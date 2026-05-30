import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  productionPluginDriverBoundary,
  summarizeProductionPluginDriverBoundaryProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const fixedNow = new Date('2026-05-30T12:48:30.000Z');
const boundary = productionPluginDriverBoundary;
const rawSentinels = Object.freeze([
  'RPP_0483_BASE_RELEASE_STATE_PRIVATE',
  'RPP_0483_LOCAL_RELEASE_STATE_PRIVATE',
  'RPP_0483_REMOTE_CHANGED_RELEASE_STATE_PRIVATE',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function releaseStateSnapshot(mode, version, marker, {
  privateNote = '',
  allowlistOverride = {},
} = {}) {
  return {
    files: {},
    plugins: {},
    db: {
      [boundary.table]: {
        [boundary.rowId]: {
          state_id: 1,
          payload: {
            owner: boundary.owner,
            mode,
            version,
            private_note: privateNote,
            releaseBoundaryProof: 'rpp-0483-release-verifier-custom-table-allowlist',
          },
          updated_marker: marker,
          __pluginOwner: boundary.owner,
        },
      },
    },
    meta: {
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: boundary.resourceKey,
            pluginOwner: boundary.owner,
            driver: boundary.driver,
            table: boundary.table,
            supportsDelete: false,
            ...allowlistOverride,
          },
        ],
      },
    },
  };
}

function releaseStateTopology({ allowlistOverride = {} } = {}) {
  return {
    remoteBaseSnapshot: releaseStateSnapshot('base', 1, 'base', {
      privateNote: rawSentinels[0],
      allowlistOverride,
    }),
    localEditedSnapshot: releaseStateSnapshot('local-update', 2, 'local-update', {
      privateNote: rawSentinels[1],
      allowlistOverride,
    }),
    remoteChangedSnapshot: releaseStateSnapshot('remote-changed', 3, 'remote-changed', {
      privateNote: rawSentinels[2],
      allowlistOverride,
    }),
  };
}

function releaseStatePlan({ remoteBaseSnapshot, localEditedSnapshot }) {
  return createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteBaseSnapshot,
    now: fixedNow,
  });
}

function releaseVerifierProof(plan, {
  applyStatus = 200,
  finalMatchesLocal = true,
  mutationApplied = 1,
  applyCommitted = true,
  verifiedResourceKeys = [boundary.resourceKey],
} = {}) {
  return {
    planObject: plan,
    dryRun: {
      status: 200,
      receiptHash: digest({ rpp: 'RPP-0483', phase: 'dry-run', planId: plan.id }),
    },
    apply: {
      status: applyStatus,
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        verifiedResourceKeys,
        planHash: digest(plan),
        receiptHash: digest({ rpp: 'RPP-0483', phase: 'receipt', planId: plan.id }),
        preconditionSetHash: digest(plan.preconditions),
        mutationSetHash: digest(plan.mutations),
      },
    },
    after: {
      status: 200,
      ok: true,
      finalMatchesLocal,
    },
    recoveryInspect: {
      status: 200,
    },
    replay: {
      status: 200,
    },
    dbJournal: {
      rows: 4,
      applyCommitted,
      mutationApplied,
      idempotencyOpened: 1,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
      },
    },
    latestReadRetryEvidence: {
      path: '/snapshot',
      preservedRemote: true,
    },
  };
}

function summarize(topology, proof) {
  return summarizeProductionPluginDriverBoundaryProof({
    proof,
    ...topology,
  });
}

