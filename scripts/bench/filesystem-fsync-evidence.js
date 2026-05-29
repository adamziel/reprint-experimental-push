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
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../../src/filesystem-compare-rename-write.js';
import { digest } from '../../src/stable-json.js';

export const FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID = 'rpp-0705-filesystem-fsync-evidence';

const DEFAULT_NOW = new Date('2026-05-29T00:00:00.000Z');
const MIB = 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'fsync-base-payload',
  'fsync-planned-payload',
  'fsync-drift-payload',
  'filesystem fsync raw fixture',
]);

const PROFILES = Object.freeze({
  unit: Object.freeze({
    updateFiles: 2,
    createFiles: 1,
    staleFiles: 1,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 4096,
    maxDurationMs: 3_000,
    maxHeapUsedBytes: 128 * MIB,
  }),
  'large-site': Object.freeze({
    updateFiles: 24,
    createFiles: 8,
    staleFiles: 4,
    tempFsyncFailureFiles: 2,
    directoryFsyncFailureFiles: 2,
    fileBytes: 64 * 1024,
    maxDurationMs: 12_000,
    maxHeapUsedBytes: 256 * MIB,
  }),
});

export function runFilesystemFsyncEvidenceBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const rootDir = config.rootDir || createFilesystemFsyncTempRoot('reprint-rpp-0705-');
  fs.mkdirSync(rootDir, { recursive: true });
  ensureFilesystemDirectoryUsable(rootDir, rootDir);
  const started = performance.now();
  const startUsage = process.resourceUsage();
  const startMemory = process.memoryUsage();
  const coverage = createCoverage(config);

  setupExistingFiles({ rootDir, config, coverage });
  runUpdateCoverage({ rootDir, config, coverage });
  runCreateCoverage({ rootDir, config, coverage });
  runStaleCoverage({ rootDir, config, coverage });
  runTempFsyncFailureCoverage({ rootDir, config, coverage });
  runDirectoryFsyncFailureCoverage({ rootDir, config, coverage });

  const tempLeaks = filesystemTempLeakPaths(rootDir);
  coverage.tempLeaks = tempLeaks.length;
  coverage.tempLeakSamples = tempLeaks.slice(0, 5).map((leak) => digest(leak));

  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);
  const runtime = {
    benchmarkId: FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID,
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
  const resources = buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory });
  const gates = evaluateFilesystemFsyncGates({ coverage, resources, runtime, config });
  const fastPathLane = buildFastPathLaneReport({ coverage, gates });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0705',
    benchmark: FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID,
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
    throw new Error(`Unknown filesystem fsync evidence benchmark profile: ${profileName}`);
  }
  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || 'rpp-0705-filesystem-fsync-evidence',
    rootDir: options.rootDir || null,
    updateFiles: numberOption(options.updateFiles, 'updateFiles', profile.updateFiles),
    createFiles: numberOption(options.createFiles, 'createFiles', profile.createFiles),
    staleFiles: numberOption(options.staleFiles, 'staleFiles', profile.staleFiles),
    tempFsyncFailureFiles: numberOption(
      options.tempFsyncFailureFiles,
      'tempFsyncFailureFiles',
      profile.tempFsyncFailureFiles,
    ),
    directoryFsyncFailureFiles: numberOption(
      options.directoryFsyncFailureFiles,
      'directoryFsyncFailureFiles',
      profile.directoryFsyncFailureFiles,
    ),
    fileBytes: numberOption(options.fileBytes, 'fileBytes', profile.fileBytes),
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
  const expectedWrites = config.updateFiles
    + config.createFiles
    + config.staleFiles
    + config.tempFsyncFailureFiles
    + config.directoryFsyncFailureFiles;
  const expectedFastPathLaneUpdates = config.updateFiles + config.createFiles;
  return {
    profile: config.profile,
    workload: {
      updateFiles: config.updateFiles,
      createFiles: config.createFiles,
      staleFiles: config.staleFiles,
      tempFsyncFailureFiles: config.tempFsyncFailureFiles,
      directoryFsyncFailureFiles: config.directoryFsyncFailureFiles,
      fileBytes: config.fileBytes,
      expectedWrites,
      expectedApplied: config.updateFiles + config.createFiles + config.directoryFsyncFailureFiles,
      expectedFastPathLaneUpdates,
      expectedFastPathLaneBlocked: expectedWrites - expectedFastPathLaneUpdates,
    },
    writes: {
      attempted: 0,
      applied: 0,
      appliedFsyncComplete: 0,
      appliedFsyncIncomplete: 0,
      staleAtWrite: 0,
      tempFsyncFailedBeforeRename: 0,
      updatesApplied: 0,
      createsApplied: 0,
      stalePreserved: 0,
      tempFsyncFailurePreserved: 0,
      directoryFsyncFailureApplied: 0,
      unsafeRenameOnStale: 0,
      unsafeRenameAfterTempFsyncFailure: 0,
    },
    fastPathLane: {
      id: FILESYSTEM_FSYNC_FAST_PATH_LANE,
      updatePolicy: 'update-only-after-correctness-gates-pass',
      evaluatedBeforeUpdate: true,
      attempted: expectedWrites,
      updated: 0,
      blocked: 0,
      blockedBy: {},
      unsafeUpdatesBeforeGates: 0,
      updatesWithFailedGate: 0,
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

function setupExistingFiles({ rootDir, config, coverage }) {
  for (const kind of ['update', 'stale', 'temp-fsync-failure', 'directory-fsync-failure']) {
    const count = countForKind(config, kind);
    for (let index = 0; index < count; index += 1) {
      const logicalPath = logicalBenchmarkPath(kind, index);
      const absolutePath = path.join(rootDir, logicalPath);
      ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
      const contents = deterministicBuffer(config.fileBytes, config.seed, `${kind}:base:${index}`);
      fs.writeFileSync(absolutePath, contents);
      coverage.bytes.setupExistingBytes += contents.byteLength;
    }
  }
}

function runUpdateCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.updateFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('update', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `update:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('update', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-filesystem-file',
    });
    recordResult({ coverage, result });
    if (result.applied && result.fastPathLaneUpdated) {
      coverage.writes.updatesApplied += 1;
    } else {
      coverage.failures.push(`update:${index}: matching storage did not complete fsync fast-path lane update`);
    }
    assertTargetHash({ rootDir, logicalPath, expectedHash: result.storageGuard.plannedStorageHash, coverage, label: `update:${index}` });
  }
}

function runCreateCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.createFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('create', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `create:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('create', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'create',
      driver: 'benchmark-filesystem-file',
    });
    recordResult({ coverage, result });
    if (result.applied && result.fastPathLaneUpdated) {
      coverage.writes.createsApplied += 1;
    } else {
      coverage.failures.push(`create:${index}: absent storage did not complete fsync fast-path lane update`);
    }
    assertTargetHash({ rootDir, logicalPath, expectedHash: result.storageGuard.plannedStorageHash, coverage, label: `create:${index}` });
  }
}

function runStaleCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.staleFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('stale', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `stale:planned:${index}`);
    const driftContents = deterministicBuffer(config.fileBytes, config.seed, `stale:drift:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('stale', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-filesystem-file',
      afterTempFsync: ({ absolutePath }) => {
        fs.writeFileSync(absolutePath, driftContents);
      },
    });
    recordResult({ coverage, result });
    if (!result.applied && result.storageGuard.outcome === 'stale-at-write') {
      coverage.writes.staleAtWrite += 1;
    } else {
      coverage.failures.push(`stale:${index}: drifted storage was not rejected`);
    }
    if (result.storageGuard.renameAttempted === true) {
      coverage.writes.unsafeRenameOnStale += 1;
      coverage.failures.push(`stale:${index}: stale guard attempted rename`);
    }
    if (result.fastPathLaneUpdated) {
      coverage.failures.push(`stale:${index}: stale guard updated the fast-path lane`);
    }
    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const driftHash = filesystemStorageHash(driftContents);
    if (filesystemStorageHash(afterStorage) === driftHash) {
      coverage.writes.stalePreserved += 1;
      coverage.bytes.driftPreservedBytes += driftContents.byteLength;
    } else {
      coverage.failures.push(`stale:${index}: drifted bytes were not preserved`);
    }
  }
}

function runTempFsyncFailureCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.tempFsyncFailureFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('temp-fsync-failure', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `temp-fsync-failure:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('temp-fsync-failure', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-filesystem-file',
      fsyncFileSync: () => {
        const error = new Error('fixture temp fsync failure');
        error.code = 'EIO';
        throw error;
      },
    });
    recordResult({ coverage, result });
    if (!result.applied && result.storageGuard.outcome === 'fsync-failed-before-rename') {
      coverage.writes.tempFsyncFailedBeforeRename += 1;
    } else {
      coverage.failures.push(`temp-fsync-failure:${index}: temp fsync failure did not block rename`);
    }
    if (result.storageGuard.renameAttempted === true) {
      coverage.writes.unsafeRenameAfterTempFsyncFailure += 1;
      coverage.failures.push(`temp-fsync-failure:${index}: rename happened after temp fsync failure`);
    }
    if (result.fastPathLaneUpdated) {
      coverage.failures.push(`temp-fsync-failure:${index}: temp fsync failure updated the fast-path lane`);
    }
    assertTargetHash({ rootDir, logicalPath, expectedHash: filesystemStorageHash(expectedStorage), coverage, label: `temp-fsync-failure:${index}` });
    coverage.writes.tempFsyncFailurePreserved += 1;
    coverage.bytes.tempFsyncFailurePreservedBytes += config.fileBytes;
  }
}

function runDirectoryFsyncFailureCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.directoryFsyncFailureFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('directory-fsync-failure', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `directory-fsync-failure:planned:${index}`);
    const result = applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('directory-fsync-failure', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-filesystem-file',
      fsyncDirectorySync: () => {
        const error = new Error('fixture directory fsync failure');
        error.code = 'EINVAL';
        throw error;
      },
    });
    recordResult({ coverage, result });
    if (result.applied && result.storageGuard.outcome === 'applied-fsync-incomplete') {
      coverage.writes.directoryFsyncFailureApplied += 1;
      coverage.bytes.fsyncIncompleteAppliedBytes += result.storageGuard.bytesWrittenToTemp;
    } else {
      coverage.failures.push(`directory-fsync-failure:${index}: directory fsync failure did not record incomplete apply`);
    }
    if (result.fastPathLaneUpdated) {
      coverage.failures.push(`directory-fsync-failure:${index}: directory fsync failure updated the fast-path lane`);
    }
    assertTargetHash({ rootDir, logicalPath, expectedHash: result.storageGuard.plannedStorageHash, coverage, label: `directory-fsync-failure:${index}` });
  }
}

function recordResult({ coverage, result }) {
  coverage.writes.attempted += 1;
  recordEvidenceSample(coverage, result.storageGuard);
  coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
  coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;

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
    coverage.fastPathLane.updated += 1;
    coverage.bytes.fastPathLaneBytes += result.storageGuard.bytesWrittenToTemp;
    if (!result.storageGuard.correctnessGates.every((gate) => gate.status === 'pass')) {
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

function assertTargetHash({ rootDir, logicalPath, expectedHash, coverage, label }) {
  const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
  if (filesystemStorageHash(afterStorage) !== expectedHash) {
    coverage.failures.push(`${label}: target hash did not match expected descriptor`);
  }
}

function buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory }) {
  const storage = {
    boundary: FILESYSTEM_FSYNC_BOUNDARY,
    engine: 'filesystem',
    adapter: 'filesystem-compare-rename-fsync',
    comparedFields: ['exists', 'type', 'sizeBytes', 'contentHash'],
    fsyncStrategy: 'temp-file-before-rename-and-directory-after-rename',
    visibilityBoundary: 'same-directory-rename-after-temp-fsync',
    guardedWritesAttempted: coverage.writes.attempted,
    appliedWrites: coverage.writes.applied,
    appliedFsyncCompleteWrites: coverage.writes.appliedFsyncComplete,
    appliedFsyncIncompleteWrites: coverage.writes.appliedFsyncIncomplete,
    staleAtWriteWrites: coverage.writes.staleAtWrite,
    tempFsyncFailedBeforeRenameWrites: coverage.writes.tempFsyncFailedBeforeRename,
    unsafeRenameOnStaleWrites: coverage.writes.unsafeRenameOnStale,
    unsafeRenameAfterTempFsyncFailureWrites: coverage.writes.unsafeRenameAfterTempFsyncFailure,
  };
  const processResources = {
    userCpuMs: microsecondsToMilliseconds(endUsage.userCPUTime - startUsage.userCPUTime),
    systemCpuMs: microsecondsToMilliseconds(endUsage.systemCPUTime - startUsage.systemCPUTime),
    maxRssBytes: endUsage.maxRSS * 1024,
    heapUsedBytes: endMemory.heapUsed,
    heapDeltaBytes: endMemory.heapUsed - startMemory.heapUsed,
  };
  return {
    workload: coverage.workload,
    storage,
    fastPathLane: {
      id: coverage.fastPathLane.id,
      updatePolicy: coverage.fastPathLane.updatePolicy,
      evaluatedBeforeUpdate: coverage.fastPathLane.evaluatedBeforeUpdate,
      updates: coverage.fastPathLane.updated,
      blocked: coverage.fastPathLane.blocked,
      blockedBy: sortedObject(coverage.fastPathLane.blockedBy),
      unsafeUpdatesBeforeGates: coverage.fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: coverage.fastPathLane.updatesWithFailedGate,
    },
    bytes: coverage.bytes,
    process: processResources,
    tempLeaks: coverage.tempLeaks,
    runtimeBudget: runtime.budgets,
  };
}

