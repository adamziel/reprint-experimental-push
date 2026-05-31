import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  arbitraryPluginFixturePackageBoundary,
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
  summarizeArbitraryPluginFixturePackageEvidence,
} from '../scripts/playground/production-plugin-package-scenarios.js';

const fixedNow = new Date('2026-05-30T12:46:00.000Z');
const evidenceScope = 'local-generated';
const rowId = 'entry_id:1';
const ownerPlugin = arbitraryPluginFixturePackageBoundary.pluginOwner;
const fixtureTable = arbitraryPluginFixturePackageBoundary.table;
const fixtureResourceKey = arbitraryPluginFixturePackageBoundary.resourceKey;
const ownerPluginFilePath = 'wp-content/plugins/driver-fixture/driver-fixture.php';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function generatedFixtureCases() {
  return [
    {
      id: 'rpp-0460-generated-arbitrary-plugin-alpha',
      label: 'alpha',
      baseVersion: 1,
      localVersion: 2,
      rawMarkers: [
        'RPP-0460-ALPHA-BASE-RAW-FIXTURE',
        'RPP-0460-ALPHA-LOCAL-RAW-FIXTURE',
        'RPP-0460-ALPHA-REJECTED-MESSAGE-RAW',
      ],
    },
    {
      id: 'rpp-0460-generated-arbitrary-plugin-beta',
      label: 'beta',
      baseVersion: 3,
      localVersion: 4,
      rawMarkers: [
        'RPP-0460-BETA-BASE-RAW-FIXTURE',
        'RPP-0460-BETA-LOCAL-RAW-FIXTURE',
        'RPP-0460-BETA-REJECTED-MESSAGE-RAW',
      ],
    },
  ];
}

function fixtureRow(testCase, mode, version, rawMarker) {
  return {
    entry_id: 1,
    payload: {
      owner: ownerPlugin,
      mode,
      version,
      generatedLabelHash: sha256Evidence({
        id: testCase.id,
        label: testCase.label,
        version,
      }),
      rawFixtureMarker: rawMarker,
    },
    updated_marker: mode,
    __pluginOwner: ownerPlugin,
  };
}

function baseFixtureSite(testCase) {
  return {
    files: {
      [ownerPluginFilePath]: `<?php /* ${testCase.id} plugin fixture */`,
    },
    plugins: {
      [ownerPlugin]: { version: `0.0.${testCase.baseVersion}-rpp0460`, active: true },
    },
    db: {
      [fixtureTable]: {
        [rowId]: fixtureRow(testCase, 'base', testCase.baseVersion, testCase.rawMarkers[0]),
      },
    },
  };
}

function fixturePolicy() {
  return {
    pluginOwnedResources: {
      evidenceScope,
      allowedResources: [
        {
          resourceKey: fixtureResourceKey,
          pluginOwner: ownerPlugin,
          driver: arbitraryPluginFixturePackageBoundary.driver,
          table: fixtureTable,
          supportsDelete: false,
          releaseGateEvidenceScope: evidenceScope,
        },
      ],
    },
  };
}

function planGeneratedFixtureCase(testCase) {
  const base = baseFixtureSite(testCase);
  const local = cloneJson(base);
  local.db[fixtureTable][rowId] = fixtureRow(
    testCase,
    `local-${testCase.label}`,
    testCase.localVersion,
    testCase.rawMarkers[1],
  );
  local.meta = fixturePolicy();
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === fixtureResourceKey);
  return { base, local, remote, plan, mutation };
}

function cleanRevokedCredentialGuard(testCase) {
  return {
    resourceKey: fixtureResourceKey,
    applyRejectedCode: 'reprint_push_lab_auth_required',
    applyRejectedMessage: testCase.rawMarkers[2],
    rowRetainedAfterReject: true,
    updatedMarkerAfterReject: 'base',
    payloadModeAfterReject: 'base',
    guardEvidenceHash: sha256Evidence({
      id: testCase.id,
      resourceKey: fixtureResourceKey,
      rejected: true,
      retainedMode: 'base',
    }),
    rawPayload: testCase.rawMarkers[0],
  };
}

