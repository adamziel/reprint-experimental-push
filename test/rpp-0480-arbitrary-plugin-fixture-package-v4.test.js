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

const fixedNow = new Date('2026-05-30T12:48:00.000Z');
const rowId = 'entry_id:1';
const ownerPlugin = arbitraryPluginFixturePackageBoundary.pluginOwner;
const fixtureTable = arbitraryPluginFixturePackageBoundary.table;
const fixtureResourceKey = arbitraryPluginFixturePackageBoundary.resourceKey;
const ownerPluginFilePath = 'wp-content/plugins/driver-fixture/driver-fixture.php';
const rawSentinels = Object.freeze([
  'RPP-0480-BASE-FIXTURE-PAYLOAD-PRIVATE',
  'RPP-0480-LOCAL-FIXTURE-PAYLOAD-PRIVATE',
  'RPP-0480-REJECTED-APPLY-MESSAGE-PRIVATE',
  'RPP-0480-OWNER-PLUGIN-FILE-PRIVATE',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseFixtureSite({ payloadMode = 'base', payloadVersion = 1 } = {}) {
  return {
    files: {
      [ownerPluginFilePath]: `<?php /* ${rawSentinels[3]} */`,
    },
    plugins: {
      [ownerPlugin]: { version: '0.0.1-rpp0480', active: true },
    },
    db: {
      [fixtureTable]: {
        [rowId]: {
          entry_id: 1,
          payload: {
            owner: ownerPlugin,
            mode: payloadMode,
            version: payloadVersion,
            private_note: rawSentinels[0],
          },
          updated_marker: payloadMode,
          __pluginOwner: ownerPlugin,
        },
      },
    },
  };
}

function arbitraryFixturePolicy({ evidenceScope = 'local-playground', entryOverrides = {} } = {}) {
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
          ...entryOverrides,
        },
      ],
    },
  };
}

function planFixturePackage({ evidenceScope = 'local-playground', entryOverrides = {} } = {}) {
  const base = baseFixtureSite();
  const local = cloneJson(base);
  local.db[fixtureTable][rowId].payload.mode = 'local-update';
  local.db[fixtureTable][rowId].payload.version = 2;
  local.db[fixtureTable][rowId].payload.private_note = rawSentinels[1];
  local.db[fixtureTable][rowId].updated_marker = 'local-update';
  local.meta = arbitraryFixturePolicy({ evidenceScope, entryOverrides });
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  return {
    base,
    local,
    remote,
    plan,
    allowedEntry: local.meta.pluginOwnedResources.allowedResources[0],
  };
}

function mutationFor(plan, resourceKey = fixtureResourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey = fixtureResourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function cleanRevokedCredentialGuard() {
  return {
    resourceKey: fixtureResourceKey,
    applyRejectedCode: 'reprint_push_lab_auth_required',
    applyRejectedMessage: rawSentinels[2],
    rowRetainedAfterReject: true,
    updatedMarkerAfterReject: 'base',
    payloadModeAfterReject: 'base',
  };
}

function fixturePackageProofFromPlan({
  plan,
  mutation,
  allowedEntry,
  guard = cleanRevokedCredentialGuard(),
  evidenceScope = allowedEntry.releaseGateEvidenceScope || allowedEntry.evidenceScope || 'local-playground',
  productionBacked = evidenceScope === 'production-backed',
} = {}) {
  return {
    driver: arbitraryPluginFixturePackageBoundary.driver,
    pluginOwner: ownerPlugin,
    table: fixtureTable,
    resourceKey: fixtureResourceKey,
    proofKind: 'arbitrary-plugin-fixture-package',
    sourceKind: productionBacked ? 'production-backed' : 'local-playground',
    evidenceScope,
    releaseGateEvidenceScope: evidenceScope,
    productionBacked,
    allowlistExact: Boolean(mutation)
      && allowedEntry.driver === arbitraryPluginFixturePackageBoundary.driver
      && allowedEntry.table === fixtureTable
      && allowedEntry.pluginOwner === ownerPlugin
      && mutation.pluginOwnedResource.pluginOwner === ownerPlugin
      && mutation.pluginOwnedResource.driver === arbitraryPluginFixturePackageBoundary.driver
      && mutation.pluginOwnedResource.supportsDelete === false,
    planReady: plan.status === 'ready',
    mutationCount: plan.mutations.length,
    noMutationAfterRevokedCredential: guard.rowRetainedAfterReject === true
      && guard.updatedMarkerAfterReject === 'base'
      && guard.payloadModeAfterReject === 'base',
    proofHash: `sha256:${digest({
      planId: plan.id,
      status: plan.status,
      summary: plan.summary,
      mutationResourceKey: mutation?.resourceKey || null,
      auditEvidence: mutation?.pluginOwnedResource?.auditEvidence || null,
      driverAuditEvidence: mutation?.pluginOwnedResource?.driverAuditEvidence || null,
    })}`,
  };
}

function summarizePackageCase({
  evidenceScope = 'local-playground',
  entryOverrides = {},
  guard = cleanRevokedCredentialGuard(),
} = {}) {
  const planned = planFixturePackage({ evidenceScope, entryOverrides });
  const mutation = mutationFor(planned.plan);
  const proof = fixturePackageProofFromPlan({
    plan: planned.plan,
    mutation,
    allowedEntry: planned.allowedEntry,
    guard,
    evidenceScope,
  });
  const summary = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: guard,
    arbitraryPluginFixturePackageProof: proof,
  });
  return {
    ...planned,
    mutation,
    proof,
    summary,
  };
}

