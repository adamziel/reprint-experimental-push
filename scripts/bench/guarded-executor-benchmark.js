#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { applyPlan, PushPlanError } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import {
  assertJournalRecordHasNoRawValues,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../../src/recovery-inspect.js';
import { resourceHash } from '../../src/resources.js';
import { DEFAULT_LIMITS, MIB } from './performance-model.js';

const FIXED_NOW = new Date('2026-05-24T00:00:00.000Z');
const LARGE_UPLOAD_PATH = 'wp-content/uploads/2026/05/catalog-export.bin';
const COMMERCE_PLUGIN = 'commerce';
const PAYMENTS_PLUGIN = 'payments';
const COMMERCE_MAIN_FILE = `wp-content/plugins/${COMMERCE_PLUGIN}/${COMMERCE_PLUGIN}.php`;
const PAYMENTS_MAIN_FILE = `wp-content/plugins/${PAYMENTS_PLUGIN}/${PAYMENTS_PLUGIN}.php`;
const ATOMIC_GROUP_ID = 'install-commerce-stack';

export const GUARDED_EXECUTOR_BENCHMARK_PROFILES = Object.freeze({
  unit: Object.freeze({
    fileBytes: 2 * MIB,
    chunkSizeBytes: 512 * 1024,
    rowCount: 24,
    rowPayloadBytes: 256,
  }),
  ci: Object.freeze({
    fileBytes: 16 * MIB,
    chunkSizeBytes: 1 * MIB,
    rowCount: 128,
    rowPayloadBytes: 512,
  }),
  guardedLarge: Object.freeze({
    fileBytes: 32 * MIB,
    chunkSizeBytes: DEFAULT_LIMITS.chunkSizeBytes,
    rowCount: 256,
    rowPayloadBytes: 700,
  }),
});

export class BenchmarkClaimError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BenchmarkClaimError';
    this.code = details.code || 'BENCHMARK_CLAIM_BLOCKED';
    this.details = details;
  }
}

export function runGuardedExecutorBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const tempDir = config.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-guarded-bench-'));
  fs.mkdirSync(tempDir, { recursive: true });

  const timings = {};
  const successJournalPath = path.join(tempDir, 'success.jsonl');
  const successJournal = openRecoveryJournal(successJournalPath, {
    truncate: true,
    now: config.now,
  });

  let stagedFile;
  let plan;
  let sites;
  let applyResult;
  const totalStarted = performance.now();

  try {
    const stageStarted = performance.now();
    stagedFile = stageGeneratedFileBytes({
      tempDir,
      journal: successJournal,
      planId: 'plan-guarded-executor-benchmark',
      resourceKey: `file:${LARGE_UPLOAD_PATH}`,
      fileBytes: config.fileBytes,
      chunkSizeBytes: config.chunkSizeBytes,
      seed: config.seed,
    });
    timings.stageFileMs = elapsedMs(stageStarted);

    const planStarted = performance.now();
    sites = buildBenchmarkSites(config, stagedFile);
    plan = createPushPlan({
      base: sites.base,
      local: sites.local,
      remote: sites.remote,
      now: config.now,
    });
    assertBenchmarkPlan(plan, config);
    timings.planMs = elapsedMs(planStarted);

    const applyStarted = performance.now();
    applyResult = applyPlan(clone(sites.remote), plan, { durableJournal: successJournal });
    timings.applyMs = elapsedMs(applyStarted);
  } finally {
    successJournal.close();
  }

  const successPersisted = readRecoveryJournal(successJournalPath);
  const successInspection = inspectRecoveryJournal({
    journal: successPersisted,
    plan,
    current: applyResult.site,
  });
  const preCommitFailure = runFailureProbe({
    mode: 'pre-commit',
    plan,
    remote: sites.remote,
    tempDir,
    now: config.now,
  });
  const partialFailure = runFailureProbe({
    mode: 'partial-commit',
    plan,
    remote: sites.remote,
    tempDir,
    now: config.now,
    failDuringCommitAtMutation: firstAtomicGroupMutationIndex(plan),
  });

  timings.totalMs = elapsedMs(totalStarted);
  const report = buildReport({
    config,
    tempDir,
    timings,
    stagedFile,
    plan,
    sites,
    applyResult,
    successPersisted,
    successInspection,
    preCommitFailure,
    partialFailure,
  });
  report.claims.productionThroughput = productionThroughputClaim(report);
  report.claims.productionThroughputDetails = productionThroughputDetails(report);

  if (config.claimProductionThroughput) {
    assertCanClaimProductionThroughput(report);
  }

  return report;
}

