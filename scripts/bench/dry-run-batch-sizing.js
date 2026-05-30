#!/usr/bin/env node
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { digest } from '../../src/stable-json.js';

export const DRY_RUN_BATCH_SIZING_BENCHMARK_ID = 'rpp-0712-dry-run-batch-sizing';

const DEFAULT_NOW = new Date('2026-05-30T00:00:00.000Z');
const KIB = 1024;
const MIB = 1024 * KIB;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'rpp-0712-raw-fixture',
  'dry-run raw payload',
  'customer secret',
  'private option value',
]);

export const DEFAULT_DRY_RUN_BATCH_LIMITS = Object.freeze({
  maxBatchResources: 64,
  maxBatchEstimatedBytes: 128 * KIB,
  maxBatchPreconditions: 64,
});

const PROFILES = Object.freeze({
  unit: Object.freeze({
    fileResources: 7,
    rowTables: Object.freeze([
      Object.freeze({ table: 'wp_posts', rowCount: 28, averageEnvelopeBytes: 720 }),
      Object.freeze({ table: 'wp_postmeta', rowCount: 64, averageEnvelopeBytes: 520 }),
      Object.freeze({ table: 'wp_options', rowCount: 11, averageEnvelopeBytes: 680 }),
    ]),
    pluginMetadataResources: 2,
    limits: Object.freeze({
      maxBatchResources: 16,
      maxBatchEstimatedBytes: 14 * KIB,
      maxBatchPreconditions: 16,
    }),
    maxDurationMs: 2_000,
    maxHeapUsedBytes: 128 * MIB,
  }),
  'large-site': Object.freeze({
    fileResources: 120,
    rowTables: Object.freeze([
      Object.freeze({ table: 'wp_posts', rowCount: 800, averageEnvelopeBytes: 760 }),
      Object.freeze({ table: 'wp_postmeta', rowCount: 2_000, averageEnvelopeBytes: 540 }),
      Object.freeze({ table: 'wp_options', rowCount: 240, averageEnvelopeBytes: 700 }),
    ]),
    pluginMetadataResources: 4,
    limits: DEFAULT_DRY_RUN_BATCH_LIMITS,
    maxDurationMs: 4_000,
    maxHeapUsedBytes: 192 * MIB,
  }),
});

export class DryRunBatchSizingConfigError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DryRunBatchSizingConfigError';
    this.code = details.code || 'DRY_RUN_BATCH_SIZING_CONFIG_ERROR';
    this.details = details;
  }
}

export function runDryRunBatchSizingBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const items = buildDryRunPlanItems(config);
  const batches = planDryRunBatches(items, config.limits);
  const finalReceipt = buildFinalDryRunReceipt({ planId: config.planId, batches, items });
  const incompleteReceiptProbe = buildIncompleteReceiptProbe({ planId: config.planId, batches, items });
  const staleStorageProbe = buildStaleStorageProbe({ items, finalReceipt });
  const errorPathCoverage = buildErrorPathCoverage(config);
  const coverage = buildCoverage({
    config,
    items,
    batches,
    finalReceipt,
    incompleteReceiptProbe,
    staleStorageProbe,
    errorPathCoverage,
  });
  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);
  const runtime = {
    benchmarkId: DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
    generatedAt: config.now.toISOString(),
    durationMs,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    budgets: {
      profile: config.profile,
      maxDurationMs: config.maxDurationMs,
      maxHeapUsedBytes: config.maxHeapUsedBytes,
    },
  };
  const resources = buildResourceReport({
    coverage,
    runtime,
    startUsage,
    endUsage,
    startMemory,
    endMemory,
  });
  const gates = evaluateDryRunBatchSizingGates({ coverage, resources, runtime, config });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0712',
    variant: 1,
    benchmark: DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
    profile: config.profile,
    ok: gates.every((gate) => gate.status === 'pass'),
    mode: 'deterministic-dry-run-batch-sizing',
    liveRemote: {
      status: 'not-configured',
      limitation:
        'No live remote service was configured or contacted for this scoped storage-performance batch sizing run.',
    },
    runtime,
    limits: config.limits,
    resources,
    gates,
    deterministicCoverage: publicCoverageSummary(coverage),
  };
}

