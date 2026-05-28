import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_COMPATIBILITY_CONTRACT,
  expectedCapabilitiesForVersion,
  negotiatePushProtocolCompatibility,
  protocolCompatibilitySummary,
  validateProtocolCompatibilityContract,
} from '../src/protocol-compatibility.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
const contractFixture = readJson('fixtures/protocol/push-protocol-compatibility-contract.json');

function fixtureVersion(version) {
  const definition = contractFixture.supported_versions.find((entry) => entry.version === version);
  assert.ok(definition, `fixture is missing protocol version ${version}`);
  return definition;
}

function jsVersion(version) {
  const definition = PROTOCOL_COMPATIBILITY_CONTRACT.supportedVersions.find((entry) => entry.version === version);
  assert.ok(definition, `source contract is missing protocol version ${version}`);
  return definition;
}

function offer(definition, overrides = {}) {
  return {
    version: definition.version,
    capabilities: [...definition.capabilities],
    ...overrides,
  };
}

test('protocol compatibility fixture is machine-readable and aligned with source contract', () => {
  const validation = validateProtocolCompatibilityContract(contractFixture);

  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(contractFixture.contract_id, PROTOCOL_COMPATIBILITY_CONTRACT.contractId);
  assert.equal(contractFixture.schema_version, PROTOCOL_COMPATIBILITY_CONTRACT.schemaVersion);
  assert.equal(contractFixture.machine_readable, true);
  assert.equal(contractFixture.negotiation.minimum_version, PROTOCOL_COMPATIBILITY_CONTRACT.minimumVersion);
  assert.equal(contractFixture.negotiation.current_version, PROTOCOL_COMPATIBILITY_CONTRACT.currentVersion);
  assert.equal(contractFixture.negotiation.fail_closed_on_unknown_version, true);
  assert.equal(contractFixture.negotiation.fail_closed_on_downgrade, true);
  assert.equal(contractFixture.negotiation.exact_capability_set_required, true);
  assert.equal(contractFixture.negotiation.fallback_policy, 'no-fallback-after-incompatible-offer');
  assert.deepEqual(contractFixture.required_capability_groups, ['auth', 'journal', 'lease']);
  assert.deepEqual(
    contractFixture.supported_versions.map((entry) => entry.version),
    PROTOCOL_COMPATIBILITY_CONTRACT.supportedVersions.map((entry) => entry.version),
  );

  for (const fixtureDefinition of contractFixture.supported_versions) {
    const sourceDefinition = jsVersion(fixtureDefinition.version);
    assert.deepEqual(fixtureDefinition.capabilities, sourceDefinition.capabilities);
    assert.deepEqual(fixtureDefinition.required_capabilities, sourceDefinition.requiredCapabilities);
    assert.deepEqual([...fixtureDefinition.capabilities].sort(), fixtureDefinition.capabilities);
    assert.equal(new Set(fixtureDefinition.capabilities).size, fixtureDefinition.capabilities.length);
    for (const group of contractFixture.required_capability_groups) {
      assert.ok(fixtureDefinition.required_capabilities[group].length > 0, `${group} requirements must not be empty`);
      assert.deepEqual(
        fixtureDefinition.required_capabilities[group].filter(
          (capability) => !fixtureDefinition.capabilities.includes(capability),
        ),
        [],
        `${fixtureDefinition.version} ${group} requirements must be part of the exact capability set`,
      );
    }
  }
});

test('supported protocol versions negotiate exact capabilities', () => {
  for (const definition of PROTOCOL_COMPATIBILITY_CONTRACT.supportedVersions) {
    const result = negotiatePushProtocolCompatibility(offer(definition));

    assert.equal(result.ok, true, definition.version);
    assert.equal(result.status, 'negotiated');
    assert.equal(result.mutationAllowed, true);
    assert.equal(result.failClosed, false);
    assert.equal(result.negotiatedVersion, definition.version);
    assert.deepEqual(result.capabilities, definition.capabilities);
    assert.deepEqual(result.capabilityComparison.missingCapabilities, []);
    assert.deepEqual(result.capabilityComparison.unexpectedCapabilities, []);
    assert.match(result.capabilityDigest, /^sha256:[a-f0-9]{64}$/);

    for (const [group, required] of Object.entries(definition.requiredCapabilities)) {
      assert.equal(result.requiredCapabilityEvidence[group].status, 'passed');
      assert.deepEqual(result.requiredCapabilityEvidence[group].required, required);
      assert.deepEqual(result.requiredCapabilityEvidence[group].observed, required);
      assert.deepEqual(result.requiredCapabilityEvidence[group].missing, []);
    }
  }
});