function assertNoRawSentinels(value, label) {
  const serialized = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(serialized.includes(sentinel), false, `${label} leaked raw sentinel ${sentinel}`);
  }
  assert.equal(serialized.includes('applyRejectedMessage'), false, `${label} leaked rejected apply message`);
  assert.equal(serialized.includes('rawPayload'), false, `${label} leaked raw payload`);
}

function assertSha256Evidence(value) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/);
}

test('RPP-0480 arbitrary plugin fixture package local proof stays support-only with an explicit release-gate note', () => {
  const { plan, mutation, proof, summary } = summarizePackageCase({
    evidenceScope: 'local-playground',
  });

  assert.deepEqual(
    Array.from(parseProductionPluginPackageSelectedScenarios(
      ['--scenario=arbitrary-plugin-fixture-package'],
      undefined,
    )),
    scenarioGroups['arbitrary-plugin-fixture-package'],
  );
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
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(proof.allowlistExact, true);
  assert.equal(proof.planReady, true);
  assert.equal(proof.mutationCount, 1);
  assert.equal(proof.noMutationAfterRevokedCredential, true);
  assertSha256Evidence(proof.proofHash);

  assert.equal(summary.checked, true);
  assert.equal(summary.proofKind, 'arbitrary-plugin-fixture-package');
  assert.equal(summary.evidenceScope, 'local-playground');
  assert.equal(summary.releaseGateEvidenceScope, 'local-playground');
  assert.equal(summary.sourceKind, 'local-playground');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /local\/support-only/);
  assert.match(summary.releaseGate.note, /evidenceScope=local-playground/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assertNoRawSentinels(proof, 'RPP-0480 local proof');
  assertNoRawSentinels(summary, 'RPP-0480 local summary');
});