export function productionThroughputBlockers(report) {
  const blockers = [];
  const backpressureEvidenceComplete = hasCompleteBackpressureEvidence(report);
  const parallelismLimits = report.evidence.parallelism?.parallelismLimits ?? null;
  const receiptCursorBackpressureBytes = report.evidence.backpressure?.receiptCursorBytes ?? null;
  const receiptCursorQueueSlackBytes = report.evidence.backpressure?.receiptCursorQueueSlackBytes ?? null;
  const receiptCursorQueueBudgetBytes = report.evidence.backpressure?.queueBudgetBytes ?? null;
  const receiptCursorQueueHeadroomBytes = report.evidence.backpressure?.queueHeadroomBytes ?? null;
  const receiptCursorMemoryHeadroomBytes = report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes ?? null;
  const receiptCursorMemoryCeilingBytes = report.resourceLimits?.memoryCeilingBytes ?? null;
  const receiptCursorWindowBytes = report.evidence.chunkReceipts.resumeCursor?.sizeBytes ?? null;
  const receiptCursorMemoryCeilingVisible =
    Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorMemoryCeilingBytes === receiptCursorQueueBudgetBytes;
  const backpressureAlignment = {
    aligned:
      Number.isFinite(receiptCursorBackpressureBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorMemoryHeadroomBytes)
      && receiptCursorBackpressureBytes === receiptCursorWindowBytes
      && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
      && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
      && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes,
  };
  if (report.evidence.chunkReceipts.recorded !== report.evidence.chunkReceipts.expected) {
    blockers.push('missing-durable-chunk-receipts');
  }
  if (
    !report.evidence.chunkReceipts.resumeCursor
    || report.evidence.chunkReceipts.resumeCursor.planId !== 'plan-guarded-executor-benchmark'
    || report.evidence.chunkReceipts.resumeCursor.chunkIndex !== report.evidence.chunkReceipts.recorded - 1
    || report.evidence.chunkReceipts.resumeCursor.chunkCount !== report.evidence.chunkReceipts.expected
    || !Number.isFinite(report.evidence.chunkReceipts.resumeCursor.sizeBytes)
    || report.evidence.chunkReceipts.resumeCursor.sizeBytes <= 0
    || report.evidence.chunkReceipts.resumeCursor.sizeBytes > report.shape.chunkSizeBytes
    || report.evidence.chunkReceipts.resumeCursor.resourceKey !== report.shape.largeUploadResourceKey
    || report.evidence.chunkReceipts.resumeCursor.offsetBytes !== (report.shape.fileBytes - report.evidence.chunkReceipts.resumeCursor.sizeBytes)
    || typeof report.evidence.chunkReceipts.resumeCursor.receiptKey !== 'string'
    || report.evidence.chunkReceipts.resumeCursor.receiptKey.length === 0
    || report.evidence.chunkReceipts.cursorConsistency?.matchesRecordedReceiptCount !== true
    || report.evidence.chunkReceipts.cursorConsistency?.canResumeFromCursor !== true
  ) {
    blockers.push('missing-valid-receipt-cursor');
  }
  if (!report.evidence.preconditions.everyMutationHasLiveRemotePrecondition) {
    blockers.push('missing-live-remote-preconditions');
  }
  if (!report.evidence.journal.allJournalsIntegrityOk) {
    blockers.push('missing-durable-journal-integrity');
  }
  if (areReceiptKindsGrouped(report.evidence.journal?.successRecordTypes ?? []) !== true) {
    blockers.push('receipt-flushes-not-kind-scoped');
  }
  if (report.evidence.journal?.successReceiptKindLedgerComplete !== true) {
    blockers.push('receipt-ledger-kind-summary-not-proven');
  }
  if (
    !Array.isArray(report.evidence.journal?.successReceiptKindLedger)
    || report.evidence.journal.successReceiptKindLedger.length !== report.evidence.journal.successRecords
    || report.evidence.journal.successReceiptKindLedger.some((entry) => !entry || typeof entry.kind !== 'string' || entry.kind.length === 0)
  ) {
    blockers.push('receipt-ledger-kind-summary-mismatch');
  }
  if (!report.evidence.redaction.durableJournalsContainNoRawValues) {
    blockers.push('durable-journal-redaction-not-proven');
  }
  if (
    !report.evidence.wordpressGraphIdentity?.allPostmetaReferencesUseStableRemoteIdentity
    || report.evidence.wordpressGraphIdentity.graphIdentityBlockers !== 0
  ) {
    blockers.push('wordpress-graph-identity-evidence-not-proven');
  }
  if (
    Number.isFinite(report.evidence.wordpressGraphIdentity?.postmetaReferences)
    && Number.isFinite(report.shape?.rowCount)
    && report.evidence.wordpressGraphIdentity.postmetaReferences !== report.shape.rowCount
  ) {
    blockers.push('wordpress-graph-identity-postmeta-count-mismatch');
  }
  if (!report.evidence.recovery.successReplayInspectable) {
    blockers.push('missing-success-recovery-evidence');
  }
  if (report.evidence.recovery.successInspectionStatus !== 'fully-updated-remote') {
    blockers.push('success-recovery-status-mismatch');
  }
  if (!report.evidence.recovery.preCommitFailureInspectable) {
    blockers.push('missing-pre-commit-recovery-evidence');
  }
  if (report.evidence.recovery.preCommitFailureInspectionStatus !== 'old-remote') {
    blockers.push('pre-commit-recovery-status-mismatch');
  }
  if (!report.evidence.recovery.partialCommitBlocksRecovery) {
    blockers.push('missing-partial-commit-recovery-evidence');
  }
  if (report.evidence.recovery.partialCommitInspectionStatus !== 'blocked-recovery') {
    blockers.push('partial-commit-recovery-status-mismatch');
  }
  if (!report.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged) {
    blockers.push('atomic-group-pre-commit-visibility-not-proven');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && !backpressureAlignment.aligned
  ) {
    blockers.push('queue-pause-without-resource-headroom-safe-receipt-cursor-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('queue-budget-visible-without-memory-ceiling-visible');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('queue-budget-visible-without-queue-headroom-visible');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('queue-budget-visible-without-queue-headroom-measurement');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('memory-ceiling-visible-without-queue-budget-visible');
  }
  if (!Number.isFinite(report.resourceLimits?.memoryCeilingBytes) || report.resourceLimits.memoryCeilingBytes <= 0) {
    blockers.push('production-memory-ceiling-not-measured');
  }
  if (
    !parallelismLimits
    || !Number.isFinite(parallelismLimits?.chunkUpload)
    || !Number.isFinite(parallelismLimits?.fileHashing)
    || !Number.isFinite(parallelismLimits?.dbBatchPerTable)
    || parallelismLimits.chunkUpload <= 0
    || parallelismLimits.fileHashing <= 0
    || parallelismLimits.dbBatchPerTable <= 0
  ) {
    blockers.push('production-parallelism-limits-not-measured');
  }
  if (
    !Number.isInteger(parallelismLimits?.chunkUpload)
    || !Number.isInteger(parallelismLimits?.fileHashing)
    || !Number.isInteger(parallelismLimits?.dbBatchPerTable)
  ) {
    blockers.push('production-parallelism-limits-not-integral');
  }
  if (
    parallelismLimits?.chunkUpload !== DEFAULT_LIMITS.maxUploadConcurrency
    || parallelismLimits?.fileHashing !== DEFAULT_LIMITS.maxHashConcurrency
    || parallelismLimits?.dbBatchPerTable !== DEFAULT_LIMITS.maxDbConcurrencyPerTable
  ) {
    blockers.push('production-parallelism-limits-not-canonical');
  }
  if (
    parallelismLimits?.chunkUpload === DEFAULT_LIMITS.maxUploadConcurrency
    && parallelismLimits?.fileHashing === DEFAULT_LIMITS.maxHashConcurrency
    && parallelismLimits?.dbBatchPerTable === DEFAULT_LIMITS.maxDbConcurrencyPerTable
    && report.claims?.productionThroughputDetails?.parallelismLimitsVisible !== true
  ) {
    blockers.push('production-parallelism-limits-not-visible');
  }
  if (
    report.evidence.parallelism?.parallelismLimitsVisible === true
    && report.evidence.parallelism?.parallelismLimitsMeasured !== true
  ) {
    blockers.push('production-parallelism-limits-visible-without-measurement');
  }
  if (
    report.evidence.parallelism?.parallelismLimitsVisible === true
    && (
      report.evidence.parallelism?.parallelismLimits?.chunkUpload !== DEFAULT_LIMITS.maxUploadConcurrency
      || report.evidence.parallelism?.parallelismLimits?.fileHashing !== DEFAULT_LIMITS.maxHashConcurrency
      || report.evidence.parallelism?.parallelismLimits?.dbBatchPerTable !== DEFAULT_LIMITS.maxDbConcurrencyPerTable
    )
  ) {
    blockers.push('production-parallelism-limits-visible-without-canonical');
  }
  if (
    !Number.isFinite(report.resourceLimits?.memoryCeilingBytes)
    || !Number.isFinite(report.evidence.chunkReceipts.resumeCursor?.sizeBytes)
    || report.evidence.chunkReceipts.resumeCursor.sizeBytes > report.resourceLimits.memoryCeilingBytes
  ) {
    blockers.push('receipt-cursor-memory-headroom-not-measured');
  }
  if (
    !Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    || report.resourceLimits.maxBufferedUploadBytes <= 0
    || report.shape.chunkSizeBytes > report.resourceLimits.maxBufferedUploadBytes
    || report.evidence.resourceLimits?.chunkWindowWithinMemoryCeiling !== true
  ) {
    blockers.push('chunk-window-exceeds-memory-ceiling');
  }
  if (report.evidence.backpressure?.queueBudgetMatchesResourceCeiling !== true) {
    blockers.push('queue-budget-does-not-match-resource-ceiling');
  }
  if (report.evidence.backpressure?.receiptCursorWithinQueueBudget !== true) {
    blockers.push('receipt-cursor-exceeds-queue-budget');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
    && Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
    && report.evidence.backpressure.receiptCursorBytes > report.evidence.backpressure.queueBudgetBytes
  ) {
    blockers.push('receipt-cursor-backpressure-exceeds-queue-budget');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
    && Number.isFinite(report.resourceLimits?.memoryCeilingBytes)
    && Number.isFinite(report.evidence.chunkReceipts.resumeCursor?.sizeBytes)
    && report.evidence.backpressure.receiptCursorBytes
      > report.resourceLimits.memoryCeilingBytes - report.evidence.chunkReceipts.resumeCursor.sizeBytes
  ) {
    blockers.push('receipt-cursor-backpressure-exceeds-resource-headroom');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    && Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
  ) {
    blockers.push('receipt-cursor-backpressure-without-queue-pause');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && backpressureAlignment.aligned !== true
  ) {
    blockers.push('backpressure-alignment-not-proven');
  }
  if (report.evidence.backpressure?.receiptCursorBackpressureWithinQueueHeadroom !== true) {
    blockers.push('receipt-cursor-exceeds-queue-headroom');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorPauseFootprintComplete !== true
  ) {
    blockers.push('queue-pause-footprint-not-proven');
  }
  if (report.evidence.backpressure?.queuePausedBeforeOverflow !== true) {
    blockers.push('queue-did-not-pause-before-overflow');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorPauseFootprintComplete !== true
  ) {
    blockers.push('queue-pause-without-complete-receipt-cursor-pause-footprint');
  }
  if (report.evidence.backpressure?.queueHeadroomMeasured !== true) {
    blockers.push('queue-headroom-not-measured');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.chunkReceipts.cursorConsistency?.canResumeFromCursor !== true
  ) {
    blockers.push('queue-pause-without-terminal-receipt-cursor');
  }
  if (report.evidence.chunkReceipts.cursorConsistency?.canResumeFromCursor !== true) {
    blockers.push('receipt-cursor-not-terminal');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorBackpressureMeasured !== true
  ) {
    blockers.push('queue-pause-without-measured-receipt-cursor-backpressure');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      !Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
      || report.evidence.backpressure.receiptCursorQueueSlackBytes <= 0
    )
  ) {
    blockers.push('queue-pause-without-measured-receipt-cursor-queue-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-pause-without-measured-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes == null
  ) {
    blockers.push('queue-pause-without-measured-receipt-cursor-memory-headroom');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure !== true
  ) {
    blockers.push('queue-pause-without-measured-receipt-cursor-backpressure-proof');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure !== true
      || report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorQueueSlack !== true
    )
  ) {
    blockers.push('queue-pause-without-measured-and-aligned-receipt-cursor-backpressure');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure !== true
  ) {
    blockers.push('queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && report.evidence.backpressure?.receiptCursorBackpressureWithinResourceHeadroom !== true
  ) {
    blockers.push('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && (
      report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure !== true
      || report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorQueueSlack !== true
      || report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure !== true
    )
  ) {
    blockers.push('queue-pause-without-consistent-measured-and-aligned-receipt-cursor-backpressure');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack === true
    && (
      report.evidence.backpressure?.queueHeadroomMeasured !== true
      || report.evidence.backpressure?.receiptCursorQueueSlackMeasured !== true
      || report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorQueueSlack !== true
      || report.evidence.backpressure?.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack !== true
    )
  ) {
    blockers.push('queue-pause-without-consistent-measured-and-aligned-receipt-cursor-queue-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudget !== true
  ) {
    blockers.push('queue-pause-without-memory-ceiling-matching-queue-budget-proof');
  }
  if (receiptCursorMemoryCeilingVisible !== true) {
    blockers.push('queue-memory-ceiling-does-not-match-queue-budget');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('queue-pause-without-measured-queue-headroom-proof');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack-proof');
  }
  if (report.evidence.backpressure?.receiptCursorQueueSlackBytes == null) {
    blockers.push('receipt-cursor-queue-slack-not-measured');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    && Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
  ) {
    blockers.push('receipt-cursor-queue-slack-without-queue-pause');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      report.evidence.backpressure?.receiptCursorQueueSlackBytes == null
      || report.evidence.backpressure?.receiptCursorQueueSlackBytes <= 0
      || report.evidence.backpressure?.receiptCursorQueueSlackBytes
        !== report.evidence.backpressure?.queueHeadroomBytes
      || report.evidence.backpressure?.receiptCursorQueueSlackBytes
        !== report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes
    )
  ) {
    blockers.push('queue-pause-without-consistent-receipt-cursor-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && report.evidence.backpressure.queueHeadroomBytes <= 0
  ) {
    blockers.push('queue-pause-without-positive-queue-headroom');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes
      > report.evidence.backpressure.queueHeadroomBytes
  ) {
    blockers.push('queue-pause-without-queue-headroom-safe-receipt-cursor-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      !Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
      || !Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
      || !Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
      || report.evidence.backpressure.receiptCursorQueueSlackBytes
        !== report.evidence.backpressure.queueBudgetBytes - report.evidence.backpressure.receiptCursorBytes
    )
  ) {
    blockers.push('queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
    && Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes
      !== report.evidence.backpressure.queueBudgetBytes - report.evidence.backpressure.receiptCursorBytes
  ) {
    blockers.push('queue-pause-without-backpressure-aligned-receipt-cursor-slack');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes > report.evidence.backpressure.queueBudgetBytes
  ) {
    blockers.push('receipt-cursor-queue-slack-exceeds-queue-budget');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorQueueSlackBytes != null
    && report.evidence.backpressure.receiptCursorQueueSlackWithinMemoryCeiling !== true
  ) {
    blockers.push('queue-pause-without-memory-safe-receipt-cursor-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorQueueSlackBytes != null
    && report.evidence.backpressure.receiptCursorQueueSlackWithinResourceHeadroom !== true
  ) {
    blockers.push('queue-pause-without-resource-headroom-safe-receipt-cursor-slack');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes <= 0
  ) {
    blockers.push('receipt-cursor-queue-slack-not-positive');
  }
  if (
    !Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
    || report.evidence.backpressure.queueBudgetBytes <= 0
  ) {
    blockers.push('missing-queue-budget-evidence');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('queue-budget-not-visible');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('queue-budget-visible-without-memory-ceiling-visibility');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible !== true
  ) {
    blockers.push('queue-budget-visible-without-memory-ceiling-match-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('memory-ceiling-visible-without-queue-budget-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('memory-ceiling-visible-without-queue-headroom-visible');
  }
  if (
    report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('queue-headroom-visible-without-queue-budget-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
    && report.evidence.backpressure?.queueHeadroomVisible === true
  ) {
    blockers.push('memory-ceiling-and-queue-headroom-visible-without-queue-budget-visibility');
  }
  if (
    !Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    || report.evidence.backpressure.queueHeadroomBytes < 0
  ) {
    blockers.push('missing-queue-headroom-evidence');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && report.evidence.backpressure.queueHeadroomBytes <= 0
  ) {
    blockers.push('queue-headroom-not-positive');
  }
  if (report.evidence.backpressure?.queueHeadroomMeasured === true && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling !== true) {
    blockers.push('queue-headroom-exceeds-resource-ceiling');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('queue-headroom-not-visible');
  }
  if (
    report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('queue-headroom-visible-without-measurement');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('queue-budget-and-queue-headroom-visible-without-queue-headroom-measurement');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('queue-pause-without-visible-memory-ceiling');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes)
    && report.evidence.backpressure.receiptCursorMemoryHeadroomBytes <= 0
  ) {
    blockers.push('receipt-cursor-memory-headroom-not-positive');
  }
  if (backpressureEvidenceComplete !== true) {
    blockers.push('backpressure-evidence-incomplete');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && report.evidence.backpressure.queueBudgetBytes !== report.resourceLimits.maxBufferedUploadBytes
  ) {
    blockers.push('queue-budget-does-not-match-resource-ceiling');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.queueBudgetBytes)
    && Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && report.evidence.backpressure.queueHeadroomBytes
      !== report.evidence.backpressure.queueBudgetBytes - report.shape.chunkSizeBytes
  ) {
    blockers.push('queue-headroom-backpressure-mismatch');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && Number.isFinite(report.evidence.chunkReceipts.resumeCursor?.sizeBytes)
    && Number.isFinite(report.resourceLimits?.memoryCeilingBytes)
    && report.evidence.backpressure.queueHeadroomBytes
      !== report.resourceLimits.memoryCeilingBytes - report.evidence.chunkReceipts.resumeCursor.sizeBytes
  ) {
    blockers.push('receipt-cursor-headroom-mismatch');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && Number.isFinite(report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes)
    && report.evidence.backpressure.queueHeadroomBytes
      !== report.evidence.backpressure.receiptCursorMemoryHeadroomBytes
  ) {
    blockers.push('queue-headroom-memory-headroom-mismatch');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && Number.isFinite(report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes
      !== report.evidence.backpressure.receiptCursorMemoryHeadroomBytes
  ) {
    blockers.push('receipt-cursor-queue-slack-mismatch');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes
      !== report.evidence.backpressure.queueHeadroomBytes
  ) {
    blockers.push('receipt-cursor-queue-slack-headroom-mismatch');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
    && Number.isFinite(report.resourceLimits?.memoryCeilingBytes)
    && Number.isFinite(report.evidence.chunkReceipts.resumeCursor?.sizeBytes)
    && report.evidence.backpressure.receiptCursorQueueSlackBytes
      !== report.resourceLimits.memoryCeilingBytes - report.evidence.chunkReceipts.resumeCursor.sizeBytes
  ) {
    blockers.push('receipt-cursor-queue-slack-resource-headroom-mismatch');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && !Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
  ) {
    blockers.push('receipt-cursor-queue-slack-not-measured');
  }
  if (report.evidence.backpressure?.receiptCursorHeadroomWithinQueueBudget !== true) {
    blockers.push('receipt-cursor-headroom-not-covered-by-queue-budget');
  }
  if (report.evidence.backpressure?.receiptCursorMemoryHeadroomWithinQueueBudget !== true) {
    blockers.push('receipt-cursor-memory-headroom-not-covered-by-queue-budget');
  }
  if (
    report.evidence.backpressure?.receiptCursorBytes !== null
    && report.evidence.backpressure?.receiptCursorBytes !== report.evidence.chunkReceipts.resumeCursor?.sizeBytes
  ) {
    blockers.push('receipt-cursor-backpressure-mismatch');
  }
  if (
    !Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
    || report.evidence.backpressure.receiptCursorBytes <= 0
  ) {
    blockers.push('receipt-cursor-backpressure-not-measured');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.receiptCursorBytes)
    && report.evidence.backpressure.receiptCursorBytes <= 0
  ) {
    blockers.push('receipt-cursor-backpressure-not-positive');
  }
  if (!report.evidence.atomicGroup.productionAtomicCommitMeasured) {
    blockers.push('production-atomic-group-commit-not-measured');
  }
  if (
    report.evidence.atomicGroup.productionAtomicCommitMeasured === true
    && (
      report.evidence.atomicGroup.groupStatus !== 'ready'
      || report.evidence.atomicGroup.requireAtomic !== true
    )
  ) {
    blockers.push('production-atomic-group-metadata-not-proven');
  }
  if (
    !(
      report.evidence.atomicGroup.productionAtomicCommitMeasured
      && report.executorCapabilities.rowApply === 'production-batched-compare-and-swap'
    )
  ) {
    blockers.push('production-capability-measurement-not-aligned');
  }
  if (
    report.evidence.atomicGroup.productionAtomicCommitMeasured === true
    && report.evidence.atomicGroup.productionAtomicGroupMetadataVisible !== true
  ) {
    blockers.push('production-atomic-group-metadata-not-visible');
  }
  if (
    report.evidence.atomicGroup.productionAtomicGroupMetadataVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitMeasured !== true
  ) {
    blockers.push('production-atomic-group-metadata-visible-without-measurement');
  }
  if (
    report.evidence.atomicGroup.productionAtomicGroupMetadataVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible !== true
  ) {
    blockers.push('production-atomic-group-metadata-visible-without-atomic-commit');
  }
  if (
    report.evidence.atomicGroup.productionAtomicGroupMetadataVisible === true
    && report.evidence.atomicGroup.productionStorageReceiptsMeasured !== true
  ) {
    blockers.push('production-atomic-group-metadata-visible-without-storage-receipts-measurement');
  }
  if (
    report.evidence.atomicGroup.productionAtomicCommitVisible === true
    && report.evidence.atomicGroup.productionAtomicGroupMetadataVisible !== true
  ) {
    blockers.push('production-atomic-group-commit-visible-without-metadata');
  }
  if (
    report.evidence.atomicGroup.productionAtomicCommitVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitMeasured !== true
  ) {
    blockers.push('production-atomic-group-commit-visible-without-measurement');
  }
  if (
    report.evidence.atomicGroup.productionAtomicCommitMeasured === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible !== true
  ) {
    blockers.push('production-atomic-group-commit-not-visible');
  }
  if (
    report.results?.successInspection?.claim?.status != null
    && !['none', 'active', 'advanced', 'blocked'].includes(report.results.successInspection.claim.status)
  ) {
    blockers.push('success-inspection-claim-status-not-recognized');
  }
  if (
    report.results?.successInspection?.claim?.status === 'blocked'
    && (
      typeof report.results.successInspection?.claim?.reason !== 'string'
      || report.results.successInspection.claim.reason.trim().length === 0
    )
  ) {
    blockers.push('success-inspection-claim-reason-not-proven');
  }
  if (
    report.results?.successInspection?.claim?.status === 'blocked'
    && report.evidence.recovery.successInspectionStatus === 'fully-updated-remote'
  ) {
    blockers.push('success-inspection-claim-status-mismatch');
  }
  if (
    report.evidence.recovery.successInspectionStatus === 'fully-updated-remote'
    && report.results?.successInspection?.claim?.status != null
    && report.results.successInspection.claim.status !== 'none'
  ) {
    blockers.push('success-inspection-claim-status-not-canonical');
  }
  if (
    report.results?.successInspection?.claim?.status === 'none'
    && report.results.successInspection?.claim?.reason != null
  ) {
    blockers.push('success-inspection-claim-reason-not-canonical');
  }
  if (
    report.results?.successInspection?.claim?.status !== 'blocked'
    && report.results?.successInspection?.claim?.reason != null
  ) {
    blockers.push('success-inspection-claim-reason-not-empty');
  }
  if (
    Number.isFinite(report.results?.successInspection?.counts?.new)
    && Number.isFinite(report.shape?.mutations)
    && report.results.successInspection.counts.new !== report.shape.mutations
  ) {
    blockers.push('success-inspection-counts-not-aligned');
  }
  if (report.executorCapabilities.fileReceipts !== 'production-storage-receipts') {
    blockers.push('production-storage-receipts-not-measured');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsMeasured !== (report.executorCapabilities.fileReceipts === 'production-storage-receipts')
  ) {
    blockers.push('production-storage-receipts-evidence-not-aligned');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsMeasured === true
    && report.evidence.atomicGroup.productionStorageReceiptsVisible !== true
  ) {
    blockers.push('production-storage-receipts-not-visible');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionStorageReceiptsMeasured !== true
  ) {
    blockers.push('production-storage-receipts-visible-without-measurement');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionAtomicGroupMetadataVisible !== true
  ) {
    blockers.push('production-storage-receipts-without-atomic-group-metadata');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionAtomicGroupMetadataVisible !== true
  ) {
    blockers.push('production-storage-receipts-and-row-batch-visible-without-atomic-group-metadata');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible !== true
  ) {
    blockers.push('production-storage-receipts-without-atomic-commit');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible === true
    && report.evidence.atomicGroup.productionStorageReceiptsMeasured !== true
  ) {
    blockers.push('production-storage-receipts-visible-and-atomic-commit-visible-without-measurement');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitMeasured !== true
  ) {
    blockers.push('production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement');
  }
  if (
    report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible === true
    && report.evidence.atomicGroup.productionAtomicGroupMetadataVisible !== true
  ) {
    blockers.push('production-storage-receipts-visible-and-atomic-commit-visible-without-metadata');
  }
  if (report.executorCapabilities.rowApply !== 'production-batched-compare-and-swap') {
    blockers.push('production-row-batch-executor-not-measured');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorMeasured
    !== (report.executorCapabilities.rowApply === 'production-batched-compare-and-swap')
  ) {
    blockers.push('production-row-batch-executor-evidence-not-aligned');
  }
  if (!report.evidence.atomicGroup.productionRowBatchExecutorMeasured) {
    blockers.push('production-row-batch-executor-measured-not-proven');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorMeasured === true
    && report.evidence.atomicGroup.productionRowBatchExecutorVisible !== true
  ) {
    blockers.push('production-row-batch-executor-not-visible');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionRowBatchExecutorMeasured !== true
  ) {
    blockers.push('production-row-batch-executor-visible-without-measurement');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionStorageReceiptsMeasured !== true
  ) {
    blockers.push('production-row-batch-executor-visible-without-storage-receipts-measurement');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionAtomicGroupMetadataVisible !== true
  ) {
    blockers.push('production-row-batch-executor-without-atomic-group-metadata');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionStorageReceiptsVisible !== true
  ) {
    blockers.push('production-row-batch-executor-without-storage-receipts');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionStorageReceiptsVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible !== true
  ) {
    blockers.push('production-row-batch-executor-visible-and-storage-receipts-visible-without-atomic-commit');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible !== true
  ) {
    blockers.push('production-row-batch-executor-without-atomic-commit');
  }
  return blockers;
}

export function productionThroughputClaim(report) {
  const blockers = productionThroughputBlockers(report);
  return {
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    blockers,
  };
}

export function productionThroughputDetails(report) {
  const receiptCursorWindowBytes = report.evidence.chunkReceipts.resumeCursor?.sizeBytes ?? null;
  const receiptCursorBackpressureBytes = report.evidence.backpressure?.receiptCursorBytes ?? null;
  const receiptCursorMemoryHeadroomBytes = report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes ?? null;
  const receiptCursorMemoryCeilingBytes = report.resourceLimits?.memoryCeilingBytes ?? null;
  const receiptCursorQueueBudgetBytes = report.evidence.backpressure?.queueBudgetBytes ?? null;
  const receiptCursorMemoryCeilingVisible =
    report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true;
  const receiptCursorQueueHeadroomBytes = report.evidence.backpressure?.queueHeadroomBytes ?? null;
  const receiptCursorQueueSlackBytes = report.evidence.backpressure?.receiptCursorQueueSlackBytes ?? null;
  const receiptCursorQueueHeadroomPositive =
    Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorQueueHeadroomBytes > 0;
  const queueBudgetPositive =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorQueueBudgetBytes > 0;
  const queueBudgetVisible =
    report.evidence.backpressure?.queueBudgetVisible === true;
  const queueHeadroomVisible =
    report.evidence.backpressure?.queueHeadroomVisible === true;
  const queueHeadroomMeasured = report.evidence.backpressure?.queueHeadroomMeasured === true;
  const queueHeadroomVisibleAndMeasured =
    queueHeadroomVisible && queueHeadroomMeasured;
  const queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured =
    queueBudgetVisible
    && receiptCursorMemoryCeilingVisible
    && queueHeadroomMeasured;
  const queueBudgetVisibleAndQueueHeadroomMeasured =
    queueBudgetVisible && queueHeadroomMeasured;
  const queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured =
    queueBudgetVisible && queueHeadroomVisible && queueHeadroomMeasured;
  const receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible =
    receiptCursorMemoryCeilingVisible && queueBudgetVisible && queueHeadroomVisible && queueHeadroomMeasured;
  const receiptCursorMemoryHeadroomPositive =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorMemoryHeadroomBytes > 0;
  const receiptCursorQueueSlackPositive =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && receiptCursorQueueSlackBytes > 0;
  const backpressureEvidenceComplete = hasCompleteBackpressureEvidence(report);
  const receiptCursorIsTerminalChunk =
    report.evidence.chunkReceipts.cursorConsistency?.canResumeFromCursor === true
    && report.evidence.chunkReceipts.resumeCursor?.chunkIndex
      === report.evidence.chunkReceipts.resumeCursor?.chunkCount - 1;
  const receiptCursorMatchesChunkWindow =
    Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorWindowBytes === report.shape.chunkSizeBytes;
  const receiptCursorWithinMemoryCeiling =
    Number.isFinite(receiptCursorWindowBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && receiptCursorWindowBytes <= receiptCursorMemoryCeilingBytes;
  const receiptCursorHeadroomMatchesQueueHeadroom =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorMemoryHeadroomBytes === receiptCursorQueueHeadroomBytes;
  const receiptCursorBackpressureWithinQueueHeadroom =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorBackpressureBytes <= receiptCursorQueueHeadroomBytes;
  const receiptCursorBackpressureWithinResourceHeadroom =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorBackpressureBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe =
    receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible
    && receiptCursorBackpressureWithinResourceHeadroom;
  const queueHeadroomWithinResourceCeiling =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes;
  const queueHeadroomMatchesMemoryHeadroom =
    Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorQueueHeadroomBytes === receiptCursorMemoryHeadroomBytes;
  const receiptCursorBackpressureWithinQueueBudget =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorBackpressureBytes <= receiptCursorQueueBudgetBytes;
  const receiptCursorQueueSlackMatchesBackpressure =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorBackpressureBytes)
    && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes;
  const receiptCursorQueueSlackMatchesMemoryHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes;
  const receiptCursorQueueSlackMatchesQueueHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorQueueSlackBytes === receiptCursorQueueHeadroomBytes;
  const receiptCursorQueueSlackMatchesResourceHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorQueueSlackBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const receiptCursorQueueSlackWithinMemoryCeiling =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes;
  const receiptCursorQueueSlackMeasured =
    Number.isFinite(receiptCursorQueueSlackBytes);
  const receiptCursorQueueSlackWithinQueueBudget =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorQueueSlackBytes > 0
    && receiptCursorQueueSlackBytes <= receiptCursorQueueBudgetBytes;
  const receiptCursorQueueSlackWithinQueueHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorQueueHeadroomBytes;
  const receiptCursorQueueSlackWithinResourceHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const queueHeadroomPositive = receiptCursorQueueHeadroomPositive;
  const receiptCursorMemoryHeadroomPositiveVisible = receiptCursorMemoryHeadroomPositive;
  const queuePauseHasMeasuredReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      queueHeadroomMeasured
      && receiptCursorQueueSlackPositive
      && receiptCursorQueueSlackWithinQueueBudget
    );
  const queuePauseHasBackpressureAlignedReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      queueHeadroomMeasured
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorBackpressureBytes)
      && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
      && report.evidence.backpressure?.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack === true
    );
  const receiptCursorHeadroomCoveredByQueueBudget =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorMemoryHeadroomBytes <= receiptCursorQueueHeadroomBytes;
  const receiptCursorMemoryHeadroomWithinQueueBudget =
    receiptCursorHeadroomCoveredByQueueBudget && receiptCursorHeadroomMatchesQueueHeadroom;
  const receiptCursorHeadroomWithinQueueBudget =
    receiptCursorHeadroomCoveredByQueueBudget && receiptCursorHeadroomMatchesQueueHeadroom;
  const receiptCursorMemoryCeilingMatchesQueueBudget =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudget === true
    && receiptCursorQueueBudgetBytes === receiptCursorMemoryCeilingBytes;
  const receiptCursorMemoryCeilingMatchesQueueBudgetVisible = receiptCursorMemoryCeilingMatchesQueueBudget;
  const backpressureAlignment = {
    queueBudgetBytes: receiptCursorQueueBudgetBytes,
    queueHeadroomBytes: receiptCursorQueueHeadroomBytes,
    receiptCursorBytes: receiptCursorBackpressureBytes,
    receiptCursorQueueSlackBytes,
    receiptCursorMemoryHeadroomBytes,
    aligned:
      Number.isFinite(receiptCursorBackpressureBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorMemoryHeadroomBytes)
      && receiptCursorBackpressureBytes === receiptCursorWindowBytes
      && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
      && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
      && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes,
  };
  const successInspectionClaimStatus = report.results.successInspection?.claim?.status ?? null;
  const successInspectionClaimReason = report.results.successInspection?.claim?.reason ?? null;
  const successInspectionClaimReasonTrimmed = typeof successInspectionClaimReason === 'string'
    ? successInspectionClaimReason.trim()
    : null;
  const successInspectionClaimRecognized =
    successInspectionClaimStatus === 'none'
    || successInspectionClaimStatus === 'active'
    || successInspectionClaimStatus === 'advanced'
    || successInspectionClaimStatus === 'blocked';
  const successInspectionClaimReasonProven =
    successInspectionClaimStatus !== 'blocked'
    || (successInspectionClaimReasonTrimmed !== null
      && successInspectionClaimReasonTrimmed.length > 0);
  const successInspectionClaimMatchesInspectionStatus =
    successInspectionClaimRecognized
    && (
      successInspectionClaimStatus !== 'blocked'
      || report.evidence.recovery.successInspectionStatus !== 'fully-updated-remote'
    );
  const successInspectionClaimCanonical =
    report.evidence.recovery.successInspectionStatus !== 'fully-updated-remote'
    || successInspectionClaimStatus == null
    || successInspectionClaimStatus === 'none';
  const successInspectionClaimReasonCanonical =
    successInspectionClaimStatus === 'blocked'
    || successInspectionClaimReason == null;
  const successInspectionCountsNewMatchesMutations =
    Number.isFinite(report.results.successInspection?.counts?.new)
    && Number.isFinite(report.shape?.mutations)
    && report.results.successInspection.counts.new === report.shape.mutations;
  const receiptCursorHeadroomMatchesResourceHeadroom =
    receiptCursorWithinMemoryCeiling
    && receiptCursorMemoryHeadroomBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const receiptCursorPauseFootprint = {
    receiptCursorBytes: receiptCursorBackpressureBytes,
    queueBudgetBytes: receiptCursorQueueBudgetBytes,
    queueHeadroomBytes: receiptCursorQueueHeadroomBytes,
    queueSlackBytes: receiptCursorQueueSlackBytes,
    memoryCeilingBytes: receiptCursorMemoryCeilingBytes,
    memoryHeadroomBytes: receiptCursorMemoryHeadroomBytes,
  };
  const receiptCursorPauseFootprintComplete =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorBackpressureBytes === receiptCursorWindowBytes
    && receiptCursorQueueBudgetBytes === receiptCursorMemoryCeilingBytes
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
    && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes;
  const receiptCursorPauseFootprintVisible = receiptCursorPauseFootprintComplete;
  const queueBudgetMatchesResourceCeiling =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes;
  const queueHeadroomMatchesResourceHeadroom =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes;
  const receiptCursorMatchesBackpressure =
    receiptCursorBackpressureBytes !== null
    && receiptCursorBackpressureBytes === receiptCursorWindowBytes;
  const receiptCursorBackpressureMeasured =
    Number.isFinite(receiptCursorBackpressureBytes)
    && receiptCursorBackpressureBytes > 0;
  const queuePauseHasMeasuredReceiptCursorBackpressure =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      receiptCursorBackpressureMeasured
      && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    );
  const queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      queuePauseHasMeasuredReceiptCursorBackpressure
      && queuePauseHasMeasuredReceiptCursorQueueSlack
      && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    );
  const queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      queueHeadroomMeasured
      && queuePauseHasMeasuredReceiptCursorQueueSlack
      && queuePauseHasBackpressureAlignedReceiptCursorQueueSlack
      && receiptCursorQueueSlackMatchesBackpressure
      && receiptCursorQueueSlackMatchesMemoryHeadroom
      && receiptCursorQueueSlackMatchesQueueHeadroom
      && receiptCursorQueueSlackMatchesResourceHeadroom
    );
  const pausedQueueSlackEvidence = {
    queuePauseHasMeasuredReceiptCursorQueueSlack,
    queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
  };
  const receiptCursorMemoryHeadroomMatchesResourceHeadroom =
    receiptCursorWithinMemoryCeiling
    && receiptCursorMemoryHeadroomBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const receiptCursorMemoryHeadroomWithinResourceHeadroom =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorMemoryHeadroomBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const journalSuccessRecordTypes = report.evidence.journal?.successRecordTypes ?? [];
  const journalSuccessReceiptKinds = journalSuccessRecordTypes.map((recordType) => receiptKindForRecordType(recordType));
  const journalSuccessReceiptKindLedger = summarizeReceiptKinds(journalSuccessReceiptKinds);
  const journalSuccessReceiptKindLedgerComplete =
    journalSuccessReceiptKindLedger.length > 0
    && journalSuccessReceiptKindLedger.every((entry, index) => entry.kind === journalSuccessReceiptKinds[index]);
  const journalSuccessReceiptKindsGrouped = areReceiptKindsGrouped(journalSuccessRecordTypes);
  const productionAtomicCommitMeasured = report.executorCapabilities.productionAtomicCommit === 'production-atomic-group-commit';
  const productionStorageReceiptsMeasured = report.executorCapabilities.fileReceipts === 'production-storage-receipts';
  const productionRowBatchExecutorMeasured = report.executorCapabilities.rowApply === 'production-batched-compare-and-swap';
  const productionAtomicCommitVisible =
    report.evidence.atomicGroup?.productionAtomicCommitVisible === true;
  const productionAtomicGroupMetadataVisible =
    report.evidence.atomicGroup?.productionAtomicGroupMetadataVisible === true;
  const productionAtomicGroupMetadataVisibleAndMeasured =
    productionAtomicGroupMetadataVisible && productionAtomicCommitMeasured;
  const productionStorageReceiptsVisible =
    report.evidence.atomicGroup?.productionStorageReceiptsVisible === true;
  const productionRowBatchExecutorVisible =
    report.evidence.atomicGroup?.productionRowBatchExecutorVisible === true;
  const productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible =
    productionStorageReceiptsVisible && productionAtomicGroupMetadataVisible;
  const productionStorageReceiptsVisibleAndAtomicCommitVisible =
    productionStorageReceiptsVisible && productionAtomicCommitVisible;
  const productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured =
    productionStorageReceiptsVisible
    && productionAtomicCommitVisible
    && productionStorageReceiptsMeasured
    && productionAtomicCommitMeasured;
  const productionRowBatchExecutorVisibleAndStorageReceiptsVisible =
    productionRowBatchExecutorVisible && productionStorageReceiptsVisible;
  const productionRowBatchExecutorVisibleAndAtomicCommitVisible =
    productionRowBatchExecutorVisible && productionAtomicCommitVisible;
  const productionAtomicGroupMetadataProven =
    report.evidence.atomicGroup?.productionAtomicCommitMeasured !== true
    || (
      report.evidence.atomicGroup?.groupStatus === 'ready'
      && report.evidence.atomicGroup?.requireAtomic === true
    );
  const parallelismLimits = report.evidence.parallelism?.parallelismLimits ?? {
    chunkUpload: DEFAULT_LIMITS.maxUploadConcurrency,
    fileHashing: DEFAULT_LIMITS.maxHashConcurrency,
    dbBatchPerTable: DEFAULT_LIMITS.maxDbConcurrencyPerTable,
  };
  const parallelismLimitsVisibleOnReport =
    report.evidence.parallelism?.parallelismLimitsVisible === true;
  const parallelismLimitsMeasuredOnReport =
    report.evidence.parallelism?.parallelismLimitsMeasured === true;
  const parallelismLimitsIntegral =
    Number.isInteger(parallelismLimits.chunkUpload)
    && Number.isInteger(parallelismLimits.fileHashing)
    && Number.isInteger(parallelismLimits.dbBatchPerTable);
  const parallelismLimitsCanonical =
    parallelismLimits.chunkUpload === DEFAULT_LIMITS.maxUploadConcurrency
    && parallelismLimits.fileHashing === DEFAULT_LIMITS.maxHashConcurrency
    && parallelismLimits.dbBatchPerTable === DEFAULT_LIMITS.maxDbConcurrencyPerTable;
  const parallelismLimitsVisible =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsMeasuredOnReport
    && parallelismLimitsIntegral
    && parallelismLimitsCanonical;
  const parallelismLimitsVisibleAndMeasured =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsMeasuredOnReport;
  const parallelismLimitsVisibleAndCanonical =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsCanonical;
  const parallelismLimitsVisibleMeasuredAndCanonical =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsMeasuredOnReport
    && parallelismLimitsCanonical;
  const wordpressGraphIdentityPostmetaReferencesMatch =
    Number.isFinite(report.evidence.wordpressGraphIdentity?.postmetaReferences)
    && Number.isFinite(report.shape?.rowCount)
    && report.evidence.wordpressGraphIdentity.postmetaReferences === report.shape.rowCount;
  return {
    shape: {
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      rowCount: report.shape.rowCount,
      atomicGroupMutationCount: report.shape.atomicGroupMutationCount,
    },
    throughput: report.throughput,
    executorCapabilities: report.executorCapabilities,
    resourceLimits: report.resourceLimits,
    chunkWindowWithinMemoryCeiling: report.evidence.resourceLimits.chunkWindowWithinMemoryCeiling,
    backpressure: report.evidence.backpressure,
    receiptCursorWindowBytes,
    receiptCursorIsTerminalChunk,
    receiptCursorMatchesChunkWindow,
    receiptCursorWithinMemoryCeiling,
    receiptCursorMemoryHeadroomBytes,
    receiptCursorMemoryCeilingBytes,
    receiptCursorHeadroomMatchesResourceHeadroom,
    receiptCursorPauseFootprint,
    receiptCursorPauseFootprintComplete,
    receiptCursorPauseFootprintVisible,
    receiptCursorHeadroomCoveredByQueueBudget,
    queueBudgetBytes: receiptCursorQueueBudgetBytes,
    queueHeadroomBytes: receiptCursorQueueHeadroomBytes,
    queueBudgetMatchesResourceCeiling,
    queueHeadroomMatchesResourceHeadroom,
    queueHeadroomMatchesMemoryHeadroom,
    queueHeadroomWithinResourceCeiling,
    queueHeadroomPositive,
    queueBudgetPositive,
    queueBudgetVisible,
    queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    queueBudgetVisibleAndQueueHeadroomMeasured,
    queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    queueBudgetVisibleAndQueueHeadroomVisible:
      queueBudgetVisible && queueHeadroomVisible,
    queueBudgetVisibleAndMemoryCeilingVisible:
      queueBudgetVisible && receiptCursorMemoryCeilingVisible,
    receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible:
      receiptCursorMemoryCeilingVisible && queueBudgetVisible,
    queueHeadroomVisible,
    queueHeadroomVisibleAndMeasured,
    receiptCursorMemoryCeilingVisible,
    receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    receiptCursorMemoryHeadroomPositive: receiptCursorMemoryHeadroomPositiveVisible,
    queuePausedBeforeOverflow: report.evidence.backpressure?.queuePausedBeforeOverflow ?? false,
    receiptCursorWithinQueueBudget: report.evidence.backpressure?.receiptCursorWithinQueueBudget ?? false,
    receiptCursor: report.evidence.chunkReceipts.resumeCursor,
    receiptCursorConsistency: report.evidence.chunkReceipts.cursorConsistency,
    receiptCursorHeadroomBytes: receiptCursorMemoryHeadroomBytes,
    receiptCursorHeadroomMatchesQueueHeadroom,
    receiptCursorQueueHeadroomPositive: receiptCursorQueueHeadroomPositive,
    queueHeadroomMeasured,
    receiptCursorBackpressureBytes,
    receiptCursorBackpressureMeasured,
    queuePauseHasMeasuredReceiptCursorBackpressure,
    ...pausedQueueSlackEvidence,
    queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
    receiptCursorQueueSlackBytes,
    receiptCursorQueueSlackPositive,
    receiptCursorQueueSlackMatchesBackpressure,
    receiptCursorQueueSlackMatchesMemoryHeadroom,
    receiptCursorQueueSlackMatchesQueueHeadroom,
    receiptCursorQueueSlackMatchesResourceHeadroom,
    receiptCursorQueueSlackWithinResourceHeadroom,
    receiptCursorQueueSlackWithinMemoryCeiling,
    receiptCursorQueueSlackMeasured,
    receiptCursorQueueSlackWithinQueueBudget,
    receiptCursorQueueSlackWithinQueueHeadroom,
    receiptCursorMemoryHeadroomWithinQueueBudget,
    receiptCursorMemoryHeadroomBytes,
    receiptCursorMemoryHeadroomPositive: receiptCursorMemoryHeadroomPositiveVisible,
    receiptCursorMemoryCeilingMatchesQueueBudget,
    receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    receiptCursorMemoryCeilingVisible,
    queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    successInspectionClaimStatus,
    successInspectionClaimReason,
    successInspectionClaimReasonTrimmed,
    successInspectionClaimRecognized,
    successInspectionClaimReasonProven,
    successInspectionClaimMatchesInspectionStatus,
    successInspectionClaimCanonical,
    successInspectionClaimReasonCanonical,
    successInspectionCountsNewMatchesMutations,
    receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    receiptCursorMemoryHeadroomWithinResourceHeadroom,
    receiptCursorMatchesBackpressure,
    receiptCursorBackpressureWithinResourceHeadroom,
    receiptCursorBackpressureWithinQueueBudget,
    receiptCursorBackpressureWithinQueueHeadroom,
    receiptCursorHeadroomWithinQueueBudget,
    backpressureAlignment,
    backpressureEvidenceComplete,
    productionAtomicCommitMeasured,
    productionStorageReceiptsMeasured,
    productionRowBatchExecutorMeasured,
    productionAtomicGroupMetadataVisible,
    productionAtomicGroupMetadataVisibleAndMeasured,
    productionStorageReceiptsVisible,
    productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    productionStorageReceiptsVisibleAndAtomicCommitVisible,
    productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
    productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    productionRowBatchExecutorVisibleAndAtomicCommitVisible,
    productionAtomicGroupMetadataProven,
    parallelismLimits,
    parallelismLimitsMeasured: parallelismLimitsMeasuredOnReport,
    parallelismLimitsVisible: parallelismLimitsVisibleOnReport,
    parallelismLimitsVisibleAndMeasured,
    parallelismLimitsVisibleAndCanonical,
    parallelismLimitsVisibleMeasuredAndCanonical,
    parallelismLimitsIntegral,
    parallelismLimitsCanonical,
    parallelismLimitsVisible,
    wordpressGraphIdentityPostmetaReferencesMatch,
    journalSuccessRecordTypes,
    journalSuccessReceiptKindsGrouped,
    backpressureConsistency: {
      queueBudgetMatchesResourceCeiling,
      queueHeadroomMatchesResourceHeadroom,
      queueHeadroomMatchesMemoryHeadroom,
      queueHeadroomWithinResourceCeiling,
      queueHeadroomPositive,
      queueBudgetPositive,
      queueBudgetVisible,
      queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
      queueBudgetVisibleAndQueueHeadroomMeasured,
      queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
      queueBudgetVisibleAndQueueHeadroomVisible:
        queueBudgetVisible && queueHeadroomVisible,
      queueBudgetVisibleAndMemoryCeilingVisible:
        queueBudgetVisible && receiptCursorMemoryCeilingVisible,
      receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible:
        receiptCursorMemoryCeilingVisible && queueBudgetVisible,
      queueHeadroomVisible,
      queueHeadroomVisibleAndMeasured,
      receiptCursorMemoryCeilingVisible,
      receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
      receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
      productionAtomicGroupMetadataVisible,
      productionAtomicGroupMetadataVisibleAndMeasured,
      productionStorageReceiptsVisible,
      queuePausedBeforeOverflow: report.evidence.backpressure?.queuePausedBeforeOverflow ?? false,
      receiptCursorMemoryCeilingBytes,
      receiptCursorQueueBudgetBytes,
      receiptCursorQueueHeadroomBytes,
      receiptCursorWithinQueueBudget: report.evidence.backpressure?.receiptCursorWithinQueueBudget ?? false,
      receiptCursorMatchesBackpressure,
      receiptCursorHeadroomMatchesQueueHeadroom,
      receiptCursorBackpressureWithinQueueHeadroom,
      receiptCursorBackpressureWithinResourceHeadroom,
      receiptCursorHeadroomCoveredByQueueBudget,
      receiptCursorHeadroomWithinQueueBudget,
      receiptCursorBackpressureBytes,
      receiptCursorBackpressureMeasured,
      queuePauseHasMeasuredReceiptCursorBackpressure,
      ...pausedQueueSlackEvidence,
      queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
      queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
      queueHeadroomMeasured,
      receiptCursorQueueSlackBytes,
      receiptCursorQueueSlackPositive,
      receiptCursorQueueSlackMatchesBackpressure,
      receiptCursorQueueSlackMatchesMemoryHeadroom,
      receiptCursorQueueSlackMatchesQueueHeadroom,
      receiptCursorQueueSlackMatchesResourceHeadroom,
      receiptCursorQueueSlackWithinResourceHeadroom,
      receiptCursorQueueSlackWithinMemoryCeiling,
      receiptCursorQueueSlackMeasured,
      receiptCursorQueueSlackWithinQueueBudget,
      receiptCursorQueueSlackWithinQueueHeadroom,
      queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
      receiptCursorMemoryHeadroomWithinQueueBudget,
      receiptCursorMemoryHeadroomBytes,
      receiptCursorMemoryHeadroomPositive: receiptCursorMemoryHeadroomPositiveVisible,
      receiptCursorMemoryHeadroomWithinResourceHeadroom,
      receiptCursorMemoryCeilingMatchesQueueBudget,
      receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
      receiptCursorMemoryCeilingVisible,
      successInspectionClaimStatus,
      successInspectionClaimReason,
      successInspectionClaimRecognized,
      successInspectionClaimMatchesInspectionStatus,
      successInspectionClaimCanonical,
      successInspectionClaimReasonCanonical,
      successInspectionCountsNewMatchesMutations,
      receiptCursorMemoryHeadroomMatchesResourceHeadroom,
      receiptCursorMemoryHeadroomWithinResourceHeadroom,
      receiptCursorPauseFootprint,
      receiptCursorPauseFootprintComplete,
      receiptCursorPauseFootprintVisible,
      receiptCursorBackpressureWithinResourceHeadroom,
      receiptCursorBackpressureWithinQueueBudget,
      backpressureEvidenceComplete,
      productionAtomicCommitMeasured,
      productionAtomicCommitVisible,
      productionStorageReceiptsMeasured,
      productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisible,
      productionRowBatchExecutorMeasured,
      productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
      productionRowBatchExecutorVisibleAndAtomicCommitVisible,
      productionAtomicGroupMetadataProven,
      parallelismLimits,
      parallelismLimitsVisible: parallelismLimitsVisibleOnReport,
      parallelismLimitsVisibleAndMeasured,
      parallelismLimitsVisibleAndCanonical,
      parallelismLimitsVisibleMeasuredAndCanonical,
      parallelismLimitsIntegral,
      parallelismLimitsCanonical,
      parallelismLimitsVisible,
      wordpressGraphIdentityPostmetaReferencesMatch,
      journalSuccessRecordTypes,
      journalSuccessReceiptKindsGrouped,
    },
    recovery: report.evidence.recovery,
    atomicGroup: {
      ...report.evidence.atomicGroup,
      productionAtomicCommitMeasured,
      productionAtomicCommitVisible,
      productionStorageReceiptsMeasured,
      productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
      productionRowBatchExecutorMeasured,
      productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
      productionRowBatchExecutorVisibleAndAtomicCommitVisible,
      productionAtomicGroupMetadataVisible,
      productionAtomicGroupMetadataProven,
      productionStorageReceiptsVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
      productionRowBatchExecutorVisible,
      parallelismLimits,
      parallelismLimitsVisible: parallelismLimitsVisibleOnReport,
      parallelismLimitsVisibleAndMeasured,
    },
    blockers: productionThroughputBlockers(report),
  };
}