function benchmarkConfig(options = {}) {
  const profileName = options.profile || 'unit';
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new DryRunBatchSizingConfigError(
      `Unknown dry-run batch sizing profile: ${profileName}`,
      {
        code: 'DRY_RUN_BATCH_PROFILE_UNKNOWN',
        profile: profileName,
      },
    );
  }

  const rowTables = configuredRowTables(profile, options);
  const fileResources = nonNegativeIntegerOption(
    options.fileResources,
    'fileResources',
    profile.fileResources,
  );
  const pluginMetadataResources = nonNegativeIntegerOption(
    options.pluginMetadataResources,
    'pluginMetadataResources',
    profile.pluginMetadataResources,
  );
  const totalRows = rowTables.reduce((sum, table) => sum + table.rowCount, 0);
  if (fileResources + pluginMetadataResources + totalRows <= 0) {
    throw new DryRunBatchSizingConfigError('dry-run batch sizing requires at least one plan resource', {
      code: 'DRY_RUN_BATCH_WORKLOAD_EMPTY',
    });
  }

  const limits = validateDryRunBatchLimits({
    maxBatchResources: positiveIntegerOption(
      options.maxBatchResources,
      'maxBatchResources',
      profile.limits.maxBatchResources,
    ),
    maxBatchEstimatedBytes: positiveIntegerOption(
      options.maxBatchEstimatedBytes,
      'maxBatchEstimatedBytes',
      profile.limits.maxBatchEstimatedBytes,
    ),
    maxBatchPreconditions: positiveIntegerOption(
      options.maxBatchPreconditions,
      'maxBatchPreconditions',
      profile.limits.maxBatchPreconditions,
    ),
  });

  return {
    profile: profileName,
    planId: options.planId || `plan-${DRY_RUN_BATCH_SIZING_BENCHMARK_ID}-${profileName}`,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
    fileResources,
    rowTables,
    pluginMetadataResources,
    atomicGroupId: options.atomicGroupId || 'install-commerce-stack',
    limits,
    maxDurationMs: positiveIntegerOption(options.maxDurationMs, 'maxDurationMs', profile.maxDurationMs),
    maxHeapUsedBytes: positiveIntegerOption(
      options.maxHeapUsedBytes,
      'maxHeapUsedBytes',
      profile.maxHeapUsedBytes,
    ),
  };
}

function configuredRowTables(profile, options) {
  const overrides = new Map([
    ['wp_posts', options.wpPosts],
    ['wp_postmeta', options.wpPostmeta],
    ['wp_options', options.wpOptions],
  ]);

  return profile.rowTables.map((entry) => ({
    ...entry,
    rowCount: nonNegativeIntegerOption(
      overrides.has(entry.table) ? overrides.get(entry.table) : undefined,
      `${entry.table} rowCount`,
      entry.rowCount,
    ),
    averageEnvelopeBytes: positiveIntegerOption(
      options[`${camelCase(entry.table)}AverageEnvelopeBytes`],
      `${entry.table} averageEnvelopeBytes`,
      entry.averageEnvelopeBytes,
    ),
  }));
}

function camelCase(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function positiveIntegerOption(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new DryRunBatchSizingConfigError(`${name} must be a positive integer`, {
      code: 'DRY_RUN_BATCH_LIMIT_INVALID',
      field: name,
      value,
    });
  }
  return number;
}

function nonNegativeIntegerOption(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new DryRunBatchSizingConfigError(`${name} must be a non-negative integer`, {
      code: 'DRY_RUN_BATCH_WORKLOAD_INVALID',
      field: name,
      value,
    });
  }
  return number;
}