test('multi-version negotiation selects the highest exact supported version only when every offer is compatible', () => {
  const baseline = jsVersion('1.0.0');
  const current = jsVersion('1.1.0');
  const result = negotiatePushProtocolCompatibility({
    offers: [
      offer(baseline),
      offer(current),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.negotiatedVersion, '1.1.0');
  assert.deepEqual(result.capabilities, current.capabilities);
  assert.deepEqual(expectedCapabilitiesForVersion('1.1.0'), current.capabilities);
});

test('unknown and downgraded protocol versions fail closed without mutation authority', () => {
  const current = jsVersion('1.1.0');
  const unknown = negotiatePushProtocolCompatibility({
    version: '9.9.9',
    capabilities: current.capabilities,
  });
  const downgraded = negotiatePushProtocolCompatibility({
    version: '0.9.0',
    capabilities: ['auth.hmac-sha1', 'journal.best-effort', 'lease.none'],
  });

  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 'failed-closed');
  assert.equal(unknown.mutationAllowed, false);
  assert.equal(unknown.failClosed, true);
  assert.equal(unknown.code, 'PUSH_PROTOCOL_VERSION_UNSUPPORTED');
  assert.deepEqual(protocolCompatibilitySummary(unknown), {
    evaluator: 'reprint-push-protocol-compatibility',
    status: 'failed-closed',
    ok: false,
    mutationAllowed: false,
    failClosed: true,
    code: 'PUSH_PROTOCOL_VERSION_UNSUPPORTED',
    negotiatedVersion: null,
    offeredVersions: ['9.9.9'],
    missingRequiredCapabilities: [],
    missingCapabilities: [],
    unexpectedCapabilities: [],
  });

  assert.equal(downgraded.ok, false);
  assert.equal(downgraded.status, 'failed-closed');
  assert.equal(downgraded.mutationAllowed, false);
  assert.equal(downgraded.failClosed, true);
  assert.equal(downgraded.code, 'PUSH_PROTOCOL_VERSION_DOWNGRADED');
  assert.match(downgraded.reason, /below minimum supported version 1\.0\.0/);
});

test('incompatible offers do not silently fall back to a lower supported version', () => {
  const baseline = jsVersion('1.0.0');
  const current = jsVersion('1.1.0');

  const withUnknown = negotiatePushProtocolCompatibility({
    offers: [
      offer(current),
      { version: '9.9.9', capabilities: current.capabilities },
      offer(baseline),
    ],
  });
  const withDowngrade = negotiatePushProtocolCompatibility({
    offers: [
      offer(baseline),
      { version: '0.9.0', capabilities: baseline.capabilities },
    ],
  });

  assert.equal(withUnknown.ok, false);
  assert.equal(withUnknown.code, 'PUSH_PROTOCOL_VERSION_UNSUPPORTED');
  assert.equal(withUnknown.mutationAllowed, false);
  assert.equal(withUnknown.negotiatedVersion, null);
  assert.equal(withDowngrade.ok, false);
  assert.equal(withDowngrade.code, 'PUSH_PROTOCOL_VERSION_DOWNGRADED');
  assert.equal(withDowngrade.mutationAllowed, false);
  assert.equal(withDowngrade.negotiatedVersion, null);
});

test('required auth, journal, and lease capabilities are not silently ignored', () => {
  const current = jsVersion('1.1.0');

  for (const [group, requiredCapabilities] of Object.entries(current.requiredCapabilities)) {
    const missingCapability = requiredCapabilities[0];
    const result = negotiatePushProtocolCompatibility({
      version: current.version,
      capabilities: current.capabilities.filter((capability) => capability !== missingCapability),
    });

    assert.equal(result.ok, false, group);
    assert.equal(result.status, 'failed-closed', group);
    assert.equal(result.code, 'PUSH_PROTOCOL_REQUIRED_CAPABILITY_MISSING', group);
    assert.equal(result.mutationAllowed, false, group);
    assert.deepEqual(result.capabilityComparison.missingRequiredCapabilities, [missingCapability], group);
    assert.equal(result.requiredCapabilityEvidence[group].status, 'missing', group);
    assert.deepEqual(result.requiredCapabilityEvidence[group].missing, [missingCapability], group);
  }
});

test('capability extras and non-required omissions fail closed instead of creating implicit extensions', () => {
  const current = jsVersion('1.1.0');
  const withExtra = negotiatePushProtocolCompatibility({
    version: current.version,
    capabilities: [...current.capabilities, 'debug.experimental-write-authority'],
  });
  const withoutNonRequired = negotiatePushProtocolCompatibility({
    version: current.version,
    capabilities: current.capabilities.filter((capability) => capability !== 'topology.local-only-ingress-8080'),
  });

  assert.equal(withExtra.ok, false);
  assert.equal(withExtra.status, 'failed-closed');
  assert.equal(withExtra.code, 'PUSH_PROTOCOL_CAPABILITY_MISMATCH');
  assert.deepEqual(withExtra.capabilityComparison.unexpectedCapabilities, ['debug.experimental-write-authority']);
  assert.equal(withExtra.mutationAllowed, false);

  assert.equal(withoutNonRequired.ok, false);
  assert.equal(withoutNonRequired.status, 'failed-closed');
  assert.equal(withoutNonRequired.code, 'PUSH_PROTOCOL_CAPABILITY_MISMATCH');
  assert.deepEqual(withoutNonRequired.capabilityComparison.missingCapabilities, ['topology.local-only-ingress-8080']);
  assert.deepEqual(withoutNonRequired.capabilityComparison.missingRequiredCapabilities, []);
  assert.equal(withoutNonRequired.mutationAllowed, false);
});

test('negative cases in the contract fixture are executable fail-closed proofs', () => {
  assert.ok(contractFixture.negative_contracts.length >= 4);

  for (const contractCase of contractFixture.negative_contracts) {
    const result = negotiatePushProtocolCompatibility(contractCase.offer);

    assert.equal(result.ok, false, contractCase.case);
    assert.equal(result.status, 'failed-closed', contractCase.case);
    assert.equal(result.code, contractCase.expected_code, contractCase.case);
    assert.equal(result.mutationAllowed, contractCase.mutation_allowed, contractCase.case);
    if (contractCase.missing_required_capabilities) {
      assert.deepEqual(
        result.capabilityComparison.missingRequiredCapabilities,
        contractCase.missing_required_capabilities,
        contractCase.case,
      );
    }
  }
});