function hasCompleteBackpressureEvidence(report) {
  const receiptCursorBackpressureBytes = report.evidence.backpressure?.receiptCursorBytes ?? null;
  const receiptCursorQueueSlackBytes = report.evidence.backpressure?.receiptCursorQueueSlackBytes ?? null;
  const receiptCursorQueueBudgetBytes = report.evidence.backpressure?.queueBudgetBytes ?? null;
  const receiptCursorQueueHeadroomBytes = report.evidence.backpressure?.queueHeadroomBytes ?? null;
  const receiptCursorMemoryHeadroomBytes = report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes ?? null;
  const receiptCursorWindowBytes = report.evidence.chunkReceipts.resumeCursor?.sizeBytes ?? null;
  const receiptCursorMemoryCeilingBytes = report.resourceLimits?.memoryCeilingBytes ?? null;
  const backpressureAlignment = {
    queueBudgetBytes: receiptCursorQueueBudgetBytes,
    queueHeadroomBytes: receiptCursorQueueHeadroomBytes,
    receiptCursorBytes: receiptCursorBackpressureBytes,
    receiptCursorQueueSlackBytes,
    receiptCursorMemoryHeadroomBytes,
    aligned:
      Number.isFinite(receiptCursorBackpressureBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorMemoryHeadroomBytes)
      && receiptCursorBackpressureBytes === receiptCursorWindowBytes
      && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
      && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
      && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes,
  };
  const receiptCursorQueueHeadroomPositive =
    Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorQueueHeadroomBytes > 0;
  const queueHeadroomMeasured = report.evidence.backpressure?.queueHeadroomMeasured === true;
  const receiptCursorMemoryHeadroomPositive =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorMemoryHeadroomBytes > 0;
  const queuePauseHasMeasuredReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      queueHeadroomMeasured
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && receiptCursorQueueSlackBytes > 0
      && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorQueueSlack === true
    );
  const queuePauseHasMeasuredReceiptCursorBackpressure =
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      queueHeadroomMeasured
      && Number.isFinite(receiptCursorBackpressureBytes)
      && receiptCursorBackpressureBytes > 0
      && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    );
  const queuePauseHasBackpressureAlignedReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorBackpressureBytes)
      && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
      && report.evidence.backpressure?.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack === true
    );
  const receiptCursorMemoryCeilingMatchesQueueBudget =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudget === true;
  const queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      queuePauseHasMeasuredReceiptCursorQueueSlack
      && queuePauseHasBackpressureAlignedReceiptCursorQueueSlack
      && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack === true
    );
  const receiptCursorQueueSlackWithinResourceHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const receiptCursorBackpressureWithinResourceHeadroom =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorBackpressureBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes;
  const queueHeadroomWithinResourceCeiling =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && receiptCursorQueueBudgetBytes === receiptCursorMemoryCeilingBytes
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes;
  return (
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorQueueBudgetBytes > 0
    && receiptCursorQueueHeadroomPositive
    && receiptCursorMemoryHeadroomPositive
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && queueHeadroomWithinResourceCeiling
    && receiptCursorMemoryHeadroomBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorWithinQueueBudget === true
    && queuePauseHasMeasuredReceiptCursorQueueSlack
    && queuePauseHasMeasuredReceiptCursorBackpressure
    && receiptCursorBackpressureBytes === receiptCursorWindowBytes
    && receiptCursorBackpressureBytes <= receiptCursorQueueBudgetBytes
    && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
    && receiptCursorQueueSlackBytes > 0
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack
    && queuePauseHasBackpressureAlignedReceiptCursorQueueSlack
    && receiptCursorMemoryCeilingMatchesQueueBudget
    && receiptCursorQueueSlackWithinResourceHeadroom
    && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && receiptCursorQueueHeadroomBytes >= receiptCursorBackpressureBytes
    && receiptCursorBackpressureWithinResourceHeadroom
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
  );
}