function assertNoRawSentinels(value, label = 'RPP-0483 evidence') {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked ${sentinel}`);
  }
}

test('RPP-0483 release verifier carries exact custom-table allowlist through apply', () => {
  const topology = releaseStateTopology();
  const plan = releaseStatePlan(topology);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === boundary.resourceKey);
  const proof = releaseVerifierProof(plan);
  const summary = summarize(topology, proof);
  const evidence = {
    rpp: 'RPP-0483',
    evidenceSource: 'release-verifier-custom-table-allowlist-v5',
    productionBacked: false,
    releaseGate: 'NO-GO',
    summaryHash: digest(summary),
    planHash: digest(plan),
    mutationHash: digest({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    }),
    preconditionHash: digest(precondition),
    applyCarryThrough: summary.applyCarryThrough,
  };

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(mutation.resource.table, boundary.table);
  assert.equal(mutation.resource.id, boundary.rowId);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, boundary.owner);
  assert.equal(mutation.pluginOwnedResource.driver, boundary.driver);
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);

  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'LIVE_PLUGIN_DRIVER_BOUNDARY_OK');
  assert.equal(summary.allowlist.entry.resourceKey, boundary.resourceKey);
  assert.equal(summary.allowlist.entry.pluginOwner, boundary.owner);
  assert.equal(summary.allowlist.entry.driver, boundary.driver);
  assert.equal(summary.allowlist.entry.table, boundary.table);
  assert.equal(summary.allowlist.entry.supportsDelete, false);
  assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, true);
  assert.equal(summary.ownershipBoundary.exactMutationOwnerDriver, true);
  assert.deepEqual(summary.ownershipBoundary.nonProductionCustomTableResourceKeys, []);
  assert.equal(summary.noArbitraryCustomTableMutation, true);
  assert.equal(summary.preconditionHashes.expectedHash, summary.sourcePluginStateEvidence.hash);
  assert.equal(summary.preconditionHashes.expectedHash, summary.mutationBoundary.baseHash);
  assert.equal(summary.preconditionHashes.expectedHash, summary.mutationBoundary.remoteBeforeHash);
  assert.equal(summary.mutationBoundary.localHash, summary.localPluginStateEvidence.hash);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.equal(summary.applyCarryThrough.applyStatus, 200);
  assert.equal(summary.applyCarryThrough.finalMatchesLocal, true);
  assert.equal(summary.applyCarryThrough.dbJournalApplyCommitted, true);
  assert.equal(summary.applyCarryThrough.dbJournalMutationApplied, 1);
  assert.equal(summary.applyCarryThrough.mutationAppliedPositive, true);
  assert.equal(summary.applyCarryThrough.accepted, true);
  assert.equal(summary.auditEvidence.dbJournalMutationApplied, 1);
  assert.equal(evidence.applyCarryThrough.accepted, true);
  assert.match(evidence.summaryHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.planHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.mutationHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.preconditionHash, /^[a-f0-9]{64}$/);
  assertNoRawSentinels(summary, 'release verifier summary');
  assertNoRawSentinels(evidence, 'focused evidence envelope');
});

test('RPP-0483 release verifier blocks custom-table allowlist and apply carry-through near misses', async (t) => {
  const allowlistCases = [
    {
      label: 'wrong owner on exact resource',
      allowlistOverride: { pluginOwner: 'other-reprint-push-owner' },
    },
    {
      label: 'wrong driver on exact table',
      allowlistOverride: { driver: 'other-release-state-driver' },
    },
    {
      label: 'wrong table on exact resource',
      allowlistOverride: { table: 'wp_reprint_push_release_state_shadow' },
    },
  ];

  for (const nearMiss of allowlistCases) {
    await t.test(nearMiss.label, () => {
      const topology = releaseStateTopology({ allowlistOverride: nearMiss.allowlistOverride });
      const plan = releaseStatePlan(topology);
      const summary = summarize(topology, releaseVerifierProof(plan));

      assert.equal(summary.status, 'blocked');
      assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
      assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, false);
      assert.equal(summary.applyCarryThrough.accepted, true);
      assertNoRawSentinels(summary, nearMiss.label);
    });
  }

  await t.test('apply evidence did not carry the mutation to final local state', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const summary = summarize(topology, releaseVerifierProof(plan, {
      finalMatchesLocal: false,
    }));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, true);
    assert.equal(summary.ownershipBoundary.exactMutationOwnerDriver, true);
    assert.equal(summary.applyCarryThrough.finalMatchesLocal, false);
    assert.equal(summary.applyCarryThrough.accepted, false);
    assertNoRawSentinels(summary, 'failed apply carry-through summary');
  });

  await t.test('extra custom-table mutation is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const extraResourceKey = 'row:["wp_reprint_push_release_state_shadow","state_id:1"]';
    const extraResource = {
      type: 'row',
      table: 'wp_reprint_push_release_state_shadow',
      id: 'state_id:1',
      key: extraResourceKey,
    };
    const extraMutation = {
      ...cloneJson(plan.mutations[0]),
      id: 'mutation-rpp-0483-extra-custom-table',
      resource: extraResource,
      resourceKey: extraResourceKey,
      pluginOwnedResource: {
        ...cloneJson(plan.mutations[0].pluginOwnedResource),
        driver: 'other-release-state-driver',
      },
    };
    plan.mutations.push(extraMutation);
    plan.summary.mutations = plan.mutations.length;

    const summary = summarize(topology, releaseVerifierProof(plan, {
      mutationApplied: 2,
      verifiedResourceKeys: [boundary.resourceKey, extraResourceKey],
    }));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, true);
    assert.equal(summary.ownershipBoundary.exactMutationOwnerDriver, true);
    assert.equal(summary.noArbitraryCustomTableMutation, false);
    assert.deepEqual(summary.ownershipBoundary.nonProductionCustomTableResourceKeys, [extraResourceKey]);
    assert.equal(summary.applyCarryThrough.accepted, true);
    assertNoRawSentinels(summary, 'extra custom table summary');
  });
});
