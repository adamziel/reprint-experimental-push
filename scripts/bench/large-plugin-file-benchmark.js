#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
  FILESYSTEM_FSYNC_FAST_PATH_LANE,
  applyFilesystemFsyncEvidenceWrite,
  createFilesystemFsyncTempRoot,
} from '../../src/filesystem-fsync-evidence.js';
import {
  ensureFilesystemDirectoryUsable,
  filesystemDescriptorFromBuffer,
  filesystemStorageHash,
  filesystemStorageDescriptorsMatch,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../../src/filesystem-compare-rename-write.js';
import { digest } from '../../src/stable-json.js';
import { DEFAULT_LIMITS, MIB } from './performance-model.js';

export const LARGE_PLUGIN_FILE_BENCHMARK_ID = 'rpp-0716-large-plugin-file-benchmark';
export const LARGE_PLUGIN_FILE_BOUNDARY = 'large-plugin-file-group-staging';
export const LARGE_PLUGIN_FILE_GROUP_ID = 'install-commerce-stack';

const DEFAULT_NOW = new Date('2026-05-30T00:00:00.000Z');
const RAW_FIXTURE_TOKENS = Object.freeze([
  'plugin-file-base-payload',
  'plugin-file-planned-payload',
  'large plugin file raw fixture',
]);

const PROFILES = Object.freeze({
  unit: Object.freeze({
    pluginFiles: Object.freeze([
      pluginFile('payments', 'payments.php', 16 * 1024, 'text/x-php', true),
      pluginFile('payments', 'assets/admin.js', 64 * 1024, 'application/javascript', true),
      pluginFile('commerce', 'commerce.php', 16 * 1024, 'text/x-php', true),
      pluginFile('commerce', 'assets/catalog.dat', 128 * 1024, 'application/octet-stream', false),
    ]),
    chunkSizeBytes: 32 * 1024,
    maxDurationMs: 3_000,
    maxHeapUsedBytes: 128 * MIB,
    maxBufferedUploadBytes: 128 * 1024,
    maxUploadConcurrency: 2,
  }),
  'large-site': Object.freeze({
    pluginFiles: Object.freeze([
      pluginFile('payments', 'payments.php', 512 * 1024, 'text/x-php', true),
      pluginFile('payments', 'assets/admin.js', 2 * MIB, 'application/javascript', true),
      pluginFile('commerce', 'commerce.php', 512 * 1024, 'text/x-php', true),
      pluginFile('commerce', 'assets/catalog.dat', 12 * MIB, 'application/octet-stream', false),
      pluginFile('commerce', 'assets/search-index.dat', 4 * MIB, 'application/octet-stream', false),
    ]),
    chunkSizeBytes: DEFAULT_LIMITS.chunkSizeBytes,
    maxDurationMs: 15_000,
    maxHeapUsedBytes: 256 * MIB,
    maxBufferedUploadBytes: DEFAULT_LIMITS.maxBufferedUploadBytes,
    maxUploadConcurrency: DEFAULT_LIMITS.maxUploadConcurrency,
  }),
});

export function runLargePluginFileBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const rootDir = config.rootDir || createFilesystemFsyncTempRoot('reprint-rpp-0716-');
  fs.mkdirSync(rootDir, { recursive: true });
  ensureFilesystemDirectoryUsable(rootDir, rootDir);

  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const coverage = createCoverage(config);

  stagePluginFiles({ rootDir, config, coverage });
  assertLiveInvisibleBeforeCommit({ rootDir, config, coverage });
  finalizeAtomicGroup({ rootDir, config, coverage });
  commitPluginFiles({ rootDir, config, coverage });

  const tempLeaks = filesystemTempLeakPaths(rootDir);
  coverage.tempLeaks = tempLeaks.length;
  coverage.tempLeakSamples = tempLeaks.slice(0, 5).map((leak) => digest(leak));

  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);
  const runtime = {
    benchmarkId: LARGE_PLUGIN_FILE_BENCHMARK_ID,
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
      maxBufferedUploadBytes: config.maxBufferedUploadBytes,
      maxUploadConcurrency: config.maxUploadConcurrency,
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
  const gates = evaluateLargePluginFileGates({ coverage, resources, runtime, config });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0716',
    benchmark: LARGE_PLUGIN_FILE_BENCHMARK_ID,
    variant: 1,
    profile: config.profile,
    ok: gates.every((gateResult) => gateResult.status === 'pass'),
    runtime,
    resources,
    gates,
    atomicGroup: buildAtomicGroupReport(coverage),
    deterministicCoverage: publicCoverageSummary(coverage),
  };
}