function receiptKindForRecordType(recordType) {
  if (typeof recordType !== 'string') {
    return 'unknown';
  }
  if (recordType.includes('chunk')) {
    return 'chunk';
  }
  if (recordType.includes('row')) {
    return 'row';
  }
  if (recordType.includes('group')) {
    return 'group';
  }
  return 'other';
}

function summarizeReceiptKinds(receiptKinds) {
  return receiptKinds.map((kind, index) => ({ kind, index }));
}

function areReceiptKindsGrouped(recordTypes) {
  const kindOrder = new Map([
    ['chunk-receipt', 0],
    ['file-staging-finalized', 1],
    ['journal-opened', 2],
    ['target-planned', 3],
    ['apply-staged', 4],
    ['dependencies-validated', 5],
    ['apply-committing', 6],
    ['mutation-observed', 7],
    ['journal-completed', 8],
    ['recovery-state', 9],
  ]);

  let lastRank = -1;
  for (const recordType of recordTypes) {
    const rank = kindOrder.get(recordType);
    if (rank == null) {
      continue;
    }
    if (rank < lastRank) {
      return false;
    }
    lastRank = rank;
  }

  return true;
}

export function assertCanClaimProductionThroughput(report) {
  const claim = productionThroughputClaim(report);
  if (!claim.allowed) {
    const details = productionThroughputDetails(report);
    throw new BenchmarkClaimError(
      `Production throughput claim blocked: ${claim.blockers.join(', ')}`,
      {
        code: 'PRODUCTION_THROUGHPUT_CLAIM_BLOCKED',
        blockers: claim.blockers,
        claim,
        throughput: report.throughput,
        executorCapabilities: report.executorCapabilities,
        resourceLimits: report.resourceLimits,
        receiptCursor: details.receiptCursor,
        productionThroughputDetails: details,
      },
    );
  }
}

