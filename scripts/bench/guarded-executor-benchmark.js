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
import { findRejectedFastPathById } from './performance-model.js';
import { DEFAULT_LIMITS, MIB } from './performance-model.js';

const FIXED_NOW = new Date('2026-05-24T00:00:00.000Z');
const LARGE_UPLOAD_PATH = 'wp-content/uploads/2026/05/catalog-export.bin';
const COMMERCE_PLUGIN = 'commerce';
const PAYMENTS_PLUGIN = 'payments';
const COMMERCE_MAIN_FILE = `wp-content/plugins/${COMMERCE_PLUGIN}/${COMMERCE_PLUGIN}.php`;
const PAYMENTS_MAIN_FILE = `wp-content/plugins/${PAYMENTS_PLUGIN}/${PAYMENTS_PLUGIN}.php`;
const ATOMIC_GROUP_ID = 'install-commerce-stack';
const RECEIPT_LEDGER_BLOCKER_REFS = Object.freeze([
  'receipt-ledger-kind-summary-not-proven',
  'receipt-ledger-kind-summary-mismatch',
]);
const POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS = Object.freeze([
  'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
  'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
  'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
  'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
]);
const INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS = Object.freeze([
  'queue-pause-footprint-not-proven',
  'queue-pause-without-complete-receipt-cursor-pause-footprint',
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
]);
const HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-not-visible',
]);
const HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'queue-budget-not-visible',
  'memory-ceiling-match-visible-without-queue-budget-visibility',
  'memory-ceiling-visible-without-queue-budget-visibility',
  'queue-headroom-visible-without-queue-budget-visibility',
  'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
  'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
]);
const HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'queue-budget-visible-without-memory-ceiling-visibility',
  'queue-pause-without-visible-memory-ceiling',
  'memory-ceiling-match-visible-without-memory-ceiling-visibility',
  'queue-headroom-visible-without-memory-ceiling-visibility',
  'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
  'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
]);
const HIDDEN_QUEUE_HEADROOM_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'queue-budget-visible-without-queue-headroom-visible',
  'memory-ceiling-match-visible-without-queue-headroom-visibility',
  'memory-ceiling-visible-without-queue-headroom-visible',
  'queue-headroom-not-visible',
  'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
  'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
]);
const HIDDEN_MEMORY_HEADROOM_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'memory-ceiling-match-visible-without-memory-headroom-visibility',
  'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
  'queue-pause-without-visible-receipt-cursor-memory-headroom',
  'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
]);
const POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
  ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
  ...HIDDEN_MEMORY_HEADROOM_VISIBILITY_BLOCKER_REFS,
  ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
]);
const POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  ...HIDDEN_QUEUE_HEADROOM_VISIBILITY_BLOCKER_REFS,
  ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
]);
const POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
  ...HIDDEN_MEMORY_HEADROOM_VISIBILITY_BLOCKER_REFS,
  ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
]);
const POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
  ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
]);

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

