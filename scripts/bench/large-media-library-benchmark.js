#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
  applyFilesystemFsyncEvidenceWrite,
  createFilesystemFsyncTempRoot,
} from '../../src/filesystem-fsync-evidence.js';
import {
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../../src/filesystem-compare-rename-write.js';
import { digest } from '../../src/stable-json.js';
import { DEFAULT_LIMITS, MIB } from './performance-model.js';

export const LARGE_MEDIA_LIBRARY_BENCHMARK_ID = 'rpp-0715-large-media-library-benchmark';
export const LARGE_MEDIA_LIBRARY_FAST_PATH_LANE = 'large-media-library-fast-path';

const DEFAULT_NOW = new Date('2026-05-30T00:00:00.000Z');
const RAW_FIXTURE_TOKENS = Object.freeze([
  'media-base-payload',
  'media-planned-payload',
  'media-drift-payload',
  'large media raw fixture',
]);

const PROFILES = Object.freeze({
  unit: Object.freeze({
    updateMedia: 4,
    createMedia: 2,
    staleMedia: 1,
    tempFsyncFailureMedia: 1,
    directoryFsyncFailureMedia: 1,
    fileBytes: 4096,
    metadataRowsPerMedia: 3,
    maxDbBatchRows: DEFAULT_LIMITS.maxDbBatchRows,
    maxDurationMs: 3_000,
    maxHeapUsedBytes: 128 * MIB,
  }),
  'large-site': Object.freeze({
    updateMedia: 96,
    createMedia: 32,
    staleMedia: 8,
    tempFsyncFailureMedia: 4,
    directoryFsyncFailureMedia: 4,
    fileBytes: 96 * 1024,
    metadataRowsPerMedia: 4,
    maxDbBatchRows: DEFAULT_LIMITS.maxDbBatchRows,
    maxDurationMs: 12_000,
    maxHeapUsedBytes: 256 * MIB,
  }),
});

export function runLargeMediaLibraryBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const rootDir = config.rootDir || createFilesystemFsyncTempRoot('reprint-rpp-0715-');
  fs.mkdirSync(rootDir, { recursive: true });
  ensureFilesystemDirectoryUsable(rootDir, rootDir);

  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const coverage = createCoverage(config);

  setupExistingMedia({ rootDir, config, coverage });
  runMatchingMediaCoverage({ rootDir, config, coverage, kind: 'update', count: config.updateMedia });
  runMatchingMediaCoverage({ rootDir, config, coverage, kind: 'create', count: config.createMedia });
  runStaleMediaCoverage({ rootDir, config, coverage });
  runTempFsyncFailureMediaCoverage({ rootDir, config, coverage });
  runDirectoryFsyncFailureMediaCoverage({ rootDir, config, coverage });
  finalizeDbBatchCoverage({ config, coverage });

  const tempLeaks = filesystemTempLeakPaths(rootDir);
  coverage.tempLeaks = tempLeaks.length;
  coverage.tempLeakSamples = tempLeaks.slice(0, 5).map((leak) => digest(leak));

  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);
  const runtime = {
    benchmarkId: LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
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
      maxDbBatchRows: config.maxDbBatchRows,
    },
  };
  const resources = buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory });
  const gates = evaluateLargeMediaLibraryGates({ coverage, resources, runtime, config });
  const fastPathLane = buildFastPathLaneReport({ coverage, gates });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0715',
    benchmark: LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
    profile: config.profile,
    ok: gates.every((gate) => gate.status === 'pass'),
    runtime,
    resources,
    gates,
    fastPathLane,
    deterministicCoverage: publicCoverageSummary(coverage),
  };
}

