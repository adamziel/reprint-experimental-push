import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  productionPluginDriverBoundary,
  summarizeProductionPluginDriverBoundaryProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const fixedNow = new Date('2026-05-30T10:28:08.000Z');
const unknownTable = 'wp_rpp0288_unknown_forms_entries';
const unknownRowId = 'entry_id:288';
const unknownResourceKey = `row:${JSON.stringify([unknownTable, unknownRowId])}`;
const unknownResource = Object.freeze({
  type: 'row',
  table: unknownTable,
  id: unknownRowId,
  key: unknownResourceKey,
});
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'RPP_0288_BASE_PRIVATE_FORM_PAYLOAD',
  'RPP_0288_LOCAL_PRIVATE_FORM_PAYLOAD',
  'RPP_0288_PRODUCTION_DRIVER_BASE_PRIVATE',
  'RPP_0288_PRODUCTION_DRIVER_LOCAL_PRIVATE',
  'RPP_0288_PRODUCTION_DRIVER_REMOTE_PRIVATE',
  '<?php /* RPP-0288 private forms plugin file */',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function unknownFormsEntry({ mode, privatePayload, revision }) {
  return {
    entry_id: 288,
    status: 'submitted',
    payload: {
      mode,
      revision,
      privatePayload,
    },
    __pluginOwner: 'forms',
  };
}

function unknownPluginBaseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': rawFixtures[5],
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      [unknownTable]: {
        [unknownRowId]: unknownFormsEntry({
          mode: 'base',
          privatePayload: rawFixtures[0],
          revision: 1,
        }),
      },
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
}

function assertPlanSummaryMatchesEvidence(plan, label) {
  assert.deepEqual(
    plan.summary,
    {
      mutations: plan.mutations.length,
      decisions: plan.decisions.length,
      conflicts: plan.conflicts.length,
      blockers: plan.blockers.length,
      atomicGroups: plan.atomicGroups.length,
    },
    `${label} summary must match emitted planner evidence`,
  );
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${label} status must match emitted planner evidence`,
  );
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} live-remote preconditions must remain one-for-one with planned mutations`,
  );
}

function assertNoRawUnknownPayloads(value, label = 'RPP-0288 release verifier proof') {
  const serialized = JSON.stringify(value);
  for (const fixture of rawFixtures) {
    assert.equal(serialized.includes(fixture), false, `${label} leaked raw fixture value ${fixture}`);
  }
  assert.equal(serialized.includes('privatePayload'), false, `${label} exposed private payload field name`);
  assert.equal(serialized.includes('__pluginOwner'), false, `${label} exposed raw owner marker field`);
}

function blockedPlanEvidence(plan) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === unknownResourceKey);
  assert.ok(blocker, 'unknown plugin-owned target should have a blocker');
  const refusal = blocker.unknownPluginOwnedResourceRefusalEvidence;
  assert.ok(refusal, 'unknown plugin-owned blocker should include refusal evidence');

  return {
    status: plan.status,
    summary: plan.summary,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    planHash: sha256Evidence(plan),
    deterministicReplayHash: sha256Evidence({
      status: plan.status,
      summary: plan.summary,
      blockerHash: sha256Evidence(blocker),
    }),
    blocker: {
      class: blocker.class,
      reasonCode: blocker.reasonCode,
      resourceKey: blocker.resourceKey,
      pluginOwner: blocker.pluginOwner,
      driver: blocker.driver,
      policySource: blocker.policySource,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      change: blocker.change,
      blockerHash: sha256Evidence(blocker),
      refusalEvidenceHash: sha256Evidence(refusal),
      refusalEvidence: {
        schemaVersion: refusal.schemaVersion,
        reasonCode: refusal.reasonCode,
        operation: refusal.operation,
        outcome: refusal.outcome,
        format: refusal.format,
        rawValuesIncluded: refusal.rawValuesIncluded,
        resourceKey: refusal.resourceKey,
        pluginOwner: refusal.pluginOwner,
        driver: refusal.driver,
        policySource: refusal.policySource,
        resource: refusal.resource,
        hashes: refusal.hashes,
        change: refusal.change,
      },
    },
  };
}