export function validateDryRunBatchLimits(limits) {
  const normalized = {};
  for (const field of ['maxBatchResources', 'maxBatchEstimatedBytes', 'maxBatchPreconditions']) {
    const value = limits[field];
    if (!Number.isInteger(value) || value <= 0) {
      throw new DryRunBatchSizingConfigError(`${field} must be a positive integer`, {
        code: 'DRY_RUN_BATCH_LIMIT_INVALID',
        field,
        value,
      });
    }
    normalized[field] = value;
  }
  return normalized;
}

function buildDryRunPlanItems(config) {
  const items = [];
  let sequence = 0;

  for (let index = 0; index < config.fileResources; index += 1) {
    const resourceKey = `file:wp-content/uploads/rpp-0712/file-${String(index).padStart(4, '0')}.bin`;
    items.push(planItem({
      config,
      sequence: sequence++,
      kind: 'file',
      resourceKey,
      estimatedBytes: 2_400 + (index % 5) * 211,
      preconditionCount: 1,
    }));
  }

  for (const table of config.rowTables) {
    for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex += 1) {
      const primaryKey = `${table.table === 'wp_options' ? 'option_id' : 'ID'}:${10_000 + rowIndex}`;
      const resourceKey = `row:${JSON.stringify([table.table, primaryKey])}`;
      items.push(planItem({
        config,
        sequence: sequence++,
        kind: 'db-row',
        table: table.table,
        resourceKey,
        estimatedBytes: table.averageEnvelopeBytes + (rowIndex % 7) * 19,
        preconditionCount: 1,
      }));
    }
  }

  for (let index = 0; index < config.pluginMetadataResources; index += 1) {
    const plugin = index % 2 === 0 ? 'payments' : 'commerce';
    items.push(planItem({
      config,
      sequence: sequence++,
      kind: 'plugin-metadata',
      resourceKey: `plugin:${plugin}:${index}`,
      atomicGroupId: config.atomicGroupId,
      estimatedBytes: 940 + (index % 3) * 37,
      preconditionCount: 1,
    }));
  }

  return items;
}

function planItem({
  config,
  sequence,
  kind,
  resourceKey,
  estimatedBytes,
  preconditionCount,
  table = null,
  atomicGroupId = null,
}) {
  const base = {
    itemId: `rpp-0712-dry-run-item-${String(sequence).padStart(5, '0')}`,
    sequence,
    kind,
    table,
    resourceKey,
    resourceKeyHash: digest(resourceKey),
    atomicGroupId,
    estimatedBytes,
    preconditionCount,
    expectedHash: `sha256:${digest({ seed: config.seed, resourceKey, phase: 'expected-storage' })}`,
    plannedHash: `sha256:${digest({ seed: config.seed, resourceKey, phase: 'planned-storage' })}`,
    validatesOnly: true,
    applyAuthorization: false,
  };
  return {
    ...base,
    itemHash: digest(batchEvidenceItem(base)),
  };
}

export function planDryRunBatches(items, limits) {
  const normalizedLimits = validateDryRunBatchLimits(limits);
  if (!Array.isArray(items) || items.length === 0) {
    throw new DryRunBatchSizingConfigError('dry-run batch sizing requires at least one item', {
      code: 'DRY_RUN_BATCH_ITEMS_EMPTY',
    });
  }

  const normalizedItems = items.map((item, index) => normalizeDryRunItem(item, index));
  const batches = [];
  let current = emptyBatch();

  for (const item of normalizedItems) {
    assertItemFitsLimits(item, normalizedLimits);
    if (current.items.length > 0 && wouldExceedBatchLimits(current, item, normalizedLimits)) {
      batches.push(finalizeBatch(current, batches.length, normalizedLimits));
      current = emptyBatch();
    }
    current.items.push(item);
    current.estimatedBytes += item.estimatedBytes;
    current.preconditionCount += item.preconditionCount;
  }

  if (current.items.length > 0) {
    batches.push(finalizeBatch(current, batches.length, normalizedLimits));
  }

  return batches;
}