function benchmarkConfig(options = {}) {
  const profileName = options.profile || 'unit';
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown large media library benchmark profile: ${profileName}`);
  }
  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || 'rpp-0715-large-media-library-benchmark',
    rootDir: options.rootDir || null,
    updateMedia: numberOption(options.updateMedia, 'updateMedia', profile.updateMedia),
    createMedia: numberOption(options.createMedia, 'createMedia', profile.createMedia),
    staleMedia: numberOption(options.staleMedia, 'staleMedia', profile.staleMedia),
    tempFsyncFailureMedia: numberOption(
      options.tempFsyncFailureMedia,
      'tempFsyncFailureMedia',
      profile.tempFsyncFailureMedia,
    ),
    directoryFsyncFailureMedia: numberOption(
      options.directoryFsyncFailureMedia,
      'directoryFsyncFailureMedia',
      profile.directoryFsyncFailureMedia,
    ),
    fileBytes: numberOption(options.fileBytes, 'fileBytes', profile.fileBytes),
    metadataRowsPerMedia: numberOption(
      options.metadataRowsPerMedia,
      'metadataRowsPerMedia',
      profile.metadataRowsPerMedia,
    ),
    maxDbBatchRows: numberOption(options.maxDbBatchRows, 'maxDbBatchRows', profile.maxDbBatchRows),
    maxDurationMs: numberOption(options.maxDurationMs, 'maxDurationMs', profile.maxDurationMs),
    maxHeapUsedBytes: numberOption(options.maxHeapUsedBytes, 'maxHeapUsedBytes', profile.maxHeapUsedBytes),
  };
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

function createCoverage(config) {
  const attemptedMedia = config.updateMedia
    + config.createMedia
    + config.staleMedia
    + config.tempFsyncFailureMedia
    + config.directoryFsyncFailureMedia;
  const expectedFastPathLaneUpdates = config.updateMedia + config.createMedia;
  const rowsPerMedia = rowsPerMediaItem(config);

  return {
    profile: config.profile,
    workload: {
      updateMedia: config.updateMedia,
      createMedia: config.createMedia,
      staleMedia: config.staleMedia,
      tempFsyncFailureMedia: config.tempFsyncFailureMedia,
      directoryFsyncFailureMedia: config.directoryFsyncFailureMedia,
      fileBytes: config.fileBytes,
      metadataRowsPerMedia: config.metadataRowsPerMedia,
      attemptedMedia,
      expectedFastPathLaneUpdates,
      expectedFastPathLaneBlocked: attemptedMedia - expectedFastPathLaneUpdates,
      expectedAttachmentRows: attemptedMedia,
      expectedMetadataRows: attemptedMedia * config.metadataRowsPerMedia,
      expectedRowPreconditions: attemptedMedia * rowsPerMedia,
      expectedLaneRowPreconditions: expectedFastPathLaneUpdates * rowsPerMedia,
    },
    media: {
      attempted: 0,
      applied: 0,
      appliedFsyncComplete: 0,
      appliedFsyncIncomplete: 0,
      staleAtWrite: 0,
      tempFsyncFailedBeforeRename: 0,
      stalePreserved: 0,
      tempFsyncFailurePreserved: 0,
      directoryFsyncFailureApplied: 0,
      unsafeRenameOnStale: 0,
      unsafeRenameAfterTempFsyncFailure: 0,
      postWriteStorageVerified: 0,
    },
    db: {
      attachmentRowsPreconditioned: 0,
      metadataRowsPreconditioned: 0,
      rowPreconditions: 0,
      rowPreconditionsAttachedToLaneUpdates: 0,
      missingExpectedRemoteHashes: 0,
      batches: [],
      batchCount: 0,
      maxBatchRowsObserved: 0,
      batchesOverLimit: 0,
    },
    fastPathLane: {
      id: LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
      updatePolicy: 'update-only-after-storage-and-row-correctness-gates-pass',
      evaluatedBeforeUpdate: true,
      attempted: attemptedMedia,
      updated: 0,
      blocked: 0,
      blockedBy: {},
      unsafeUpdatesBeforeGates: 0,
      updatesWithFailedGate: 0,
      updatesMissingRowPreconditions: 0,
    },
    bytes: {
      setupExistingBytes: 0,
      tempWrittenBytes: 0,
      comparedBytes: 0,
      fastPathLaneBytes: 0,
      fsyncIncompleteAppliedBytes: 0,
      driftPreservedBytes: 0,
      tempFsyncFailurePreservedBytes: 0,
    },
    tempLeaks: 0,
    tempLeakSamples: [],
    evidenceSamples: [],
    failures: [],
    rawValueEvidenceLeaks: 0,
  };
}

function setupExistingMedia({ rootDir, config, coverage }) {
  for (const kind of ['update', 'stale', 'temp-fsync-failure', 'directory-fsync-failure']) {
    const count = countForKind(config, kind);
    for (let index = 0; index < count; index += 1) {
      const logicalPath = mediaLogicalPath(kind, index);
      const absolutePath = path.join(rootDir, logicalPath);
      ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
      const contents = deterministicBuffer(config.fileBytes, config.seed, `${kind}:base:${index}`);
      fs.writeFileSync(absolutePath, contents);
      coverage.bytes.setupExistingBytes += contents.byteLength;
    }
  }
}

function runMatchingMediaCoverage({ rootDir, config, coverage, kind, count }) {
  for (let index = 0; index < count; index += 1) {
    const logicalPath = mediaLogicalPath(kind, index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `${kind}:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: mediaResourceEvidence(kind, index, logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: kind === 'create' ? 'create' : 'update',
      driver: 'benchmark-media-library-file',
    });
    const rowEvidence = mediaRowPreconditionEvidence({ kind, index, logicalPath, config });
    recordMediaResult({ coverage, result, rowEvidence });

    if (result.applied && result.fastPathLaneUpdated) {
      assertTargetHash({
        rootDir,
        logicalPath,
        expectedHash: result.storageGuard.plannedStorageHash,
        coverage,
        label: `${kind}:${index}`,
      });
      coverage.media.postWriteStorageVerified += 1;
    } else {
      coverage.failures.push(`${kind}:${index}: media file did not update the fast-path lane`);
    }
  }
}

function runStaleMediaCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.staleMedia; index += 1) {
    const logicalPath = mediaLogicalPath('stale', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `stale:planned:${index}`);
    const driftContents = deterministicBuffer(config.fileBytes, config.seed, `stale:drift:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: mediaResourceEvidence('stale', index, logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-media-library-file',
      afterTempFsync: ({ absolutePath }) => {
        fs.writeFileSync(absolutePath, driftContents);
      },
    });
    const rowEvidence = mediaRowPreconditionEvidence({ kind: 'stale', index, logicalPath, config });
    recordMediaResult({ coverage, result, rowEvidence });

    if (!result.applied && result.storageGuard.outcome === 'stale-at-write') {
      coverage.media.staleAtWrite += 1;
    } else {
      coverage.failures.push(`stale:${index}: drifted media storage was not rejected`);
    }
    if (result.storageGuard.renameAttempted === true) {
      coverage.media.unsafeRenameOnStale += 1;
      coverage.failures.push(`stale:${index}: stale media guard attempted rename`);
    }
    if (result.fastPathLaneUpdated) {
      coverage.failures.push(`stale:${index}: stale media storage updated the fast-path lane`);
    }

    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const driftHash = filesystemStorageHash(driftContents);
    if (filesystemStorageHash(afterStorage) === driftHash) {
      coverage.media.stalePreserved += 1;
      coverage.bytes.driftPreservedBytes += driftContents.byteLength;
    } else {
      coverage.failures.push(`stale:${index}: drifted media bytes were not preserved`);
    }
  }
}

function runTempFsyncFailureMediaCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.tempFsyncFailureMedia; index += 1) {
    const logicalPath = mediaLogicalPath('temp-fsync-failure', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `temp-fsync-failure:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: mediaResourceEvidence('temp-fsync-failure', index, logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-media-library-file',
      fsyncFileSync: () => {
        const error = new Error('fixture media temp fsync failure');
        error.code = 'EIO';
        throw error;
      },
    });
    const rowEvidence = mediaRowPreconditionEvidence({
      kind: 'temp-fsync-failure',
      index,
      logicalPath,
      config,
    });
    recordMediaResult({ coverage, result, rowEvidence });

    if (!result.applied && result.storageGuard.outcome === 'fsync-failed-before-rename') {
      coverage.media.tempFsyncFailedBeforeRename += 1;
    } else {
      coverage.failures.push(`temp-fsync-failure:${index}: temp fsync failure did not block rename`);
    }
    if (result.storageGuard.renameAttempted === true) {
      coverage.media.unsafeRenameAfterTempFsyncFailure += 1;
      coverage.failures.push(`temp-fsync-failure:${index}: rename happened after temp fsync failure`);
    }
    if (result.fastPathLaneUpdated) {
      coverage.failures.push(`temp-fsync-failure:${index}: temp fsync failure updated the fast-path lane`);
    }
    assertTargetHash({
      rootDir,
      logicalPath,
      expectedHash: filesystemStorageHash(expectedStorage),
      coverage,
      label: `temp-fsync-failure:${index}`,
    });
    coverage.media.tempFsyncFailurePreserved += 1;
    coverage.bytes.tempFsyncFailurePreservedBytes += config.fileBytes;
  }
}

function runDirectoryFsyncFailureMediaCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.directoryFsyncFailureMedia; index += 1) {
    const logicalPath = mediaLogicalPath('directory-fsync-failure', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `directory-fsync-failure:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: mediaResourceEvidence('directory-fsync-failure', index, logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-media-library-file',
      fsyncDirectorySync: () => {
        const error = new Error('fixture media directory fsync failure');
        error.code = 'EINVAL';
        throw error;
      },
    });
    const rowEvidence = mediaRowPreconditionEvidence({
      kind: 'directory-fsync-failure',
      index,
      logicalPath,
      config,
    });
    recordMediaResult({ coverage, result, rowEvidence });

    if (result.applied && result.storageGuard.outcome === 'applied-fsync-incomplete') {
      coverage.media.directoryFsyncFailureApplied += 1;
      coverage.bytes.fsyncIncompleteAppliedBytes += result.storageGuard.bytesWrittenToTemp;
    } else {
      coverage.failures.push(`directory-fsync-failure:${index}: directory fsync failure did not record incomplete apply`);
    }
    if (result.fastPathLaneUpdated) {
      coverage.failures.push(`directory-fsync-failure:${index}: directory fsync failure updated the fast-path lane`);
    }
    assertTargetHash({
      rootDir,
      logicalPath,
      expectedHash: result.storageGuard.plannedStorageHash,
      coverage,
      label: `directory-fsync-failure:${index}`,
    });
  }
}

function recordMediaResult({ coverage, result, rowEvidence }) {
  coverage.media.attempted += 1;
  coverage.db.attachmentRowsPreconditioned += rowEvidence.attachmentRows;
  coverage.db.metadataRowsPreconditioned += rowEvidence.metadataRows;
  coverage.db.rowPreconditions += rowEvidence.rowPreconditions;
  if (!rowEvidence.allRowsHaveExpectedRemoteHash) {
    coverage.db.missingExpectedRemoteHashes += 1;
  }

  coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
  coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;
  recordEvidenceSample(coverage, result.storageGuard, rowEvidence);

  if (result.applied) {
    coverage.media.applied += 1;
    if (result.storageGuard.outcome === 'applied') {
      coverage.media.appliedFsyncComplete += 1;
    }
    if (result.storageGuard.outcome === 'applied-fsync-incomplete') {
      coverage.media.appliedFsyncIncomplete += 1;
    }
  }

  const storageCorrectnessGatesHold = result.storageGuard.correctnessGates.every((gate) => gate.status === 'pass');
  const rowPreconditionsHold = rowEvidence.allRowsHaveExpectedRemoteHash
    && rowEvidence.rowPreconditions === rowsPerMediaItem({ metadataRowsPerMedia: rowEvidence.metadataRows });
  const laneMayUpdate = result.fastPathLaneUpdated && storageCorrectnessGatesHold && rowPreconditionsHold;

  if (laneMayUpdate) {
    coverage.fastPathLane.updated += 1;
    coverage.bytes.fastPathLaneBytes += result.storageGuard.bytesWrittenToTemp;
    coverage.db.rowPreconditionsAttachedToLaneUpdates += rowEvidence.rowPreconditions;
  } else {
    coverage.fastPathLane.blocked += 1;
  }

  if (result.fastPathLaneUpdated && !storageCorrectnessGatesHold) {
    coverage.fastPathLane.unsafeUpdatesBeforeGates += 1;
    coverage.fastPathLane.updatesWithFailedGate += 1;
  }
  if (result.fastPathLaneUpdated && !rowPreconditionsHold) {
    coverage.fastPathLane.updatesMissingRowPreconditions += 1;
  }

  for (const blocker of result.storageGuard.fastPathLane.blockedBy) {
    coverage.fastPathLane.blockedBy[blocker] = (coverage.fastPathLane.blockedBy[blocker] || 0) + 1;
  }
}

function finalizeDbBatchCoverage({ config, coverage }) {
  const batches = [
    ...dbBatchesForTable({
      table: 'wp_posts',
      rowKind: 'attachment',
      rows: coverage.db.attachmentRowsPreconditioned,
      maxDbBatchRows: config.maxDbBatchRows,
    }),
    ...dbBatchesForTable({
      table: 'wp_postmeta',
      rowKind: 'attachment-metadata',
      rows: coverage.db.metadataRowsPreconditioned,
      maxDbBatchRows: config.maxDbBatchRows,
    }),
  ];
  coverage.db.batches = batches;
  coverage.db.batchCount = batches.length;
  coverage.db.maxBatchRowsObserved = batches.reduce((max, batch) => Math.max(max, batch.rowCount), 0);
  coverage.db.batchesOverLimit = batches.filter((batch) => batch.rowCount > config.maxDbBatchRows).length;
}

function dbBatchesForTable({ table, rowKind, rows, maxDbBatchRows }) {
  const batches = [];
  let remaining = rows;
  let startRow = 0;
  while (remaining > 0) {
    const rowCount = Math.min(remaining, maxDbBatchRows);
    batches.push({
      table,
      rowKind,
      batchIndex: batches.length,
      rowCount,
      order: 'primary-key',
      preconditions: {
        kind: 'per-row-hash',
        count: rowCount,
      },
      idempotencyKeyHash: digest({
        benchmark: LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
        table,
        rowKind,
        startRow,
        rowCount,
      }),
      fastPathLane: LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
      commitPolicy: 'withhold-until-media-storage-gates-pass',
    });
    remaining -= rowCount;
    startRow += rowCount;
  }
  return batches;
}

function assertTargetHash({ rootDir, logicalPath, expectedHash, coverage, label }) {
  const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
  if (filesystemStorageHash(afterStorage) !== expectedHash) {
    coverage.failures.push(`${label}: target hash did not match expected descriptor`);
  }
}

function buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory }) {
  const processResources = {
    userCpuMs: microsecondsToMilliseconds(endUsage.userCPUTime - startUsage.userCPUTime),
    systemCpuMs: microsecondsToMilliseconds(endUsage.systemCPUTime - startUsage.systemCPUTime),
    maxRssBytes: endUsage.maxRSS * 1024,
    heapUsedBytes: endMemory.heapUsed,
    heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
  };

  return {
    workload: coverage.workload,
    storage: {
      boundary: FILESYSTEM_FSYNC_BOUNDARY,
      engine: 'filesystem',
      adapter: 'filesystem-compare-rename-fsync',
      mediaDriver: 'benchmark-media-library-file',
      comparedFields: ['exists', 'type', 'sizeBytes', 'contentHash'],
      fsyncStrategy: 'temp-file-before-rename-and-directory-after-rename',
      visibilityBoundary: 'same-directory-rename-after-temp-fsync',
      mediaWritesAttempted: coverage.media.attempted,
      appliedMediaWrites: coverage.media.applied,
      appliedFsyncCompleteMediaWrites: coverage.media.appliedFsyncComplete,
      appliedFsyncIncompleteMediaWrites: coverage.media.appliedFsyncIncomplete,
      staleAtWriteMediaWrites: coverage.media.staleAtWrite,
      tempFsyncFailedBeforeRenameMediaWrites: coverage.media.tempFsyncFailedBeforeRename,
      unsafeRenameOnStaleMediaWrites: coverage.media.unsafeRenameOnStale,
      unsafeRenameAfterTempFsyncFailureMediaWrites: coverage.media.unsafeRenameAfterTempFsyncFailure,
      postWriteStorageVerified: coverage.media.postWriteStorageVerified,
    },
    database: {
      tables: ['wp_posts', 'wp_postmeta'],
      attachmentRowsPreconditioned: coverage.db.attachmentRowsPreconditioned,
      metadataRowsPreconditioned: coverage.db.metadataRowsPreconditioned,
      rowPreconditions: coverage.db.rowPreconditions,
      rowPreconditionsAttachedToLaneUpdates: coverage.db.rowPreconditionsAttachedToLaneUpdates,
      missingExpectedRemoteHashes: coverage.db.missingExpectedRemoteHashes,
      batches: coverage.db.batches,
      batchCount: coverage.db.batchCount,
      maxBatchRowsObserved: coverage.db.maxBatchRowsObserved,
      maxDbBatchRows: runtime.budgets.maxDbBatchRows,
      batchesOverLimit: coverage.db.batchesOverLimit,
    },
    fastPathLane: {
      id: coverage.fastPathLane.id,
      updatePolicy: coverage.fastPathLane.updatePolicy,
      evaluatedBeforeUpdate: coverage.fastPathLane.evaluatedBeforeUpdate,
      updates: coverage.fastPathLane.updated,
      blocked: coverage.fastPathLane.blocked,
      blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
      unsafeUpdatesBeforeGates: coverage.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: coverage.fastPathLane.updatesWithFailedGate,
      updatesMissingRowPreconditions: coverage.fastPathLane.updatesMissingRowPreconditions,
    },
    bytes: coverage.bytes,
    process: processResources,
    tempLeaks: coverage.tempLeaks,
    runtimeBudget: runtime.budgets,
  };
}

function evaluateLargeMediaLibraryGates({ coverage, resources, runtime, config }) {
  return [
    gate('deterministic-media-library-behavior', coverage.failures.length === 0, {
      failures: coverage.failures,
      attempted: coverage.media.attempted,
      applied: coverage.media.applied,
      fastPathLaneUpdates: coverage.fastPathLane.updated,
    }),
    gate('fast-path-lane-updates-only-after-correctness-gates',
      coverage.fastPathLane.updated === coverage.workload.expectedFastPathLaneUpdates
        && coverage.fastPathLane.blocked === coverage.workload.expectedFastPathLaneBlocked
        && coverage.fastPathLane.unsafeUpdatesBeforeGates === 0
        && coverage.fastPathLane.updatesWithFailedGate === 0
        && coverage.fastPathLane.updatesMissingRowPreconditions === 0,
      {
        expectedFastPathLaneUpdates: coverage.workload.expectedFastPathLaneUpdates,
        fastPathLaneUpdates: coverage.fastPathLane.updated,
        expectedBlocked: coverage.workload.expectedFastPathLaneBlocked,
        blocked: coverage.fastPathLane.blocked,
        unsafeUpdatesBeforeGates: coverage.fastPathLane.unsafeUpdatesBeforeGates,
        updatesWithFailedGate: coverage.fastPathLane.updatesWithFailedGate,
        updatesMissingRowPreconditions: coverage.fastPathLane.updatesMissingRowPreconditions,
      }),
    gate('attachment-row-preconditions-retained',
      coverage.db.attachmentRowsPreconditioned === coverage.workload.expectedAttachmentRows
        && coverage.db.metadataRowsPreconditioned === coverage.workload.expectedMetadataRows
        && coverage.db.rowPreconditions === coverage.workload.expectedRowPreconditions
        && coverage.db.rowPreconditionsAttachedToLaneUpdates === coverage.workload.expectedLaneRowPreconditions
        && coverage.db.missingExpectedRemoteHashes === 0,
      {
        attachmentRowsPreconditioned: coverage.db.attachmentRowsPreconditioned,
        metadataRowsPreconditioned: coverage.db.metadataRowsPreconditioned,
        rowPreconditions: coverage.db.rowPreconditions,
        rowPreconditionsAttachedToLaneUpdates: coverage.db.rowPreconditionsAttachedToLaneUpdates,
        missingExpectedRemoteHashes: coverage.db.missingExpectedRemoteHashes,
      }),
    gate('media-db-batches-within-budget',
      coverage.db.batchCount > 0
        && coverage.db.batchesOverLimit === 0
        && coverage.db.maxBatchRowsObserved <= config.maxDbBatchRows,
      {
        batchCount: coverage.db.batchCount,
        maxBatchRowsObserved: coverage.db.maxBatchRowsObserved,
        maxDbBatchRows: config.maxDbBatchRows,
        batchesOverLimit: coverage.db.batchesOverLimit,
      }),
    gate('stale-media-storage-blocks-lane-update',
      coverage.media.staleAtWrite === config.staleMedia
        && coverage.media.stalePreserved === config.staleMedia
        && coverage.media.unsafeRenameOnStale === 0
        && (coverage.fastPathLane.blockedBy['live-storage-mismatch'] || 0) === config.staleMedia,
      {
        staleAtWrite: coverage.media.staleAtWrite,
        stalePreserved: coverage.media.stalePreserved,
        unsafeRenameOnStale: coverage.media.unsafeRenameOnStale,
        blockedBy: coverage.fastPathLane.blockedBy['live-storage-mismatch'] || 0,
      }),
    gate('fsync-failures-block-or-withhold-lane-update',
      coverage.media.tempFsyncFailedBeforeRename === config.tempFsyncFailureMedia
        && coverage.media.tempFsyncFailurePreserved === config.tempFsyncFailureMedia
        && coverage.media.directoryFsyncFailureApplied === config.directoryFsyncFailureMedia
        && coverage.media.appliedFsyncIncomplete === config.directoryFsyncFailureMedia
        && coverage.media.unsafeRenameAfterTempFsyncFailure === 0
        && (coverage.fastPathLane.blockedBy['temp-file-fsync-missing'] || 0) === config.tempFsyncFailureMedia
        && (coverage.fastPathLane.blockedBy['target-directory-fsync-missing'] || 0)
          === config.directoryFsyncFailureMedia,
      {
        tempFsyncFailedBeforeRename: coverage.media.tempFsyncFailedBeforeRename,
        tempFsyncFailurePreserved: coverage.media.tempFsyncFailurePreserved,
        directoryFsyncFailureApplied: coverage.media.directoryFsyncFailureApplied,
        appliedFsyncIncomplete: coverage.media.appliedFsyncIncomplete,
        unsafeRenameAfterTempFsyncFailure: coverage.media.unsafeRenameAfterTempFsyncFailure,
        blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
      }),
    gate('temp-cleanup', coverage.tempLeaks === 0, {
      tempLeaks: coverage.tempLeaks,
      tempLeakSamples: coverage.tempLeakSamples,
    }),
    gate('hash-only-evidence', coverage.rawValueEvidenceLeaks === 0, {
      rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
      samples: coverage.evidenceSamples.length,
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

function buildFastPathLaneReport({ coverage, gates }) {
  const correctnessGate = gates.find((gateResult) =>
    gateResult.id === 'fast-path-lane-updates-only-after-correctness-gates');
  return {
    id: coverage.fastPathLane.id,
    updatePolicy: coverage.fastPathLane.updatePolicy,
    evaluatedAfterGates: true,
    updatesOnlyAfterCorrectnessGates: correctnessGate?.status === 'pass'
      && coverage.fastPathLane.unsafeUpdatesBeforeGates === 0
      && coverage.fastPathLane.updatesMissingRowPreconditions === 0,
    updates: coverage.fastPathLane.updated,
    blocked: coverage.fastPathLane.blocked,
    blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
  };
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
    profile: coverage.profile,
    workload: coverage.workload,
    media: coverage.media,
    db: {
      ...coverage.db,
      batches: coverage.db.batches.slice(0, 12),
    },
    fastPathLane: {
      ...coverage.fastPathLane,
      blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
    },
    bytes: coverage.bytes,
    tempLeaks: coverage.tempLeaks,
    evidenceSamples: coverage.evidenceSamples,
    failures: coverage.failures,
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
  };
}

function recordEvidenceSample(coverage, storageGuard, rowEvidence) {
  const sample = {
    storageGuard,
    mediaRows: {
      attachmentRowHash: rowEvidence.attachmentRowHash,
      metadataRowHashes: rowEvidence.metadataRowHashes,
      rowPreconditions: rowEvidence.rowPreconditions,
      allRowsHaveExpectedRemoteHash: rowEvidence.allRowsHaveExpectedRemoteHash,
    },
  };
  if (JSON.stringify(sample).match(rawFixtureEvidencePattern())) {
    coverage.rawValueEvidenceLeaks += 1;
  }
  if (coverage.evidenceSamples.length < 12) {
    coverage.evidenceSamples.push(sample);
  }
}

function rawFixtureEvidencePattern() {
  return new RegExp(RAW_FIXTURE_TOKENS.map(escapeRegExp).join('|'));
}

function mediaRowPreconditionEvidence({ kind, index, logicalPath, config }) {
  const logicalPathHash = digest(logicalPath);
  const attachmentRowHash = digest({
    table: 'wp_posts',
    rowKind: 'attachment',
    mediaOrdinal: mediaOrdinal(kind, index),
    logicalPathHash,
  });
  const metadataRowHashes = [];
  for (let metaIndex = 0; metaIndex < config.metadataRowsPerMedia; metaIndex += 1) {
    metadataRowHashes.push(digest({
      table: 'wp_postmeta',
      rowKind: 'attachment-metadata',
      mediaOrdinal: mediaOrdinal(kind, index),
      metaIndex,
      logicalPathHash,
    }));
  }
  return {
    attachmentRows: 1,
    metadataRows: metadataRowHashes.length,
    rowPreconditions: 1 + metadataRowHashes.length,
    attachmentRowHash,
    metadataRowHashes,
    allRowsHaveExpectedRemoteHash: Boolean(attachmentRowHash)
      && metadataRowHashes.every((rowHash) => /^[a-f0-9]{64}$/.test(rowHash)),
  };
}

function mediaResourceEvidence(kind, index, logicalPath, expectedStorage) {
  return {
    type: 'file',
    kind: 'media-library-object',
    mediaKind: kind,
    mediaOrdinalHash: digest(mediaOrdinal(kind, index)),
    logicalPathHash: digest(logicalPath),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
  };
}

function mediaOrdinal(kind, index) {
  return `${kind}:${String(index).padStart(6, '0')}`;
}

function mediaLogicalPath(kind, index) {
  const shard = String(Math.floor(index / 64)).padStart(2, '0');
  return `wp-content/uploads/2026/05/rpp-0715/${kind}/${shard}/media-${String(index).padStart(6, '0')}.jpg`;
}

function countForKind(config, kind) {
  if (kind === 'update') {
    return config.updateMedia;
  }
  if (kind === 'stale') {
    return config.staleMedia;
  }
  if (kind === 'temp-fsync-failure') {
    return config.tempFsyncFailureMedia;
  }
  if (kind === 'directory-fsync-failure') {
    return config.directoryFsyncFailureMedia;
  }
  return 0;
}

function rowsPerMediaItem({ metadataRowsPerMedia }) {
  return 1 + metadataRowsPerMedia;
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

function sortedObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
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
    } else if (key === 'update-media') {
      options.updateMedia = Number.parseInt(value, 10);
    } else if (key === 'create-media') {
      options.createMedia = Number.parseInt(value, 10);
    } else if (key === 'stale-media') {
      options.staleMedia = Number.parseInt(value, 10);
    } else if (key === 'temp-fsync-failure-media') {
      options.tempFsyncFailureMedia = Number.parseInt(value, 10);
    } else if (key === 'directory-fsync-failure-media') {
      options.directoryFsyncFailureMedia = Number.parseInt(value, 10);
    } else if (key === 'file-bytes') {
      options.fileBytes = Number.parseInt(value, 10);
    } else if (key === 'metadata-rows-per-media') {
      options.metadataRowsPerMedia = Number.parseInt(value, 10);
    } else if (key === 'max-db-batch-rows') {
      options.maxDbBatchRows = Number.parseInt(value, 10);
    } else if (key === 'max-duration-ms') {
      options.maxDurationMs = Number.parseInt(value, 10);
    } else if (key === 'max-heap-used-bytes') {
      options.maxHeapUsedBytes = Number.parseInt(value, 10);
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
    const report = runLargeMediaLibraryBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
