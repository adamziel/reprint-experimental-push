#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';
const baseBlueprint = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const targetPath = 'wp-content/uploads/reprint-push/shared.txt';
const createPath = 'wp-content/uploads/reprint-push/zz-storage-guard-create.txt';
const laterPath = 'wp-content/uploads/reprint-push/zz-storage-guard-later.txt';
const createDriftPath = 'wp-content/uploads/reprint-push/zz-storage-guard-create-drift-a.txt';
const createDriftLaterPath = 'wp-content/uploads/reprint-push/zz-storage-guard-create-drift-z.txt';
const deleteDriftLaterPath = 'wp-content/uploads/reprint-push/zz-storage-guard-delete-later.txt';
const plannedContent = 'storage guarded file planned content';
const positiveContent = 'storage guarded file positive content';
const driftContent = 'storage guarded file drift content';
const conflictDriftContent = 'storage guarded file conflict drift content';
const createContent = 'storage guarded file create guarded content';
const createDriftPlannedContent = 'storage guarded file create planned content';
const createDriftContent = 'storage guarded file create drift content';
const createConflictDriftContent = 'storage guarded file create conflict drift content';
const createDriftLaterContent = 'storage guarded file create later content';
const deleteDriftContent = 'storage guarded file delete drift content';
const deleteConflictDriftContent = 'storage guarded file delete conflict drift content';
const deleteDriftLaterContent = 'storage guarded file delete later content';
const laterContent = 'storage guarded file later content';

const base = exportSnapshot('base', baseBlueprint);
assert.ok(base.files[targetPath], `base fixture missing ${targetPath}`);

const positiveLocal = clone(base);
positiveLocal.files[targetPath] = positiveContent;
positiveLocal.files[createPath] = createContent;
const positivePlan = createPushPlan({
  base,
  local: positiveLocal,
  remote: base,
  now: fixedNow,
});
assert.equal(positivePlan.status, 'ready');
const positiveUpdate = mutationForPath(positivePlan, targetPath);
const positiveCreate = mutationForPath(positivePlan, createPath);
assert.ok(positiveUpdate, 'positive plan missing existing file update');
assert.ok(positiveCreate, 'positive plan missing file create');

const failureLocal = clone(base);
failureLocal.files[targetPath] = plannedContent;
failureLocal.files[laterPath] = laterContent;
const failurePlan = createPushPlan({
  base,
  local: failureLocal,
  remote: base,
  now: fixedNow,
});
assert.equal(failurePlan.status, 'ready');
const failureMutation = mutationForPath(failurePlan, targetPath);
const laterMutation = mutationForPath(failurePlan, laterPath);
assert.ok(failureMutation, 'failure plan missing drift target');
assert.ok(laterMutation, 'failure plan missing later mutation');
const failureIndex = failurePlan.mutations.findIndex((mutation) => mutation.id === failureMutation.id);
const laterIndex = failurePlan.mutations.findIndex((mutation) => mutation.id === laterMutation.id);
assert.ok(laterIndex > failureIndex, 'later mutation must be after drift target');
const preconditionsByMutation = new Map(
  failurePlan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
);

const createDriftLocal = clone(base);
createDriftLocal.files[createDriftPath] = createDriftPlannedContent;
createDriftLocal.files[createDriftLaterPath] = createDriftLaterContent;
const createDriftPlan = createPushPlan({
  base,
  local: createDriftLocal,
  remote: base,
  now: fixedNow,
});
assert.equal(createDriftPlan.status, 'ready');
const createDriftMutation = mutationForPath(createDriftPlan, createDriftPath);
const createDriftLaterMutation = mutationForPath(createDriftPlan, createDriftLaterPath);
assert.ok(createDriftMutation, 'create drift plan missing drift target');
assert.ok(createDriftLaterMutation, 'create drift plan missing later mutation');
const createDriftIndex = createDriftPlan.mutations.findIndex((mutation) => mutation.id === createDriftMutation.id);
const createDriftLaterIndex = createDriftPlan.mutations.findIndex((mutation) => mutation.id === createDriftLaterMutation.id);
assert.ok(createDriftLaterIndex > createDriftIndex, 'create drift later mutation must be after drift target');
const createPreconditionsByMutation = new Map(
  createDriftPlan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
);

const deleteLocal = clone(base);
delete deleteLocal.files[targetPath];
const deletePlan = createPushPlan({
  base,
  local: deleteLocal,
  remote: base,
  now: fixedNow,
});
assert.equal(deletePlan.status, 'ready');
const deleteMutation = mutationForPath(deletePlan, targetPath);
assert.ok(deleteMutation, 'delete plan missing file delete');