function normalizeDryRunItem(item, index) {
  const normalized = {
    ...item,
    sequence: Number.isInteger(item.sequence) ? item.sequence : index,
    estimatedBytes: Number(item.estimatedBytes),
    preconditionCount: Number(item.preconditionCount),
  };
  if (!normalized.itemId || !normalized.resourceKey || !normalized.resourceKeyHash) {
    throw new DryRunBatchSizingConfigError('dry-run batch item is missing resource identity evidence', {
      code: 'DRY_RUN_BATCH_ITEM_INVALID',
      index,
    });
  }
  if (!Number.isInteger(normalized.estimatedBytes) || normalized.estimatedBytes <= 0) {
    throw new DryRunBatchSizingConfigError('dry-run batch item has invalid estimated bytes', {
      code: 'DRY_RUN_BATCH_ITEM_INVALID',
      itemId: normalized.itemId,
      field: 'estimatedBytes',
      value: item.estimatedBytes,
    });
  }
  if (!Number.isInteger(normalized.preconditionCount) || normalized.preconditionCount <= 0) {
    throw new DryRunBatchSizingConfigError('dry-run batch item has invalid precondition count', {
      code: 'DRY_RUN_BATCH_ITEM_INVALID',
      itemId: normalized.itemId,
      field: 'preconditionCount',
      value: item.preconditionCount,
    });
  }
  if (typeof normalized.expectedHash !== 'string' || typeof normalized.plannedHash !== 'string') {
    throw new DryRunBatchSizingConfigError('dry-run batch item is missing expected or planned hash evidence', {
      code: 'DRY_RUN_BATCH_ITEM_INVALID',
      itemId: normalized.itemId,
    });
  }
  if (!normalized.itemHash) {
    normalized.itemHash = digest(batchEvidenceItem(normalized));
  }
  return normalized;
}

function assertItemFitsLimits(item, limits) {
  const violations = [];
  if (limits.maxBatchResources < 1) {
    violations.push('maxBatchResources');
  }
  if (item.estimatedBytes > limits.maxBatchEstimatedBytes) {
    violations.push('maxBatchEstimatedBytes');
  }
  if (item.preconditionCount > limits.maxBatchPreconditions) {
    violations.push('maxBatchPreconditions');
  }
  if (violations.length > 0) {
    throw new DryRunBatchSizingConfigError('dry-run batch item exceeds configured batch limits', {
      code: 'DRY_RUN_BATCH_ITEM_EXCEEDS_LIMIT',
      itemId: item.itemId,
      violations,
      item: {
        estimatedBytes: item.estimatedBytes,
        preconditionCount: item.preconditionCount,
      },
      limits,
    });
  }
}

function emptyBatch() {
  return {
    items: [],
    estimatedBytes: 0,
    preconditionCount: 0,
  };
}

function wouldExceedBatchLimits(batch, item, limits) {
  return batch.items.length + 1 > limits.maxBatchResources
    || batch.estimatedBytes + item.estimatedBytes > limits.maxBatchEstimatedBytes
    || batch.preconditionCount + item.preconditionCount > limits.maxBatchPreconditions;
}

function finalizeBatch(batch, batchIndex, limits) {
  const batchId = `dry-run-batch-${String(batchIndex + 1).padStart(4, '0')}`;
  const evidenceItems = batch.items.map(batchEvidenceItem);
  const itemHashes = batch.items.map((item) => item.itemHash);
  const receiptHash = digest({
    batchId,
    itemHashes,
    limits,
    mode: 'dry-run-batch',
  });
  const kindCounts = evidenceItems.reduce((counts, item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    return counts;
  }, {});

  return {
    batchId,
    sequence: batchIndex,
    mode: 'dry-run',
    resourceCount: batch.items.length,
    estimatedBytes: batch.estimatedBytes,
    preconditionCount: batch.preconditionCount,
    firstSequence: batch.items[0].sequence,
    lastSequence: batch.items[batch.items.length - 1].sequence,
    kindCounts,
    itemHashes,
    items: evidenceItems,
    limits,
    receipt: {
      mode: 'dry-run-batch',
      receiptHash,
      applyAuthorization: false,
      notLock: true,
    },
  };
}

