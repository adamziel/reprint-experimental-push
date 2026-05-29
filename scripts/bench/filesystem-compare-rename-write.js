#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  FILESYSTEM_COMPARE_RENAME_BOUNDARY,
  applyFilesystemCompareRenameWrite,
  createFilesystemCompareRenameTempRoot,
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../../src/filesystem-compare-rename-write.js';
import { digest } from '../../src/stable-json.js';

export const FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID = 'rpp-0704-filesystem-compare-rename-write';

const DEFAULT_NOW = new Date('2026-05-29T00:00:00.000Z');
const MIB = 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'fs-base-payload',
  'fs-planned-payload',
  'fs-drift-payload',
  'filesystem raw fixture',
]);

const PROFILES = Object.freeze({
  unit: Object.freeze({
    updateFiles: 4,
    createFiles: 2,
    staleFiles: 2,
    fileBytes: 16 * 1024,
    maxDurationMs: 2_000,
    maxHeapUsedBytes: 128 * MIB,
  }),
  'large-site': Object.freeze({
    updateFiles: 96,
    createFiles: 32,
    staleFiles: 32,
    fileBytes: 256 * 1024,
    maxDurationMs: 12_000,
    maxHeapUsedBytes: 256 * MIB,
  }),
});

export function runFilesystemCompareRenameBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const rootDir = config.rootDir || createFilesystemCompareRenameTempRoot('reprint-rpp-0704-');
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

  const tempLeaks = filesystemTempLeakPaths(rootDir);
  coverage.tempLeaks = tempLeaks.length;
  coverage.tempLeakSamples = tempLeaks.slice(0, 5).map((leak) => digest(leak));

  const endUsage = process.resourceUsage();
  const endMemory = process.memoryUsage();
  const durationMs = elapsedMs(started);
  const runtime = {
    benchmarkId: FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID,
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
  const gates = evaluateFilesystemCompareRenameGates({ coverage, resources, runtime, config });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0704',
    benchmark: FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID,
    profile: config.profile,
    ok: gates.every((gate) => gate.status === 'pass'),
    runtime,
    resources,
    gates,
    deterministicCoverage: publicCoverageSummary(coverage),
  };
}