const deleteDriftLocal = clone(base);
delete deleteDriftLocal.files[targetPath];
deleteDriftLocal.files[deleteDriftLaterPath] = deleteDriftLaterContent;
const deleteDriftPlan = createPushPlan({
  base,
  local: deleteDriftLocal,
  remote: base,
  now: fixedNow,
});
assert.equal(deleteDriftPlan.status, 'ready');
const deleteDriftMutation = mutationForPath(deleteDriftPlan, targetPath);
const deleteDriftLaterMutation = mutationForPath(deleteDriftPlan, deleteDriftLaterPath);
assert.ok(deleteDriftMutation, 'delete drift plan missing drift target');
assert.ok(deleteDriftLaterMutation, 'delete drift plan missing later mutation');
const deleteDriftIndex = deleteDriftPlan.mutations.findIndex((mutation) => mutation.id === deleteDriftMutation.id);
const deleteDriftLaterIndex = deleteDriftPlan.mutations.findIndex((mutation) => mutation.id === deleteDriftLaterMutation.id);
assert.ok(deleteDriftLaterIndex > deleteDriftIndex, 'delete drift later mutation must be after drift target');
const deletePreconditionsByMutation = new Map(
  deleteDriftPlan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
);

const summary = {
  positive: {},
  delete: {},
  updateFailure: {},
  createFailure: {},
  deleteFailure: {},
  deleteMissingFailure: {},
  idempotency: {},
  redaction: {},
};