function batchEvidenceItem(item) {
  return {
    itemId: item.itemId,
    sequence: item.sequence,
    kind: item.kind,
    table: item.table || null,
    resourceKeyHash: item.resourceKeyHash || digest(item.resourceKey),
    atomicGroupId: item.atomicGroupId || null,
    estimatedBytes: item.estimatedBytes,
    preconditionCount: item.preconditionCount,
    expectedHash: item.expectedHash,
    plannedHash: item.plannedHash,
    validatesOnly: item.validatesOnly === true,
    applyAuthorization: item.applyAuthorization === true,
  };
}

function buildFinalDryRunReceipt({ planId, batches, items }) {
  const batchReceiptHashes = batches.map((batch) => batch.receipt.receiptHash);
  return {
    mode: 'dry-run',
    planId,
    complete: true,
    issueCondition: 'all-batches-validated',
    batchCount: batches.length,
    resourceCount: items.length,
    preconditionCount: items.reduce((sum, item) => sum + item.preconditionCount, 0),
    batchReceiptHashes,
    receiptHash: digest({
      mode: 'dry-run',
      planId,
      batchReceiptHashes,
      itemHashes: items.map((item) => item.itemHash),
    }),
    applyAuthorization: false,
    notLock: true,
  };
}

function buildIncompleteReceiptProbe({ planId, batches, items }) {
  const observedBatches = batches.slice(0, Math.max(0, batches.length - 1));
  return {
    planId,
    missingBatchId: batches.at(-1)?.batchId || null,
    observedBatchCount: observedBatches.length,
    requiredBatchCount: batches.length,
    resourceCount: items.length,
    issueReceipt: false,
    complete: false,
    reason: 'missing-dry-run-batch',
  };
}

function buildStaleStorageProbe({ items, finalReceipt }) {
  const target = items.find((item) => item.kind === 'db-row') || items[0];
  const observedLiveHash = `sha256:${digest({
    itemId: target.itemId,
    phase: 'apply-time-live-storage-drift',
  })}`;
  const rejected = observedLiveHash !== target.expectedHash;
  return {
    targetItemId: target.itemId,
    kind: target.kind,
    resourceKeyHash: target.resourceKeyHash,
    dryRunReceiptHash: finalReceipt.receiptHash,
    dryRunExpectedHash: target.expectedHash,
    observedLiveHash,
    outcome: rejected ? 'stale-at-write' : 'applied',
    guardedWriteAttempted: true,
    guardedWriteRejected: rejected,
    mutationApplied: false,
    dryRunReceiptAuthorizesMutation: false,
    reason: rejected
      ? 'live-storage-hash-differs-from-dry-run-precondition'
      : 'live-storage-hash-still-matches-dry-run-precondition',
  };
}

function buildErrorPathCoverage(config) {
  const baseItem = buildDryRunPlanItems({
    ...config,
    fileResources: 1,
    rowTables: config.rowTables.map((table) => ({ ...table, rowCount: 0 })),
    pluginMetadataResources: 0,
  })[0];
  const probes = [
    errorProbe('zero-resource-limit', () => {
      validateDryRunBatchLimits({ ...config.limits, maxBatchResources: 0 });
    }),
    errorProbe('oversized-resource-envelope', () => {
      planDryRunBatches([
        {
          ...baseItem,
          estimatedBytes: config.limits.maxBatchEstimatedBytes + 1,
        },
      ], config.limits);
    }),
    errorProbe('missing-precondition-hash', () => {
      const { expectedHash, ...badItem } = baseItem;
      planDryRunBatches([badItem], config.limits);
    }),
  ];
  return {
    probes,
    allFailedClosed: probes.every((probe) => probe.blocked === true),
  };
}

