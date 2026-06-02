import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { digest } from '../src/stable-json.js';
import { serializeResourceValue } from '../src/resources.js';
import {
  productionPluginDriverBoundary,
  summarizeProductionPluginDriverBoundaryProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';
import { pluginOwnedRowDriverContractHash } from '../src/plugin-driver-contracts.js';

const fixedNow = new Date('2026-05-30T12:48:30.000Z');
const boundary = productionPluginDriverBoundary;
const releaseBoundaryProofValue = 'rpp-0483-release-verifier-custom-table-allowlist';
const releaseStateRowSchema = Object.freeze({
  required: ['state_id', 'payload', 'updated_marker', '__pluginOwner'],
  fields: {
    state_id: 'integer',
    payload: {
      type: 'object',
      required: ['owner', 'mode', 'version', 'private_note', 'releaseBoundaryProof'],
      additionalProperties: false,
      properties: {
        owner: {
          type: 'string',
          const: boundary.owner,
        },
        mode: 'string',
        version: 'integer',
        private_note: 'string',
        releaseBoundaryProof: {
          type: 'string',
          const: releaseBoundaryProofValue,
        },
      },
    },
    updated_marker: 'string',
    __pluginOwner: 'string',
  },
});
const normalizedReleaseStateRowSchema = Object.freeze({
  schemaVersion: 1,
  fields: [
    { field: '__pluginOwner', type: 'string', required: true },
    {
      field: 'payload',
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: [
        { field: 'mode', type: 'string', required: true },
        {
          field: 'owner',
          type: 'string',
          required: true,
          constHash: digest(boundary.owner),
        },
        { field: 'private_note', type: 'string', required: true },
        {
          field: 'releaseBoundaryProof',
          type: 'string',
          required: true,
          constHash: digest(releaseBoundaryProofValue),
        },
        { field: 'version', type: 'integer', required: true },
      ],
    },
    { field: 'state_id', type: 'integer', required: true },
    { field: 'updated_marker', type: 'string', required: true },
  ],
});
const rawSentinels = Object.freeze([
  'RPP_0483_BASE_RELEASE_STATE_PRIVATE',
  'RPP_0483_LOCAL_RELEASE_STATE_PRIVATE',
  'RPP_0483_REMOTE_CHANGED_RELEASE_STATE_PRIVATE',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    return error;
  }
}

function releaseStateSnapshot(mode, version, marker, {
  privateNote = '',
  allowlistOverride = {},
} = {}) {
  const allowlistEntry = {
    resourceKey: boundary.resourceKey,
    pluginOwner: boundary.owner,
    driver: boundary.driver,
    table: boundary.table,
    supportsDelete: false,
    contractKind: 'plugin-owned-row-driver',
    contractVersion: 1,
    rowSchema: releaseStateRowSchema,
    ...allowlistOverride,
  };
  allowlistEntry.contractHash = pluginOwnedRowDriverContractHash(allowlistEntry);

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
            releaseBoundaryProof: releaseBoundaryProofValue,
          },
          updated_marker: marker,
          __pluginOwner: boundary.owner,
        },
      },
    },
    meta: {
      pluginOwnedResources: {
        allowedResources: [allowlistEntry],
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

function matchedReleaseStateSchemaValidation() {
  return {
    schemaHash: digest(normalizedReleaseStateRowSchema),
    status: 'matched',
    fields: [
      {
        field: '__pluginOwner',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
      {
        field: 'payload',
        expectedType: 'object',
        required: true,
        state: 'present',
        observedType: 'object',
        matched: true,
      },
      {
        field: 'mode',
        path: 'payload.mode',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
      {
        field: 'owner',
        path: 'payload.owner',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        constraint: 'const',
        constraintHash: digest(boundary.owner),
        observedHash: digest(boundary.owner),
        matched: true,
      },
      {
        field: 'private_note',
        path: 'payload.private_note',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
      {
        field: 'releaseBoundaryProof',
        path: 'payload.releaseBoundaryProof',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        constraint: 'const',
        constraintHash: digest(releaseBoundaryProofValue),
        observedHash: digest(releaseBoundaryProofValue),
        matched: true,
      },
      {
        field: 'version',
        path: 'payload.version',
        expectedType: 'integer',
        required: true,
        state: 'present',
        observedType: 'integer',
        matched: true,
      },
      {
        field: 'state_id',
        expectedType: 'integer',
        required: true,
        state: 'present',
        observedType: 'integer',
        matched: true,
      },
      {
        field: 'updated_marker',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
    ],
  };
}

function unexpectedReleaseStateSchemaValidation(extraPropertyCount = 1) {
  const evidence = matchedReleaseStateSchemaValidation();
  evidence.status = 'mismatch';
  const stateIdIndex = evidence.fields.findIndex((field) => field.field === 'state_id');
  evidence.fields.splice(stateIdIndex, 0, {
    field: 'payload',
    path: 'payload',
    expectedType: 'object',
    required: true,
    state: 'unexpected',
    observedType: 'object',
    observedExtraPropertyCount: extraPropertyCount,
    matched: false,
  });
  return evidence;
}

function constraintMismatchReleaseStateSchemaValidation({
  fieldPath,
  observedHash,
} = {}) {
  const evidence = matchedReleaseStateSchemaValidation();
  evidence.status = 'mismatch';
  const field = evidence.fields.find((entry) => entry.path === fieldPath);
  field.state = 'constraint-mismatch';
  field.observedHash = observedHash;
  field.matched = false;
  return evidence;
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
  assert.equal(
    mutation.pluginOwnedResource.contractValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_ACCEPTED',
  );
  assert.equal(mutation.pluginOwnedResource.contractValidationEvidence.rawValuesIncluded, false);
  assert.equal(
    mutation.pluginOwnedResource.contractValidationEvidence.contractHash,
    pluginOwnedRowDriverContractHash(mutation.pluginOwnedResource.contractValidationEvidence),
  );
  assert.equal(
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED',
  );
  assert.equal(mutation.pluginOwnedResource.driverPayloadValidationEvidence.rawValuesIncluded, false);
  assert.equal(
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.contractHash,
    mutation.pluginOwnedResource.contractValidationEvidence.contractHash,
  );
  assert.deepEqual(mutation.pluginOwnedResource.driverPayloadValidationEvidence.rowIdentity, {
    resourceId: boundary.rowId,
    status: 'matched',
    fields: [
      {
        field: 'state_id',
        expected: '1',
        observedHash: digest('1'),
        matched: true,
      },
    ],
  });
  assert.deepEqual(mutation.pluginOwnedResource.contractValidationEvidence.rowSchema, normalizedReleaseStateRowSchema);
  assert.deepEqual(
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.schemaValidation,
    matchedReleaseStateSchemaValidation(),
  );
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);

  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'LIVE_PLUGIN_DRIVER_BOUNDARY_OK');
  assert.equal(summary.allowlist.entry.resourceKey, boundary.resourceKey);
  assert.equal(summary.allowlist.entry.pluginOwner, boundary.owner);
  assert.equal(summary.allowlist.entry.driver, boundary.driver);
  assert.equal(summary.allowlist.entry.table, boundary.table);
  assert.equal(summary.allowlist.entry.supportsDelete, false);
  assert.equal(summary.allowlist.entry.contractKind, 'plugin-owned-row-driver');
  assert.equal(summary.allowlist.entry.contractVersion, 1);
  assert.equal(summary.allowlist.entry.contractHash, summary.driverContractBoundary.contractHash);
  assert.equal(summary.allowlist.entry.expectedContractHash, summary.driverContractBoundary.contractHash);
  assert.equal(summary.allowlist.entry.rowSchemaHash, digest(normalizedReleaseStateRowSchema));
  assert.equal(summary.driverContractBoundary.contractBound, true);
  assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
  assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, true);
  assert.equal(summary.driverContractBoundary.contractEvidenceExactShape, true);
  assert.equal(summary.driverContractBoundary.payloadEvidenceExactShape, true);
  assert.equal(summary.driverContractBoundary.allowlistContractBound, true);
  assert.equal(summary.driverContractBoundary.allowlistContractHashMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.allowlistContractHashMatchesMutation, true);
  assert.equal(summary.driverContractBoundary.allowlistRowSchemaMatchesMutation, true);
  assert.equal(summary.driverContractBoundary.contractHashMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.contractHashMatchesPayload, true);
  assert.equal(summary.driverContractBoundary.contractValidationHashMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadContractValidationHashMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadValueStateMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
  assert.equal(summary.driverContractBoundary.payloadRowIdentityMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadSchemaValidationMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadOwnerMatchesExpected, true);
  assert.equal(summary.driverContractBoundary.payloadContractSupportsDeleteMatches, true);
  assert.match(summary.driverContractBoundary.contractHash, /^[a-f0-9]{64}$/);
  assert.match(summary.driverContractBoundary.contractValidationHash, /^[a-f0-9]{64}$/);
  assert.match(summary.driverContractBoundary.expectedContractValidationHash, /^[a-f0-9]{64}$/);
  assert.equal(
    summary.driverContractBoundary.contractValidationHash,
    summary.driverContractBoundary.expectedContractValidationHash,
  );
  assert.equal(summary.driverContractBoundary.expectedContractHash, summary.driverContractBoundary.contractHash);
  assert.equal(summary.driverContractBoundary.contractValidation.reasonCode, 'PLUGIN_DRIVER_CONTRACT_ACCEPTED');
  assert.equal(summary.driverContractBoundary.contractValidation.contractKind, 'plugin-owned-row-driver');
  assert.equal(summary.driverContractBoundary.contractValidation.contractVersion, 1);
  assert.equal(summary.driverContractBoundary.contractValidation.contractHash, summary.driverContractBoundary.contractHash);
  assert.equal(summary.driverContractBoundary.contractValidation.rowSchemaHash, digest(normalizedReleaseStateRowSchema));
  assert.equal(summary.driverContractBoundary.driverPayloadValidation.validator, 'contract-bound-row-driver');
  assert.equal(summary.driverContractBoundary.driverPayloadValidation.action, 'put');
  assert.equal(summary.driverContractBoundary.driverPayloadValidation.contractHash, summary.driverContractBoundary.contractHash);
  assert.equal(
    summary.driverContractBoundary.driverPayloadValidation.contractValidationHash,
    summary.driverContractBoundary.expectedContractValidationHash,
  );
  assert.deepEqual(summary.driverContractBoundary.driverPayloadValidation.rowIdentity, {
    resourceId: boundary.rowId,
    status: 'matched',
    fields: [
      {
        field: 'state_id',
        expected: '1',
        observedHash: digest('1'),
        matched: true,
      },
    ],
  });
  assert.deepEqual(
    summary.driverContractBoundary.driverPayloadValidation.schemaValidation,
    matchedReleaseStateSchemaValidation(),
  );
  assert.equal(summary.driverContractBoundary.driverPayloadValidation.value.state, 'present');
  assert.equal(summary.driverContractBoundary.driverPayloadValidation.value.hash, mutation.localHash);
  assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, true);
  assert.equal(summary.ownershipBoundary.exactMutationOwnerDriver, true);
  assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, true);
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

test('RPP-0483 JS apply refuses forged contract-bound payload evidence before mutation', async (t) => {
  const topology = releaseStateTopology();
  const acceptedPlan = releaseStatePlan(topology);
  const acceptedRemote = cloneJson(topology.remoteBaseSnapshot);
  const acceptedResult = applyPlan(acceptedRemote, cloneJson(acceptedPlan));

  assert.equal(acceptedResult.appliedMutations, 1);
  assert.equal(
    acceptedResult.site.db[boundary.table][boundary.rowId].payload.mode,
    'local-update',
  );

  const forgedCases = [
    {
      label: 'missing payload evidence',
      mutate(mutation) {
        delete mutation.pluginOwnedResource.driverPayloadValidationEvidence;
      },
    },
    {
      label: 'forged payload action',
      mutate(mutation) {
        mutation.pluginOwnedResource.driverPayloadValidationEvidence.action = 'delete';
      },
    },
    {
      label: 'forged payload value hash',
      mutate(mutation) {
        mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = '0'.repeat(64);
      },
    },
    {
      label: 'forged payload contract-validation hash',
      mutate(mutation) {
        mutation.pluginOwnedResource.driverPayloadValidationEvidence.contractValidationHash = '0'.repeat(64);
      },
    },
  ];

  for (const forgedCase of forgedCases) {
    await t.test(forgedCase.label, () => {
      const plan = releaseStatePlan(topology);
      const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
      const remote = cloneJson(topology.remoteBaseSnapshot);
      const remoteBeforeHash = digest(remote);
      let hookCalls = 0;

      forgedCase.mutate(mutation);
      const error = captureError(() => applyPlan(remote, plan, {
        beforeMutation() {
          hookCalls++;
        },
      }));

      assert.ok(error instanceof PushPlanError);
      assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
      assert.equal(error.details.resourceKey, boundary.resourceKey);
      assert.equal(error.details.pluginOwner, boundary.owner);
      assert.equal(error.details.driver, boundary.driver);
      assert.equal(error.details.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
      assert.equal(error.details.applyValidationEvidence.outcome, 'refused-before-mutation');
      assert.equal(hookCalls, 0);
      assert.equal(digest(remote), remoteBeforeHash);
      assertNoRawSentinels(error.details, forgedCase.label);
    });
  }
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
      const contractBoundTopology = releaseStateTopology();
      const plan = releaseStatePlan(contractBoundTopology);
      const mutatedAllowlistTopology = releaseStateTopology({ allowlistOverride: nearMiss.allowlistOverride });
      const summary = summarize(mutatedAllowlistTopology, releaseVerifierProof(plan));

      assert.equal(summary.status, 'blocked');
      assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
      assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, false);
      assert.equal(summary.ownershipBoundary.exactMutationOwnerDriver, true);
      assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
      assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
      assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, true);
      assert.equal(summary.driverContractBoundary.allowlistContractBound, false);
      assert.equal(summary.driverContractBoundary.allowlistContractHashMatchesExpected, true);
      assert.equal(summary.driverContractBoundary.allowlistContractHashMatchesMutation, false);
      assert.equal(summary.driverContractBoundary.allowlistRowSchemaMatchesMutation, true);
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

  await t.test('forged matching contract and payload fingerprints are not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const forgedHash = '0'.repeat(64);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    mutation.pluginOwnedResource.contractValidationEvidence.contractHash = forgedHash;
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.contractHash = forgedHash;
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.contractHashMatchesPayload, true);
    assert.equal(summary.driverContractBoundary.contractHashMatchesExpected, false);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'forged contract fingerprint summary');
  });

  await t.test('forged contract validation evidence with raw extras is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    mutation.pluginOwnedResource.contractValidationEvidence.rawFixture = rawSentinels[1];
    mutation.pluginOwnedResource.contractValidationEvidence.rawValuesIncluded = false;
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.contractHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.contractValidationHashMatchesExpected, false);
    assert.equal(summary.driverContractBoundary.payloadContractValidationHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'forged contract validation evidence summary');
  });

  await t.test('forged payload validation evidence with raw extras is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.rawFixture = rawSentinels[1];
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.contractEvidenceExactShape, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadEvidenceExactShape, false);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'forged payload validation evidence summary');
  });

  await t.test('allowlist row schema mismatch is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mismatchedAllowlistTopology = releaseStateTopology({
      allowlistOverride: {
        rowSchema: {
          required: ['state_id', 'payload', 'updated_marker', '__pluginOwner'],
          fields: {
            state_id: 'integer',
            payload: {
              type: 'object',
              required: ['owner', 'mode', 'version', 'releaseBoundaryProof'],
              additionalProperties: false,
              properties: {
                owner: 'string',
                mode: 'string',
                version: 'integer',
                releaseBoundaryProof: 'string',
              },
            },
            updated_marker: 'string',
            __pluginOwner: 'string',
          },
        },
      },
    });
    const summary = summarize(mismatchedAllowlistTopology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.ownershipBoundary.exactAllowlistOwnerDriver, true);
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.allowlistContractBound, false);
    assert.equal(summary.driverContractBoundary.allowlistContractHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.allowlistContractHashMatchesMutation, false);
    assert.equal(summary.driverContractBoundary.allowlistRowSchemaMatchesMutation, false);
    assert.notEqual(summary.driverContractBoundary.allowlistRowSchemaHash, digest(normalizedReleaseStateRowSchema));
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'allowlist row schema mismatch summary');
  });

  await t.test('forged payload action is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.action = 'delete';
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, false);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'forged payload action summary');
  });

  await t.test('forged payload value hash is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = '0'.repeat(64);
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, false);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'forged payload value hash summary');
  });

  await t.test('forged payload contract-validation hash is not release-verifier eligible', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.contractValidationHash = '0'.repeat(64);
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadContractValidationHashMatchesExpected, false);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assertNoRawSentinels(summary, 'forged payload contract-validation hash summary');
  });

  await t.test('missing planned payload owner marker is not release-verifier eligible with matching hashes', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    const ownerlessValue = cloneJson(topology.localEditedSnapshot.db[boundary.table][boundary.rowId]);
    delete ownerlessValue.__pluginOwner;
    topology.localEditedSnapshot.db[boundary.table][boundary.rowId] = ownerlessValue;
    mutation.value = serializeResourceValue(ownerlessValue);
    mutation.localHash = digest(ownerlessValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(ownerlessValue);
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadValueStateMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadOwnerMatchesExpected, false);
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assert.equal(summary.mutationBoundary.localHash, summary.localPluginStateEvidence.hash);
    assertNoRawSentinels(summary, 'missing payload owner marker summary');
  });

  await t.test('forged payload row identity is not release-verifier eligible with matching hashes', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    const rowIdMismatchValue = cloneJson(topology.localEditedSnapshot.db[boundary.table][boundary.rowId]);
    rowIdMismatchValue.state_id = 2;
    topology.localEditedSnapshot.db[boundary.table][boundary.rowId] = rowIdMismatchValue;
    mutation.value = serializeResourceValue(rowIdMismatchValue);
    mutation.localHash = digest(rowIdMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(rowIdMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.rowIdentity = {
      resourceId: boundary.rowId,
      status: 'mismatch',
      fields: [
        {
          field: 'state_id',
          expected: '1',
          observedHash: digest('2'),
          matched: false,
        },
      ],
    };
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadValueStateMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadOwnerMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadRowIdentityMatchesExpected, false);
    assert.deepEqual(summary.driverContractBoundary.driverPayloadValidation.rowIdentity, {
      resourceId: boundary.rowId,
      status: 'mismatch',
      fields: [
        {
          field: 'state_id',
          expected: '1',
          observedHash: digest('2'),
          matched: false,
        },
      ],
    });
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assert.equal(summary.mutationBoundary.localHash, summary.localPluginStateEvidence.hash);
    assertNoRawSentinels(summary, 'planned payload row id mismatch summary');
  });

  await t.test('forged payload row schema is not release-verifier eligible with matching hashes', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    const schemaMismatchValue = cloneJson(topology.localEditedSnapshot.db[boundary.table][boundary.rowId]);
    schemaMismatchValue.payload = 'not-a-schema-object';
    topology.localEditedSnapshot.db[boundary.table][boundary.rowId] = schemaMismatchValue;
    mutation.value = serializeResourceValue(schemaMismatchValue);
    mutation.localHash = digest(schemaMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(schemaMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.schemaValidation = {
      schemaHash: digest(normalizedReleaseStateRowSchema),
      status: 'mismatch',
      fields: [
        {
          field: '__pluginOwner',
          expectedType: 'string',
          required: true,
          state: 'present',
          observedType: 'string',
          matched: true,
        },
        {
          field: 'payload',
          expectedType: 'object',
          required: true,
          state: 'present',
          observedType: 'string',
          matched: false,
        },
        {
          field: 'state_id',
          expectedType: 'integer',
          required: true,
          state: 'present',
          observedType: 'integer',
          matched: true,
        },
        {
          field: 'updated_marker',
          expectedType: 'string',
          required: true,
          state: 'present',
          observedType: 'string',
          matched: true,
        },
      ],
    };
    const summary = summarize(topology, releaseVerifierProof(plan));

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadValueStateMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadOwnerMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadRowIdentityMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadSchemaValidationMatchesExpected, false);
    assert.deepEqual(
      summary.driverContractBoundary.driverPayloadValidation.schemaValidation.fields.find(
        (field) => field.field === 'payload',
      ),
      {
        field: 'payload',
        expectedType: 'object',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: false,
      },
    );
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assert.equal(summary.mutationBoundary.localHash, summary.localPluginStateEvidence.hash);
    assertNoRawSentinels(summary, 'planned payload row schema mismatch summary');
  });

  await t.test('forged payload row schema constraint is not release-verifier eligible with matching hashes', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    const constraintMismatchValue = cloneJson(topology.localEditedSnapshot.db[boundary.table][boundary.rowId]);
    constraintMismatchValue.payload.releaseBoundaryProof = 'rpp-0483-private-forged-release-boundary-proof';
    topology.localEditedSnapshot.db[boundary.table][boundary.rowId] = constraintMismatchValue;
    mutation.value = serializeResourceValue(constraintMismatchValue);
    mutation.localHash = digest(constraintMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(constraintMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.schemaValidation =
      constraintMismatchReleaseStateSchemaValidation({
        fieldPath: 'payload.releaseBoundaryProof',
        observedHash: digest('rpp-0483-private-forged-release-boundary-proof'),
      });
    const summary = summarize(topology, releaseVerifierProof(plan));
    const mismatch = summary.driverContractBoundary.driverPayloadValidation.schemaValidation.fields.find(
      (field) => field.path === 'payload.releaseBoundaryProof',
    );

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadSchemaValidationMatchesExpected, false);
    assert.deepEqual(mismatch, {
      field: 'releaseBoundaryProof',
      path: 'payload.releaseBoundaryProof',
      expectedType: 'string',
      required: true,
      state: 'constraint-mismatch',
      observedType: 'string',
      constraint: 'const',
      constraintHash: digest(releaseBoundaryProofValue),
      observedHash: digest('rpp-0483-private-forged-release-boundary-proof'),
      matched: false,
    });
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assert.equal(JSON.stringify(summary).includes('rpp-0483-private-forged-release-boundary-proof'), false);
    assertNoRawSentinels(summary, 'planned payload row schema constraint mismatch summary');
  });

  await t.test('unexpected nested payload properties are not release-verifier eligible with redacted evidence', () => {
    const topology = releaseStateTopology();
    const plan = releaseStatePlan(topology);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === boundary.resourceKey);
    const schemaMismatchValue = cloneJson(topology.localEditedSnapshot.db[boundary.table][boundary.rowId]);
    schemaMismatchValue.payload.unexpected_private_note = rawSentinels[1];
    schemaMismatchValue.payload.auth_token = 'rpp-0483-unexpected-auth-token-private';
    topology.localEditedSnapshot.db[boundary.table][boundary.rowId] = schemaMismatchValue;
    mutation.value = serializeResourceValue(schemaMismatchValue);
    mutation.localHash = digest(schemaMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(schemaMismatchValue);
    mutation.pluginOwnedResource.driverPayloadValidationEvidence.schemaValidation =
      unexpectedReleaseStateSchemaValidation(2);
    const summary = summarize(topology, releaseVerifierProof(plan));
    const unexpected = summary.driverContractBoundary.driverPayloadValidation.schemaValidation.fields.find(
      (field) => field.path === 'payload' && field.state === 'unexpected',
    );

    assert.equal(summary.status, 'blocked');
    assert.equal(summary.verdict, 'PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED');
    assert.equal(summary.driverContractBoundary.contractEvidenceAccepted, true);
    assert.equal(summary.driverContractBoundary.driverPayloadEvidenceAccepted, false);
    assert.equal(summary.driverContractBoundary.payloadActionMatchesMutation, true);
    assert.equal(summary.driverContractBoundary.payloadValueHashMatchesExpected, true);
    assert.equal(summary.driverContractBoundary.payloadSchemaValidationMatchesExpected, false);
    assert.deepEqual(unexpected, {
      field: 'payload',
      path: 'payload',
      expectedType: 'object',
      required: true,
      state: 'unexpected',
      observedType: 'object',
      observedExtraPropertyCount: 2,
      matched: false,
    });
    assert.equal(summary.driverContractBoundary.contractBound, false);
    assert.equal(summary.ownershipBoundary.contractBoundDriverMutation, false);
    assert.equal(JSON.stringify(summary).includes('unexpected_private_note'), false);
    assert.equal(JSON.stringify(summary).includes('auth_token'), false);
    assert.equal(JSON.stringify(summary).includes('rpp-0483-unexpected-auth-token-private'), false);
    assertNoRawSentinels(summary, 'unexpected nested payload properties summary');
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