await withPlaygroundServer('storage-guard-file-positive', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: positivePlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const apply = await postLab(server, '/apply', {
    plan: positivePlan,
    receipt: dryRun.body.receipt,
  }, { [idempotencyHeader]: 'storage-guard-file-positive-001' });
  assert.equal(apply.status, 200, JSON.stringify(apply.body, null, 2));
  assert.equal(apply.body.ok, true);
  assert.equal(apply.body.applied, positivePlan.mutations.length);

  const after = await getSnapshot(server);
  assert.equal(after.body.snapshot.files[targetPath], positiveContent);
  assert.equal(after.body.snapshot.files[createPath], createContent);

  const dbJournal = await getLab(server, '/db-journal?limit=100');
  const entries = journalEntries(dbJournal.body);
  const applied = entries.filter((entry) => journalEvent(entry) === 'mutation-applied').map(mutationEvidence);
  const updateEvidence = applied.find((evidence) => evidence.mutationId === positiveUpdate.id);
  const createEvidence = applied.find((evidence) => evidence.mutationId === positiveCreate.id);
  assert.ok(updateEvidence, 'missing applied evidence for guarded file update');
  assert.equal(updateEvidence.preconditionCheck, 'storage-boundary-cas');
  assert.equal(updateEvidence.preWriteExpectedHash, updateEvidence.preWriteActualHash);
  assert.equal(updateEvidence.storageGuard?.boundary, 'filesystem-compare-rename');
  assert.equal(updateEvidence.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(updateEvidence.storageGuard?.operation, 'update');
  assert.equal(updateEvidence.storageGuard?.logicalPath, targetPath);
  assert.equal(updateEvidence.storageGuard?.outcome, 'applied');
  assert.match(updateEvidence.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(updateEvidence.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(updateEvidence.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(updateEvidence.storageGuard?.plannedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(updateEvidence.storageGuard?.physicalPathHash ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(updateEvidence.storageGuard?.comparedFields));

  assert.ok(createEvidence, 'missing applied evidence for guarded file create');
  assert.equal(createEvidence.preconditionCheck, 'storage-boundary-cas');
  assert.equal(createEvidence.preWriteExpectedHash, createEvidence.preWriteActualHash);
  assert.equal(createEvidence.storageGuard?.boundary, 'filesystem-compare-rename');
  assert.equal(createEvidence.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(createEvidence.storageGuard?.operation, 'create');
  assert.equal(createEvidence.storageGuard?.logicalPath, createPath);
  assert.equal(createEvidence.storageGuard?.outcome, 'applied');
  assert.match(createEvidence.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(createEvidence.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(createEvidence.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(createEvidence.storageGuard?.plannedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(createEvidence.storageGuard?.physicalPathHash ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(createEvidence.storageGuard?.comparedFields));
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  summary.positive = {
    applied: apply.body.applied,
    updateBoundary: updateEvidence.storageGuard.boundary,
    createBoundary: createEvidence.storageGuard.boundary,
  };
});

await withPlaygroundServer('storage-guard-file-delete-positive', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: deletePlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const apply = await postLab(server, '/apply', {
    plan: deletePlan,
    receipt: dryRun.body.receipt,
  }, { [idempotencyHeader]: 'storage-guard-file-delete-001' });
  assert.equal(apply.status, 200, JSON.stringify(apply.body, null, 2));
  assert.equal(apply.body.ok, true);

  const after = await getSnapshot(server);
  assert.equal(Object.hasOwn(after.body.snapshot.files, targetPath), false);

  const dbJournal = await getLab(server, '/db-journal?limit=80');
  const applied = journalEntries(dbJournal.body)
    .filter((entry) => journalEvent(entry) === 'mutation-applied')
    .map(mutationEvidence);
  const deleteEvidence = applied.find((evidence) => evidence.mutationId === deleteMutation.id);
  assert.ok(deleteEvidence, 'missing applied evidence for guarded file delete');
  assert.equal(deleteEvidence.preconditionCheck, 'storage-boundary-cas');
  assert.equal(deleteEvidence.preWriteExpectedHash, deleteEvidence.preWriteActualHash);
  assert.equal(deleteEvidence.storageGuard?.boundary, 'filesystem-compare-unlink');
  assert.equal(deleteEvidence.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(deleteEvidence.storageGuard?.operation, 'delete');
  assert.equal(deleteEvidence.storageGuard?.logicalPath, targetPath);
  assert.equal(deleteEvidence.storageGuard?.outcome, 'applied');
  assert.match(deleteEvidence.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(deleteEvidence.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(deleteEvidence.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(deleteEvidence.storageGuard?.plannedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(deleteEvidence.storageGuard?.physicalPathHash ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(deleteEvidence.storageGuard?.comparedFields));
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  summary.delete = {
    deleteApplied: apply.body.applied,
    deleteBoundary: deleteEvidence.storageGuard.boundary,
  };
});

await withPlaygroundServer('storage-guard-file-drift', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: failurePlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const applyBody = {
    plan: failurePlan,
    receipt: dryRun.body.receipt,
    labDriftBeforeStorageWrite: {
      mutationId: failureMutation.id,
      resourceKey: failureMutation.resourceKey,
      value: {
        type: 'file',
        content: driftContent,
      },
    },
  };
  const idempotencyKey = 'storage-guard-file-drift-001';
  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  const driftHash = hashFileContent(driftContent);
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'storage-boundary-cas');
  assert.equal(apply.body.preWriteActualHash, preconditionsByMutation.get(failureMutation.id).expectedHash);
  assert.equal(apply.body.actualHash, driftHash);
  assert.equal(apply.body.applied, failureIndex);
  assert.equal(apply.body.storageGuard?.boundary, 'filesystem-compare-rename');
  assert.equal(apply.body.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(apply.body.storageGuard?.logicalPath, targetPath);
  assert.equal(apply.body.storageGuard?.outcome, 'stale-at-write');
  assert.match(apply.body.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(apply.body.storageGuard?.actualStorageHash, apply.body.storageGuard?.expectedStorageHash);
  assertResponseHasNoRawFixtureData(apply.body);

  const afterFailure = await getSnapshot(server);
  assert.equal(afterFailure.body.snapshot.files[targetPath], driftContent, 'drifted file content must be preserved');
  assert.equal(Object.hasOwn(afterFailure.body.snapshot.files, laterPath), false, 'later mutation must not run');
  assert.equal(resourceHash(afterFailure.body.snapshot, failureMutation.resource), driftHash);
  assert.notEqual(resourceHash(afterFailure.body.snapshot, failureMutation.resource), failureMutation.localHash);
  assertLaterMutationsStayedOld(afterFailure.body.snapshot, failurePlan, failureIndex, preconditionsByMutation);

  const dbJournal = await getLab(server, '/db-journal?limit=120');
  const failureEntries = journalEntries(dbJournal.body);
  assertJournalEvents(failureEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-prepared',
    'mutation-precondition-failed',
    'apply-rejected',
  ]);
  assertNoJournalEvent(failureEntries, 'apply-committed');
  assertNoMutationAppliedFor(failureEntries, failureMutation.id);
  assert.equal(countJournalEvents(failureEntries, 'mutation-applied'), failureIndex);
  assertNoPreparedAfter(failureEntries, failureIndex);
  const failedEvidence = failureEntries
    .filter((entry) => journalEvent(entry) === 'mutation-precondition-failed')
    .map(mutationEvidence)
    .find((evidence) => evidence.mutationId === failureMutation.id);
  assert.ok(failedEvidence, 'missing failed mutation storage evidence');
  assert.equal(failedEvidence.preWriteActualHash, preconditionsByMutation.get(failureMutation.id).expectedHash);
  assert.equal(failedEvidence.actualHash, driftHash);
  assert.equal(failedEvidence.observedHash, driftHash);
  assert.equal(failedEvidence.storageGuard?.boundary, 'filesystem-compare-rename');
  assert.equal(failedEvidence.storageGuard?.outcome, 'stale-at-write');
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 412);
  assert.equal(replay.body.ok, false);
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(replay.body);
  const afterReplay = await getSnapshot(server);
  assertTargetSurfaceEqual(afterReplay.body.snapshot, afterFailure.body.snapshot, 'replayed rejection must not mutate');

  const conflict = await postLab(server, '/apply', {
    ...applyBody,
    labDriftBeforeStorageWrite: {
      ...applyBody.labDriftBeforeStorageWrite,
      value: {
        type: 'file',
        content: conflictDriftContent,
      },
    },
  }, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflict.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(conflict.body);
  const afterConflict = await getSnapshot(server);
  assertTargetSurfaceEqual(afterConflict.body.snapshot, afterFailure.body.snapshot, 'different-body conflict must not mutate');

  const dbJournalAfterConflict = await getLab(server, '/db-journal?limit=120');
  const conflictEntries = journalEntries(dbJournalAfterConflict.body);
  assertJournalEvents(conflictEntries, ['apply-replayed', 'idempotency-key-conflict']);
  assertNoJournalEvent(conflictEntries, 'apply-committed');
  assert.equal(countJournalEvents(conflictEntries, 'mutation-applied'), failureIndex);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);

  summary.updateFailure = {
    status: apply.status,
    code: apply.body.code,
    mutationIndex: failureIndex,
    driftPreserved: afterFailure.body.snapshot.files[targetPath] === driftContent,
    laterMutationRan: Object.hasOwn(afterFailure.body.snapshot.files, laterPath),
    guardOutcome: apply.body.storageGuard.outcome,
  };
  summary.idempotency = {
    replayStatus: replay.status,
    replayFreshMutationWork: replay.body.idempotency?.freshMutationWork,
    conflictStatus: conflict.status,
    conflictCode: conflict.body.code,
  };
  summary.redaction = {
    responseAndJournal: true,
  };
});

await withPlaygroundServer('storage-guard-file-create-drift', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: createDriftPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const applyBody = {
    plan: createDriftPlan,
    receipt: dryRun.body.receipt,
    labDriftBeforeStorageWrite: {
      mutationId: createDriftMutation.id,
      resourceKey: createDriftMutation.resourceKey,
      value: {
        type: 'file',
        content: createDriftContent,
      },
    },
  };
  const idempotencyKey = 'storage-guard-file-create-drift-001';
  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  const driftHash = hashFileContent(createDriftContent);
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'storage-boundary-cas');
  assert.equal(apply.body.preWriteActualHash, createPreconditionsByMutation.get(createDriftMutation.id).expectedHash);
  assert.equal(apply.body.actualHash, driftHash);
  assert.equal(apply.body.applied, createDriftIndex);
  assert.equal(apply.body.storageGuard?.boundary, 'filesystem-compare-rename');
  assert.equal(apply.body.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(apply.body.storageGuard?.operation, 'create');
  assert.equal(apply.body.storageGuard?.logicalPath, createDriftPath);
  assert.equal(apply.body.storageGuard?.outcome, 'stale-at-write');
  assert.match(apply.body.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.plannedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(apply.body.storageGuard?.actualStorageHash, apply.body.storageGuard?.expectedStorageHash);
  assertResponseHasNoRawFixtureData(apply.body);

  const afterFailure = await getSnapshot(server);
  assert.equal(afterFailure.body.snapshot.files[createDriftPath], createDriftContent, 'remote-created file content must be preserved');
  assert.equal(Object.hasOwn(afterFailure.body.snapshot.files, createDriftLaterPath), false, 'later create mutation must not run');
  assert.equal(resourceHash(afterFailure.body.snapshot, createDriftMutation.resource), driftHash);
  assert.notEqual(resourceHash(afterFailure.body.snapshot, createDriftMutation.resource), createDriftMutation.localHash);
  assertLaterMutationsStayedOld(afterFailure.body.snapshot, createDriftPlan, createDriftIndex, createPreconditionsByMutation);

  const dbJournal = await getLab(server, '/db-journal?limit=120');
  const failureEntries = journalEntries(dbJournal.body);
  assertJournalEvents(failureEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-prepared',
    'mutation-precondition-failed',
    'apply-rejected',
  ]);
  assertNoJournalEvent(failureEntries, 'apply-committed');
  assertNoMutationAppliedFor(failureEntries, createDriftMutation.id);
  assert.equal(countJournalEvents(failureEntries, 'mutation-applied'), createDriftIndex);
  assertNoPreparedAfter(failureEntries, createDriftIndex);
  const failedEvidence = failureEntries
    .filter((entry) => journalEvent(entry) === 'mutation-precondition-failed')
    .map(mutationEvidence)
    .find((evidence) => evidence.mutationId === createDriftMutation.id);
  assert.ok(failedEvidence, 'missing failed create mutation storage evidence');
  assert.equal(failedEvidence.preWriteActualHash, createPreconditionsByMutation.get(createDriftMutation.id).expectedHash);
  assert.equal(failedEvidence.actualHash, driftHash);
  assert.equal(failedEvidence.observedHash, driftHash);
  assert.equal(failedEvidence.storageGuard?.boundary, 'filesystem-compare-rename');
  assert.equal(failedEvidence.storageGuard?.operation, 'create');
  assert.equal(failedEvidence.storageGuard?.outcome, 'stale-at-write');
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 412);
  assert.equal(replay.body.ok, false);
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(replay.body);
  const afterReplay = await getSnapshot(server);
  assertTargetSurfaceEqual(afterReplay.body.snapshot, afterFailure.body.snapshot, 'replayed create rejection must not mutate');

  const conflict = await postLab(server, '/apply', {
    ...applyBody,
    labDriftBeforeStorageWrite: {
      ...applyBody.labDriftBeforeStorageWrite,
      value: {
        type: 'file',
        content: createConflictDriftContent,
      },
    },
  }, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflict.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(conflict.body);
  const afterConflict = await getSnapshot(server);
  assertTargetSurfaceEqual(afterConflict.body.snapshot, afterFailure.body.snapshot, 'different-body create conflict must not mutate');

  const dbJournalAfterConflict = await getLab(server, '/db-journal?limit=120');
  const conflictEntries = journalEntries(dbJournalAfterConflict.body);
  assertJournalEvents(conflictEntries, ['apply-replayed', 'idempotency-key-conflict']);
  assertNoJournalEvent(conflictEntries, 'apply-committed');
  assert.equal(countJournalEvents(conflictEntries, 'mutation-applied'), createDriftIndex);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);

  summary.createFailure = {
    status: apply.status,
    code: apply.body.code,
    mutationIndex: createDriftIndex,
    driftPreserved: afterFailure.body.snapshot.files[createDriftPath] === createDriftContent,
    laterMutationRan: Object.hasOwn(afterFailure.body.snapshot.files, createDriftLaterPath),
    guardOutcome: apply.body.storageGuard.outcome,
  };
});

await withPlaygroundServer('storage-guard-file-delete-drift', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: deleteDriftPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const applyBody = {
    plan: deleteDriftPlan,
    receipt: dryRun.body.receipt,
    labDriftBeforeStorageWrite: {
      mutationId: deleteDriftMutation.id,
      resourceKey: deleteDriftMutation.resourceKey,
      value: {
        type: 'file',
        content: deleteDriftContent,
      },
    },
  };
  const idempotencyKey = 'storage-guard-file-delete-drift-001';
  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  const driftHash = hashFileContent(deleteDriftContent);
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'storage-boundary-cas');
  assert.equal(apply.body.preWriteActualHash, deletePreconditionsByMutation.get(deleteDriftMutation.id).expectedHash);
  assert.equal(apply.body.actualHash, driftHash);
  assert.equal(apply.body.applied, deleteDriftIndex);
  assert.equal(apply.body.storageGuard?.boundary, 'filesystem-compare-unlink');
  assert.equal(apply.body.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(apply.body.storageGuard?.operation, 'delete');
  assert.equal(apply.body.storageGuard?.logicalPath, targetPath);
  assert.equal(apply.body.storageGuard?.outcome, 'stale-at-write');
  assert.match(apply.body.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.plannedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(apply.body.storageGuard?.actualStorageHash, apply.body.storageGuard?.expectedStorageHash);
  assertResponseHasNoRawFixtureData(apply.body);

  const afterFailure = await getSnapshot(server);
  assert.equal(afterFailure.body.snapshot.files[targetPath], deleteDriftContent, 'changed delete target must be preserved');
  assert.equal(Object.hasOwn(afterFailure.body.snapshot.files, deleteDriftLaterPath), false, 'later create mutation must not run');
  assert.equal(resourceHash(afterFailure.body.snapshot, deleteDriftMutation.resource), driftHash);
  assert.notEqual(resourceHash(afterFailure.body.snapshot, deleteDriftMutation.resource), deleteDriftMutation.localHash);
  assertLaterMutationsStayedOld(afterFailure.body.snapshot, deleteDriftPlan, deleteDriftIndex, deletePreconditionsByMutation);

  const dbJournal = await getLab(server, '/db-journal?limit=120');
  const failureEntries = journalEntries(dbJournal.body);
  assertJournalEvents(failureEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-prepared',
    'mutation-precondition-failed',
    'apply-rejected',
  ]);
  assertNoJournalEvent(failureEntries, 'apply-committed');
  assertNoMutationAppliedFor(failureEntries, deleteDriftMutation.id);
  assert.equal(countJournalEvents(failureEntries, 'mutation-applied'), deleteDriftIndex);
  assertNoPreparedAfter(failureEntries, deleteDriftIndex);
  const failedEvidence = failureEntries
    .filter((entry) => journalEvent(entry) === 'mutation-precondition-failed')
    .map(mutationEvidence)
    .find((evidence) => evidence.mutationId === deleteDriftMutation.id);
  assert.ok(failedEvidence, 'missing failed delete mutation storage evidence');
  assert.equal(failedEvidence.preWriteActualHash, deletePreconditionsByMutation.get(deleteDriftMutation.id).expectedHash);
  assert.equal(failedEvidence.actualHash, driftHash);
  assert.equal(failedEvidence.observedHash, driftHash);
  assert.equal(failedEvidence.storageGuard?.boundary, 'filesystem-compare-unlink');
  assert.equal(failedEvidence.storageGuard?.operation, 'delete');
  assert.equal(failedEvidence.storageGuard?.outcome, 'stale-at-write');
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 412);
  assert.equal(replay.body.ok, false);
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(replay.body);
  const afterReplay = await getSnapshot(server);
  assertTargetSurfaceEqual(afterReplay.body.snapshot, afterFailure.body.snapshot, 'replayed delete rejection must not mutate');

  const conflict = await postLab(server, '/apply', {
    ...applyBody,
    labDriftBeforeStorageWrite: {
      ...applyBody.labDriftBeforeStorageWrite,
      value: {
        type: 'file',
        content: deleteConflictDriftContent,
      },
    },
  }, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflict.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(conflict.body);
  const afterConflict = await getSnapshot(server);
  assertTargetSurfaceEqual(afterConflict.body.snapshot, afterFailure.body.snapshot, 'different-body delete conflict must not mutate');

  const dbJournalAfterConflict = await getLab(server, '/db-journal?limit=120');
  const conflictEntries = journalEntries(dbJournalAfterConflict.body);
  assertJournalEvents(conflictEntries, ['apply-replayed', 'idempotency-key-conflict']);
  assertNoJournalEvent(conflictEntries, 'apply-committed');
  assert.equal(countJournalEvents(conflictEntries, 'mutation-applied'), deleteDriftIndex);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);

  summary.deleteFailure = {
    status: apply.status,
    code: apply.body.code,
    mutationIndex: deleteDriftIndex,
    driftPreserved: afterFailure.body.snapshot.files[targetPath] === deleteDriftContent,
    laterMutationRan: Object.hasOwn(afterFailure.body.snapshot.files, deleteDriftLaterPath),
    guardOutcome: apply.body.storageGuard.outcome,
  };
});

await withPlaygroundServer('storage-guard-file-delete-missing-drift', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: deleteDriftPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const applyBody = {
    plan: deleteDriftPlan,
    receipt: dryRun.body.receipt,
    labDriftBeforeStorageWrite: {
      mutationId: deleteDriftMutation.id,
      resourceKey: deleteDriftMutation.resourceKey,
      absent: true,
    },
  };
  const idempotencyKey = 'storage-guard-file-delete-missing-drift-001';
  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'storage-boundary-cas');
  assert.equal(apply.body.preWriteActualHash, deletePreconditionsByMutation.get(deleteDriftMutation.id).expectedHash);
  assert.equal(apply.body.actualHash, deleteDriftMutation.localHash);
  assert.equal(apply.body.applied, deleteDriftIndex);
  assert.equal(apply.body.storageGuard?.boundary, 'filesystem-compare-unlink');
  assert.equal(apply.body.storageGuard?.driver, 'fixture-upload-file');
  assert.equal(apply.body.storageGuard?.operation, 'delete');
  assert.equal(apply.body.storageGuard?.logicalPath, targetPath);
  assert.equal(apply.body.storageGuard?.outcome, 'stale-at-write');
  assert.match(apply.body.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.actualStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(apply.body.storageGuard?.plannedStorageHash ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(apply.body.storageGuard?.actualStorageHash, apply.body.storageGuard?.expectedStorageHash);
  assertResponseHasNoRawFixtureData(apply.body);

  const afterFailure = await getSnapshot(server);
  assert.equal(Object.hasOwn(afterFailure.body.snapshot.files, targetPath), false, 'missing delete target must remain absent');
  assert.equal(Object.hasOwn(afterFailure.body.snapshot.files, deleteDriftLaterPath), false, 'later create mutation must not run');
  assert.equal(resourceHash(afterFailure.body.snapshot, deleteDriftMutation.resource), deleteDriftMutation.localHash);
  assertLaterMutationsStayedOld(afterFailure.body.snapshot, deleteDriftPlan, deleteDriftIndex, deletePreconditionsByMutation);

  const dbJournal = await getLab(server, '/db-journal?limit=120');
  const failureEntries = journalEntries(dbJournal.body);
  assertJournalEvents(failureEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-prepared',
    'mutation-precondition-failed',
    'apply-rejected',
  ]);
  assertNoJournalEvent(failureEntries, 'apply-committed');
  assertNoMutationAppliedFor(failureEntries, deleteDriftMutation.id);
  assert.equal(countJournalEvents(failureEntries, 'mutation-applied'), deleteDriftIndex);
  assertNoPreparedAfter(failureEntries, deleteDriftIndex);
  const failedEvidence = failureEntries
    .filter((entry) => journalEvent(entry) === 'mutation-precondition-failed')
    .map(mutationEvidence)
    .find((evidence) => evidence.mutationId === deleteDriftMutation.id);
  assert.ok(failedEvidence, 'missing failed delete-missing mutation storage evidence');
  assert.equal(failedEvidence.preWriteActualHash, deletePreconditionsByMutation.get(deleteDriftMutation.id).expectedHash);
  assert.equal(failedEvidence.actualHash, deleteDriftMutation.localHash);
  assert.equal(failedEvidence.observedHash, deleteDriftMutation.localHash);
  assert.equal(failedEvidence.storageGuard?.boundary, 'filesystem-compare-unlink');
  assert.equal(failedEvidence.storageGuard?.operation, 'delete');
  assert.equal(failedEvidence.storageGuard?.outcome, 'stale-at-write');
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 412);
  assert.equal(replay.body.ok, false);
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(replay.body);
  const afterReplay = await getSnapshot(server);
  assertTargetSurfaceEqual(afterReplay.body.snapshot, afterFailure.body.snapshot, 'replayed delete-missing rejection must not mutate');

  const conflict = await postLab(server, '/apply', {
    ...applyBody,
    labDriftBeforeStorageWrite: {
      ...applyBody.labDriftBeforeStorageWrite,
      conflictMarker: true,
    },
  }, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflict.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(conflict.body);
  const afterConflict = await getSnapshot(server);
  assertTargetSurfaceEqual(afterConflict.body.snapshot, afterFailure.body.snapshot, 'different-body delete-missing conflict must not mutate');

  const dbJournalAfterConflict = await getLab(server, '/db-journal?limit=120');
  const conflictEntries = journalEntries(dbJournalAfterConflict.body);
  assertJournalEvents(conflictEntries, ['apply-replayed', 'idempotency-key-conflict']);
  assertNoJournalEvent(conflictEntries, 'apply-committed');
  assert.equal(countJournalEvents(conflictEntries, 'mutation-applied'), deleteDriftIndex);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);

  summary.deleteMissingFailure = {
    status: apply.status,
    code: apply.body.code,
    mutationIndex: deleteDriftIndex,
    observedAbsent: !Object.hasOwn(afterFailure.body.snapshot.files, targetPath),
    laterMutationRan: Object.hasOwn(afterFailure.body.snapshot.files, deleteDriftLaterPath),
    guardOutcome: apply.body.storageGuard.outcome,
  };
});

console.log(JSON.stringify(summary, null, 2));

function mutationForPath(plan, relativePath) {
  return plan.mutations.find((mutation) => mutation.resource.type === 'file' && mutation.resource.path === relativePath);
}

function hashFileContent(content) {
  return digest({
    type: 'file',
    content,
  });
}

function assertLaterMutationsStayedOld(snapshot, plan, failedIndex, preconditionsByMutation) {
  for (const mutation of plan.mutations.slice(failedIndex + 1)) {
    const precondition = preconditionsByMutation.get(mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(
      resourceHash(snapshot, mutation.resource),
      precondition.expectedHash,
      `later mutation changed after storage guard failure: ${mutation.resourceKey}`,
    );
  }
}

function assertNoMutationAppliedFor(entries, mutationId) {
  const applied = entries.filter((entry) => journalEvent(entry) === 'mutation-applied');
  assert.ok(
    !applied.some((entry) => mutationEvidence(entry).mutationId === mutationId),
    `mutation-applied must not be written for ${mutationId}`,
  );
}

function assertNoPreparedAfter(entries, failedIndex) {
  const prepared = entries.filter((entry) => journalEvent(entry) === 'mutation-prepared');
  assert.ok(
    !prepared.some((entry) => Number(mutationEvidence(entry).mutationOrder) > failedIndex),
    'later mutation-prepared event written after storage guard failure',
  );
}

function assertStoredJournalHasNoRawFixtureData(body) {
  const forbiddenKeys = new Set([
    'value',
    'content',
    'payload',
    'option_value',
    'post_content',
    'meta_value',
    'currentSnapshot',
    'afterSnapshot',
    'beforeSnapshot',
  ]);
  const forbiddenStrings = [
    plannedContent,
    positiveContent,
    driftContent,
    conflictDriftContent,
    createContent,
    createDriftPlannedContent,
    createDriftContent,
    createConflictDriftContent,
    createDriftLaterContent,
    deleteDriftContent,
    deleteConflictDriftContent,
    deleteDriftLaterContent,
    laterContent,
  ];
  const forbiddenPathFragments = [
    repoRoot,
    '/home/',
    '/workspace/',
    '/wordpress/',
    '.reprint-push-',
  ];

  walkJournalValue(body, [], (pathParts, value) => {
    const key = pathParts.at(-1);
    assert.ok(!forbiddenKeys.has(key), `journal stored raw-value field ${pathParts.join('.')}`);
    if (typeof value === 'string') {
      for (const forbidden of forbiddenStrings) {
        assert.ok(!value.includes(forbidden), `journal stored raw fixture value at ${pathParts.join('.')}`);
      }
      for (const forbidden of forbiddenPathFragments) {
        assert.ok(!value.includes(forbidden), `journal stored host/temp path fragment at ${pathParts.join('.')}`);
      }
    }
  });
}

function assertResponseHasNoRawFixtureData(body) {
  assertStoredJournalHasNoRawFixtureData(body);
}

function walkJournalValue(value, pathParts, visit) {
  visit(pathParts, value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJournalValue(item, [...pathParts, String(index)], visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, innerValue] of Object.entries(value)) {
      walkJournalValue(innerValue, [...pathParts, key], visit);
    }
  }
}

function assertJournalEvents(entries, events) {
  for (const event of events) {
    assert.ok(entries.some((entry) => journalEvent(entry) === event), `DB journal entries missing ${event}`);
  }
}

function assertNoJournalEvent(entries, event) {
  assert.ok(!entries.some((entry) => journalEvent(entry) === event), `DB journal must not include ${event}`);
}

function countJournalEvents(entries, event) {
  return entries.filter((entry) => journalEvent(entry) === event).length;
}

function mutationEvidence(entry) {
  return entry.resourceHashEvidence?.mutation ?? {};
}

function journalEntries(body) {
  const journal = body.journal ?? body.dbJournal ?? body;
  return journal.entries ?? journal.latestRows ?? body.entries ?? [];
}

function journalEvent(entry) {
  return entry.event ?? entry.eventName ?? entry.event_name ?? entry.type ?? entry.name;
}

function assertTargetSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}

function exportSnapshot(name, blueprintPath) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  try {
    await waitForServer(child, baseUrl, logs);
    assertLocalhostListener(port);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return { name, port, baseUrl, child, logs };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/wp-json/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${logs.join('')}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve();
    }
    child.once('exit', onExit);
  });
}

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  return response;
}