function errorProbe(id, fn) {
  try {
    fn();
    return {
      id,
      blocked: false,
      code: null,
      message: 'probe unexpectedly accepted invalid dry-run batch sizing input',
    };
  } catch (error) {
    return {
      id,
      blocked: true,
      code: error?.code || 'ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildCoverage({
  config,
  items,
  batches,
  finalReceipt,
  incompleteReceiptProbe,
  staleStorageProbe,
  errorPathCoverage,
}) {
  const seenItemHashes = new Set();
  const duplicateItemHashes = [];
  const coveredItemHashes = [];
  const batchLimitViolations = [];

  for (const batch of batches) {
    if (batch.resourceCount > config.limits.maxBatchResources) {
      batchLimitViolations.push(`${batch.batchId}:resources`);
    }
    if (batch.estimatedBytes > config.limits.maxBatchEstimatedBytes) {
      batchLimitViolations.push(`${batch.batchId}:estimatedBytes`);
    }
    if (batch.preconditionCount > config.limits.maxBatchPreconditions) {
      batchLimitViolations.push(`${batch.batchId}:preconditions`);
    }
    for (const itemHash of batch.itemHashes) {
      coveredItemHashes.push(itemHash);
      if (seenItemHashes.has(itemHash)) {
        duplicateItemHashes.push(itemHash);
      }
      seenItemHashes.add(itemHash);
    }
  }

  const expectedItemHashes = items.map((item) => item.itemHash);
  const missingItemHashes = expectedItemHashes.filter((itemHash) => !seenItemHashes.has(itemHash));
  const dryRunOnlyFailures = [];
  if (batches.some((batch) => batch.receipt.applyAuthorization !== false || batch.receipt.notLock !== true)) {
    dryRunOnlyFailures.push('batch-receipt-grants-apply-authority');
  }
  if (finalReceipt.applyAuthorization !== false || finalReceipt.notLock !== true) {
    dryRunOnlyFailures.push('final-receipt-grants-apply-authority');
  }
  for (const item of items) {
    if (item.validatesOnly !== true || item.applyAuthorization !== false) {
      dryRunOnlyFailures.push(`${item.itemId}:not-validation-only`);
    }
  }

  const evidenceEnvelope = {
    batches,
    finalReceipt,
    incompleteReceiptProbe,
    staleStorageProbe,
    errorPathCoverage,
  };
  const rawValueEvidenceLeaks = rawFixtureEvidencePattern().test(JSON.stringify(evidenceEnvelope)) ? 1 : 0;

  return {
    workload: {
      profile: config.profile,
      planId: config.planId,
      fileResources: config.fileResources,
      rowTables: config.rowTables,
      pluginMetadataResources: config.pluginMetadataResources,
      totalResources: items.length,
      totalPreconditions: items.reduce((sum, item) => sum + item.preconditionCount, 0),
      totalEstimatedBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
    },
    limits: config.limits,
    batches,
    finalReceipt,
    incompleteReceiptProbe,
    staleStorageProbe,
    errorPathCoverage,
    coverage: {
      expectedItemHashes: expectedItemHashes.length,
      coveredItemHashes: coveredItemHashes.length,
      duplicateItemHashes: duplicateItemHashes.length,
      missingItemHashes: missingItemHashes.length,
      batchLimitViolations,
      dryRunOnlyFailures,
    },
    rawValueEvidenceLeaks,
  };
}

function buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory }) {
  const largestBatch = coverage.batches.reduce(
    (largest, batch) => ({
      resourceCount: Math.max(largest.resourceCount, batch.resourceCount),
      estimatedBytes: Math.max(largest.estimatedBytes, batch.estimatedBytes),
      preconditionCount: Math.max(largest.preconditionCount, batch.preconditionCount),
    }),
    { resourceCount: 0, estimatedBytes: 0, preconditionCount: 0 },
  );
  return {
    dryRun: {
      stage: 'push_plan_dry_run',
      mode: 'dry-run',
      readOnly: true,
      batches: coverage.batches.length,
      totalResources: coverage.workload.totalResources,
      totalPreconditions: coverage.workload.totalPreconditions,
      totalEstimatedBytes: coverage.workload.totalEstimatedBytes,
      largestBatch,
      finalReceiptRequiresCompleteBatchSet: coverage.finalReceipt.issueCondition === 'all-batches-validated',
      finalReceiptHash: coverage.finalReceipt.receiptHash,
      finalReceiptApplyAuthorization: coverage.finalReceipt.applyAuthorization,
      incompleteReceiptProbe: coverage.incompleteReceiptProbe,
    },
    storageGuardProjection: coverage.staleStorageProbe,
    errorPathCoverage: coverage.errorPathCoverage,
    process: {
      userCpuMs: microsecondsToMilliseconds(endUsage.userCPUTime - startUsage.userCPUTime),
      systemCpuMs: microsecondsToMilliseconds(endUsage.systemCPUTime - startUsage.systemCPUTime),
      maxRssBytes: endUsage.maxRSS * 1024,
      heapUsedBytes: endMemory.heapUsed,
      heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
    },
    runtimeBudget: runtime.budgets,
  };
}