function packageProofFromPlan(testCase, plan, mutation) {
  return {
    driver: arbitraryPluginFixturePackageBoundary.driver,
    pluginOwner: ownerPlugin,
    table: fixtureTable,
    resourceKey: fixtureResourceKey,
    proofKind: 'arbitrary-plugin-fixture-package',
    sourceKind: evidenceScope,
    evidenceScope,
    releaseGateEvidenceScope: evidenceScope,
    productionBacked: false,
    allowlistExact: Boolean(mutation)
      && mutation.pluginOwnedResource.pluginOwner === ownerPlugin
      && mutation.pluginOwnedResource.driver === arbitraryPluginFixturePackageBoundary.driver
      && mutation.pluginOwnedResource.supportsDelete === false
      && mutation.pluginOwnedResource.auditEvidence.format === 'hash-only'
      && mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded === false
      && mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded === false,
    planReady: plan.status === 'ready',
    mutationCount: plan.mutations.length,
    noMutationAfterRevokedCredential: true,
    generatedFixtureHash: sha256Evidence({
      id: testCase.id,
      resourceKey: fixtureResourceKey,
      baseHash: mutation?.change?.base?.hash || null,
      localHash: mutation?.change?.local?.hash || null,
      remoteHash: mutation?.change?.remote?.hash || null,
    }),
    auditEvidenceHash: sha256Evidence(mutation?.pluginOwnedResource?.auditEvidence || null),
    driverAuditEvidenceHash: sha256Evidence(mutation?.pluginOwnedResource?.driverAuditEvidence || null),
    proofHash: sha256Evidence({
      planId: plan.id,
      status: plan.status,
      summary: plan.summary,
      mutationResourceKey: mutation?.resourceKey || null,
      auditEvidence: mutation?.pluginOwnedResource?.auditEvidence || null,
      driverAuditEvidence: mutation?.pluginOwnedResource?.driverAuditEvidence || null,
    }),
  };
}

function summarizeGeneratedFixtureCase(testCase) {
  const { plan, mutation } = planGeneratedFixtureCase(testCase);
  const guard = cleanRevokedCredentialGuard(testCase);
  const proof = packageProofFromPlan(testCase, plan, mutation);
  const summary = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: guard,
    arbitraryPluginFixturePackageProof: proof,
  });
  return { plan, mutation, guard, proof, summary };
}

function assertSha256Evidence(value) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/);
}

function assertNoRawMarkers(testCase, value, label) {
  const serialized = JSON.stringify(value);
  for (const marker of testCase.rawMarkers) {
    assert.equal(serialized.includes(marker), false, `${label} leaked raw fixture marker ${marker}`);
  }
  assert.equal(serialized.includes('rawPayload'), false, `${label} leaked rawPayload`);
  assert.equal(serialized.includes('applyRejectedMessage'), false, `${label} leaked rejected credential message`);
}

test('RPP-0460 arbitrary plugin fixture package alias stays bounded for generated variant 3', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=arbitrary-plugin-fixture-package'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected),
    scenarioGroups['arbitrary-plugin-fixture-package'],
  );
  assert.deepEqual(Array.from(selected), ['driver-receipt-guards']);
  assert.equal(arbitraryPluginFixturePackageBoundary.plugin, 'driver-fixture/driver-fixture.php');
  assert.equal(arbitraryPluginFixturePackageBoundary.driver, 'fixture-arbitrary-plugin-table');
  assert.equal(arbitraryPluginFixturePackageBoundary.pluginOwner, ownerPlugin);
  assert.equal(arbitraryPluginFixturePackageBoundary.table, fixtureTable);
  assert.equal(arbitraryPluginFixturePackageBoundary.resourceKey, fixtureResourceKey);
});