async function getLab(server, pathSuffix) {
  return requestJson(server, 'GET', `/wp-json/reprint-push-lab/v1${pathSuffix}`);
}

async function postLab(server, pathSuffix, body, headers = {}) {
  return requestJson(server, 'POST', `/wp-json/reprint-push-lab/v1${pathSuffix}`, body, headers);
}

async function requestJson(server, method, pathname, body = undefined, headers = {}) {
  let response;
  try {
    response = await fetch(`${server.baseUrl}${pathname}`, {
      method,
      headers: body === undefined ? {
        connection: 'close',
        ...headers,
      } : {
        'content-type': 'application/json',
        connection: 'close',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Fetch failed for ${method} ${pathname}: ${error.message}\nRecent Playground logs:\n${server.logs.join('')}`, { cause: error });
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return { status: response.status, body: json };
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function assertLocalhostListener(port) {
  const result = spawnSync('ss', ['-H', '-ltn', 'sport', '=', `:${port}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return;
  }
  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length > 0, `No listener found for Playground port ${port}`);
  for (const line of lines) {
    const fields = line.split(/\s+/);
    const localAddress = fields[3] || '';
    assert.ok(
      localAddress === `127.0.0.1:${port}` || localAddress === `[127.0.0.1]:${port}`,
      `Playground listener must be 127.0.0.1 only, got: ${line}`,
    );
  }
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

async function isPortAccepting(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function pushLog(logs, chunk) {
  logs.push(chunk);
  if (logs.length > 40) {
    logs.splice(0, logs.length - 40);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