function blockedApplyRefusalEvidence(plan, remote) {
  const blockedRemote = cloneJson(remote);
  const remoteHashBefore = digest(blockedRemote);
  const error = captureError(() => applyPlan(blockedRemote, plan, { mutateRemote: true }));
  const remoteHashAfter = digest(blockedRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.deepEqual(error.details, { status: 'blocked' });

  return {
    code: error.code,
    status: error.details.status,
    rejectedBeforeMutation: true,
    remoteDataPreserved: remoteHashAfter === remoteHashBefore,
    remoteHashBefore: `sha256:${remoteHashBefore}`,
    remoteHashAfter: `sha256:${remoteHashAfter}`,
    detailsHash: sha256Evidence(error.details),
  };
}

function forgedReadyPlanFromUnknownBlocker(blockedPlan, local, remote) {
  const blocker = blockedPlan.blockers.find((entry) => entry.resourceKey === unknownResourceKey);
  const mutationId = 'mutation-rpp-0288-forged-unknown-plugin-owned-resource-v5';
  const forged = cloneJson(blockedPlan);
  const plannedValue = local.db[unknownTable][unknownRowId];
  const remoteHash = resourceHash(remote, unknownResource);

  forged.status = 'ready';
  forged.conflicts = [];
  forged.blockers = [];
  forged.decisions = [];
  forged.atomicGroups = [];
  forged.mutations = [
    {
      id: mutationId,
      resource: unknownResource,
      resourceKey: unknownResource.key,
      action: 'put',
      value: serializeResourceValue(plannedValue),
      remoteBeforeHash: remoteHash,
      baseHash: blocker.baseHash,
      localHash: resourceHash(local, unknownResource),
      changeKind: 'update',
      change: blocker.change,
      atomicGroupId: null,
      pluginOwnedResource: {
        pluginOwner: 'forms',
        driver: null,
        policySource: null,
        supportsDelete: false,
      },
    },
  ];
  forged.preconditions = [
    {
      mutationId,
      resource: unknownResource,
      resourceKey: unknownResource.key,
      expectedHash: remoteHash,
      checkedAgainst: 'live-remote',
    },
  ];
  forged.summary = {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  };

  return forged;
}

function forgedApplyRefusalEvidence(blockedPlan, local, remote) {
  const forgedPlan = forgedReadyPlanFromUnknownBlocker(blockedPlan, local, remote);
  const forgedRemote = cloneJson(remote);
  const remoteHashBefore = digest(forgedRemote);
  const error = captureError(() => applyPlan(forgedRemote, forgedPlan, { mutateRemote: true }));
  const remoteHashAfter = digest(forgedRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(error.details.resourceKey, unknownResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, null);
  assert.equal(error.details.applyValidationEvidence.outcome, 'refused-before-mutation');

  return {
    code: error.code,
    mutationId: error.details.mutationId,
    resourceKey: error.details.resourceKey,
    pluginOwner: error.details.pluginOwner,
    driver: error.details.driver,
    reasonCode: error.details.applyValidationEvidence.reasonCode,
    rejectedBeforeMutation: error.details.applyValidationEvidence.outcome === 'refused-before-mutation',
    remoteDataPreserved: remoteHashAfter === remoteHashBefore,
    remoteHashBefore: `sha256:${remoteHashBefore}`,
    remoteHashAfter: `sha256:${remoteHashAfter}`,
    applyValidationHash: sha256Evidence(error.details.applyValidationEvidence),
    detailsHash: sha256Evidence(error.details),
    forgedPlanHash: sha256Evidence(forgedPlan),
  };
}

function buildUnknownPluginOwnedReleaseVerifierProof() {
  const base = unknownPluginBaseSite();
  const local = cloneJson(base);
  local.db[unknownTable][unknownRowId] = unknownFormsEntry({
    mode: 'local-update',
    privatePayload: rawFixtures[1],
    revision: 2,
  });
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const planEvidence = blockedPlanEvidence(plan);
  const replayPlanEvidence = blockedPlanEvidence(replayPlan);

  assert.equal(plan.status, 'blocked');
  assertPlanSummaryMatchesEvidence(plan, 'RPP-0288 focused blocked plan');
  assert.deepEqual(plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.deepEqual(planEvidence, replayPlanEvidence, 'RPP-0288 refusal evidence must be deterministic');

  const proof = {
    rpp: 'RPP-0288',
    evidenceSource: 'release-verifier-unknown-plugin-owned-resource-refusal-v5',
    status: 'support_only',
    verdict: 'UNKNOWN_PLUGIN_OWNED_RESOURCE_REFUSED_BEFORE_MUTATION',
    evidenceScope: 'local-generated-release-verifier',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    releaseVerifier: {
      checkedBy: 'test/rpp-0288-unknown-plugin-owned-resource-refusal-release-verifier-v5.test.js',
      check: 'unknown-plugin-owned-resource-refusal',
      variant: 'v5',
      plannerRefusesUnknownPluginOwnedData: true,
      executorRejectsBlockedPlans: true,
      executorRejectsForgedMutationAttempts: true,
    },
    resource: {
      resourceKey: unknownResourceKey,
      table: unknownTable,
      rowId: unknownRowId,
      pluginOwner: 'forms',
    },
    plan: planEvidence,
    blockedPlanApplyRefusal: blockedApplyRefusalEvidence(plan, remote),
    forgedMutationRefusal: forgedApplyRefusalEvidence(plan, local, remote),
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      rawFieldNamesIncluded: false,
      surfaces: [
        'planner-unknown-plugin-owned-resource-refusal',
        'blocked-plan-apply-refusal',
        'forged-ready-plan-apply-refusal',
        'release-verifier-proof',
      ],
    },
  };
  proof.proofHash = sha256Evidence({
    releaseVerifier: proof.releaseVerifier,
    resource: proof.resource,
    plan: proof.plan,
    blockedPlanApplyRefusal: proof.blockedPlanApplyRefusal,
    forgedMutationRefusal: proof.forgedMutationRefusal,
    redaction: proof.redaction,
  });

  assertNoRawUnknownPayloads(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0288 release verifier proof' }));
  return proof;
}

function productionDriverSnapshot(mode, version, marker, privateNote) {
  const boundary = productionPluginDriverBoundary;
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
            privateNote,
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
          },
        ],
      },
    },
  };
}