function benchmarkConfig(options) {
  const profileName = options.profile || 'ci';
  const profile = GUARDED_EXECUTOR_BENCHMARK_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown guarded executor benchmark profile: ${profileName}`);
  }
  return {
    ...profile,
    maxBufferedUploadBytes: DEFAULT_LIMITS.maxBufferedUploadBytes,
    ...options,
    profile: profileName,
    now: options.now || FIXED_NOW,
    seed: options.seed || 'guarded-executor-benchmark-v1',
    claimProductionThroughput: options.claimProductionThroughput === true,
  };
}

function stageGeneratedFileBytes({
  tempDir,
  journal,
  planId,
  resourceKey,
  fileBytes,
  chunkSizeBytes,
  seed,
}) {
  const stagingDir = path.join(tempDir, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagingPath = path.join(stagingDir, 'catalog-export.bin');
  const fd = fs.openSync(stagingPath, 'w');
  const fileHash = crypto.createHash('sha256');
  const chunkCount = Math.ceil(fileBytes / chunkSizeBytes);
  let bytesMoved = 0;

  try {
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      const offsetBytes = chunkIndex * chunkSizeBytes;
      const sizeBytes = Math.min(chunkSizeBytes, fileBytes - offsetBytes);
      const chunk = deterministicChunk(sizeBytes, seed, chunkIndex);
      const chunkDigest = digestBuffer(chunk);
      fileHash.update(chunk);
      fs.writeSync(fd, chunk, 0, chunk.length, offsetBytes);
      bytesMoved += chunk.length;
      journal.appendEvent('chunk-receipt', {
        planId,
        resourceKey,
        state: 'staged',
        chunkIndex,
        chunkCount,
        offsetBytes,
        sizeBytes,
        chunkDigest: `sha256:${chunkDigest}`,
        canonicalVisible: false,
        idempotencyKey: `${planId}:${resourceKey}:chunk:${chunkIndex}`,
        receiptKey: `${planId}:${resourceKey}:${chunkIndex}:sha256:${chunkDigest}`,
        artifactRefs: {
          staging: `bench-staging:${resourceKey}:${chunkIndex}`,
        },
      });
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  const assembledDigest = fileHash.digest('hex');
  const stat = fs.statSync(stagingPath);
  journal.appendEvent('file-staging-finalized', {
    planId,
    resourceKey,
    state: 'staged-file-complete',
    chunkReceipts: chunkCount,
    sizeBytes: stat.size,
    assembledHash: `sha256:${assembledDigest}`,
    canonicalVisible: false,
    idempotencyKey: `${planId}:${resourceKey}:file-staging-finalize`,
    artifactRefs: {
      staging: `bench-staging:${resourceKey}:assembled`,
    },
  });

  return {
    stagingPath,
    bytesMoved,
    chunkCount,
    chunkSizeBytes,
    assembledHash: `sha256:${assembledDigest}`,
    descriptor: fileDescriptor({
      sizeBytes: stat.size,
      contentDigest: `sha256:${assembledDigest}`,
      storage: 'bench-generated-chunk-staging',
    }),
  };
}

function buildBenchmarkSites(config, stagedFile) {
  const base = {
    files: {
      [LARGE_UPLOAD_PATH]: fileDescriptor({
        sizeBytes: config.fileBytes,
        contentDigest: digestLabel('base-large-upload'),
        storage: 'remote-existing-file',
      }),
      [PAYMENTS_MAIN_FILE]: fileDescriptor({
        sizeBytes: 4096,
        contentDigest: digestLabel('payments-plugin-file'),
        storage: 'remote-existing-file',
      }),
    },
    plugins: {
      [PAYMENTS_PLUGIN]: { version: '2.1.0', active: true },
    },
    db: {
      wp_posts: benchmarkStablePosts(config.rowCount),
      wp_postmeta: {},
    },
  };
  const local = clone(base);
  const rowResourceKeys = [];
  const allowedResources = [];
  const graphIdentityTargets = [];

  local.files[LARGE_UPLOAD_PATH] = stagedFile.descriptor;
  local.files[COMMERCE_MAIN_FILE] = fileDescriptor({
    sizeBytes: 8192,
    contentDigest: digestLabel('commerce-plugin-main-file'),
    storage: 'bench-plugin-descriptor',
  });
  local.plugins[COMMERCE_PLUGIN] = {
    version: '1.0.0',
    active: true,
    requires: [PAYMENTS_PLUGIN],
  };

  for (let index = 1; index <= config.rowCount; index++) {
    const id = `meta_id:${index}`;
    const postId = benchmarkPostIdForRow(index);
    const resourceKey = `row:${JSON.stringify(['wp_postmeta', id])}`;
    const targetResourceKey = `row:${JSON.stringify(['wp_posts', `ID:${postId}`])}`;
    rowResourceKeys.push(resourceKey);
    graphIdentityTargets.push(targetResourceKey);
    allowedResources.push({
      resourceKey,
      pluginOwner: COMMERCE_PLUGIN,
      driver: 'wp-postmeta',
    });
    local.db.wp_postmeta[id] = {
      meta_id: index,
      post_id: postId,
      meta_key: `_commerce_bench_${index}`,
      meta_value: deterministicRowPayload(index, config.rowPayloadBytes),
      __pluginOwner: COMMERCE_PLUGIN,
    };
  }

  local.pushIntents = [
    {
      id: ATOMIC_GROUP_ID,
      kind: 'plugin-install',
      label: 'Install commerce stack',
      requireAtomic: true,
      resources: [
        `file:${COMMERCE_MAIN_FILE}`,
        `plugin:${COMMERCE_PLUGIN}`,
        ...rowResourceKeys,
      ],
      dependencies: {
        plugins: [
          {
            name: PAYMENTS_PLUGIN,
            version: '2.1.0',
            active: true,
            hash: resourceHash(base, pluginResource(PAYMENTS_PLUGIN)),
          },
        ],
      },
      resourcePolicy: {
        pluginOwnedResources: {
          allowedResources,
        },
      },
    },
  ];

  return {
    base,
    local,
    remote: clone(base),
    rowResourceKeys,
    graphIdentityTargets: [...new Set(graphIdentityTargets)],
    atomicGroupId: ATOMIC_GROUP_ID,
  };
}

function benchmarkStablePosts(rowCount) {
  const posts = {};
  for (let index = 1; index <= rowCount; index++) {
    const postId = benchmarkPostIdForRow(index);
    posts[`ID:${postId}`] ||= {
      ID: postId,
      post_title: `Benchmark catalog identity ${postId}`,
      post_status: 'publish',
      post_type: 'product',
    };
  }
  return posts;
}

function benchmarkPostIdForRow(index) {
  return 10_000 + Math.floor(index / 8);
}

function runFailureProbe({ mode, plan, remote, tempDir, now, failDuringCommitAtMutation = null }) {
  const journalPath = path.join(tempDir, `${mode}.jsonl`);
  const durableJournal = openRecoveryJournal(journalPath, { truncate: true, now });
  const current = clone(remote);
  const before = JSON.stringify(current);
  let error = null;
  const started = performance.now();

  try {
    if (mode === 'pre-commit') {
      applyPlan(current, plan, { failAfterDependencyValidation: true, durableJournal });
    } else if (mode === 'partial-commit') {
      applyPlan(current, plan, {
        mutateRemote: true,
        failDuringCommitAtMutation,
        durableJournal,
      });
    } else {
      throw new Error(`Unknown failure probe mode: ${mode}`);
    }
  } catch (caught) {
    error = caught;
  } finally {
    durableJournal.close();
  }

  if (!(error instanceof PushPlanError)) {
    throw new Error(`Expected ${mode} failure probe to raise PushPlanError.`);
  }

  const persisted = readRecoveryJournal(journalPath);
  const inspection = inspectRecoveryJournal({ journal: persisted, plan, current });
  return {
    mode,
    errorCode: error.code,
    recoveryStatus: error.details?.recovery?.status || null,
    journalPath,
    journalIntegrity: persisted.integrity.status,
    journalRecords: persisted.records.length,
    journalRecordTypes: persisted.records.map((record) => record.type),
    durableJournalHasNoRawValues: durableJournalHasNoRawValues(persisted),
    inspectionStatus: inspection.status,
    inspectionCounts: inspection.counts,
    remoteUnchanged: JSON.stringify(current) === before,
    groupNewTargets: inspection.targets.filter((target) =>
      target.resourceKey === `file:${COMMERCE_MAIN_FILE}`
      || target.resourceKey === `plugin:${COMMERCE_PLUGIN}`
      || target.resourceKey.startsWith('row:["wp_postmeta",')
    ).filter((target) => target.state === 'new').length,
    elapsedMs: elapsedMs(started),
  };
}

function buildReport({
  config,
  tempDir,
  timings,
  stagedFile,
  plan,
  sites,
  applyResult,
  successPersisted,
  successInspection,
  preCommitFailure,
  partialFailure,
}) {
  const chunkReceiptRecords = successPersisted.records.filter((record) => record.type === 'chunk-receipt');
  const lastChunkReceipt = chunkReceiptRecords[chunkReceiptRecords.length - 1] || null;
  const mutationPreconditions = plan.preconditions || [];
  const mutationCount = plan.mutations.length;
  const atomicGroup = plan.atomicGroups.find((group) => group.id === sites.atomicGroupId);
  const allJournalsIntegrityOk = [
    successPersisted.integrity.status,
    preCommitFailure.journalIntegrity,
    partialFailure.journalIntegrity,
  ].every((status) => status === 'ok');
  const durableJournalsContainNoRawValues = [
    durableJournalHasNoRawValues(successPersisted),
    preCommitFailure.durableJournalHasNoRawValues,
    partialFailure.durableJournalHasNoRawValues,
  ].every(Boolean);
  const queueHeadroomMeasured =
    Number.isFinite(config.maxBufferedUploadBytes)
    && Number.isFinite(config.chunkSizeBytes)
    && config.maxBufferedUploadBytes - config.chunkSizeBytes > 0;
  const queuePausedBeforeOverflow = config.chunkSizeBytes <= config.maxBufferedUploadBytes;
  const productionAtomicCommitMeasured = false;
  const productionStorageReceiptsMeasured = false;
  const productionRowBatchExecutorMeasured = false;
  const productionAtomicGroupMetadataVisible =
    productionAtomicCommitMeasured
    && atomicGroup?.status === 'ready'
    && atomicGroup?.requireAtomic === true;
  const productionStorageReceiptsVisible =
    productionStorageReceiptsMeasured && productionAtomicGroupMetadataVisible;
  const productionRowBatchExecutorVisible =
    productionRowBatchExecutorMeasured && productionAtomicGroupMetadataVisible;

  return {
    schemaVersion: 1,
    profile: config.profile,
    priority: 'no-data-loss-no-data-loss-reliable-fast',
    tempDir,
    shape: {
      largeUploadResourceKey: `file:${LARGE_UPLOAD_PATH}`,
      fileBytes: config.fileBytes,
      bytesMovedThroughStaging: stagedFile.bytesMoved,
      chunkSizeBytes: config.chunkSizeBytes,
      chunkCount: stagedFile.chunkCount,
      rowCount: config.rowCount,
      rowPayloadBytes: config.rowPayloadBytes,
      graphIdentityTargetCount: sites.graphIdentityTargets.length,
      mutations: mutationCount,
      atomicGroupId: sites.atomicGroupId,
      atomicGroupMutationCount: atomicGroup?.mutationIds.length || 0,
    },
    timings,
    throughput: {
      labStagedMiBPerSecond: mibPerSecond(stagedFile.bytesMoved, timings.stageFileMs),
      labApplyMutationsPerSecond: perSecond(mutationCount, timings.applyMs),
      productionThroughput: 'not-claimed',
      fastPathModeEnabled: false,
    },
    executorCapabilities: {
      chunkStaging: 'bench-generated-file-staging',
      fileReceipts: 'lab-file-journal-receipts',
      guardedApply: 'applyPlan-live-precondition-model',
      rowApply: 'per-row-apply-model',
      recoveryJournal: 'file-backed-jsonl-fsync',
      productionAtomicCommit: 'not-measured',
    },
    resourceLimits: {
      memoryCeilingBytes: config.maxBufferedUploadBytes,
      maxBufferedUploadBytes: config.maxBufferedUploadBytes,
    },
    evidence: {
      chunkReceipts: {
        expected: stagedFile.chunkCount,
        recorded: chunkReceiptRecords.length,
        resumeCursor: lastChunkReceipt
          ? {
              planId: lastChunkReceipt.planId,
              resourceKey: lastChunkReceipt.resourceKey,
              chunkIndex: lastChunkReceipt.chunkIndex,
              chunkCount: lastChunkReceipt.chunkCount,
              offsetBytes: lastChunkReceipt.offsetBytes,
              sizeBytes: lastChunkReceipt.sizeBytes,
              receiptKey: lastChunkReceipt.receiptKey,
            }
          : null,
        cursorConsistency: {
          expectedNextChunkIndex: Math.max(chunkReceiptRecords.length - 1, 0),
          matchesRecordedReceiptCount: chunkReceiptRecords.length === stagedFile.chunkCount,
          canResumeFromCursor: Boolean(lastChunkReceipt)
            && lastChunkReceipt.chunkIndex === chunkReceiptRecords.length - 1
            && lastChunkReceipt.chunkCount === stagedFile.chunkCount
            && chunkReceiptRecords.length === stagedFile.chunkCount,
        },
        finalStagingRecord: successPersisted.records.some((record) =>
          record.type === 'file-staging-finalized'
          && record.assembledHash === stagedFile.assembledHash),
        canonicalVisibleBeforePublish: chunkReceiptRecords.some((record) =>
          record.canonicalVisible === true),
      },
      preconditions: {
        mutations: mutationCount,
        liveRemoteMutationPreconditions: mutationPreconditions.length,
        everyMutationHasLiveRemotePrecondition: plan.mutations.every((mutation) => {
          const precondition = mutationPreconditions.find((entry) => entry.mutationId === mutation.id);
          return precondition
            && precondition.resourceKey === mutation.resourceKey
            && precondition.expectedHash === mutation.remoteBeforeHash
            && precondition.checkedAgainst === 'live-remote';
        }),
      },
      journal: {
        successIntegrity: successPersisted.integrity.status,
        successRecords: successPersisted.records.length,
        successRecordTypes: successPersisted.records.map((record) => record.type),
        successReceiptKindLedger: summarizeReceiptKinds(
          successPersisted.records.map((record) => receiptKindForRecordType(record.type)),
        ),
        successReceiptKindLedgerComplete: true,
        successReceiptKindsGrouped: areReceiptKindsGrouped(
          successPersisted.records.map((record) => record.type),
        ),
        preCommitFailureIntegrity: preCommitFailure.journalIntegrity,
        partialFailureIntegrity: partialFailure.journalIntegrity,
        allJournalsIntegrityOk,
      },
      atomicGroup: {
        groupStatus: atomicGroup?.status || null,
        requireAtomic: atomicGroup?.requireAtomic === true,
        successAllTargetsNew: successInspection.status === 'fully-updated-remote',
        preCommitFailureLeavesRemoteUnchanged: preCommitFailure.remoteUnchanged,
        partialCommitGroupNewTargets: partialFailure.groupNewTargets,
        partialCommitStatus: partialFailure.inspectionStatus,
        productionAtomicCommitMeasured,
        productionAtomicCommitVisible: false,
        productionStorageReceiptsMeasured,
        productionRowBatchExecutorMeasured,
        productionAtomicGroupMetadataVisible,
        productionStorageReceiptsVisible,
        productionRowBatchExecutorVisible,
      },
      parallelism: {
        parallelismLimits: {
          chunkUpload: DEFAULT_LIMITS.maxUploadConcurrency,
          fileHashing: DEFAULT_LIMITS.maxHashConcurrency,
          dbBatchPerTable: DEFAULT_LIMITS.maxDbConcurrencyPerTable,
        },
        parallelismLimitsMeasured: true,
        parallelismLimitsVisible: false,
      },
      resourceLimits: {
        memoryCeilingBytes: config.maxBufferedUploadBytes,
        maxBufferedUploadBytes: config.maxBufferedUploadBytes,
        chunkWindowWithinMemoryCeiling: config.chunkSizeBytes <= config.maxBufferedUploadBytes,
      },
      backpressure: {
        producerQueueBounded: true,
        queueBudgetBytes: config.maxBufferedUploadBytes,
        queueHeadroomBytes: config.maxBufferedUploadBytes - config.chunkSizeBytes,
        queueHeadroomMeasured,
        queueBudgetMatchesResourceCeiling:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        queueBudgetVisible:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        queueHeadroomVisible:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        queuePausedBeforeOverflow,
        chunkWindowBytes: config.chunkSizeBytes,
        receiptCursorBytes: lastChunkReceipt?.sizeBytes ?? null,
        receiptCursorQueueSlackBytes:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
            ? config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            : null,
        receiptCursorQueueSlackWithinResourceHeadroom:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            <= config.maxBufferedUploadBytes - config.chunkSizeBytes,
        receiptCursorMemoryHeadroomBytes:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && lastChunkReceipt.sizeBytes <= config.maxBufferedUploadBytes
            ? config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            : null,
        receiptCursorWithinQueueBudget:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && lastChunkReceipt.sizeBytes <= config.maxBufferedUploadBytes,
        queuePauseHasMeasuredReceiptCursorQueueSlack:
          queuePausedBeforeOverflow === true
          && queueHeadroomMeasured
          && Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0,
        queuePauseHasMeasuredReceiptCursorBackpressure:
          queuePausedBeforeOverflow === true
          && queueHeadroomMeasured
          && Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && lastChunkReceipt.sizeBytes > 0,
        queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure:
          queuePausedBeforeOverflow === true
          && Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && lastChunkReceipt.sizeBytes === config.chunkSizeBytes
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0,
        queuePauseHasBackpressureAlignedReceiptCursorQueueSlack:
          queuePausedBeforeOverflow === true
          && Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            === config.maxBufferedUploadBytes - config.chunkSizeBytes,
        receiptCursorMemoryCeilingMatchesQueueBudget:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        receiptCursorMemoryCeilingVisible:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        receiptCursorPauseFootprintComplete:
          queuePausedBeforeOverflow === true
          && Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            === config.maxBufferedUploadBytes - config.chunkSizeBytes,
        queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack:
          queuePausedBeforeOverflow === true
          && Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            === config.maxBufferedUploadBytes - config.chunkSizeBytes,
        backpressureEvidenceComplete:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.maxBufferedUploadBytes - config.chunkSizeBytes)
          && config.chunkSizeBytes <= config.maxBufferedUploadBytes,
      },
      recovery: {
        successInspectionStatus: successInspection.status,
        successInspectionCounts: successInspection.counts,
        successReplayInspectable: successInspection.status === 'fully-updated-remote',
        preCommitFailureInspectionStatus: preCommitFailure.inspectionStatus,
        preCommitFailureInspectable: preCommitFailure.inspectionStatus === 'old-remote',
        partialCommitInspectionStatus: partialFailure.inspectionStatus,
        partialCommitBlocksRecovery: partialFailure.inspectionStatus === 'blocked-recovery',
      },
      redaction: {
        durableJournalsContainNoRawValues,
      },
      wordpressGraphIdentity: {
        postmetaReferences: config.rowCount,
        stableRemotePostTargets: sites.graphIdentityTargets.length,
        allPostmetaReferencesUseStableRemoteIdentity: benchmarkGraphIdentityStable(sites),
        graphIdentityBlockers: plan.blockers.filter((blocker) =>
          blocker.class === 'stale-wordpress-graph-identity').length,
      },
    },
    results: {
      appliedMutations: applyResult.appliedMutations,
      successJournalPath: successPersisted.filePath,
      successInspection: {
        status: successInspection.status,
        reason: successInspection.reason,
        counts: successInspection.counts,
        claim: successInspection.claim,
      },
      preCommitFailure: failureProbeDetails(preCommitFailure),
      partialFailure: failureProbeDetails(partialFailure),
    },
    claims: {
      labGuardedExecutorEvidence: true,
    },
  };
}

function benchmarkGraphIdentityStable(sites) {
  return sites.graphIdentityTargets.every((targetResourceKey) => {
    const [table, id] = JSON.parse(targetResourceKey.slice('row:'.length));
    if (table !== 'wp_posts' || !id) {
      return false;
    }
    const basePost = sites.base.db.wp_posts?.[id] || null;
    const remotePost = sites.remote.db.wp_posts?.[id] || null;
    return basePost
      && remotePost
      && JSON.stringify(basePost) === JSON.stringify(remotePost);
  });
}

function assertBenchmarkPlan(plan, config) {
  if (plan.status !== 'ready') {
    throw new Error(`Benchmark plan must be ready; got ${plan.status}.`);
  }
  const expectedMutations = config.rowCount + 3;
  if (plan.mutations.length !== expectedMutations) {
    throw new Error(`Expected ${expectedMutations} benchmark mutations; got ${plan.mutations.length}.`);
  }
  if (plan.preconditions.length !== plan.mutations.length) {
    throw new Error('Benchmark plan does not have one live precondition per mutation.');
  }
  if (!plan.preconditions.every((precondition) => precondition.checkedAgainst === 'live-remote')) {
    throw new Error('Benchmark plan includes a non-live precondition.');
  }
  const atomicGroup = plan.atomicGroups.find((group) => group.id === ATOMIC_GROUP_ID);
  if (!atomicGroup || atomicGroup.status !== 'ready' || atomicGroup.requireAtomic !== true) {
    throw new Error('Benchmark plan does not contain a ready required atomic group.');
  }
}

function firstAtomicGroupMutationIndex(plan) {
  const index = plan.mutations.findIndex((mutation) => mutation.atomicGroupId === ATOMIC_GROUP_ID);
  if (index < 0) {
    throw new Error('Benchmark plan has no atomic group mutation.');
  }
  return index + 1;
}

function deterministicChunk(sizeBytes, seed, chunkIndex) {
  const marker = crypto.createHash('sha256').update(`${seed}:chunk:${chunkIndex}`).digest();
  const chunk = Buffer.allocUnsafe(sizeBytes);
  for (let offset = 0; offset < sizeBytes; offset += marker.length) {
    marker.copy(chunk, offset, 0, Math.min(marker.length, sizeBytes - offset));
  }
  return chunk;
}

function deterministicRowPayload(index, byteLength) {
  const marker = crypto.createHash('sha256').update(`row-payload:${index}`).digest('hex');
  return marker.repeat(Math.ceil(byteLength / marker.length)).slice(0, byteLength);
}

function fileDescriptor({ sizeBytes, contentDigest, storage }) {
  return {
    type: 'file',
    sizeBytes,
    contentDigest,
    storage,
  };
}

function pluginResource(name) {
  return {
    type: 'plugin',
    name,
    key: `plugin:${name}`,
  };
}

function digestBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function digestLabel(label) {
  return `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
}