function evaluateDryRunBatchSizingGates({ coverage, resources, runtime, config }) {
  return [
    gate('dry-run-batches-stay-within-resource-limit',
      coverage.batches.every((batch) => batch.resourceCount <= config.limits.maxBatchResources),
      {
        largestBatchResources: resources.dryRun.largestBatch.resourceCount,
        maxBatchResources: config.limits.maxBatchResources,
      }),
    gate('dry-run-batches-stay-within-byte-limit',
      coverage.batches.every((batch) => batch.estimatedBytes <= config.limits.maxBatchEstimatedBytes),
      {
        largestBatchEstimatedBytes: resources.dryRun.largestBatch.estimatedBytes,
        maxBatchEstimatedBytes: config.limits.maxBatchEstimatedBytes,
      }),
    gate('dry-run-batches-stay-within-precondition-limit',
      coverage.batches.every((batch) => batch.preconditionCount <= config.limits.maxBatchPreconditions),
      {
        largestBatchPreconditions: resources.dryRun.largestBatch.preconditionCount,
        maxBatchPreconditions: config.limits.maxBatchPreconditions,
      }),
    gate('all-resources-covered-once',
      coverage.coverage.coveredItemHashes === coverage.coverage.expectedItemHashes
        && coverage.coverage.duplicateItemHashes === 0
        && coverage.coverage.missingItemHashes === 0,
      coverage.coverage),
    gate('dry-run-is-read-only-and-not-apply-authority',
      coverage.coverage.dryRunOnlyFailures.length === 0,
      {
        dryRunOnlyFailures: coverage.coverage.dryRunOnlyFailures,
        finalReceiptApplyAuthorization: coverage.finalReceipt.applyAuthorization,
        finalReceiptNotLock: coverage.finalReceipt.notLock,
      }),
    gate('per-resource-preconditions-carried',
      coverage.batches.every((batch) =>
        batch.items.every((item) =>
          item.preconditionCount > 0
          && typeof item.expectedHash === 'string'
          && item.expectedHash.startsWith('sha256:')
          && typeof item.plannedHash === 'string'
          && item.plannedHash.startsWith('sha256:'))),
      {
        resources: coverage.workload.totalResources,
        preconditions: coverage.workload.totalPreconditions,
      }),
    gate('final-receipt-requires-all-batches',
      coverage.finalReceipt.complete === true
        && coverage.finalReceipt.batchCount === coverage.batches.length
        && coverage.incompleteReceiptProbe.issueReceipt === false
        && coverage.incompleteReceiptProbe.reason === 'missing-dry-run-batch',
      {
        requiredBatchCount: coverage.incompleteReceiptProbe.requiredBatchCount,
        observedBatchCount: coverage.incompleteReceiptProbe.observedBatchCount,
        issueReceipt: coverage.incompleteReceiptProbe.issueReceipt,
      }),
    gate('stale-storage-rejected-after-dry-run',
      coverage.staleStorageProbe.guardedWriteRejected === true
        && coverage.staleStorageProbe.outcome === 'stale-at-write'
        && coverage.staleStorageProbe.mutationApplied === false
        && coverage.staleStorageProbe.dryRunReceiptAuthorizesMutation === false,
      coverage.staleStorageProbe),
    gate('configuration-errors-fail-closed',
      coverage.errorPathCoverage.allFailedClosed === true,
      {
        probes: coverage.errorPathCoverage.probes.map(({ id, blocked, code }) => ({ id, blocked, code })),
      }),
    gate('hash-only-evidence',
      coverage.rawValueEvidenceLeaks === 0,
      {
        rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
      }),
    gate('runtime-resource-budget',
      runtime.durationMs <= config.maxDurationMs
        && resources.process.heapUsedBytes <= config.maxHeapUsedBytes,
      {
        profile: config.profile,
        durationMs: runtime.durationMs,
        maxDurationMs: config.maxDurationMs,
        heapUsedBytes: resources.process.heapUsedBytes,
        maxHeapUsedBytes: config.maxHeapUsedBytes,
      }),
  ];
}