function evaluateFilesystemFsyncGates({ coverage, resources, runtime, config }) {
  return [
    gate('deterministic-fsync-guard-behavior', coverage.failures.length === 0, {
      failures: coverage.failures,
      attempted: coverage.writes.attempted,
      applied: coverage.writes.applied,
      fastPathLaneUpdates: coverage.fastPathLane.updated,
    }),
    gate('correctness-gates-before-fast-path-lane',
      coverage.fastPathLane.updated === coverage.workload.expectedFastPathLaneUpdates
        && coverage.fastPathLane.unsafeUpdatesBeforeGates === 0
        && coverage.fastPathLane.updatesWithFailedGate === 0,
      {
        expectedFastPathLaneUpdates: coverage.workload.expectedFastPathLaneUpdates,
        fastPathLaneUpdates: coverage.fastPathLane.updated,
        unsafeUpdatesBeforeGates: coverage.fastPathLane.unsafeUpdatesBeforeGates,
        updatesWithFailedGate: coverage.fastPathLane.updatesWithFailedGate,
      }),
    gate('temp-and-directory-fsync-required-for-updates',
      coverage.evidenceSamples.length > 0
        && coverage.evidenceSamples
          .filter((evidence) => evidence.fastPathLane.updated === true)
          .every((evidence) => (
            evidence.fsyncEvidence.tempFile.status === 'passed'
            && evidence.fsyncEvidence.targetDirectory.status === 'passed'
            && evidence.correctnessGates.every((correctnessGate) => correctnessGate.status === 'pass')
          )),
      {
        sampledEvidence: coverage.evidenceSamples.length,
        fastPathLaneUpdates: coverage.fastPathLane.updated,
      }),
    gate('stale-storage-blocks-rename-and-lane-update',
      coverage.writes.staleAtWrite === config.staleFiles
        && coverage.writes.stalePreserved === config.staleFiles
        && coverage.writes.unsafeRenameOnStale === 0,
      {
        staleAtWrite: coverage.writes.staleAtWrite,
        stalePreserved: coverage.writes.stalePreserved,
        unsafeRenameOnStale: coverage.writes.unsafeRenameOnStale,
      }),
    gate('temp-fsync-failure-blocks-rename-and-lane-update',
      coverage.writes.tempFsyncFailedBeforeRename === config.tempFsyncFailureFiles
        && coverage.writes.tempFsyncFailurePreserved === config.tempFsyncFailureFiles
        && coverage.writes.unsafeRenameAfterTempFsyncFailure === 0
        && (coverage.fastPathLane.blockedBy['temp-file-fsync-missing'] || 0) === config.tempFsyncFailureFiles,
      {
        tempFsyncFailedBeforeRename: coverage.writes.tempFsyncFailedBeforeRename,
        tempFsyncFailurePreserved: coverage.writes.tempFsyncFailurePreserved,
        unsafeRenameAfterTempFsyncFailure: coverage.writes.unsafeRenameAfterTempFsyncFailure,
        blockedBy: coverage.fastPathLane.blockedBy['temp-file-fsync-missing'] || 0,
      }),
    gate('directory-fsync-failure-withholds-fast-path-lane-update',
      coverage.writes.directoryFsyncFailureApplied === config.directoryFsyncFailureFiles
        && coverage.writes.appliedFsyncIncomplete === config.directoryFsyncFailureFiles
        && (coverage.fastPathLane.blockedBy['target-directory-fsync-missing'] || 0) === config.directoryFsyncFailureFiles,
      {
        directoryFsyncFailureApplied: coverage.writes.directoryFsyncFailureApplied,
        appliedFsyncIncomplete: coverage.writes.appliedFsyncIncomplete,
        blockedBy: coverage.fastPathLane.blockedBy['target-directory-fsync-missing'] || 0,
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
  const correctnessGate = gates.find((gateResult) => gateResult.id === 'correctness-gates-before-fast-path-lane');
  return {
    id: coverage.fastPathLane.id,
    updatePolicy: coverage.fastPathLane.updatePolicy,
    evaluatedAfterGates: true,
    updatesOnlyAfterCorrectnessGates: correctnessGate?.status === 'pass'
      && coverage.fastPathLane.unsafeUpdatesBeforeGates === 0,
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
    writes: coverage.writes,
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

function resourceEvidence(kind, logicalPath, expectedStorage) {
  return {
    type: 'file',
    kind,
    logicalPathHash: digest(logicalPath),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
  };
}

function logicalBenchmarkPath(kind, index) {
  const shard = String(Math.floor(index / 32)).padStart(2, '0');
  return `wp-content/uploads/rpp-0705/${kind}/${shard}/file-${String(index).padStart(4, '0')}.bin`;
}

function countForKind(config, kind) {
  if (kind === 'update') {
    return config.updateFiles;
  }
  if (kind === 'stale') {
    return config.staleFiles;
  }
  if (kind === 'temp-fsync-failure') {
    return config.tempFsyncFailureFiles;
  }
  if (kind === 'directory-fsync-failure') {
    return config.directoryFsyncFailureFiles;
  }
  return 0;
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
    } else if (key === 'update-files') {
      options.updateFiles = Number.parseInt(value, 10);
    } else if (key === 'create-files') {
      options.createFiles = Number.parseInt(value, 10);
    } else if (key === 'stale-files') {
      options.staleFiles = Number.parseInt(value, 10);
    } else if (key === 'temp-fsync-failure-files') {
      options.tempFsyncFailureFiles = Number.parseInt(value, 10);
    } else if (key === 'directory-fsync-failure-files') {
      options.directoryFsyncFailureFiles = Number.parseInt(value, 10);
    } else if (key === 'file-bytes') {
      options.fileBytes = Number.parseInt(value, 10);
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
    const report = runFilesystemFsyncEvidenceBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