test('RPP-0460 generated arbitrary plugin fixture package proof is hash-only local support evidence', async (t) => {
  for (const testCase of generatedFixtureCases()) {
    await t.test(testCase.id, () => {
      const { plan, mutation, proof, summary } = summarizeGeneratedFixtureCase(testCase);

      assert.equal(plan.status, 'ready');
      assert.deepEqual(plan.summary, {
        mutations: 1,
        decisions: 0,
        conflicts: 0,
        blockers: 0,
        atomicGroups: 0,
      });
      assert.equal(plan.preconditions.length, 1);
      assert.equal(mutation.resourceKey, fixtureResourceKey);
      assert.equal(mutation.resource.table, fixtureTable);
      assert.equal(mutation.resource.id, rowId);
      assert.equal(mutation.pluginOwnedResource.pluginOwner, ownerPlugin);
      assert.equal(mutation.pluginOwnedResource.driver, arbitraryPluginFixturePackageBoundary.driver);
      assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
      assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
      assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
      assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
      assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
      assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
      assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);

      assert.equal(proof.productionBacked, false);
      assert.equal(proof.allowlistExact, true);
      assert.equal(proof.planReady, true);
      assert.equal(proof.mutationCount, 1);
      assert.equal(proof.noMutationAfterRevokedCredential, true);
      assertSha256Evidence(proof.generatedFixtureHash);
      assertSha256Evidence(proof.auditEvidenceHash);
      assertSha256Evidence(proof.driverAuditEvidenceHash);
      assertSha256Evidence(proof.proofHash);

      assert.equal(summary.checked, true);
      assert.equal(summary.proofKind, 'arbitrary-plugin-fixture-package');
      assert.equal(summary.evidenceScope, evidenceScope);
      assert.equal(summary.releaseGateEvidenceScope, evidenceScope);
      assert.equal(summary.sourceKind, evidenceScope);
      assert.equal(summary.productionBacked, false);
      assert.equal(summary.supportOnly, true);
      assert.equal(summary.acceptedForReleaseGate, false);
      assert.equal(summary.releaseGate.status, 'NO-GO');
      assert.equal(summary.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
      assert.equal(summary.releaseGate.evidenceScope, evidenceScope);
      assert.equal(summary.releaseGate.productionBacked, false);
      assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
      assert.match(summary.releaseGate.note, /local\/support-only/);
      assert.match(summary.releaseGate.note, /evidenceScope=local-generated/);
      assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
      assert.equal(summary.packageProof.allowlistExact, true);
      assert.equal(summary.packageProof.planReady, true);
      assert.equal(summary.packageProof.mutationCount, 1);
      assert.equal(summary.packageProof.noMutationAfterRevokedCredential, true);
      assert.equal(summary.revokedCredentialGuard.applyRejectedCode, 'reprint_push_lab_auth_required');
      assert.equal(summary.revokedCredentialGuard.updatedMarkerAfterReject, 'base');
      assert.equal(summary.revokedCredentialGuard.payloadModeAfterReject, 'base');

      assertNoRawMarkers(testCase, proof, `${testCase.id} package proof`);
      assertNoRawMarkers(testCase, summary, `${testCase.id} package summary`);
    });
  }
});

test('RPP-0460 generated arbitrary plugin fixture package release posture stays support-only NO-GO', () => {
  const evidence = generatedFixtureCases().map((testCase) => {
    const { proof, summary } = summarizeGeneratedFixtureCase(testCase);
    return {
      id: testCase.id,
      proofHash: proof.proofHash,
      evidenceScope: summary.evidenceScope,
      productionBacked: summary.productionBacked,
      supportOnly: summary.supportOnly,
      releaseGateStatus: summary.releaseGate.status,
      releaseGateVerdict: summary.releaseGate.verdict,
      releaseGateNoteHash: sha256Evidence(summary.releaseGate.note),
    };
  });

  assert.equal(evidence.length, 2);
  for (const entry of evidence) {
    assertSha256Evidence(entry.proofHash);
    assertSha256Evidence(entry.releaseGateNoteHash);
    assert.equal(entry.evidenceScope, evidenceScope);
    assert.equal(entry.productionBacked, false);
    assert.equal(entry.supportOnly, true);
    assert.equal(entry.releaseGateStatus, 'NO-GO');
    assert.equal(entry.releaseGateVerdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  }
});