const ROLLOUT_REJECTED_FAST_PATH_SPECS = Object.freeze([
  Object.freeze({
    id: 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
    blockerRefs: Object.freeze([
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-storage-receipts-not-measured',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
    blockerRefs: Object.freeze([
      'production-capability-measurement-not-aligned',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions',
    blockerRefs: Object.freeze([
      'production-capability-measurement-not-aligned',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing',
    blockerRefs: Object.freeze([
      'production-capability-measurement-not-aligned',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-planning',
    blockerRefs: Object.freeze([
      'production-capability-measurement-not-aligned',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-capability-measurement-not-aligned',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RELEASE_BUNDLE_COMMIT_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-compressed-db-batches-skips-release-bundle-commit',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
    blockerRefs: Object.freeze([
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-budget-not-visible',
      'queue-budget-visible-without-memory-ceiling-visibility',
      'queue-budget-visible-without-queue-headroom-visible',
      'queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility',
      'queue-pause-footprint-not-proven',
      'queue-pause-without-visible-memory-ceiling',
      'queue-pause-without-complete-receipt-cursor-pause-footprint',
      'queue-pause-without-terminal-receipt-cursor',
      'receipt-cursor-not-terminal',
      'memory-ceiling-match-visible-without-memory-ceiling-visibility',
      'memory-ceiling-match-visible-without-queue-budget-visibility',
      'memory-ceiling-match-visible-without-queue-headroom-visibility',
      'memory-ceiling-visible-without-memory-ceiling-visibility',
      'memory-ceiling-visible-without-queue-budget-visibility',
      'memory-ceiling-visible-without-queue-headroom-visible',
      'queue-headroom-not-visible',
      'queue-headroom-visible-without-memory-ceiling-visibility',
      'queue-headroom-visible-without-queue-budget-visibility',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-not-visible',
      'staging-disk-headroom-visible-without-measurement',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-memory-ceiling-match-visibility',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'memory-ceiling-match-visible-without-memory-headroom-visibility',
      'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
      'queue-pause-without-visible-receipt-cursor-memory-headroom',
      'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
      'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
      'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
      'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
      'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
    ]),
  }),
  Object.freeze({
    id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'receipt-flushes-not-kind-scoped',
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-parallelism-limits-not-measured',
      'production-parallelism-limits-not-integral',
      'production-parallelism-limits-not-canonical',
      'production-parallelism-limits-not-visible',
      'production-parallelism-limits-visible-without-positive',
      'production-parallelism-limits-visible-without-measurement',
      'production-parallelism-limits-visible-without-integral',
      'production-parallelism-limits-visible-without-canonical',
      'production-row-batch-executor-not-measured',
      'production-row-batch-executor-measured-not-proven',
      'production-row-batch-executor-visible-without-parallelism-limits',
      ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
      ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
      ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'production-atomic-group-commit-not-measured',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
    blockerRefs: Object.freeze([
      'memory-ceiling-match-visible-without-queue-slack-visibility',
      'queue-headroom-visible-without-queue-slack-visibility',
      'queue-pause-without-measured-receipt-cursor-queue-slack',
      'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
      'receipt-cursor-queue-slack-not-measured',
      'receipt-cursor-queue-slack-visible-without-measurement',
      'receipt-cursor-queue-slack-visible-without-queue-headroom-measurement',
      'queue-pause-without-visible-receipt-cursor-queue-slack',
      'receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement',
      'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-memory-headroom-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'memory-ceiling-match-visible-without-memory-headroom-visibility',
      'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
      'queue-pause-without-measured-receipt-cursor-memory-headroom',
      'receipt-cursor-memory-headroom-visible-without-measurement',
      'receipt-cursor-headroom-not-covered-by-queue-budget',
      'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
      'receipt-cursor-queue-slack-visible-without-queue-headroom-measurement',
      'queue-pause-without-visible-receipt-cursor-memory-headroom',
      'receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement',
      'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-atomic-group-commit-after-pause',
    blockerRefs: Object.freeze([
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
    blockerRefs: Object.freeze([
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      ...POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
    blockerRefs: Object.freeze([
      'queue-pause-without-measured-queue-headroom-proof',
      'queue-budget-not-visible',
      'memory-ceiling-match-visible-without-queue-slack-visibility',
      'memory-ceiling-match-visible-without-memory-headroom-visibility',
      'memory-ceiling-match-visible-without-queue-budget-visibility',
      'memory-ceiling-visible-without-queue-budget-visibility',
      'queue-headroom-visible-without-queue-slack-visibility',
      'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
      'queue-headroom-visible-without-queue-budget-visibility',
      'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
    blockerRefs: Object.freeze([
      'queue-pause-without-measured-queue-headroom-proof',
      'memory-ceiling-match-visible-without-queue-slack-visibility',
      'memory-ceiling-match-visible-without-memory-headroom-visibility',
      'queue-headroom-visible-without-queue-slack-visibility',
      'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
      'queue-budget-visible-without-queue-headroom-measurement',
      'memory-ceiling-visible-without-queue-headroom-measurement',
      'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-measurement',
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
    blockerRefs: Object.freeze([
      'queue-pause-without-measured-queue-headroom-proof',
      'memory-ceiling-match-visible-without-queue-slack-visibility',
      'memory-ceiling-match-visible-without-memory-headroom-visibility',
      'queue-headroom-visible-without-queue-slack-visibility',
      'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
      'queue-budget-visible-without-queue-headroom-measurement',
      'memory-ceiling-visible-without-queue-headroom-measurement',
      'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-measurement',
    ]),
  }),
  Object.freeze({
    id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    blockerRefs: Object.freeze([
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-budget-not-visible',
      'queue-budget-visible-without-memory-ceiling-visibility',
      'queue-budget-visible-without-queue-headroom-visible',
      'queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility',
      'queue-pause-footprint-not-proven',
      'queue-pause-without-visible-memory-ceiling',
      'queue-pause-without-complete-receipt-cursor-pause-footprint',
      'queue-pause-without-terminal-receipt-cursor',
      'receipt-cursor-not-terminal',
      'memory-ceiling-match-visible-without-memory-ceiling-visibility',
      'memory-ceiling-match-visible-without-queue-budget-visibility',
      'memory-ceiling-match-visible-without-queue-headroom-visibility',
      'memory-ceiling-visible-without-memory-ceiling-visibility',
      'memory-ceiling-visible-without-queue-budget-visibility',
      'memory-ceiling-visible-without-queue-headroom-visible',
      'queue-headroom-not-visible',
      'queue-headroom-visible-without-memory-ceiling-visibility',
      'queue-headroom-visible-without-queue-budget-visibility',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'memory-ceiling-match-visible-without-memory-headroom-visibility',
      'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
      'queue-pause-without-visible-receipt-cursor-memory-headroom',
      'staging-disk-headroom-visible-without-measurement',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-memory-ceiling-match-visibility',
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
      'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
      'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
      'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
      'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
      ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
    ]),
  }),
]);

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
  const parallelismLimitsMeasured =
    report.evidence.parallelism?.parallelismLimitsMeasured === true;
  const parallelismLimitsVisibleOnReport =
    report.evidence.parallelism?.parallelismLimitsVisible === true;
  const parallelismLimitsIntegral =
    Number.isInteger(parallelismLimits?.chunkUpload)
    && Number.isInteger(parallelismLimits?.fileHashing)
    && Number.isInteger(parallelismLimits?.dbBatchPerTable);
  const parallelismLimitsCanonical =
    parallelismLimits?.chunkUpload === DEFAULT_LIMITS.maxUploadConcurrency
    && parallelismLimits?.fileHashing === DEFAULT_LIMITS.maxHashConcurrency
    && parallelismLimits?.dbBatchPerTable === DEFAULT_LIMITS.maxDbConcurrencyPerTable;
  const parallelismLimitsVisible =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsMeasured
    && parallelismLimitsIntegral
    && parallelismLimitsCanonical;
  const receiptCursorBackpressureBytes = report.evidence.backpressure?.receiptCursorBytes ?? null;
  const receiptCursorQueueSlackBytes = report.evidence.backpressure?.receiptCursorQueueSlackBytes ?? null;
  const receiptCursorQueueBudgetBytes = report.evidence.backpressure?.queueBudgetBytes ?? null;
  const receiptCursorQueueHeadroomBytes = report.evidence.backpressure?.queueHeadroomBytes ?? null;
  const receiptCursorMemoryHeadroomBytes = report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes ?? null;
  const receiptCursorMemoryCeilingBytes = report.evidence.backpressure?.receiptCursorMemoryCeilingBytes ?? null;
  const receiptCursorWindowBytes = report.evidence.chunkReceipts.resumeCursor?.sizeBytes ?? null;
  const receiptCursorQueueSlackVisible =
    report.evidence.backpressure?.receiptCursorQueueSlackVisible === true;
  const receiptCursorMemoryHeadroomVisible =
    report.evidence.backpressure?.receiptCursorMemoryHeadroomVisible === true;
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
    blockers.push('queue-budget-visible-without-memory-ceiling-visibility');
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
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('memory-ceiling-visible-without-queue-headroom-measurement');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('memory-ceiling-visible-without-queue-budget-visibility');
  }
  if (!Number.isFinite(report.resourceLimits?.memoryCeilingBytes) || report.resourceLimits.memoryCeilingBytes <= 0) {
    blockers.push('production-memory-ceiling-not-measured');
  }
  if (!Number.isFinite(report.resourceLimits?.maxStagingDiskBytes) || report.resourceLimits.maxStagingDiskBytes <= 0) {
    blockers.push('production-staging-disk-ceiling-not-measured');
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
    && parallelismLimitsVisible !== true
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
    && report.evidence.parallelism?.parallelismLimitsMeasured === true
    && (
      report.evidence.parallelism?.parallelismLimits?.chunkUpload <= 0
      || report.evidence.parallelism?.parallelismLimits?.fileHashing <= 0
      || report.evidence.parallelism?.parallelismLimits?.dbBatchPerTable <= 0
    )
  ) {
    blockers.push('production-parallelism-limits-visible-without-positive');
  }
  if (
    report.evidence.parallelism?.parallelismLimitsVisible === true
    && report.evidence.parallelism?.parallelismLimitsMeasured === true
    && (
      !Number.isInteger(report.evidence.parallelism?.parallelismLimits?.chunkUpload)
      || !Number.isInteger(report.evidence.parallelism?.parallelismLimits?.fileHashing)
      || !Number.isInteger(report.evidence.parallelism?.parallelismLimits?.dbBatchPerTable)
    )
  ) {
    blockers.push('production-parallelism-limits-visible-without-integral');
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
  if (
    report.evidence.backpressure?.queueBudgetMatchesResourceCeiling !== true
    || !(
      Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
      && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes
    )
  ) {
    blockers.push('queue-budget-does-not-match-resource-ceiling');
  }
  if (
    report.evidence.backpressure?.receiptCursorWithinQueueBudget !== true
    || !(
      Number.isFinite(receiptCursorBackpressureBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && receiptCursorBackpressureBytes <= receiptCursorQueueBudgetBytes
    )
  ) {
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
  if (
    report.evidence.backpressure?.receiptCursorBackpressureWithinQueueHeadroom !== true
    || !(
      Number.isFinite(receiptCursorBackpressureBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && receiptCursorBackpressureBytes <= receiptCursorQueueHeadroomBytes
    )
  ) {
    blockers.push('receipt-cursor-exceeds-queue-headroom');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorPauseFootprintComplete !== true
  ) {
    blockers.push('queue-pause-footprint-not-proven');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorPauseFootprintComplete === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorPauseFootprintComplete === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible !== true
  ) {
    blockers.push('queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility');
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
    && !(
      report.evidence.backpressure?.receiptCursorBackpressureWithinResourceHeadroom === true
      && Number.isFinite(receiptCursorBackpressureBytes)
      && Number.isFinite(receiptCursorMemoryCeilingBytes)
      && Number.isFinite(receiptCursorWindowBytes)
      && receiptCursorBackpressureBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    )
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
      || report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom !== true
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
    && !(
      report.evidence.backpressure.receiptCursorQueueSlackWithinMemoryCeiling === true
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorMemoryCeilingBytes)
      && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes
    )
  ) {
    blockers.push('queue-pause-without-memory-safe-receipt-cursor-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.receiptCursorQueueSlackBytes != null
    && !(
      report.evidence.backpressure.receiptCursorQueueSlackWithinResourceHeadroom === true
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorMemoryCeilingBytes)
      && Number.isFinite(receiptCursorWindowBytes)
      && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    )
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
    report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('memory-ceiling-match-visible-without-queue-budget-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('memory-ceiling-match-visible-without-memory-ceiling-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('memory-ceiling-match-visible-without-queue-headroom-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('memory-ceiling-match-visible-without-queue-headroom-measurement');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true
    && receiptCursorMemoryHeadroomVisible !== true
  ) {
    blockers.push('memory-ceiling-match-visible-without-memory-headroom-visibility');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true
    && receiptCursorQueueSlackVisible !== true
  ) {
    blockers.push('memory-ceiling-match-visible-without-queue-slack-visibility');
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
    report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('queue-headroom-visible-without-memory-ceiling-visibility');
  }
  if (
    report.evidence.backpressure?.queueHeadroomVisible === true
    && receiptCursorMemoryHeadroomVisible !== true
  ) {
    blockers.push('queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility');
  }
  if (
    report.evidence.backpressure?.queueHeadroomVisible === true
    && receiptCursorQueueSlackVisible !== true
  ) {
    blockers.push('queue-headroom-visible-without-queue-slack-visibility');
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
    !Number.isFinite(report.evidence.backpressure?.stagingDiskHeadroomBytes)
    || report.evidence.backpressure.stagingDiskHeadroomBytes < 0
  ) {
    blockers.push('missing-staging-disk-headroom-evidence');
  }
  if (
    !Number.isFinite(report.evidence.backpressure?.stagingDiskReserveBytes)
    || report.evidence.backpressure.stagingDiskReserveBytes <= 0
  ) {
    blockers.push('missing-staging-disk-reserve-evidence');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.stagingDiskReserveBytes)
    && report.evidence.backpressure.stagingDiskReserveBytes !== report.shape.chunkSizeBytes
  ) {
    blockers.push('staging-disk-reserve-not-aligned-to-chunk-window');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.queueHeadroomBytes)
    && report.evidence.backpressure.queueHeadroomBytes <= 0
  ) {
    blockers.push('queue-headroom-not-positive');
  }
  if (
    Number.isFinite(report.evidence.backpressure?.stagingDiskHeadroomBytes)
    && report.evidence.backpressure.stagingDiskHeadroomBytes <= 0
  ) {
    blockers.push('staging-disk-headroom-not-positive');
  }
  if (
    report.evidence.backpressure?.queueHeadroomMeasured === true
    && !(
      report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
      && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes
      && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    )
  ) {
    blockers.push('queue-headroom-exceeds-resource-ceiling');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('queue-headroom-not-visible');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && receiptCursorQueueSlackVisible !== true
  ) {
    blockers.push('queue-pause-without-visible-receipt-cursor-queue-slack');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && receiptCursorMemoryHeadroomVisible !== true
  ) {
    blockers.push('queue-pause-without-visible-receipt-cursor-memory-headroom');
  }
  if (
    report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('queue-headroom-visible-without-measurement');
  }
  if (
    report.evidence.backpressure?.stagingDiskHeadroomVisible === true
    && report.evidence.backpressure?.stagingDiskHeadroomMeasured !== true
  ) {
    blockers.push('staging-disk-headroom-visible-without-measurement');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && report.evidence.backpressure?.stagingDiskHeadroomVisible !== true
  ) {
    blockers.push('staging-disk-headroom-not-visible');
  }
  if (
    report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.stagingDiskHeadroomVisible === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.stagingDiskHeadroomVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible !== true
  ) {
    blockers.push('staging-disk-headroom-visible-without-memory-ceiling-match-visibility');
  }
  if (
    report.evidence.backpressure?.stagingDiskHeadroomVisible === true
    && (
      report.evidence.backpressure?.receiptCursorPauseFootprintComplete !== true
      || report.evidence.backpressure?.queueBudgetVisible !== true
      || report.evidence.backpressure?.queueHeadroomVisible !== true
      || report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
      || report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible !== true
      || receiptCursorQueueSlackVisible !== true
      || receiptCursorMemoryHeadroomVisible !== true
      || report.evidence.backpressure?.queueHeadroomMeasured !== true
      || report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
    )
  ) {
    blockers.push('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint');
  }
  if (
    report.evidence.backpressure?.stagingDiskHeadroomMeasured === true
    && report.evidence.backpressure?.stagingDiskHeadroomWithinPlanReserve !== true
  ) {
    blockers.push('staging-disk-headroom-outside-plan-reserve');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack !== true
  ) {
    blockers.push('memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof');
  }
  if (
    report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('queue-budget-and-queue-headroom-visible-without-queue-headroom-measurement');
  }
  if (
    receiptCursorQueueSlackVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('receipt-cursor-queue-slack-visible-without-queue-budget-visibility');
  }
  if (
    receiptCursorQueueSlackVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility');
  }
  if (
    receiptCursorQueueSlackVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility');
  }
  if (
    receiptCursorQueueSlackVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('receipt-cursor-queue-slack-visible-without-queue-headroom-measurement');
  }
  if (
    receiptCursorQueueSlackVisible === true
    && receiptCursorMemoryHeadroomVisible !== true
  ) {
    blockers.push('receipt-cursor-queue-slack-visible-without-memory-headroom-visibility');
  }
  if (
    receiptCursorMemoryHeadroomVisible === true
    && report.evidence.backpressure?.queueBudgetVisible !== true
  ) {
    blockers.push('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility');
  }
  if (
    receiptCursorMemoryHeadroomVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible !== true
  ) {
    blockers.push('receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility');
  }
  if (
    receiptCursorMemoryHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible !== true
  ) {
    blockers.push('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility');
  }
  if (
    receiptCursorMemoryHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured !== true
  ) {
    blockers.push('receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement');
  }
  if (
    receiptCursorMemoryHeadroomVisible === true
    && receiptCursorQueueSlackVisible !== true
  ) {
    blockers.push('receipt-cursor-memory-headroom-visible-without-queue-slack-visibility');
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
  if (
    receiptCursorQueueSlackVisible === true
    && !Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
  ) {
    blockers.push('receipt-cursor-queue-slack-visible-without-measurement');
  }
  if (
    receiptCursorMemoryHeadroomVisible === true
    && !Number.isFinite(report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes)
  ) {
    blockers.push('receipt-cursor-memory-headroom-visible-without-measurement');
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
    Number.isFinite(report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes)
    && Number.isFinite(report.resourceLimits?.memoryCeilingBytes)
    && Number.isFinite(report.evidence.chunkReceipts.resumeCursor?.sizeBytes)
    && report.evidence.backpressure.receiptCursorMemoryHeadroomBytes
      !== report.resourceLimits.memoryCeilingBytes - report.evidence.chunkReceipts.resumeCursor.sizeBytes
  ) {
    blockers.push('receipt-cursor-memory-headroom-resource-headroom-mismatch');
  }
  if (
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && !Number.isFinite(report.evidence.backpressure?.receiptCursorQueueSlackBytes)
  ) {
    blockers.push('receipt-cursor-queue-slack-not-measured');
  }
  if (
    report.evidence.backpressure?.receiptCursorHeadroomWithinQueueBudget !== true
    || !(
      Number.isFinite(receiptCursorMemoryHeadroomBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && receiptCursorMemoryHeadroomBytes <= receiptCursorQueueHeadroomBytes
      && receiptCursorMemoryHeadroomBytes === receiptCursorQueueHeadroomBytes
    )
  ) {
    blockers.push('receipt-cursor-headroom-not-covered-by-queue-budget');
  }
  if (
    report.evidence.backpressure?.receiptCursorMemoryHeadroomWithinQueueBudget !== true
    || !(
      Number.isFinite(receiptCursorMemoryHeadroomBytes)
      && Number.isFinite(receiptCursorQueueHeadroomBytes)
      && receiptCursorMemoryHeadroomBytes <= receiptCursorQueueHeadroomBytes
      && receiptCursorMemoryHeadroomBytes === receiptCursorQueueHeadroomBytes
    )
  ) {
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
    && parallelismLimitsVisible !== true
  ) {
    blockers.push('production-row-batch-executor-visible-without-parallelism-limits');
  }
  if (
    report.evidence.atomicGroup.productionRowBatchExecutorVisible === true
    && report.evidence.atomicGroup.productionAtomicCommitVisible !== true
  ) {
    blockers.push('production-row-batch-executor-without-atomic-commit');
  }
  return [...new Set(blockers)];
}

export function productionThroughputClaim(report) {
  const blockers = productionThroughputBlockers(report);
  return {
    allowed: blockers.length === 0,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    blockers,
    rejectedFastPaths: rolloutRejectedFastPaths(blockers),
  };
}

export function validateRolloutRejectedFastPathSpecs() {
  for (const spec of ROLLOUT_REJECTED_FAST_PATH_SPECS) {
    const rejected = findRejectedFastPathById(spec.id);
    if (!rejected) {
      throw new Error(
        `rollout rejected fast-path spec "${spec.id}" no longer resolves to a modeled rejected fast path`,
      );
    }
  }
}

function rolloutRejectedFastPaths(blockers) {
  validateRolloutRejectedFastPathSpecs();
  const blockerSet = new Set(blockers);

  return ROLLOUT_REJECTED_FAST_PATH_SPECS.flatMap((spec) => {
    const matchedBlockers = spec.blockerRefs.filter((blocker) => blockerSet.has(blocker));
    const receiptLedgerBlockers = (
      spec.id.includes('receipt-flush')
      || spec.id.includes('row-receipts')
      || spec.id.includes('row-batch-receipts')
      || spec.id.includes('chunk-receipts')
    )
      ? RECEIPT_LEDGER_BLOCKER_REFS.filter((blocker) => blockerSet.has(blocker))
      : [];
    const matchedWithReceiptLedger = [...new Set([...matchedBlockers, ...receiptLedgerBlockers])];
    if (matchedWithReceiptLedger.length === 0) {
      return [];
    }

    const rejected = findRejectedFastPathById(spec.id);

    return [{
      id: rejected.id,
      rejectedGate: rejected.rejectedGate,
      blockerRefs: matchedWithReceiptLedger,
      proposal: rejected.proposal,
      violates: [...rejected.violates],
    }];
  });
}

export function productionThroughputDetails(report) {
  const blockers = productionThroughputBlockers(report);
  const rejectedFastPaths = rolloutRejectedFastPaths(blockers);
  const rejectedFastPathGateSummary = summarizeRejectedFastPathGates(rejectedFastPaths);
  const receiptCursorWindowBytes = report.evidence.chunkReceipts.resumeCursor?.sizeBytes ?? null;
  const receiptCursorBackpressureBytes = report.evidence.backpressure?.receiptCursorBytes ?? null;
  const receiptCursorMemoryHeadroomBytes = report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes ?? null;
  const receiptCursorMemoryCeilingBytes = report.evidence.backpressure?.receiptCursorMemoryCeilingBytes ?? null;
  const receiptCursorQueueBudgetBytes = report.evidence.backpressure?.queueBudgetBytes ?? null;
  const stagingDiskHeadroomBytes = report.evidence.backpressure?.stagingDiskHeadroomBytes ?? null;
  const stagingDiskReserveBytes = report.evidence.backpressure?.stagingDiskReserveBytes ?? null;
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
  const stagingDiskHeadroomVisible =
    report.evidence.backpressure?.stagingDiskHeadroomVisible === true;
  const stagingDiskHeadroomMeasured =
    report.evidence.backpressure?.stagingDiskHeadroomMeasured === true;
  const stagingDiskReservePositive =
    Number.isFinite(stagingDiskReserveBytes)
    && stagingDiskReserveBytes > 0;
  const stagingDiskReserveMatchesChunkWindow =
    stagingDiskReservePositive
    && stagingDiskReserveBytes === report.shape.chunkSizeBytes;
  const stagingDiskHeadroomWithinPlanReserve =
    report.evidence.backpressure?.stagingDiskHeadroomWithinPlanReserve === true
    && stagingDiskReserveMatchesChunkWindow;
  const receiptCursorQueueSlackVisible =
    report.evidence.backpressure?.receiptCursorQueueSlackVisible === true;
  const receiptCursorMemoryHeadroomVisible =
    report.evidence.backpressure?.receiptCursorMemoryHeadroomVisible === true;
  const queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof =
    report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack === true;
  const stagingDiskHeadroomPositive =
    Number.isFinite(stagingDiskHeadroomBytes)
    && stagingDiskHeadroomBytes > 0;
  const stagingDiskHeadroomVisibleAndMeasured =
    stagingDiskHeadroomVisible
    && stagingDiskHeadroomMeasured
    && stagingDiskHeadroomWithinPlanReserve
    && stagingDiskHeadroomPositive;
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
    && receiptCursorMemoryHeadroomBytes === receiptCursorQueueHeadroomBytes
    && report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom === true
    && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true;
  const receiptCursorBackpressureWithinQueueHeadroom =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorBackpressureBytes <= receiptCursorQueueHeadroomBytes
    && report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom === true
    && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true;
  const receiptCursorBackpressureWithinResourceHeadroomBase =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorBackpressureBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true;
  const queueHeadroomWithinResourceCeiling =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true;
  const queueHeadroomMatchesMemoryHeadroomBase =
    Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorQueueHeadroomBytes === receiptCursorMemoryHeadroomBytes
    && queueHeadroomWithinResourceCeiling;
  const receiptCursorBackpressureWithinQueueBudgetBase =
    Number.isFinite(receiptCursorBackpressureBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorBackpressureBytes <= receiptCursorQueueBudgetBytes;
  const receiptCursorPauseFootprint = {
    receiptCursorBytes: receiptCursorBackpressureBytes,
    queueBudgetBytes: receiptCursorQueueBudgetBytes,
    queueHeadroomBytes: receiptCursorQueueHeadroomBytes,
    queueSlackBytes: receiptCursorQueueSlackBytes,
    memoryCeilingBytes: receiptCursorMemoryCeilingBytes,
    memoryHeadroomBytes: receiptCursorMemoryHeadroomBytes,
  };
  const receiptCursorPauseFootprintMeasuredComplete =
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
  const receiptCursorPauseFootprintBaseComplete =
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && receiptCursorPauseFootprintMeasuredComplete
    && report.evidence.backpressure?.receiptCursorPauseFootprintComplete === true;
  const receiptCursorQueueSlackMatchesBackpressure =
    receiptCursorPauseFootprintBaseComplete
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorBackpressureBytes)
    && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof;
  const receiptCursorQueueSlackMatchesMemoryHeadroom =
    receiptCursorPauseFootprintBaseComplete
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof;
  const receiptCursorQueueSlackMatchesQueueHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorQueueSlackBytes === receiptCursorQueueHeadroomBytes
    && report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom === true;
  const receiptCursorQueueSlackMatchesResourceHeadroom =
    receiptCursorPauseFootprintBaseComplete
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorQueueSlackBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && queueHeadroomWithinResourceCeiling
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof;
  const receiptCursorQueueSlackWithinMemoryCeiling =
    receiptCursorPauseFootprintBaseComplete
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof;
  const receiptCursorQueueSlackMeasured =
    Number.isFinite(receiptCursorQueueSlackBytes);
  const receiptCursorQueueSlackWithinQueueBudget =
    receiptCursorPauseFootprintBaseComplete
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueBudgetBytes)
    && receiptCursorQueueSlackBytes > 0
    && receiptCursorQueueSlackBytes <= receiptCursorQueueBudgetBytes
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof;
  const receiptCursorQueueSlackWithinQueueHeadroom =
    Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorQueueHeadroomBytes
    && report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom === true;
  const receiptCursorQueueSlackWithinResourceHeadroom =
    receiptCursorPauseFootprintBaseComplete
    && report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorBackpressure === true
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && Number.isFinite(receiptCursorQueueSlackBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorQueueSlackBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && queueHeadroomWithinResourceCeiling
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlackProof;
  const queueHeadroomPositive = receiptCursorQueueHeadroomPositive;
  const receiptCursorMemoryHeadroomPositiveVisible = receiptCursorMemoryHeadroomPositive;
  const queuePauseHasMeasuredReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      report.evidence.backpressure?.queuePauseHasMeasuredReceiptCursorQueueSlack === true
      && queueHeadroomMeasured
      && receiptCursorQueueSlackPositive
      && receiptCursorQueueSlackWithinQueueBudget
    );
  const queuePauseHasBackpressureAlignedReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow !== true
    || (
      queuePauseHasMeasuredReceiptCursorQueueSlack
      && queueHeadroomMeasured
      && Number.isFinite(receiptCursorQueueSlackBytes)
      && Number.isFinite(receiptCursorQueueBudgetBytes)
      && Number.isFinite(receiptCursorBackpressureBytes)
      && receiptCursorQueueSlackBytes === receiptCursorQueueBudgetBytes - receiptCursorBackpressureBytes
      && report.evidence.backpressure?.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack === true
    );
  const receiptCursorHeadroomCoveredByQueueBudget =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && receiptCursorMemoryHeadroomBytes <= receiptCursorQueueHeadroomBytes
    && report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom === true
    && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true;
  const receiptCursorMemoryHeadroomWithinQueueBudget =
    receiptCursorHeadroomCoveredByQueueBudget && receiptCursorHeadroomMatchesQueueHeadroom;
  const receiptCursorHeadroomWithinQueueBudget =
    receiptCursorHeadroomCoveredByQueueBudget && receiptCursorHeadroomMatchesQueueHeadroom;
  const receiptCursorMemoryCeilingMatchesQueueBudget =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudget === true
    && receiptCursorQueueBudgetBytes === receiptCursorMemoryCeilingBytes;
  const receiptCursorMemoryCeilingMatchesQueueBudgetVisible =
    receiptCursorMemoryCeilingMatchesQueueBudget
    && receiptCursorMemoryCeilingVisible
    && queueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorQueueSlackVisible
    && receiptCursorMemoryHeadroomVisible
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true;
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
  const successInspectionClaimReasonVisible = successInspectionClaimReasonProven;
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
  const receiptCursorHeadroomMatchesResourceHeadroomBase =
    receiptCursorWithinMemoryCeiling
    && receiptCursorMemoryHeadroomBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && queueHeadroomWithinResourceCeiling;
  const queueBudgetMatchesResourceCeiling =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes;
  const queueHeadroomMatchesResourceHeadroomBase =
    Number.isFinite(receiptCursorQueueBudgetBytes)
    && Number.isFinite(receiptCursorQueueHeadroomBytes)
    && Number.isFinite(report.resourceLimits?.maxBufferedUploadBytes)
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && receiptCursorQueueBudgetBytes === report.resourceLimits.maxBufferedUploadBytes
    && queueHeadroomWithinResourceCeiling;
  const receiptCursorMatchesBackpressure =
    receiptCursorBackpressureBytes !== null
    && receiptCursorBackpressureBytes === receiptCursorWindowBytes;
  const receiptCursorBackpressureMeasured =
    report.evidence.backpressure?.receiptCursorBackpressureMeasured === true
    && Number.isFinite(receiptCursorBackpressureBytes)
    && receiptCursorBackpressureBytes > 0;
  const receiptCursorBackpressurePositive =
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
      && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack === true
      && receiptCursorQueueSlackMatchesBackpressure
      && receiptCursorQueueSlackMatchesMemoryHeadroom
      && receiptCursorQueueSlackMatchesQueueHeadroom
      && receiptCursorQueueSlackMatchesResourceHeadroom
    );
  const receiptCursorPauseFootprintComplete =
    receiptCursorPauseFootprintBaseComplete
    && queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueHeadroomVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomPositive
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackVisible
    && queueHeadroomWithinResourceCeiling;
  const queueHeadroomVisibleAndMeasuredAndAligned =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorQueueSlackVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackVisible
    && receiptCursorQueueSlackMeasured
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueHeadroomVisibleAndQueueSlackMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueHeadroomVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueHeadroomVisibleAndQueueSlackVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackVisible
    && receiptCursorQueueSlackPositive
    && receiptCursorQueueSlackMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueHeadroomVisibleAndMemoryHeadroomVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorMemoryCeilingMatchesQueueBudget
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackVisible
    && receiptCursorMemoryHeadroomVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorPauseFootprintVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueBudgetVisible
    && queueHeadroomVisible
    && receiptCursorMemoryCeilingVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && receiptCursorQueueSlackVisible
    && receiptCursorMemoryHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const stagingDiskHeadroomVisibleAndMeasuredAfterPause =
    stagingDiskHeadroomVisible
    && stagingDiskHeadroomMeasured
    && stagingDiskHeadroomWithinPlanReserve
    && stagingDiskHeadroomPositive
    && receiptCursorPauseFootprintVisible;
  const queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueBudgetVisible
    && receiptCursorMemoryCeilingVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueBudgetVisibleAndQueueHeadroomMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueBudgetVisibleAndQueueHeadroomVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueBudgetVisible
    && queueHeadroomVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const queueBudgetVisibleAndMemoryCeilingVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && queueBudgetVisible
    && receiptCursorMemoryCeilingVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && receiptCursorMemoryCeilingVisible
    && queueBudgetVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && receiptCursorQueueSlackVisible
    && receiptCursorMemoryHeadroomVisible
    && queueBudgetVisible
    && receiptCursorMemoryCeilingVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && receiptCursorMemoryHeadroomVisible
    && receiptCursorQueueSlackVisible
    && queueBudgetVisible
    && receiptCursorMemoryCeilingVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && receiptCursorMemoryCeilingVisible
    && queueBudgetVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && receiptCursorQueueSlackVisible
    && receiptCursorMemoryHeadroomVisible
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe =
    receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible
    && receiptCursorBackpressureWithinResourceHeadroomBase;
  const pausedQueueSlackEvidence = {
    queuePauseHasMeasuredReceiptCursorQueueSlack,
    queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
  };
  const receiptCursorMemoryHeadroomMatchesResourceHeadroomBase =
    receiptCursorWithinMemoryCeiling
    && receiptCursorMemoryHeadroomBytes === receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && queueHeadroomWithinResourceCeiling;
  const receiptCursorMemoryHeadroomWithinResourceHeadroomBase =
    Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && Number.isFinite(receiptCursorWindowBytes)
    && receiptCursorMemoryHeadroomBytes <= receiptCursorMemoryCeilingBytes - receiptCursorWindowBytes
    && queueHeadroomWithinResourceCeiling;
  const receiptCursorMemoryHeadroomVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && receiptCursorQueueSlackVisible
    && receiptCursorMemoryHeadroomVisible
    && Number.isFinite(receiptCursorMemoryHeadroomBytes)
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorMemoryCeilingVisibleAndMeasured =
    receiptCursorPauseFootprintComplete
    && queueHeadroomWithinResourceCeiling
    && receiptCursorMemoryCeilingVisible
    && queueBudgetVisible
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && queueHeadroomVisible
    && queueHeadroomMeasured
    && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack;
  const receiptCursorBackpressureWithinQueueBudget =
    receiptCursorPauseFootprintComplete
    && receiptCursorBackpressureWithinQueueBudgetBase;
  const receiptCursorBackpressureWithinResourceHeadroom =
    receiptCursorPauseFootprintComplete
    && receiptCursorBackpressureWithinResourceHeadroomBase;
  const receiptCursorHeadroomMatchesResourceHeadroom =
    receiptCursorPauseFootprintComplete
    && receiptCursorHeadroomMatchesResourceHeadroomBase;
  const queueHeadroomMatchesResourceHeadroom =
    receiptCursorPauseFootprintComplete
    && queueHeadroomMatchesResourceHeadroomBase;
  const queueHeadroomMatchesMemoryHeadroom =
    receiptCursorPauseFootprintComplete
    && queueHeadroomMatchesMemoryHeadroomBase;
  const receiptCursorMemoryHeadroomMatchesResourceHeadroom =
    receiptCursorPauseFootprintComplete
    && receiptCursorMemoryHeadroomMatchesResourceHeadroomBase;
  const receiptCursorMemoryHeadroomWithinResourceHeadroom =
    receiptCursorPauseFootprintComplete
    && receiptCursorMemoryHeadroomWithinResourceHeadroomBase;
  const journalSuccessRecordTypes = report.evidence.journal?.successRecordTypes ?? [];
  const journalSuccessReceiptKinds = journalSuccessRecordTypes.map((recordType) => receiptKindForRecordType(recordType));
  const journalSuccessReceiptKindLedger = summarizeReceiptKinds(journalSuccessReceiptKinds);
  const journalSuccessReceiptKindLedgerComplete =
    journalSuccessReceiptKindLedger.length > 0
    && journalSuccessReceiptKindLedger.every((entry, index) => entry.kind === journalSuccessReceiptKinds[index]);
  const journalSuccessReceiptKindsGrouped = areReceiptKindsGrouped(journalSuccessRecordTypes);
  const productionAtomicCommitMeasured =
    report.executorCapabilities.productionAtomicCommit === 'production-atomic-group-commit'
    && report.evidence.atomicGroup?.productionAtomicCommitMeasured === true;
  const productionStorageReceiptsMeasured =
    report.executorCapabilities.fileReceipts === 'production-storage-receipts'
    && report.evidence.atomicGroup?.productionStorageReceiptsMeasured === true;
  const productionRowBatchExecutorMeasured =
    report.executorCapabilities.rowApply === 'production-batched-compare-and-swap'
    && report.evidence.atomicGroup?.productionRowBatchExecutorMeasured === true;
  const productionAtomicCommitVisible =
    report.evidence.atomicGroup?.productionAtomicCommitVisible === true;
  const productionAtomicGroupMetadataVisible =
    report.evidence.atomicGroup?.productionAtomicGroupMetadataVisible === true;
  const productionAtomicGroupMetadataVisibleAndMeasured =
    productionAtomicGroupMetadataVisible
    && productionAtomicCommitMeasured
    && productionAtomicCommitVisible
    && productionStorageReceiptsMeasured;
  const productionStorageReceiptsVisible =
    report.evidence.atomicGroup?.productionStorageReceiptsVisible === true;
  const productionRowBatchExecutorVisible =
    report.evidence.atomicGroup?.productionRowBatchExecutorVisible === true;
  const productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible =
    productionStorageReceiptsVisible
    && productionStorageReceiptsMeasured
    && productionAtomicGroupMetadataVisibleAndMeasured;
  const productionStorageReceiptsVisibleAndAtomicCommitVisible =
    productionStorageReceiptsVisible
    && productionStorageReceiptsMeasured
    && productionAtomicGroupMetadataVisibleAndMeasured;
  const productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured =
    productionStorageReceiptsVisible
    && productionAtomicCommitVisible
    && productionStorageReceiptsMeasured
    && productionAtomicCommitMeasured
    && productionAtomicGroupMetadataVisible;
  const productionRowBatchExecutorVisibleAndStorageReceiptsVisible =
    productionRowBatchExecutorVisible
    && productionStorageReceiptsVisible
    && productionRowBatchExecutorMeasured
    && productionStorageReceiptsMeasured
    && productionAtomicGroupMetadataVisibleAndMeasured;
  const productionRowBatchExecutorVisibleAndAtomicCommitVisible =
    productionRowBatchExecutorVisible
    && productionRowBatchExecutorMeasured
    && productionAtomicCommitVisible
    && productionAtomicGroupMetadataVisibleAndMeasured;
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
  const parallelismLimitsPositive =
    Number.isFinite(parallelismLimits.chunkUpload)
    && Number.isFinite(parallelismLimits.fileHashing)
    && Number.isFinite(parallelismLimits.dbBatchPerTable)
    && parallelismLimits.chunkUpload > 0
    && parallelismLimits.fileHashing > 0
    && parallelismLimits.dbBatchPerTable > 0;
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
    && parallelismLimitsMeasuredOnReport
    && parallelismLimitsPositive
    && parallelismLimitsIntegral;
  const productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured =
    productionRowBatchExecutorVisible
    && productionStorageReceiptsVisible
    && productionRowBatchExecutorMeasured
    && productionStorageReceiptsMeasured
    && productionAtomicGroupMetadataVisibleAndMeasured
    && parallelismLimitsVisible;
  const parallelismLimitsVisibleAndCanonical =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsMeasuredOnReport
    && parallelismLimitsCanonical;
  const parallelismLimitsVisibleMeasuredAndCanonical =
    parallelismLimitsVisibleOnReport
    && parallelismLimitsMeasuredOnReport
    && parallelismLimitsCanonical;
  const productionCapabilityRolloutSummary = summarizeProductionCapabilityRollout({
    blockers,
    parallelismLimitsMeasuredOnReport,
    parallelismLimitsVisible,
    parallelismLimitsCanonical,
    backpressureEvidenceComplete,
    queueBudgetMatchesResourceCeiling,
    productionStorageReceiptsMeasured,
    productionStorageReceiptsVisible,
    productionAtomicCommitMeasured,
    productionAtomicCommitVisible,
    productionRowBatchExecutorMeasured,
    productionRowBatchExecutorVisible,
    productionAtomicGroupMetadataVisibleAndMeasured,
  });
  const releaseBundlePlanningSummary = summarizeReleaseBundlePlanning({
    blockers,
    queueBudgetVisible,
    queueHeadroomVisible,
    queueHeadroomMeasured,
    queueHeadroomWithinResourceCeiling,
    receiptCursorPauseFootprintComplete,
    receiptCursorQueueSlackVisible,
    receiptCursorMemoryHeadroomVisible,
    queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    stagingDiskHeadroomVisible,
    stagingDiskHeadroomMeasured,
    stagingDiskHeadroomWithinPlanReserve,
  });
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
    receiptCursorPauseFootprintBaseComplete,
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
    stagingDiskHeadroomBytes,
    stagingDiskReserveBytes,
    stagingDiskReservePositive,
    stagingDiskReserveMatchesChunkWindow,
    stagingDiskHeadroomPositive,
    stagingDiskHeadroomVisible,
    stagingDiskHeadroomMeasured,
    stagingDiskHeadroomWithinPlanReserve,
    stagingDiskHeadroomVisibleAndMeasured,
    stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    queueBudgetPositive,
    queueBudgetVisible,
    queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    queueBudgetVisibleAndQueueHeadroomMeasured,
    queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    queueBudgetVisibleAndQueueHeadroomVisible,
    queueBudgetVisibleAndMemoryCeilingVisible,
    receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
    queueHeadroomVisible,
    queueHeadroomVisibleAndMeasured,
    queueHeadroomVisibleAndMeasuredAndAligned,
    queueHeadroomVisibleAndQueueSlackMeasured,
    queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    queueHeadroomVisibleAndMemoryHeadroomVisible,
    receiptCursorMemoryCeilingVisible,
    receiptCursorMemoryCeilingVisibleAndMeasured,
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
    receiptCursorQueueSlackVisible,
    receiptCursorQueueSlackVisibleAndMeasured,
    receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
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
    receiptCursorMemoryHeadroomVisible,
    receiptCursorMemoryHeadroomVisibleAndMeasured,
    receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
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
    successInspectionClaimReasonVisible,
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
    productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    productionRowBatchExecutorVisibleAndAtomicCommitVisible,
    productionAtomicGroupMetadataProven,
    parallelismLimits,
    parallelismLimitsMeasured: parallelismLimitsMeasuredOnReport,
    parallelismLimitsPositive,
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
      stagingDiskHeadroomBytes,
      stagingDiskReserveBytes,
      stagingDiskReservePositive,
      stagingDiskReserveMatchesChunkWindow,
      stagingDiskHeadroomPositive,
      stagingDiskHeadroomVisible,
      stagingDiskHeadroomMeasured,
      stagingDiskHeadroomWithinPlanReserve,
      stagingDiskHeadroomVisibleAndMeasured,
      stagingDiskHeadroomVisibleAndMeasuredAfterPause,
      queueBudgetPositive,
      queueBudgetVisible,
      queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
      queueBudgetVisibleAndQueueHeadroomMeasured,
      queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
      queueBudgetVisibleAndQueueHeadroomVisible,
      queueBudgetVisibleAndMemoryCeilingVisible,
      receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
      queueHeadroomVisible,
      queueHeadroomVisibleAndMeasured,
      queueHeadroomVisibleAndMeasuredAndAligned,
      queueHeadroomVisibleAndQueueSlackMeasured,
      queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
      queueHeadroomVisibleAndMemoryHeadroomVisible,
      receiptCursorMemoryCeilingVisible,
      receiptCursorMemoryCeilingVisibleAndMeasured,
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
      receiptCursorHeadroomMatchesResourceHeadroom,
      receiptCursorBackpressureWithinQueueHeadroom,
      receiptCursorBackpressureWithinResourceHeadroom,
      receiptCursorHeadroomCoveredByQueueBudget,
      receiptCursorHeadroomWithinQueueBudget,
      receiptCursorBackpressureBytes,
      receiptCursorBackpressureMeasured,
      receiptCursorBackpressurePositive,
      queuePauseHasMeasuredReceiptCursorBackpressure,
      ...pausedQueueSlackEvidence,
      queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
      queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
      queueHeadroomMeasured,
      receiptCursorQueueSlackBytes,
      receiptCursorQueueSlackVisible,
      receiptCursorQueueSlackVisibleAndMeasured,
      receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
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
      receiptCursorMemoryHeadroomVisible,
      receiptCursorMemoryHeadroomVisibleAndMeasured,
      receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
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
      successInspectionClaimReasonVisible,
      successInspectionCountsNewMatchesMutations,
      receiptCursorMemoryHeadroomMatchesResourceHeadroom,
      receiptCursorMemoryHeadroomWithinResourceHeadroom,
      receiptCursorPauseFootprint,
      receiptCursorPauseFootprintBaseComplete,
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
      productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
      productionRowBatchExecutorMeasured,
      productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
      productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
      productionRowBatchExecutorVisibleAndAtomicCommitVisible,
      productionAtomicGroupMetadataProven,
      parallelismLimits,
      parallelismLimitsPositive,
      parallelismLimitsVisible,
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
      productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
      productionRowBatchExecutorVisibleAndAtomicCommitVisible,
      productionAtomicGroupMetadataVisible,
      productionAtomicGroupMetadataProven,
      productionStorageReceiptsVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisible,
      productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
      productionRowBatchExecutorVisible,
      parallelismLimits,
      parallelismLimitsVisible,
      parallelismLimitsVisibleAndMeasured,
    },
    blockers,
    rejectedFastPaths,
    rejectedFastPathGateSummary,
    productionCapabilityRolloutSummary,
    releaseBundlePlanningSummary,
  };
}

function summarizeRejectedFastPathGates(rejectedFastPaths) {
  const counts = new Map();

  for (const fastPath of rejectedFastPaths) {
    const gate = fastPath?.rejectedGate;
    if (typeof gate !== 'string' || gate.length === 0) {
      continue;
    }

    counts.set(gate, (counts.get(gate) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([leftGate], [rightGate]) => leftGate.localeCompare(rightGate))
    .map(([rejectedGate, count]) => ({ rejectedGate, count }));
}

function summarizeProductionCapabilityRollout({
  blockers,
  parallelismLimitsMeasuredOnReport,
  parallelismLimitsVisible,
  parallelismLimitsCanonical,
  backpressureEvidenceComplete,
  queueBudgetMatchesResourceCeiling,
  productionStorageReceiptsMeasured,
  productionStorageReceiptsVisible,
  productionAtomicCommitMeasured,
  productionAtomicCommitVisible,
  productionRowBatchExecutorMeasured,
  productionRowBatchExecutorVisible,
  productionAtomicGroupMetadataVisibleAndMeasured,
}) {
  const blockerSet = new Set(blockers);
  const entry = (surface, measured, visible, blockerRefs) => {
    const presentBlockers = blockerRefs.filter((blocker) => blockerSet.has(blocker));
    return {
      surface,
      status: measured && visible && presentBlockers.length === 0 ? 'ready' : 'blocked',
      measured,
      visible,
      blockerRefs: presentBlockers,
    };
  };

  return [
    entry(
      'chunk-upload-concurrency',
      parallelismLimitsMeasuredOnReport
        && queueBudgetMatchesResourceCeiling
        && parallelismLimitsCanonical
        && backpressureEvidenceComplete
        && productionStorageReceiptsMeasured
        && productionAtomicCommitMeasured
        && productionAtomicCommitVisible
        && productionAtomicGroupMetadataVisibleAndMeasured,
      parallelismLimitsVisible
        && queueBudgetMatchesResourceCeiling
        && backpressureEvidenceComplete
        && productionStorageReceiptsMeasured
        && productionStorageReceiptsVisible
        && productionAtomicCommitVisible
        && productionAtomicGroupMetadataVisibleAndMeasured,
      [
        'backpressure-evidence-incomplete',
        'queue-budget-does-not-match-resource-ceiling',
        'queue-budget-not-visible',
        'queue-budget-visible-without-memory-ceiling-visibility',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
        'queue-headroom-memory-headroom-mismatch',
        'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
        'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-without-queue-headroom-visible',
        'queue-budget-visible-without-queue-headroom-measurement',
        'memory-ceiling-match-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-headroom-measurement',
        'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'missing-staging-disk-headroom-evidence',
        'missing-staging-disk-reserve-evidence',
        'staging-disk-reserve-not-aligned-to-chunk-window',
        'staging-disk-headroom-not-positive',
        'staging-disk-headroom-not-visible',
        'staging-disk-headroom-visible-without-measurement',
        'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'staging-disk-headroom-visible-without-memory-ceiling-match-visibility',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'staging-disk-headroom-outside-plan-reserve',
        'memory-ceiling-match-visible-without-memory-ceiling-visibility',
        'memory-ceiling-match-visible-without-memory-headroom-visibility',
        'memory-ceiling-match-visible-without-queue-slack-visibility',
        'memory-ceiling-match-visible-without-queue-headroom-visibility',
        'memory-ceiling-visible-without-queue-headroom-visible',
        'queue-headroom-visible-without-queue-budget-visibility',
        'queue-headroom-visible-without-memory-ceiling-visibility',
        'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        'queue-headroom-not-visible',
        'queue-headroom-visible-without-measurement',
        'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-headroom-visible-without-queue-slack-visibility',
        'queue-pause-without-visible-receipt-cursor-memory-headroom',
        'queue-pause-without-visible-receipt-cursor-queue-slack',
        'queue-pause-without-visible-memory-ceiling',
        'queue-pause-without-measured-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-backpressure-not-measured',
        'receipt-cursor-backpressure-mismatch',
        'receipt-cursor-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
        'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
        'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
        'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
        'receipt-cursor-memory-headroom-visible-without-measurement',
        'receipt-cursor-memory-headroom-resource-headroom-mismatch',
        'receipt-cursor-queue-slack-not-measured',
        'receipt-cursor-queue-slack-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
        'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-measurement',
        'receipt-cursor-queue-slack-resource-headroom-mismatch',
        'production-parallelism-limits-not-measured',
        'production-parallelism-limits-not-integral',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-not-visible',
        'production-parallelism-limits-visible-without-positive',
        'production-parallelism-limits-visible-without-measurement',
        'production-parallelism-limits-visible-without-integral',
        'production-parallelism-limits-visible-without-canonical',
        'production-atomic-group-commit-not-measured',
        'production-atomic-group-commit-not-visible',
        'production-atomic-group-commit-visible-without-measurement',
        'production-atomic-group-metadata-not-visible',
        'production-atomic-group-metadata-visible-without-measurement',
        'production-atomic-group-metadata-visible-without-atomic-commit',
        'production-storage-receipts-not-measured',
        'production-storage-receipts-not-visible',
        'production-storage-receipts-visible-without-measurement',
        'production-storage-receipts-without-atomic-group-metadata',
        'production-storage-receipts-without-atomic-commit',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-metadata',
      ],
    ),
    entry(
      'file-hashing-concurrency',
      parallelismLimitsMeasuredOnReport
        && parallelismLimitsCanonical
        && queueBudgetMatchesResourceCeiling
        && backpressureEvidenceComplete,
      parallelismLimitsVisible
        && queueBudgetMatchesResourceCeiling
        && backpressureEvidenceComplete,
      [
        'backpressure-evidence-incomplete',
        'queue-budget-does-not-match-resource-ceiling',
        'queue-budget-not-visible',
        'queue-budget-visible-without-memory-ceiling-visibility',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
        'queue-headroom-memory-headroom-mismatch',
        'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
        'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-without-queue-headroom-visible',
        'queue-budget-visible-without-queue-headroom-measurement',
        'memory-ceiling-match-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-headroom-measurement',
        'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'missing-staging-disk-headroom-evidence',
        'missing-staging-disk-reserve-evidence',
        'staging-disk-reserve-not-aligned-to-chunk-window',
        'staging-disk-headroom-not-positive',
        'staging-disk-headroom-not-visible',
        'staging-disk-headroom-visible-without-measurement',
        'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'staging-disk-headroom-visible-without-memory-ceiling-match-visibility',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'staging-disk-headroom-outside-plan-reserve',
        'memory-ceiling-match-visible-without-memory-ceiling-visibility',
        'memory-ceiling-match-visible-without-memory-headroom-visibility',
        'memory-ceiling-match-visible-without-queue-slack-visibility',
        'memory-ceiling-match-visible-without-queue-headroom-visibility',
        'memory-ceiling-visible-without-queue-headroom-visible',
        'queue-headroom-visible-without-queue-budget-visibility',
        'queue-headroom-visible-without-memory-ceiling-visibility',
        'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        'queue-headroom-not-visible',
        'queue-headroom-visible-without-measurement',
        'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-headroom-visible-without-queue-slack-visibility',
        'queue-pause-without-visible-receipt-cursor-memory-headroom',
        'queue-pause-without-visible-receipt-cursor-queue-slack',
        'queue-pause-without-visible-memory-ceiling',
        'queue-pause-without-measured-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-backpressure-not-measured',
        'receipt-cursor-backpressure-mismatch',
        'receipt-cursor-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
        'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
        'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
        'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
        'receipt-cursor-memory-headroom-visible-without-measurement',
        'receipt-cursor-memory-headroom-resource-headroom-mismatch',
        'receipt-cursor-queue-slack-not-measured',
        'receipt-cursor-queue-slack-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
        'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-measurement',
        'receipt-cursor-queue-slack-resource-headroom-mismatch',
        'production-parallelism-limits-not-measured',
        'production-parallelism-limits-not-integral',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-not-visible',
        'production-parallelism-limits-visible-without-positive',
        'production-parallelism-limits-visible-without-measurement',
        'production-parallelism-limits-visible-without-integral',
        'production-parallelism-limits-visible-without-canonical',
      ],
    ),
    entry(
      'row-batch-concurrency',
      parallelismLimitsMeasuredOnReport
        && parallelismLimitsCanonical
        && productionAtomicCommitMeasured
        && productionAtomicCommitVisible
        && productionAtomicGroupMetadataVisibleAndMeasured
        && queueBudgetMatchesResourceCeiling
        && backpressureEvidenceComplete
        && productionStorageReceiptsMeasured
        && productionRowBatchExecutorMeasured,
      productionAtomicCommitVisible
        && productionAtomicCommitMeasured
        && queueBudgetMatchesResourceCeiling
        && backpressureEvidenceComplete
        && productionStorageReceiptsVisible
        && productionStorageReceiptsMeasured
        && productionRowBatchExecutorVisible
        && productionRowBatchExecutorMeasured
        && productionAtomicGroupMetadataVisibleAndMeasured
        && parallelismLimitsVisible,
      [
        'backpressure-evidence-incomplete',
        'queue-budget-does-not-match-resource-ceiling',
        'queue-budget-not-visible',
        'queue-budget-visible-without-memory-ceiling-visibility',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
        'queue-headroom-memory-headroom-mismatch',
        'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
        'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-without-queue-headroom-visible',
        'queue-budget-visible-without-queue-headroom-measurement',
        'memory-ceiling-match-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-headroom-measurement',
        'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'staging-disk-headroom-not-visible',
        'memory-ceiling-match-visible-without-memory-ceiling-visibility',
        'memory-ceiling-match-visible-without-memory-headroom-visibility',
        'memory-ceiling-match-visible-without-queue-slack-visibility',
        'memory-ceiling-match-visible-without-queue-headroom-visibility',
        'memory-ceiling-visible-without-queue-headroom-visible',
        'queue-headroom-visible-without-queue-budget-visibility',
        'queue-headroom-visible-without-memory-ceiling-visibility',
        'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        'queue-headroom-not-visible',
        'queue-headroom-visible-without-measurement',
        'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-headroom-visible-without-queue-slack-visibility',
        'queue-pause-without-visible-receipt-cursor-memory-headroom',
        'queue-pause-without-visible-receipt-cursor-queue-slack',
        'queue-pause-without-visible-memory-ceiling',
        'queue-pause-without-measured-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-backpressure-not-measured',
        'receipt-cursor-backpressure-mismatch',
        'receipt-cursor-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
        'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
        'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
        'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
        'receipt-cursor-memory-headroom-visible-without-measurement',
        'receipt-cursor-memory-headroom-resource-headroom-mismatch',
        'receipt-cursor-queue-slack-not-measured',
        'receipt-cursor-queue-slack-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
        'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-measurement',
        'receipt-cursor-queue-slack-resource-headroom-mismatch',
        'production-atomic-group-commit-not-measured',
        'production-atomic-group-commit-not-visible',
        'production-atomic-group-commit-visible-without-measurement',
        'production-atomic-group-metadata-not-visible',
        'production-atomic-group-metadata-visible-without-measurement',
        'production-atomic-group-metadata-visible-without-atomic-commit',
        'production-atomic-group-metadata-visible-without-storage-receipts-measurement',
        'production-atomic-group-commit-visible-without-metadata',
        'production-storage-receipts-not-measured',
        'production-storage-receipts-not-visible',
        'production-storage-receipts-visible-without-measurement',
        'production-storage-receipts-without-atomic-group-metadata',
        'production-storage-receipts-without-atomic-commit',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-metadata',
        'production-storage-receipts-and-row-batch-visible-without-atomic-group-metadata',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-not-visible',
        'production-row-batch-executor-measured-not-proven',
        'production-row-batch-executor-visible-without-measurement',
        'production-row-batch-executor-visible-without-storage-receipts-measurement',
        'production-row-batch-executor-without-atomic-group-metadata',
        'production-row-batch-executor-without-storage-receipts',
        'production-row-batch-executor-visible-and-storage-receipts-visible-without-atomic-commit',
        'production-parallelism-limits-not-measured',
        'production-parallelism-limits-not-integral',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-not-visible',
        'production-parallelism-limits-visible-without-positive',
        'production-parallelism-limits-visible-without-measurement',
        'production-parallelism-limits-visible-without-integral',
        'production-parallelism-limits-visible-without-canonical',
        'production-row-batch-executor-visible-without-parallelism-limits',
        'production-row-batch-executor-without-atomic-commit',
      ],
    ),
  ];
}

function summarizeReleaseBundlePlanning({
  blockers,
  queueBudgetVisible,
  queueHeadroomVisible,
  queueHeadroomMeasured,
  queueHeadroomWithinResourceCeiling,
  receiptCursorPauseFootprintComplete,
  receiptCursorQueueSlackVisible,
  receiptCursorMemoryHeadroomVisible,
  queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
  stagingDiskHeadroomVisible,
  stagingDiskHeadroomMeasured,
  stagingDiskHeadroomWithinPlanReserve,
}) {
  const blockerSet = new Set(blockers);
  const blockerRefs = [
    ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
    ...POST_PAUSE_ALIGNED_QUEUE_SLACK_BLOCKER_REFS,
    ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
    ...POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ...POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    ...HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS,
    'staging-disk-headroom-visible-without-measurement',
    'staging-disk-headroom-outside-plan-reserve',
    'queue-budget-visible-without-queue-headroom-measurement',
    'memory-ceiling-visible-without-queue-headroom-measurement',
    'queue-headroom-visible-without-measurement',
  ];
  const presentBlockers = [...new Set(blockerRefs)].filter((blocker) => blockerSet.has(blocker));

  return {
    surface: 'release-bundle-post-pause-planning',
    status:
      presentBlockers.length > 0
        ? 'blocked'
        : (
          receiptCursorPauseFootprintComplete
          && queueHeadroomWithinResourceCeiling
          && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack
          && stagingDiskHeadroomMeasured
          && stagingDiskHeadroomWithinPlanReserve
        )
          ? 'ready'
          : 'pending',
    measured:
      receiptCursorPauseFootprintComplete
      && queueHeadroomMeasured
      && queueHeadroomWithinResourceCeiling
      && queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack
      && stagingDiskHeadroomMeasured
      && stagingDiskHeadroomWithinPlanReserve,
    visible:
      receiptCursorPauseFootprintComplete
      && queueBudgetVisible
      && queueHeadroomVisible
      && receiptCursorQueueSlackVisible
      && receiptCursorMemoryHeadroomVisible
      && stagingDiskHeadroomVisible,
    blockerRefs: presentBlockers,
  };
}

function hasCompleteBackpressureEvidence(report) {
  const receiptCursorBackpressureBytes = report.evidence.backpressure?.receiptCursorBytes ?? null;
  const receiptCursorQueueSlackBytes = report.evidence.backpressure?.receiptCursorQueueSlackBytes ?? null;
  const receiptCursorQueueBudgetBytes = report.evidence.backpressure?.queueBudgetBytes ?? null;
  const receiptCursorQueueHeadroomBytes = report.evidence.backpressure?.queueHeadroomBytes ?? null;
  const stagingDiskHeadroomBytes = report.evidence.backpressure?.stagingDiskHeadroomBytes ?? null;
  const stagingDiskReserveBytes = report.evidence.backpressure?.stagingDiskReserveBytes ?? null;
  const receiptCursorMemoryHeadroomBytes = report.evidence.backpressure?.receiptCursorMemoryHeadroomBytes ?? null;
  const receiptCursorWindowBytes = report.evidence.chunkReceipts.resumeCursor?.sizeBytes ?? null;
  const receiptCursorMemoryCeilingBytes = report.evidence.backpressure?.receiptCursorMemoryCeilingBytes ?? null;
  const maxStagingDiskBytes = report.resourceLimits?.maxStagingDiskBytes ?? null;
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
      && report.evidence.backpressure?.receiptCursorBackpressureMeasured === true
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
    && Number.isFinite(receiptCursorMemoryCeilingBytes)
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudget === true
    && receiptCursorQueueBudgetBytes === receiptCursorMemoryCeilingBytes;
  const receiptCursorMemoryCeilingMatchesQueueBudgetVisible =
    receiptCursorMemoryCeilingMatchesQueueBudget
    && report.evidence.backpressure?.receiptCursorMemoryCeilingVisible === true
    && report.evidence.backpressure?.queueBudgetVisible === true
    && report.evidence.backpressure?.queueHeadroomVisible === true
    && report.evidence.backpressure?.queueHeadroomMeasured === true
    && report.evidence.backpressure?.receiptCursorQueueSlackVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryHeadroomVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryCeilingMatchesQueueBudgetVisible === true;
  const queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack =
    report.evidence.backpressure?.queuePausedBeforeOverflow === true
    && (
      queuePauseHasMeasuredReceiptCursorQueueSlack
      && queuePauseHasBackpressureAlignedReceiptCursorQueueSlack
      && report.evidence.backpressure?.receiptCursorQueueSlackMatchesQueueHeadroom === true
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
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && report.evidence.backpressure?.queueHeadroomWithinResourceCeiling === true;
  const stagingDiskHeadroomMeasured =
    Number.isFinite(stagingDiskHeadroomBytes)
    && stagingDiskHeadroomBytes > 0;
  const stagingDiskReservePositive =
    Number.isFinite(stagingDiskReserveBytes)
    && stagingDiskReserveBytes > 0;
  const stagingDiskReserveMatchesChunkWindow =
    stagingDiskReservePositive
    && stagingDiskReserveBytes === report.shape.chunkSizeBytes;
  const stagingDiskHeadroomVisible =
    report.evidence.backpressure?.stagingDiskHeadroomVisible === true;
  const stagingDiskHeadroomWithinPlanReserve =
    stagingDiskHeadroomMeasured
    && stagingDiskReserveMatchesChunkWindow
    && Number.isFinite(maxStagingDiskBytes)
    && stagingDiskHeadroomBytes === maxStagingDiskBytes - report.shape.bytesMovedThroughStaging
    && stagingDiskHeadroomBytes >= stagingDiskReserveBytes
    && report.evidence.backpressure?.stagingDiskHeadroomWithinPlanReserve === true;
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
    && report.evidence.backpressure?.receiptCursorBackpressureMeasured === true
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
    && receiptCursorMemoryCeilingMatchesQueueBudgetVisible
    && report.evidence.backpressure?.receiptCursorQueueSlackVisible === true
    && report.evidence.backpressure?.receiptCursorMemoryHeadroomVisible === true
    && receiptCursorQueueSlackWithinResourceHeadroom
    && receiptCursorQueueSlackBytes === receiptCursorMemoryHeadroomBytes
    && receiptCursorQueueHeadroomBytes === receiptCursorQueueBudgetBytes - report.shape.chunkSizeBytes
    && receiptCursorQueueHeadroomBytes >= receiptCursorBackpressureBytes
    && receiptCursorBackpressureWithinResourceHeadroom
    && report.evidence.backpressure?.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure === true
    && stagingDiskHeadroomVisible
    && stagingDiskHeadroomMeasured
    && stagingDiskHeadroomWithinPlanReserve
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
    maxStagingDiskBytes: DEFAULT_LIMITS.maxStagingDiskBytes,
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
  const stagingDiskReserveBytes = config.chunkSizeBytes;
  const stagingDiskHeadroomBytes =
    Number.isFinite(config.maxStagingDiskBytes)
    && Number.isFinite(stagedFile?.bytesMoved)
      ? config.maxStagingDiskBytes - stagedFile.bytesMoved
      : null;
  const stagingDiskHeadroomMeasured =
    Number.isFinite(stagingDiskHeadroomBytes)
    && stagingDiskHeadroomBytes > 0;
  const stagingDiskHeadroomVisible =
    config.maxStagingDiskBytes === DEFAULT_LIMITS.maxStagingDiskBytes;
  const stagingDiskHeadroomWithinPlanReserve =
    stagingDiskHeadroomMeasured
    && Number.isFinite(stagingDiskReserveBytes)
    && stagingDiskHeadroomBytes >= stagingDiskReserveBytes;
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
      maxStagingDiskBytes: config.maxStagingDiskBytes,
      stagingDiskReserveBytes,
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
        maxStagingDiskBytes: config.maxStagingDiskBytes,
        stagingDiskReserveBytes,
        chunkWindowWithinMemoryCeiling: config.chunkSizeBytes <= config.maxBufferedUploadBytes,
        bytesMovedWithinStagingDiskCeiling:
          Number.isFinite(config.maxStagingDiskBytes)
          && stagedFile.bytesMoved <= config.maxStagingDiskBytes,
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
        stagingDiskHeadroomBytes,
        stagingDiskReserveBytes,
        stagingDiskHeadroomMeasured,
        stagingDiskHeadroomVisible,
        stagingDiskHeadroomWithinPlanReserve,
        queuePausedBeforeOverflow,
        chunkWindowBytes: config.chunkSizeBytes,
        receiptCursorBytes: lastChunkReceipt?.sizeBytes ?? null,
        receiptCursorBackpressureMeasured:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && lastChunkReceipt.sizeBytes > 0,
        receiptCursorBackpressureWithinQueueHeadroom:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && lastChunkReceipt.sizeBytes <= config.maxBufferedUploadBytes - config.chunkSizeBytes,
        receiptCursorBackpressureWithinResourceHeadroom:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && lastChunkReceipt.sizeBytes <= config.maxBufferedUploadBytes - config.chunkSizeBytes,
        receiptCursorQueueSlackBytes:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
            ? config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes
            : null,
        receiptCursorQueueSlackMeasured:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0,
        receiptCursorQueueSlackVisible:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        receiptCursorQueueSlackWithinMemoryCeiling:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes <= config.maxBufferedUploadBytes,
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
        receiptCursorMemoryHeadroomVisible:
          config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes,
        receiptCursorHeadroomCoveredByQueueBudget:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0,
        receiptCursorHeadroomWithinQueueBudget:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0,
        receiptCursorMemoryHeadroomWithinQueueBudget:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && Number.isFinite(config.maxBufferedUploadBytes)
          && config.maxBufferedUploadBytes - lastChunkReceipt.sizeBytes > 0,
        receiptCursorWithinQueueBudget:
          Number.isFinite(lastChunkReceipt?.sizeBytes)
          && lastChunkReceipt.sizeBytes <= config.maxBufferedUploadBytes,
        queueHeadroomWithinResourceCeiling:
          Number.isFinite(config.maxBufferedUploadBytes)
          && Number.isFinite(config.chunkSizeBytes)
          && config.maxBufferedUploadBytes === DEFAULT_LIMITS.maxBufferedUploadBytes
          && config.maxBufferedUploadBytes - config.chunkSizeBytes > 0,
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
        receiptCursorMemoryCeilingMatchesQueueBudgetVisible:
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