function benchmarkConfig(options = {}) {
  const profileName = options.profile || 'unit';
  const profile = PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown filesystem compare-and-rename benchmark profile: ${profileName}`);
  }
  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || 'rpp-0704-filesystem-compare-rename-write',
    rootDir: options.rootDir || null,
    updateFiles: numberOption(options.updateFiles, 'updateFiles', profile.updateFiles),
    createFiles: numberOption(options.createFiles, 'createFiles', profile.createFiles),
    staleFiles: numberOption(options.staleFiles, 'staleFiles', profile.staleFiles),
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
  return {
    profile: config.profile,
    workload: {
      updateFiles: config.updateFiles,
      createFiles: config.createFiles,
      staleFiles: config.staleFiles,
      fileBytes: config.fileBytes,
      expectedWrites: config.updateFiles + config.createFiles + config.staleFiles,
      expectedApplied: config.updateFiles + config.createFiles,
      expectedStale: config.staleFiles,
    },
    writes: {
      attempted: 0,
      applied: 0,
      staleAtWrite: 0,
      updatesApplied: 0,
      createsApplied: 0,
      stalePreserved: 0,
      unsafeRenameOnStale: 0,
    },
    bytes: {
      setupExistingBytes: 0,
      tempWrittenBytes: 0,
      comparedBytes: 0,
      renamedBytes: 0,
      driftPreservedBytes: 0,
    },
    tempLeaks: 0,
    tempLeakSamples: [],
    evidenceSamples: [],
    failures: [],
    rawValueEvidenceLeaks: 0,
  };
}

function setupExistingFiles({ rootDir, config, coverage }) {
  for (const kind of ['update', 'stale']) {
    const count = kind === 'update' ? config.updateFiles : config.staleFiles;
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
    const result = applyFilesystemCompareRenameWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('update', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-filesystem-file',
    });
    coverage.writes.attempted += 1;
    recordEvidenceSample(coverage, result.storageGuard);
    coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
    coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;
    if (result.applied && result.storageGuard.outcome === 'applied' && result.storageGuard.renameAttempted === true) {
      coverage.writes.applied += 1;
      coverage.writes.updatesApplied += 1;
      coverage.bytes.renamedBytes += result.storageGuard.bytesWrittenToTemp;
    } else {
      coverage.failures.push(`update:${index}: matching storage did not rename`);
    }
    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    if (filesystemStorageHash(afterStorage) !== result.storageGuard.plannedStorageHash) {
      coverage.failures.push(`update:${index}: target did not contain planned descriptor after rename`);
    }
  }
}

function runCreateCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.createFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('create', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `create:planned:${index}`);
    const result = applyFilesystemCompareRenameWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('create', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'create',
      driver: 'benchmark-filesystem-file',
    });
    coverage.writes.attempted += 1;
    recordEvidenceSample(coverage, result.storageGuard);
    coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
    coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;
    if (result.applied && result.storageGuard.outcome === 'applied' && result.storageGuard.renameAttempted === true) {
      coverage.writes.applied += 1;
      coverage.writes.createsApplied += 1;
      coverage.bytes.renamedBytes += result.storageGuard.bytesWrittenToTemp;
    } else {
      coverage.failures.push(`create:${index}: absent storage did not rename`);
    }
    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    if (filesystemStorageHash(afterStorage) !== result.storageGuard.plannedStorageHash) {
      coverage.failures.push(`create:${index}: target did not contain planned descriptor after rename`);
    }
  }
}

function runStaleCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.staleFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('stale', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const plannedContents = deterministicBuffer(config.fileBytes, config.seed, `stale:planned:${index}`);
    const driftContents = deterministicBuffer(config.fileBytes, config.seed, `stale:drift:${index}`);
    const result = applyFilesystemCompareRenameWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('stale', logicalPath, expectedStorage),
      expectedStorage,
      plannedContents,
      operation: 'update',
      driver: 'benchmark-filesystem-file',
      afterTempWrite: ({ absolutePath }) => {
        fs.writeFileSync(absolutePath, driftContents);
      },
    });
    coverage.writes.attempted += 1;
    recordEvidenceSample(coverage, result.storageGuard);
    coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
    coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;
    if (!result.applied && result.storageGuard.outcome === 'stale-at-write') {
      coverage.writes.staleAtWrite += 1;
    } else {
      coverage.failures.push(`stale:${index}: drifted storage was not rejected`);
    }
    if (result.storageGuard.renameAttempted === true) {
      coverage.writes.unsafeRenameOnStale += 1;
      coverage.failures.push(`stale:${index}: stale guard attempted rename`);
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

function buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory }) {
  const storage = {
    boundary: FILESYSTEM_COMPARE_RENAME_BOUNDARY,
    engine: 'filesystem',
    adapter: FILESYSTEM_COMPARE_RENAME_BOUNDARY,
    comparedFields: ['exists', 'type', 'sizeBytes', 'contentHash'],
    tempPlacement: 'same-directory',
    visibilityBoundary: 'rename-temp-to-target-after-compare',
    guardedWritesAttempted: coverage.writes.attempted,
    appliedWrites: coverage.writes.applied,
    staleAtWriteWrites: coverage.writes.staleAtWrite,
    unsafeRenameOnStaleWrites: coverage.writes.unsafeRenameOnStale,
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
    bytes: coverage.bytes,
    process: processResources,
    tempLeaks: coverage.tempLeaks,
    runtimeBudget: runtime.budgets,
  };
}

function evaluateFilesystemCompareRenameGates({ coverage, resources, runtime, config }) {
  return [
    gate('deterministic-guard-behavior', coverage.failures.length === 0, {
      failures: coverage.failures,
      attempted: coverage.writes.attempted,
      applied: coverage.writes.applied,
      staleAtWrite: coverage.writes.staleAtWrite,
    }),
    gate('matching-storage-renames',
      coverage.writes.applied === coverage.workload.expectedApplied
        && coverage.writes.updatesApplied === config.updateFiles
        && coverage.writes.createsApplied === config.createFiles,
      {
        expectedApplied: coverage.workload.expectedApplied,
        applied: coverage.writes.applied,
        updatesApplied: coverage.writes.updatesApplied,
        createsApplied: coverage.writes.createsApplied,
      }),
    gate('stale-storage-rejected-and-preserved',
      coverage.writes.staleAtWrite === config.staleFiles
        && coverage.writes.stalePreserved === config.staleFiles
        && coverage.writes.unsafeRenameOnStale === 0,
      {
        staleAtWrite: coverage.writes.staleAtWrite,
        stalePreserved: coverage.writes.stalePreserved,
        unsafeRenameOnStale: coverage.writes.unsafeRenameOnStale,
      }),
    gate('same-directory-compare-before-rename-evidence',
      coverage.evidenceSamples.length > 0
        && coverage.evidenceSamples.every((evidence) => (
          evidence.boundary === FILESYSTEM_COMPARE_RENAME_BOUNDARY
          && evidence.sameDirectoryTemp === true
          && evidence.compareBeforeRename === true
          && evidence.atomicVisibilityBoundary === 'same-directory-rename'
        )),
      {
        evidenceSamples: coverage.evidenceSamples.length,
      }),
    gate('temp-cleanup', coverage.tempLeaks === 0, {
      tempLeaks: coverage.tempLeaks,
      tempLeakSamples: coverage.tempLeakSamples,
    }),
    gate('hash-only-evidence', coverage.rawValueEvidenceLeaks === 0, {
      rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
      samples: coverage.evidenceSamples.length,
    }),
    gate('large-site-runtime-budget',
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
    profile: coverage.profile,
    workload: coverage.workload,
    writes: coverage.writes,
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
  if (coverage.evidenceSamples.length < 8) {
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
  return `wp-content/uploads/rpp-0704/${kind}/${shard}/file-${String(index).padStart(4, '0')}.bin`;
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
    const report = runFilesystemCompareRenameBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