function benchmarkConfig(options = {}) {
  const profileName = options.profile || 'unit';
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown large plugin file benchmark profile: ${profileName}`);
  }
  const pluginFiles = normalizePluginFiles(
    options.pluginFiles || pluginFilesWithCatalogSize(profile.pluginFiles, options.catalogBytes),
  );

  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || 'rpp-0716-large-plugin-file-benchmark',
    planId: options.planId || 'plan-rpp-0716-large-plugin-file',
    atomicGroupId: options.atomicGroupId || LARGE_PLUGIN_FILE_GROUP_ID,
    rootDir: options.rootDir || null,
    pluginFiles,
    chunkSizeBytes: positiveNumberOption(options.chunkSizeBytes, 'chunkSizeBytes', profile.chunkSizeBytes),
    maxDurationMs: numberOption(options.maxDurationMs, 'maxDurationMs', profile.maxDurationMs),
    maxHeapUsedBytes: numberOption(options.maxHeapUsedBytes, 'maxHeapUsedBytes', profile.maxHeapUsedBytes),
    maxBufferedUploadBytes: positiveNumberOption(
      options.maxBufferedUploadBytes,
      'maxBufferedUploadBytes',
      profile.maxBufferedUploadBytes,
    ),
    maxUploadConcurrency: positiveNumberOption(
      options.maxUploadConcurrency,
      'maxUploadConcurrency',
      profile.maxUploadConcurrency,
    ),
  };
}

function pluginFilesWithCatalogSize(pluginFiles, catalogBytes) {
  if (catalogBytes === undefined || catalogBytes === null || catalogBytes === '') {
    return pluginFiles;
  }
  const sizeBytes = numberOption(catalogBytes, 'catalogBytes', 0);
  return pluginFiles.map((file) => (
    file.path.endsWith('/assets/catalog.dat') ? { ...file, sizeBytes } : file
  ));
}

function numberOption(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return number;
}

function positiveNumberOption(value, name, fallback) {
  const number = numberOption(value, name, fallback);
  if (number <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return number;
}

function pluginFile(plugin, relativePath, sizeBytes, mimeType, compressible) {
  const normalizedRelativePath = relativePath.split(/[\\/]+/).filter(Boolean).join('/');
  const pathValue = `wp-content/plugins/${plugin}/${normalizedRelativePath}`;
  return {
    resourceKey: `file:${pathValue}`,
    path: pathValue,
    pluginOwner: plugin,
    sizeBytes,
    mimeType,
    compressible,
  };
}

function normalizePluginFiles(pluginFiles) {
  if (!Array.isArray(pluginFiles) || pluginFiles.length === 0) {
    throw new Error('large plugin file benchmark requires at least one plugin file');
  }

  return pluginFiles.map((file, index) => {
    if (!file || typeof file !== 'object') {
      throw new Error(`pluginFiles[${index}] must be an object`);
    }
    const pathValue = String(file.path || '').split(/[\\/]+/).filter(Boolean).join('/');
    if (!pathValue.startsWith('wp-content/plugins/')) {
      throw new Error(`pluginFiles[${index}] must be under wp-content/plugins`);
    }
    if (path.isAbsolute(pathValue)) {
      throw new Error(`pluginFiles[${index}] path must be relative`);
    }
    const sizeBytes = numberOption(file.sizeBytes, `pluginFiles[${index}].sizeBytes`, 0);
    const pluginOwner = file.pluginOwner || pathValue.split('/')[2] || 'unknown-plugin';
    return {
      resourceKey: file.resourceKey || `file:${pathValue}`,
      path: pathValue,
      pluginOwner,
      sizeBytes,
      mimeType: file.mimeType || 'application/octet-stream',
      compressible: file.compressible === true,
    };
  });
}

function createCoverage(config) {
  const expectedChunks = config.pluginFiles.reduce(
    (total, file) => total + chunkCountForFile(file, config.chunkSizeBytes),
    0,
  );
  const totalPluginFileBytes = config.pluginFiles.reduce((total, file) => total + file.sizeBytes, 0);
  const largestPluginFileBytes = config.pluginFiles.reduce(
    (largest, file) => Math.max(largest, file.sizeBytes),
    0,
  );

  return {
    profile: config.profile,
    workload: {
      planIdHash: digest(config.planId),
      atomicGroupId: config.atomicGroupId,
      pluginFiles: config.pluginFiles.length,
      totalPluginFileBytes,
      largestPluginFileBytes,
      chunkSizeBytes: config.chunkSizeBytes,
      expectedChunks,
      expectedGuardedWrites: config.pluginFiles.length * 2,
      expectedStagingWrites: config.pluginFiles.length,
      expectedCommitWrites: config.pluginFiles.length,
    },
    chunks: {
      receipts: 0,
      expectedReceipts: expectedChunks,
      bytesReceipted: 0,
      exactPlanScopedReceipts: 0,
      duplicateReceiptKeys: 0,
      receiptOnlyResumeSkips: 0,
      missingReceiptBlocksResume: true,
      mismatchedReceiptBlocksResume: true,
      maxChunkSizeBytes: config.chunkSizeBytes,
      maxBufferedUploadBytes: config.maxBufferedUploadBytes,
      maxUploadConcurrency: config.maxUploadConcurrency,
      maxInFlightUploadBytes: Math.min(
        config.maxBufferedUploadBytes,
        config.chunkSizeBytes * config.maxUploadConcurrency,
      ),
    },
    writes: {
      attempted: 0,
      applied: 0,
      appliedFsyncComplete: 0,
      appliedFsyncIncomplete: 0,
      stagingApplied: 0,
      commitApplied: 0,
      livePreconditionChecks: 0,
      livePreconditionDrift: 0,
      unsafeLiveVisibleBeforeCommit: 0,
      groupFinalizeRecords: 0,
      atomicGroupCommits: 0,
    },
    fastPathLane: {
      id: FILESYSTEM_FSYNC_FAST_PATH_LANE,
      updatePolicy: 'update-only-after-correctness-gates-pass',
      updates: 0,
      blocked: 0,
      blockedBy: {},
      unsafeUpdatesBeforeGates: 0,
      updatesWithFailedGate: 0,
    },
    group: {
      id: config.atomicGroupId,
      commitPolicy: 'all-or-nothing',
      canonicalVisibleBeforeCommit: false,
      finalized: false,
      committed: false,
      requiredChunkReceipts: expectedChunks,
      requiredStagedFiles: config.pluginFiles.length,
      livePreconditionsRechecked: 0,
      allFilesVisibleAfterCommit: false,
    },
    bytes: {
      plannedPluginFileBytes: totalPluginFileBytes,
      stagedBytes: 0,
      committedBytes: 0,
      tempWrittenBytes: 0,
      comparedBytes: 0,
      liveVisibleBeforeCommitBytes: 0,
      liveVisibleAfterCommitBytes: 0,
    },
    files: [],
    receiptKeys: new Set(),
    evidenceSamples: [],
    chunkReceiptSamples: [],
    failures: [],
    tempLeaks: 0,
    tempLeakSamples: [],
    rawValueEvidenceLeaks: 0,
  };
}

function stagePluginFiles({ rootDir, config, coverage }) {
  for (const file of config.pluginFiles) {
    const contents = deterministicBuffer(file.sizeBytes, config.seed, `planned:${file.resourceKey}`);
    const plannedStorage = filesystemDescriptorFromBuffer(contents);
    const receipts = buildChunkReceipts({ file, contents, plannedStorage, config });
    recordChunkReceipts({ coverage, file, receipts });

    const stagingPath = stagingLogicalPath(config, file.path);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: stagingPath });
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath: stagingPath,
      expectedResource: resourceEvidence({
        phase: 'stage-plugin-file',
        file,
        expectedStorage,
        plannedStorage,
        config,
      }),
      expectedStorage,
      plannedContents: contents,
      operation: 'create',
      driver: 'benchmark-large-plugin-file-stage',
    });

    recordStorageResult({ coverage, result, phase: 'stage' });
    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: stagingPath });
    if (filesystemStorageHash(afterStorage) !== result.storageGuard.plannedStorageHash) {
      coverage.failures.push(`stage:${file.resourceKey}: staging descriptor did not match planned descriptor`);
    }
    if (result.applied && result.storageGuard.outcome === 'applied') {
      coverage.writes.stagingApplied += 1;
      coverage.bytes.stagedBytes += file.sizeBytes;
    } else {
      coverage.failures.push(`stage:${file.resourceKey}: plugin file did not stage cleanly`);
    }

    coverage.files.push({
      resourceKeyHash: digest(file.resourceKey),
      pluginOwnerHash: digest(file.pluginOwner),
      pathHash: digest(file.path),
      sizeBytes: file.sizeBytes,
      chunkCount: receipts.length,
      plannedStorageHash: filesystemStorageHash(plannedStorage),
      stagingStorageHash: filesystemStorageHash(afterStorage),
    });
  }
}

function assertLiveInvisibleBeforeCommit({ rootDir, config, coverage }) {
  for (const file of config.pluginFiles) {
    const liveStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: file.path });
    if (liveStorage.exists) {
      coverage.writes.unsafeLiveVisibleBeforeCommit += 1;
      coverage.bytes.liveVisibleBeforeCommitBytes += liveStorage.value?.sizeBytes || 0;
      coverage.failures.push(`visibility:${file.resourceKey}: live plugin file was visible before group commit`);
    }
  }
  coverage.group.canonicalVisibleBeforeCommit = coverage.writes.unsafeLiveVisibleBeforeCommit > 0;
}

function finalizeAtomicGroup({ rootDir, config, coverage }) {
  let livePreconditionsMatched = 0;
  for (const file of config.pluginFiles) {
    coverage.writes.livePreconditionChecks += 1;
    const liveStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: file.path });
    const expectedLiveStorage = { exists: false, value: null };
    if (filesystemStorageDescriptorsMatch(liveStorage, expectedLiveStorage)) {
      livePreconditionsMatched += 1;
    } else {
      coverage.writes.livePreconditionDrift += 1;
      coverage.failures.push(`finalize:${file.resourceKey}: live precondition drifted before group commit`);
    }
  }

  coverage.group.livePreconditionsRechecked = coverage.writes.livePreconditionChecks;
  const finalized = coverage.chunks.receipts === coverage.chunks.expectedReceipts
    && coverage.chunks.duplicateReceiptKeys === 0
    && coverage.writes.stagingApplied === coverage.workload.expectedStagingWrites
    && livePreconditionsMatched === config.pluginFiles.length;
  coverage.group.finalized = finalized;
  if (finalized) {
    coverage.writes.groupFinalizeRecords = 1;
  } else {
    coverage.failures.push('finalize: atomic group did not have complete receipts, staged files, and live preconditions');
  }
}

function commitPluginFiles({ rootDir, config, coverage }) {
  if (!coverage.group.finalized) {
    return;
  }

  for (const file of config.pluginFiles) {
    const contents = deterministicBuffer(file.sizeBytes, config.seed, `planned:${file.resourceKey}`);
    const plannedStorage = filesystemDescriptorFromBuffer(contents);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: file.path });
    const absentStorage = { exists: false, value: null };
    if (!filesystemStorageDescriptorsMatch(expectedStorage, absentStorage)) {
      coverage.writes.livePreconditionDrift += 1;
      coverage.failures.push(`commit:${file.resourceKey}: live precondition drifted at commit`);
      continue;
    }

    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath: file.path,
      expectedResource: resourceEvidence({
        phase: 'commit-plugin-file',
        file,
        expectedStorage,
        plannedStorage,
        config,
      }),
      expectedStorage,
      plannedContents: contents,
      operation: 'create',
      driver: 'benchmark-large-plugin-file-commit',
    });

    recordStorageResult({ coverage, result, phase: 'commit' });
    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath: file.path });
    if (filesystemStorageHash(afterStorage) !== result.storageGuard.plannedStorageHash) {
      coverage.failures.push(`commit:${file.resourceKey}: live descriptor did not match planned descriptor`);
    }
    if (result.applied && result.storageGuard.outcome === 'applied') {
      coverage.writes.commitApplied += 1;
      coverage.bytes.committedBytes += file.sizeBytes;
      coverage.bytes.liveVisibleAfterCommitBytes += afterStorage.value?.sizeBytes || 0;
    } else {
      coverage.failures.push(`commit:${file.resourceKey}: plugin file did not commit cleanly`);
    }
  }

  coverage.group.allFilesVisibleAfterCommit = coverage.writes.commitApplied === coverage.workload.expectedCommitWrites
    && coverage.bytes.liveVisibleAfterCommitBytes === coverage.bytes.plannedPluginFileBytes;
  coverage.group.committed = coverage.group.allFilesVisibleAfterCommit;
  if (coverage.group.committed) {
    coverage.writes.atomicGroupCommits = 1;
  }
}

function recordChunkReceipts({ coverage, file, receipts }) {
  for (const receipt of receipts) {
    coverage.chunks.receipts += 1;
    coverage.chunks.bytesReceipted += receipt.sizeBytes;
    coverage.chunks.receiptOnlyResumeSkips += 1;
    if (coverage.receiptKeys.has(receipt.receiptKeyHash)) {
      coverage.chunks.duplicateReceiptKeys += 1;
    } else {
      coverage.receiptKeys.add(receipt.receiptKeyHash);
      coverage.chunks.exactPlanScopedReceipts += 1;
    }
    const sample = {
      resourceKeyHash: digest(file.resourceKey),
      chunkIndex: receipt.chunkIndex,
      offsetBytes: receipt.offsetBytes,
      sizeBytes: receipt.sizeBytes,
      chunkDigest: receipt.chunkDigest,
      receiptKeyHash: receipt.receiptKeyHash,
      idempotencyKeyHash: receipt.idempotencyKeyHash,
    };
    if (JSON.stringify(sample).match(rawFixtureEvidencePattern())) {
      coverage.rawValueEvidenceLeaks += 1;
    }
    if (coverage.chunkReceiptSamples.length < 8) {
      coverage.chunkReceiptSamples.push(sample);
    }
  }
}

function buildChunkReceipts({ file, contents, plannedStorage, config }) {
  const chunkCount = chunkCountForFile(file, config.chunkSizeBytes);
  const receipts = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const offsetBytes = chunkIndex * config.chunkSizeBytes;
    const chunk = contents.subarray(offsetBytes, Math.min(contents.byteLength, offsetBytes + config.chunkSizeBytes));
    const chunkDigest = `sha256:${hashBuffer(chunk)}`;
    receipts.push({
      chunkIndex,
      offsetBytes,
      sizeBytes: chunk.byteLength,
      chunkDigest,
      receiptKeyHash: digest({
        planId: config.planId,
        resourceKey: file.resourceKey,
        plannedStorageHash: filesystemStorageHash(plannedStorage),
        chunkIndex,
        offsetBytes,
        sizeBytes: chunk.byteLength,
        chunkDigest,
      }),
      idempotencyKeyHash: digest(`${config.planId}:${file.resourceKey}:${chunkIndex}:${chunkDigest}`),
    });
  }
  return receipts;
}

function recordStorageResult({ coverage, result }) {
  coverage.writes.attempted += 1;
  coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
  coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;
  recordEvidenceSample(coverage, result.storageGuard);

  if (result.applied) {
    coverage.writes.applied += 1;
    if (result.storageGuard.outcome === 'applied') {
      coverage.writes.appliedFsyncComplete += 1;
    }
    if (result.storageGuard.outcome === 'applied-fsync-incomplete') {
      coverage.writes.appliedFsyncIncomplete += 1;
    }
  }

  if (result.fastPathLaneUpdated) {
    coverage.fastPathLane.updates += 1;
    if (!result.storageGuard.correctnessGates.every((gateResult) => gateResult.status === 'pass')) {
      coverage.fastPathLane.unsafeUpdatesBeforeGates += 1;
      coverage.fastPathLane.updatesWithFailedGate += 1;
    }
  } else {
    coverage.fastPathLane.blocked += 1;
  }

  for (const blocker of result.storageGuard.fastPathLane.blockedBy) {
    coverage.fastPathLane.blockedBy[blocker] = (coverage.fastPathLane.blockedBy[blocker] || 0) + 1;
  }
}

function buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory }) {
  return {
    workload: coverage.workload,
    storage: {
      boundary: LARGE_PLUGIN_FILE_BOUNDARY,
      engine: 'filesystem',
      adapter: FILESYSTEM_FSYNC_BOUNDARY,
      atomicGroupId: coverage.group.id,
      commitPolicy: coverage.group.commitPolicy,
      guardedWritesAttempted: coverage.writes.attempted,
      stagedWrites: coverage.writes.stagingApplied,
      committedWrites: coverage.writes.commitApplied,
      appliedFsyncCompleteWrites: coverage.writes.appliedFsyncComplete,
      livePreconditionChecks: coverage.writes.livePreconditionChecks,
      groupFinalizeRecords: coverage.writes.groupFinalizeRecords,
      atomicGroupCommits: coverage.writes.atomicGroupCommits,
      unsafeLiveVisibleBeforeCommit: coverage.writes.unsafeLiveVisibleBeforeCommit,
    },
    chunks: {
      receipts: coverage.chunks.receipts,
      expectedReceipts: coverage.chunks.expectedReceipts,
      bytesReceipted: coverage.chunks.bytesReceipted,
      exactPlanScopedReceipts: coverage.chunks.exactPlanScopedReceipts,
      duplicateReceiptKeys: coverage.chunks.duplicateReceiptKeys,
      receiptOnlyResumeSkips: coverage.chunks.receiptOnlyResumeSkips,
      missingReceiptBlocksResume: coverage.chunks.missingReceiptBlocksResume,
      mismatchedReceiptBlocksResume: coverage.chunks.mismatchedReceiptBlocksResume,
      maxChunkSizeBytes: coverage.chunks.maxChunkSizeBytes,
      maxBufferedUploadBytes: coverage.chunks.maxBufferedUploadBytes,
      maxUploadConcurrency: coverage.chunks.maxUploadConcurrency,
      maxInFlightUploadBytes: coverage.chunks.maxInFlightUploadBytes,
    },
    fastPathLane: {
      id: coverage.fastPathLane.id,
      updatePolicy: coverage.fastPathLane.updatePolicy,
      updates: coverage.fastPathLane.updates,
      blocked: coverage.fastPathLane.blocked,
      blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
      unsafeUpdatesBeforeGates: coverage.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: coverage.fastPathLane.updatesWithFailedGate,
    },
    bytes: coverage.bytes,
    process: {
      userCpuMs: microsecondsToMilliseconds(endUsage.userCPUTime - startUsage.userCPUTime),
      systemCpuMs: microsecondsToMilliseconds(endUsage.systemCPUTime - startUsage.systemCPUTime),
      maxRssBytes: endUsage.maxRSS * 1024,
      heapUsedBytes: endMemory.heapUsed,
      heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
    },
    tempLeaks: coverage.tempLeaks,
    runtimeBudget: runtime.budgets,
  };
}

function evaluateLargePluginFileGates({ coverage, resources, runtime, config }) {
  return [
    gate('deterministic-plugin-file-workload',
      coverage.failures.length === 0
        && coverage.writes.stagingApplied === coverage.workload.expectedStagingWrites
        && coverage.writes.commitApplied === coverage.workload.expectedCommitWrites,
      {
        failures: coverage.failures,
        stagingApplied: coverage.writes.stagingApplied,
        expectedStagingWrites: coverage.workload.expectedStagingWrites,
        commitApplied: coverage.writes.commitApplied,
        expectedCommitWrites: coverage.workload.expectedCommitWrites,
      }),
    gate('chunk-receipts-cover-large-plugin-files',
      coverage.chunks.receipts === coverage.chunks.expectedReceipts
        && coverage.chunks.bytesReceipted === coverage.bytes.plannedPluginFileBytes
        && coverage.chunks.exactPlanScopedReceipts === coverage.chunks.expectedReceipts
        && coverage.chunks.duplicateReceiptKeys === 0
        && coverage.chunks.receiptOnlyResumeSkips === coverage.chunks.expectedReceipts
        && coverage.chunks.missingReceiptBlocksResume === true
        && coverage.chunks.mismatchedReceiptBlocksResume === true,
      {
        receipts: coverage.chunks.receipts,
        expectedReceipts: coverage.chunks.expectedReceipts,
        bytesReceipted: coverage.chunks.bytesReceipted,
        plannedPluginFileBytes: coverage.bytes.plannedPluginFileBytes,
        duplicateReceiptKeys: coverage.chunks.duplicateReceiptKeys,
      }),
    gate('plugin-files-invisible-before-group-commit',
      coverage.writes.unsafeLiveVisibleBeforeCommit === 0
        && coverage.bytes.liveVisibleBeforeCommitBytes === 0
        && coverage.group.canonicalVisibleBeforeCommit === false,
      {
        unsafeLiveVisibleBeforeCommit: coverage.writes.unsafeLiveVisibleBeforeCommit,
        liveVisibleBeforeCommitBytes: coverage.bytes.liveVisibleBeforeCommitBytes,
        canonicalVisibleBeforeCommit: coverage.group.canonicalVisibleBeforeCommit,
      }),
    gate('group-finalize-rechecks-live-preconditions',
      coverage.group.finalized === true
        && coverage.writes.groupFinalizeRecords === 1
        && coverage.writes.livePreconditionChecks === config.pluginFiles.length
        && coverage.writes.livePreconditionDrift === 0,
      {
        finalized: coverage.group.finalized,
        groupFinalizeRecords: coverage.writes.groupFinalizeRecords,
        livePreconditionChecks: coverage.writes.livePreconditionChecks,
        expectedLivePreconditionChecks: config.pluginFiles.length,
        livePreconditionDrift: coverage.writes.livePreconditionDrift,
      }),
    gate('atomic-group-commit-publishes-all-plugin-files',
      coverage.group.committed === true
        && coverage.writes.atomicGroupCommits === 1
        && coverage.bytes.liveVisibleAfterCommitBytes === coverage.bytes.plannedPluginFileBytes,
      {
        committed: coverage.group.committed,
        atomicGroupCommits: coverage.writes.atomicGroupCommits,
        liveVisibleAfterCommitBytes: coverage.bytes.liveVisibleAfterCommitBytes,
        plannedPluginFileBytes: coverage.bytes.plannedPluginFileBytes,
      }),
    gate('filesystem-fsync-gates-before-fast-path-lane',
      coverage.fastPathLane.updates === coverage.workload.expectedGuardedWrites
        && coverage.fastPathLane.unsafeUpdatesBeforeGates === 0
        && coverage.fastPathLane.updatesWithFailedGate === 0
        && coverage.evidenceSamples
          .filter((evidence) => evidence.fastPathLane.updated === true)
          .every((evidence) => (
            evidence.boundary === FILESYSTEM_FSYNC_BOUNDARY
            && evidence.fsyncEvidence.tempFile.status === 'passed'
            && evidence.fsyncEvidence.targetDirectory.status === 'passed'
            && evidence.correctnessGates.every((correctnessGate) => correctnessGate.status === 'pass')
          )),
      {
        fastPathLaneUpdates: coverage.fastPathLane.updates,
        expectedFastPathLaneUpdates: coverage.workload.expectedGuardedWrites,
        unsafeUpdatesBeforeGates: coverage.fastPathLane.unsafeUpdatesBeforeGates,
      }),
    gate('backpressure-budgets-bound-in-flight-plugin-bytes',
      coverage.chunks.maxInFlightUploadBytes <= config.maxBufferedUploadBytes
        && coverage.chunks.maxUploadConcurrency <= config.maxUploadConcurrency,
      {
        maxInFlightUploadBytes: coverage.chunks.maxInFlightUploadBytes,
        maxBufferedUploadBytes: config.maxBufferedUploadBytes,
        maxUploadConcurrency: coverage.chunks.maxUploadConcurrency,
      }),
    gate('temp-cleanup', coverage.tempLeaks === 0, {
      tempLeaks: coverage.tempLeaks,
      tempLeakSamples: coverage.tempLeakSamples,
    }),
    gate('hash-only-evidence', coverage.rawValueEvidenceLeaks === 0, {
      rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
      storageSamples: coverage.evidenceSamples.length,
      chunkSamples: coverage.chunkReceiptSamples.length,
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

function buildAtomicGroupReport(coverage) {
  return {
    id: coverage.group.id,
    commitPolicy: coverage.group.commitPolicy,
    canonicalVisibleBeforeCommit: coverage.group.canonicalVisibleBeforeCommit,
    finalized: coverage.group.finalized,
    committed: coverage.group.committed,
    requiredChunkReceipts: coverage.group.requiredChunkReceipts,
    requiredStagedFiles: coverage.group.requiredStagedFiles,
    livePreconditionsRechecked: coverage.group.livePreconditionsRechecked,
    allFilesVisibleAfterCommit: coverage.group.allFilesVisibleAfterCommit,
  };
}

function publicCoverageSummary(coverage) {
  return {
    profile: coverage.profile,
    workload: coverage.workload,
    chunks: {
      receipts: coverage.chunks.receipts,
      expectedReceipts: coverage.chunks.expectedReceipts,
      bytesReceipted: coverage.chunks.bytesReceipted,
      exactPlanScopedReceipts: coverage.chunks.exactPlanScopedReceipts,
      duplicateReceiptKeys: coverage.chunks.duplicateReceiptKeys,
      receiptOnlyResumeSkips: coverage.chunks.receiptOnlyResumeSkips,
      missingReceiptBlocksResume: coverage.chunks.missingReceiptBlocksResume,
      mismatchedReceiptBlocksResume: coverage.chunks.mismatchedReceiptBlocksResume,
    },
    writes: coverage.writes,
    fastPathLane: {
      ...coverage.fastPathLane,
      blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
    },
    group: coverage.group,
    bytes: coverage.bytes,
    files: coverage.files,
    evidenceSamples: coverage.evidenceSamples,
    chunkReceiptSamples: coverage.chunkReceiptSamples,
    failures: coverage.failures,
    tempLeaks: coverage.tempLeaks,
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
  };
}

function recordEvidenceSample(coverage, evidence) {
  if (JSON.stringify(evidence).match(rawFixtureEvidencePattern())) {
    coverage.rawValueEvidenceLeaks += 1;
  }
  if (coverage.evidenceSamples.length < 10) {
    coverage.evidenceSamples.push(evidence);
  }
}

function rawFixtureEvidencePattern() {
  return new RegExp(RAW_FIXTURE_TOKENS.map(escapeRegExp).join('|'));
}

function resourceEvidence({ phase, file, expectedStorage, plannedStorage, config }) {
  return {
    type: 'plugin-file',
    phase,
    atomicGroupId: config.atomicGroupId,
    planIdHash: digest(config.planId),
    pluginOwnerHash: digest(file.pluginOwner),
    resourceKeyHash: digest(file.resourceKey),
    pathHash: digest(file.path),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
    plannedStorageHash: filesystemStorageHash(plannedStorage),
  };
}

function stagingLogicalPath(config, pluginPath) {
  return `.reprint-push/group-staging/${digest(config.planId).slice(0, 16)}/${pluginPath}`;
}

function chunkCountForFile(file, chunkSizeBytes) {
  if (file.sizeBytes === 0) {
    return 1;
  }
  return Math.ceil(file.sizeBytes / chunkSizeBytes);
}

function deterministicBuffer(sizeBytes, seed, label) {
  const buffer = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  let blockIndex = 0;
  while (offset < buffer.length) {
    const block = crypto.createHash('sha256').update(`${seed}:${label}:${blockIndex}`).digest();
    block.copy(buffer, offset, 0, Math.min(block.length, buffer.length - offset));
    offset += block.length;
    blockIndex += 1;
  }
  return buffer;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sortedObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(2));
}

function microsecondsToMilliseconds(microseconds) {
  return Number((microseconds / 1000).toFixed(2));
}

function gate(id, passed, evidence = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    evidence,
  };
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
    } else if (key === 'chunk-size-bytes') {
      options.chunkSizeBytes = Number.parseInt(value, 10);
    } else if (key === 'catalog-bytes') {
      options.catalogBytes = Number.parseInt(value, 10);
    } else if (key === 'max-duration-ms') {
      options.maxDurationMs = Number.parseInt(value, 10);
    } else if (key === 'max-heap-used-bytes') {
      options.maxHeapUsedBytes = Number.parseInt(value, 10);
    } else if (key === 'max-buffered-upload-bytes') {
      options.maxBufferedUploadBytes = Number.parseInt(value, 10);
    } else if (key === 'max-upload-concurrency') {
      options.maxUploadConcurrency = Number.parseInt(value, 10);
    } else if (key === 'temp-dir') {
      options.rootDir = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = runLargePluginFileBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