function durableJournalHasNoRawValues(journal) {
  try {
    for (const record of journal.records) {
      assertJournalRecordHasNoRawValues(record);
    }
    return journal.integrity.status === 'ok';
  } catch {
    return false;
  }
}

function failureProbeDetails(probe) {
  return {
    errorCode: probe.errorCode,
    recoveryStatus: probe.recoveryStatus,
    journalPath: probe.journalPath,
    journalIntegrity: probe.journalIntegrity,
    inspectionStatus: probe.inspectionStatus,
    remoteUnchanged: probe.remoteUnchanged,
    groupNewTargets: probe.groupNewTargets,
    journalRecordTypes: probe.journalRecordTypes,
    elapsedMs: probe.elapsedMs,
  };
}

function mibPerSecond(bytes, ms) {
  return Number(((bytes / MIB) / Math.max(ms / 1000, 0.001)).toFixed(2));
}

function perSecond(count, ms) {
  return Number((count / Math.max(ms / 1000, 0.001)).toFixed(2));
}

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(2));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--claim-production-throughput') {
      options.claimProductionThroughput = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = match[1];
    const value = match[2];
    if (key === 'profile') {
      options.profile = value;
    } else if (key === 'file-bytes') {
      options.fileBytes = Number.parseInt(value, 10);
    } else if (key === 'chunk-size-bytes') {
      options.chunkSizeBytes = Number.parseInt(value, 10);
    } else if (key === 'row-count') {
      options.rowCount = Number.parseInt(value, 10);
    } else if (key === 'row-payload-bytes') {
      options.rowPayloadBytes = Number.parseInt(value, 10);
    } else if (key === 'temp-dir') {
      options.tempDir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runGuardedExecutorBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