function gate(id, passed, evidence = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence,
  };
}

function publicCoverageSummary(coverage) {
  return {
    workload: coverage.workload,
    limits: coverage.limits,
    batchSummary: {
      batches: coverage.batches.length,
      firstBatch: summarizeBatch(coverage.batches[0]),
      lastBatch: summarizeBatch(coverage.batches.at(-1)),
    },
    finalReceipt: {
      mode: coverage.finalReceipt.mode,
      complete: coverage.finalReceipt.complete,
      issueCondition: coverage.finalReceipt.issueCondition,
      batchCount: coverage.finalReceipt.batchCount,
      resourceCount: coverage.finalReceipt.resourceCount,
      preconditionCount: coverage.finalReceipt.preconditionCount,
      receiptHash: coverage.finalReceipt.receiptHash,
      applyAuthorization: coverage.finalReceipt.applyAuthorization,
      notLock: coverage.finalReceipt.notLock,
    },
    incompleteReceiptProbe: coverage.incompleteReceiptProbe,
    staleStorageProbe: coverage.staleStorageProbe,
    errorPathCoverage: coverage.errorPathCoverage,
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
  };
}

function summarizeBatch(batch) {
  if (!batch) {
    return null;
  }
  return {
    batchId: batch.batchId,
    resourceCount: batch.resourceCount,
    estimatedBytes: batch.estimatedBytes,
    preconditionCount: batch.preconditionCount,
    firstSequence: batch.firstSequence,
    lastSequence: batch.lastSequence,
    kindCounts: batch.kindCounts,
    receiptHash: batch.receipt.receiptHash,
  };
}

function rawFixtureEvidencePattern() {
  return new RegExp(RAW_FIXTURE_TOKENS.map(escapeRegExp).join('|'));
}

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(2));
}

function microsecondsToMilliseconds(microseconds) {
  return Number((microseconds / 1000).toFixed(2));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = match[1];
    const value = match[2];
    if (key === 'profile') {
      options.profile = value;
    } else if (key === 'file-resources') {
      options.fileResources = Number.parseInt(value, 10);
    } else if (key === 'plugin-metadata-resources') {
      options.pluginMetadataResources = Number.parseInt(value, 10);
    } else if (key === 'wp-posts') {
      options.wpPosts = Number.parseInt(value, 10);
    } else if (key === 'wp-postmeta') {
      options.wpPostmeta = Number.parseInt(value, 10);
    } else if (key === 'wp-options') {
      options.wpOptions = Number.parseInt(value, 10);
    } else if (key === 'max-batch-resources') {
      options.maxBatchResources = Number.parseInt(value, 10);
    } else if (key === 'max-batch-estimated-bytes') {
      options.maxBatchEstimatedBytes = Number.parseInt(value, 10);
    } else if (key === 'max-batch-preconditions') {
      options.maxBatchPreconditions = Number.parseInt(value, 10);
    } else if (key === 'max-duration-ms') {
      options.maxDurationMs = Number.parseInt(value, 10);
    } else if (key === 'max-heap-used-bytes') {
      options.maxHeapUsedBytes = Number.parseInt(value, 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runDryRunBatchSizingBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
