import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BenchmarkClaimError,
  productionThroughputBlockers,
  ROLLOUT_SAFETY_GATE_DEFINITIONS,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempBenchmarkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-guarded-executor-benchmark-test-'));
}

function smallBenchmark(overrides = {}) {
  return runGuardedExecutorBenchmark({
    profile: 'unit',
    fileBytes: 3 * 1024 * 1024,
    chunkSizeBytes: 512 * 1024,
    rowCount: 16,
    rowPayloadBytes: 192,
    now: fixedNow,
    tempDir: tempBenchmarkDir(),
    ...overrides,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('guarded executor benchmark moves buffers and row payloads through durable evidence', { concurrency: false }, () => {
  const report = smallBenchmark();

  assert.equal(report.claims.labGuardedExecutorEvidence, true);
  assert.equal(report.shape.bytesMovedThroughStaging, report.shape.fileBytes);
  assert.equal(report.evidence.chunkReceipts.recorded, report.shape.chunkCount);
  assert.equal(report.evidence.chunkReceipts.finalStagingRecord, true);
  assert.equal(report.evidence.chunkReceipts.canonicalVisibleBeforePublish, false);
  assert.equal(report.resources.transfer.resourceKey, report.shape.largeUploadResourceKey);
  assert.equal(report.resources.transfer.chunkReceipts, report.shape.chunkCount);
  assert.equal(report.evidence.guardedTransfer.manifest.complete, true);
  assert.equal(report.evidence.guardedTransfer.manifest.entries.length, report.shape.chunkCount);
  assert.equal(report.evidence.guardedTransfer.manifest.byteRangeCoverage.contiguous, true);
  assert.equal(report.evidence.guardedTransfer.receipts.everyReceiptPlanScoped, true);
  assert.equal(report.evidence.guardedTransfer.receipts.receiptKeysUnique, true);
  assert.equal(report.evidence.guardedTransfer.hashVerification.status, 'passed');
  assert.equal(report.evidence.guardedTransfer.hashVerification.allChunksMatchManifest, true);
  assert.equal(
    report.evidence.guardedTransfer.hashVerification.assembledHashMatchesFinalized,
    true,
  );
  assert.equal(report.evidence.guardedTransfer.resume.status, 'passed');
  assert.equal(report.evidence.guardedTransfer.resume.chunksSkippedByReceipt, report.shape.chunkCount);
  assert.equal(report.evidence.guardedTransfer.resume.chunksToUpload, 0);
  assert.equal(report.evidence.guardedTransfer.resume.bytesToUpload, 0);
  assert.equal(report.evidence.guardedTransfer.resume.duplicateMutationWork, 0);
  assert.equal(report.evidence.guardedTransfer.resume.missingReceiptBlocksSkip, true);
  assert.equal(report.evidence.guardedTransfer.resume.mismatchedReceiptBlocksSkip, true);
  assert.equal(report.evidence.guardedTransfer.visibility.livePathChangesOnlyAfterFinalize, true);
  assert.equal(report.evidence.preconditions.liveRemoteMutationPreconditions, report.shape.mutations);
  assert.equal(report.evidence.preconditions.everyMutationHasLiveRemotePrecondition, true);
  assert.ok(report.shape.graphIdentityTargetCount > 0);
  assert.equal(report.evidence.wordpressGraphIdentity.postmetaReferences, report.shape.rowCount);
  assert.equal(
    report.evidence.wordpressGraphIdentity.stableRemotePostTargets,
    report.shape.graphIdentityTargetCount,
  );
  assert.equal(report.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity, true);
  assert.equal(report.evidence.wordpressGraphIdentity.graphIdentityBlockers, 0);
  assert.deepEqual(report.evidence.wordpressGraphIdentity.familyCounters, {
    totalFamilies: 7,
    mappedFamilies: 6,
    unmappedFamilies: 0,
    blockedFamilies: 0,
    guardedFamilies: 1,
    mappedReferences: report.shape.rowCount + 7,
    unmappedReferences: 0,
  });
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.postmetaPostRefs.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.postmetaPostRefs.mapped,
    report.shape.rowCount,
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.postsParents.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.featuredImagesAttachments.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.termsTaxonomies.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.termRelationships.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.termmeta.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.unsupportedPluginOwnedSurfaces.status,
    'planner-guarded',
  );
  assert.ok(
    report.evidence.wordpressGraphIdentity.actionableBlockers.some(
      (blocker) =>
        blocker.family === 'unsupported/plugin-owned surfaces'
        && blocker.plannerOwner === 'planner:test/push-planner.test.js'
        && blocker.smokeOwner === 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    ),
  );
  assert.equal(report.evidence.journal.allJournalsIntegrityOk, true);
  assert.equal(report.evidence.redaction.durableJournalsContainNoRawValues, true);
  assert.equal(report.evidence.recovery.successInspectionStatus, 'fully-updated-remote');
  assert.equal(report.evidence.recovery.preCommitFailureInspectionStatus, 'old-remote');
  assert.equal(report.evidence.recovery.partialCommitInspectionStatus, 'blocked-recovery');
  assert.equal(report.evidence.atomicGroup.requireAtomic, true);
  assert.equal(report.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged, true);
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('guarded benchmark refuses production throughput claims until production gaps are measured', { concurrency: false }, () => {
  const report = smallBenchmark();

  assert.equal(report.claims.productionThroughput.status, 'blocked');
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-atomic-group-commit-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-storage-receipts-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-row-batch-executor-not-measured'),
  );
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-receipts'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-manifest'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-chunk-hash-verification'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-receipt-only-resume-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-live-remote-preconditions'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-partial-commit-recovery-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('wordpress-graph-identity-evidence-not-proven'));

  assert.throws(
    () => smallBenchmark({ claimProductionThroughput: true }),
    (error) =>
      error instanceof BenchmarkClaimError
      && error.code === 'PRODUCTION_THROUGHPUT_CLAIM_BLOCKED'
      && error.details.blockers.includes('production-atomic-group-commit-not-measured'),
  );
});

test('production claim gate fails closed if benchmark evidence is tampered', { concurrency: false }, () => {
  const report = smallBenchmark();

  const missingReceipt = clone(report);
  missingReceipt.evidence.chunkReceipts.recorded -= 1;
  assert.ok(productionThroughputBlockers(missingReceipt).includes('missing-durable-chunk-receipts'));

  const missingManifest = clone(report);
  missingManifest.evidence.guardedTransfer.manifest.complete = false;
  assert.ok(productionThroughputBlockers(missingManifest).includes('missing-durable-chunk-manifest'));

  const missingHashVerification = clone(report);
  missingHashVerification.evidence.guardedTransfer.hashVerification.allChunksMatchManifest = false;
  assert.ok(
    productionThroughputBlockers(missingHashVerification).includes('missing-chunk-hash-verification'),
  );

  const missingResumeEvidence = clone(report);
  missingResumeEvidence.evidence.guardedTransfer.resume.receiptOnlyResumeSafe = false;
  assert.ok(
    productionThroughputBlockers(missingResumeEvidence).includes('missing-receipt-only-resume-evidence'),
  );

  const missingPrecondition = clone(report);
  missingPrecondition.evidence.preconditions.everyMutationHasLiveRemotePrecondition = false;
  assert.ok(productionThroughputBlockers(missingPrecondition).includes('missing-live-remote-preconditions'));

  const missingRecovery = clone(report);
  missingRecovery.evidence.recovery.partialCommitBlocksRecovery = false;
  assert.ok(
    productionThroughputBlockers(missingRecovery).includes('missing-partial-commit-recovery-evidence'),
  );

  const missingGraphIdentity = clone(report);
  missingGraphIdentity.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity = false;
  missingGraphIdentity.evidence.wordpressGraphIdentity.familyReport.postmetaPostRefs.status = 'blocked';
  assert.ok(
    productionThroughputBlockers(missingGraphIdentity).includes('wordpress-graph-identity-evidence-not-proven'),
  );
});

test('rollout safety gates are named before speed claims', { concurrency: false }, () => {
  const report = smallBenchmark({
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
  });
  const rootKeys = Object.keys(report);
  const gateIds = report.rolloutSafetyGates.gates.map((gate) => gate.id);
  const gatesById = new Map(report.rolloutSafetyGates.gates.map((gate) => [gate.id, gate]));

  assert.ok(rootKeys.indexOf('rolloutSafetyGates') < rootKeys.indexOf('throughput'));
  assert.equal(report.rolloutSafetyGates.evaluatedBeforeSpeedClaims, true);
  assert.deepEqual(
    gateIds,
    ROLLOUT_SAFETY_GATE_DEFINITIONS.map((gate) => gate.id),
  );
  for (const gateId of [
    'guarded-transfer-manifest',
    'chunk-hash-verification',
    'receipt-only-resume',
    'live-remote-preconditions',
    'durable-journal-integrity',
    'failure-recovery-classification',
    'atomic-group-visibility',
  ]) {
    assert.equal(gatesById.get(gateId).status, 'passed', `${gateId} should pass in lab evidence`);
    assert.equal(gatesById.get(gateId).speedClaimBlocker, null);
  }

  assert.equal(gatesById.get('production-storage-receipts').status, 'blocked');
  assert.equal(gatesById.get('production-row-batch-executor').status, 'blocked');
  assert.equal(gatesById.get('production-atomic-group-commit').status, 'blocked');
  assert.deepEqual(report.rolloutSafetyGates.summary, {
    passed: 7,
    blocked: 3,
    failed: 0,
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
    ],
    speedClaimsAllowed: false,
  });
});

test('guarded transfer projection is deterministic apart from timings and temp paths', { concurrency: false }, () => {
  const overrides = {
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
  };
  const first = smallBenchmark(overrides);
  const second = smallBenchmark(overrides);

  assert.deepEqual(deterministicTransferProjection(first), deterministicTransferProjection(second));
});

function deterministicTransferProjection(report) {
  return {
    shape: report.shape,
    transfer: report.resources.transfer,
    rolloutSafetyGates: report.rolloutSafetyGates,
    guardedTransfer: {
      manifest: report.evidence.guardedTransfer.manifest,
      receipts: report.evidence.guardedTransfer.receipts,
      hashVerification: report.evidence.guardedTransfer.hashVerification,
      resume: report.evidence.guardedTransfer.resume,
      visibility: report.evidence.guardedTransfer.visibility,
    },
    productionThroughputBlockers: report.claims.productionThroughput.blockers,
  };
}