test('RPP-0480 production-backed arbitrary plugin fixture package proof is GO only when package checks are clean', () => {
  const accepted = summarizePackageCase({
    evidenceScope: 'production-backed',
  });
  const incomplete = summarizePackageCase({
    evidenceScope: 'production-backed',
    guard: {
      ...cleanRevokedCredentialGuard(),
      updatedMarkerAfterReject: 'local-update',
      payloadModeAfterReject: 'local-update',
    },
  });

  assert.equal(accepted.plan.status, 'ready');
  assert.equal(accepted.proof.productionBacked, true);
  assert.equal(accepted.summary.checked, true);
  assert.equal(accepted.summary.productionBacked, true);
  assert.equal(accepted.summary.supportOnly, false);
  assert.equal(accepted.summary.acceptedForReleaseGate, true);
  assert.equal(accepted.summary.releaseGate.status, 'GO');
  assert.equal(accepted.summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED');
  assert.equal(accepted.summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(accepted.summary.releaseGate.productionBacked, true);
  assert.equal(accepted.summary.releaseGate.acceptedForReleaseGate, true);
  assert.match(accepted.summary.releaseGate.note, /production-backed/);
  assert.doesNotMatch(accepted.summary.releaseGate.note, /local\/support-only/);

  assert.equal(incomplete.summary.checked, false);
  assert.equal(incomplete.summary.productionBacked, true);
  assert.equal(incomplete.summary.supportOnly, false);
  assert.equal(incomplete.summary.acceptedForReleaseGate, false);
  assert.equal(incomplete.summary.remoteDataPreserved, false);
  assert.equal(incomplete.summary.releaseGate.status, 'NO-GO');
  assert.equal(incomplete.summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE');
  assert.equal(incomplete.summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(incomplete.summary.releaseGate.productionBacked, true);
  assert.equal(incomplete.summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(incomplete.summary.releaseGate.note, /production-backed/);
  assert.doesNotMatch(incomplete.summary.releaseGate.note, /local\/support-only/);
  assertNoRawSentinels(accepted.summary, 'RPP-0480 accepted production summary');
  assertNoRawSentinels(incomplete.summary, 'RPP-0480 incomplete production summary');
});

test('RPP-0480 arbitrary fixture package allowlist near misses fail closed without production release-gate credit', async (t) => {
  const cases = [
    {
      name: 'wrong plugin owner',
      entryOverrides: { pluginOwner: 'other-driver-fixture' },
      expectedDriver: null,
    },
    {
      name: 'wrong table for exact resource',
      entryOverrides: { table: 'wp_reprint_push_driver_fixture_shadow' },
      expectedDriver: arbitraryPluginFixturePackageBoundary.driver,
    },
    {
      name: 'missing arbitrary driver name',
      entryOverrides: { driver: null },
      expectedClass: 'missing-plugin-driver',
      expectedDriver: null,
    },
  ];

  for (const nearMiss of cases) {
    await t.test(nearMiss.name, () => {
      const { plan, allowedEntry } = planFixturePackage({
        evidenceScope: 'production-backed',
        entryOverrides: nearMiss.entryOverrides,
      });
      const blocker = blockerFor(plan);
      const guard = cleanRevokedCredentialGuard();
      const proof = fixturePackageProofFromPlan({
        plan,
        mutation: mutationFor(plan),
        allowedEntry,
        guard,
        evidenceScope: 'production-backed',
      });
      const summary = summarizeArbitraryPluginFixturePackageEvidence({
        driverReceiptRevokedCredentialGuard: guard,
        arbitraryPluginFixturePackageProof: proof,
      });
      const refusalEvidence = {
        rpp: 'RPP-0480',
        evidenceSource: 'local-focused-arbitrary-plugin-fixture-package-v4',
        productionBacked: false,
        releaseGate: 'NO-GO',
        nearMiss: nearMiss.name,
        blockerClass: blocker.class,
        driver: blocker.driver,
        blockerHash: `sha256:${digest(blocker)}`,
        releaseGateVerdict: summary.releaseGate.verdict,
      };

      assert.equal(plan.status, 'blocked');
      assert.equal(plan.summary.mutations, 0);
      assert.equal(plan.preconditions.length, 0);
      assert.equal(mutationFor(plan), undefined);
      assert.equal(blocker.class, nearMiss.expectedClass || 'unsupported-plugin-owned-resource');
      assert.equal(blocker.pluginOwner, ownerPlugin);
      assert.equal(blocker.driver, nearMiss.expectedDriver);
      assert.equal(summary.checked, false);
      assert.equal(summary.productionBacked, true);
      assert.equal(summary.acceptedForReleaseGate, false);
      assert.equal(summary.releaseGate.status, 'NO-GO');
      assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE');
      assert.match(summary.releaseGate.note, /production-backed/);
      assertSha256Evidence(refusalEvidence.blockerHash);
      assertNoRawSentinels(blocker, `RPP-0480 blocker ${nearMiss.name}`);
      assertNoRawSentinels(refusalEvidence, `RPP-0480 refusal proof ${nearMiss.name}`);
      assertNoRawSentinels(summary, `RPP-0480 near-miss summary ${nearMiss.name}`);
    });
  }
});