function productionDriverProof(plan) {
  return {
    planObject: plan,
    dryRun: {
      status: 200,
      receiptHash: sha256Evidence({ rpp: 'RPP-0288', phase: 'dry-run', planId: plan.id }),
    },
    apply: {
      status: 200,
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        verifiedResourceKeys: [productionPluginDriverBoundary.resourceKey],
        planHash: digest(plan),
        receiptHash: sha256Evidence({ rpp: 'RPP-0288', phase: 'receipt', planId: plan.id }),
        preconditionSetHash: digest(plan.preconditions),
        mutationSetHash: digest(plan.mutations),
      },
    },
    after: {
      status: 200,
      ok: true,
      finalMatchesLocal: true,
    },
    recoveryInspect: {
      status: 200,
    },
    replay: {
      status: 200,
    },
    dbJournal: {
      rows: 4,
      applyCommitted: true,
      mutationApplied: 1,
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

test('RPP-0288 release verifier carries unknown plugin-owned resource refusal as hash-only support evidence', () => {
  const proof = buildUnknownPluginOwnedReleaseVerifierProof();
  const blocker = proof.plan.blocker;
  const refusal = blocker.refusalEvidence;

  assert.equal(proof.rpp, 'RPP-0288');
  assert.equal(proof.evidenceSource, 'release-verifier-unknown-plugin-owned-resource-refusal-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'UNKNOWN_PLUGIN_OWNED_RESOURCE_REFUSED_BEFORE_MUTATION');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'test/rpp-0288-unknown-plugin-owned-resource-refusal-release-verifier-v5.test.js',
    check: 'unknown-plugin-owned-resource-refusal',
    variant: 'v5',
    plannerRefusesUnknownPluginOwnedData: true,
    executorRejectsBlockedPlans: true,
    executorRejectsForgedMutationAttempts: true,
  });

  assert.equal(proof.plan.status, 'blocked');
  assert.deepEqual(proof.plan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 0,
    blockers: 1,
    atomicGroups: 0,
  });
  assert.equal(proof.plan.mutationCount, 0);
  assert.equal(proof.plan.preconditionCount, 0);
  assert.match(proof.plan.planHash, sha256EvidencePattern);
  assert.match(proof.plan.deterministicReplayHash, sha256EvidencePattern);

  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(blocker.resourceKey, unknownResourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver, null);
  assert.equal(blocker.policySource, null);
  assert.match(blocker.baseHash, sha256HexPattern);
  assert.match(blocker.localHash, sha256HexPattern);
  assert.match(blocker.remoteHash, sha256HexPattern);
  assert.equal(blocker.baseHash, blocker.remoteHash);
  assert.notEqual(blocker.localHash, blocker.baseHash);
  assert.match(blocker.blockerHash, sha256EvidencePattern);
  assert.match(blocker.refusalEvidenceHash, sha256EvidencePattern);

  assert.equal(refusal.schemaVersion, 1);
  assert.equal(refusal.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(refusal.operation, 'planner-refusal');
  assert.equal(refusal.outcome, 'blocked-before-mutation');
  assert.equal(refusal.format, 'hash-only');
  assert.equal(refusal.rawValuesIncluded, false);
  assert.equal(refusal.resourceKey, unknownResourceKey);
  assert.equal(refusal.pluginOwner, 'forms');
  assert.equal(refusal.driver, null);
  assert.equal(refusal.policySource, null);
  assert.deepEqual(refusal.hashes, {
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
  });
  assert.deepEqual(refusal.resource, {
    type: 'row',
    key: unknownResourceKey,
    table: unknownTable,
    id: unknownRowId,
    name: null,
  });
  assert.equal(refusal.change.localChange, 'update');
  assert.equal(refusal.change.remoteChange, 'unchanged');

  assert.equal(proof.blockedPlanApplyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(proof.blockedPlanApplyRefusal.rejectedBeforeMutation, true);
  assert.equal(proof.blockedPlanApplyRefusal.remoteDataPreserved, true);
  assert.equal(proof.blockedPlanApplyRefusal.remoteHashAfter, proof.blockedPlanApplyRefusal.remoteHashBefore);
  assert.match(proof.blockedPlanApplyRefusal.detailsHash, sha256EvidencePattern);

  assert.equal(proof.forgedMutationRefusal.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(proof.forgedMutationRefusal.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(proof.forgedMutationRefusal.rejectedBeforeMutation, true);
  assert.equal(proof.forgedMutationRefusal.remoteDataPreserved, true);
  assert.equal(proof.forgedMutationRefusal.remoteHashAfter, proof.forgedMutationRefusal.remoteHashBefore);
  assert.match(proof.forgedMutationRefusal.applyValidationHash, sha256EvidencePattern);
  assert.match(proof.forgedMutationRefusal.detailsHash, sha256EvidencePattern);
  assert.match(proof.forgedMutationRefusal.forgedPlanHash, sha256EvidencePattern);

  assert.deepEqual(proof.redaction, {
    format: 'hash-only',
    rawValuesIncluded: false,
    rawFieldNamesIncluded: false,
    surfaces: [
      'planner-unknown-plugin-owned-resource-refusal',
      'blocked-plan-apply-refusal',
      'forged-ready-plan-apply-refusal',
      'release-verifier-proof',
    ],
  });
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawUnknownPayloads(proof);
});

test('RPP-0288 production-shaped plugin-driver summary carries unknown-plugin failure-closed proof', () => {
  const remoteBaseSnapshot = productionDriverSnapshot('base', 1, 'base', rawFixtures[2]);
  const localEditedSnapshot = productionDriverSnapshot('local-update', 2, 'local-update', rawFixtures[3]);
  const remoteChangedSnapshot = productionDriverSnapshot('remote-changed', 3, 'remote-changed', rawFixtures[4]);
  const plan = createPushPlan({
    base: remoteBaseSnapshot,
    local: localEditedSnapshot,
    remote: remoteBaseSnapshot,
    now: fixedNow,
  });
  const summary = summarizeProductionPluginDriverBoundaryProof({
    proof: productionDriverProof(plan),
    remoteBaseSnapshot,
    localEditedSnapshot,
    remoteChangedSnapshot,
  });
  const unknown = summary.failureClosedUnknownPluginData;
  const evidence = {
    rpp: 'RPP-0288',
    evidenceSource: 'release-verifier-unknown-plugin-owned-resource-refusal-v5',
    productionBacked: false,
    releaseGate: 'NO-GO',
    summaryHash: sha256Evidence(summary),
    failureClosedUnknownPluginData: unknown,
  };

  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'LIVE_PLUGIN_DRIVER_BOUNDARY_OK');
  assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, true);
  assert.equal(summary.ownershipBoundary.exactMutationOwnerDriver, true);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.failureClosed, true);
  assert.equal(unknown.resourceKey, `row:${JSON.stringify(['wp_reprint_push_unknown_plugin_data', 'id:1'])}`);
  assert.equal(unknown.blockerClass, 'unsupported-plugin-owned-resource');
  assert.match(unknown.blockerReason, /not covered by a supported resource driver policy/);
  assert.match(evidence.summaryHash, sha256EvidencePattern);
  assertNoRawUnknownPayloads(summary, 'RPP-0288 production-shaped plugin-driver summary');
  assertNoRawUnknownPayloads(evidence, 'RPP-0288 production-shaped evidence');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0288 production-shaped evidence' }));
});
