#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  FILESYSTEM_MEMORY_CEILING_ADAPTER,
  FILESYSTEM_MEMORY_CEILING_BOUNDARY,
  applyFilesystemMemoryCeilingWrite,
  createFilesystemMemoryCeilingTempRoot,
} from '../../src/filesystem-memory-ceiling-proof.js';
import {
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../../src/filesystem-compare-rename-write.js';
import { digest } from '../../src/stable-json.js';

export const FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID = 'rpp-0717-filesystem-memory-ceiling-proof';

const DEFAULT_NOW = new Date('2026-05-30T00:00:00.000Z');
const MIB = 1024 * 1024;
const RAW_FIXTURE_TOKENS = Object.freeze([
  'memory-base-payload',
  'memory-planned-payload',
  'memory-drift-payload',
  'filesystem memory raw fixture',
]);

const PROFILES = Object.freeze({
  unit: Object.freeze({
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 2,
    fileBytes: 256 * 1024,
    chunkSizeBytes: 16 * 1024,
    maxBufferedBytes: 16 * 1024,
    maxDurationMs: 3_000,
    maxHeapUsedBytes: 128 * MIB,
  }),
  'large-site': Object.freeze({
    updateFiles: 24,
    createFiles: 8,
    staleFiles: 8,
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 64 * 1024,
    maxBufferedBytes: 64 * 1024,
    maxDurationMs: 12_000,
    maxHeapUsedBytes: 256 * MIB,
  }),
});

export function runFilesystemMemoryCeilingProofBenchmark(options = {}) {
  const config = benchmarkConfig(options);
  const rootDir = config.rootDir || createFilesystemMemoryCeilingTempRoot('reprint-rpp-0717-');
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
    benchmarkId: FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID,
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
      maxBufferedBytes: config.maxBufferedBytes,
      chunkSizeBytes: config.chunkSizeBytes,
    },
  };
  const resources = buildResourceReport({ coverage, runtime, startUsage, endUsage, startMemory, endMemory });
  const gates = evaluateFilesystemMemoryCeilingGates({ coverage, resources, runtime, config });

  return {
    schemaVersion: 1,
    rppId: 'RPP-0717',
    benchmark: FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID,
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
    throw new Error(`Unknown filesystem memory ceiling proof profile: ${profileName}`);
  }
  return {
    ...profile,
    ...options,
    profile: profileName,
    now: options.now || DEFAULT_NOW,
    seed: options.seed || 'rpp-0717-filesystem-memory-ceiling-proof',
    rootDir: options.rootDir || null,
    updateFiles: numberOption(options.updateFiles, 'updateFiles', profile.updateFiles),
    createFiles: numberOption(options.createFiles, 'createFiles', profile.createFiles),
    staleFiles: numberOption(options.staleFiles, 'staleFiles', profile.staleFiles),
    fileBytes: numberOption(options.fileBytes, 'fileBytes', profile.fileBytes),
    chunkSizeBytes: positiveNumberOption(options.chunkSizeBytes, 'chunkSizeBytes', profile.chunkSizeBytes),
    maxBufferedBytes: positiveNumberOption(options.maxBufferedBytes, 'maxBufferedBytes', profile.maxBufferedBytes),
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

function positiveNumberOption(value, name, fallback) {
  const number = numberOption(value, name, fallback);
  if (number <= 0) {
    throw new Error(`${name} must be a positive number`);
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
      chunkSizeBytes: config.chunkSizeBytes,
      maxBufferedBytes: config.maxBufferedBytes,
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
    memory: {
      totalPlannedBytes: 0,
      chunkCount: 0,
      maxObservedBufferedBytes: 0,
      ceilingBreaches: 0,
      fullPayloadBufferWrites: 0,
      materializedPayloadWrites: 0,
      payloadBytesGreaterThanCeilingWrites: 0,
      streamedWrites: 0,
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
      writeDeterministicFile({
        rootDir,
        logicalPath,
        sizeBytes: config.fileBytes,
        chunkSizeBytes: config.chunkSizeBytes,
        seed: config.seed,
        label: `memory-base-payload:${kind}:${index}`,
      });
      coverage.bytes.setupExistingBytes += config.fileBytes;
    }
  }
}

function runUpdateCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.updateFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('update', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const result = applyFilesystemMemoryCeilingWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('update', logicalPath, expectedStorage),
      expectedStorage,
      plannedSizeBytes: config.fileBytes,
      createChunk: deterministicChunkSource(config, `memory-planned-payload:update:${index}`),
      operation: 'update',
      driver: 'benchmark-filesystem-file',
      chunkSizeBytes: config.chunkSizeBytes,
      maxBufferedBytes: config.maxBufferedBytes,
    });
    recordResult({ coverage, result });
    if (result.applied && result.storageGuard.outcome === 'applied' && result.storageGuard.renameAttempted === true) {
      coverage.writes.updatesApplied += 1;
      coverage.bytes.renamedBytes += result.storageGuard.bytesWrittenToTemp;
    } else {
      coverage.failures.push(`update:${index}: matching storage did not rename under memory ceiling`);
    }
    assertTargetHash({ rootDir, logicalPath, expectedHash: result.storageGuard.plannedStorageHash, coverage, label: `update:${index}` });
  }
}

function runCreateCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.createFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('create', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const result = applyFilesystemMemoryCeilingWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('create', logicalPath, expectedStorage),
      expectedStorage,
      plannedSizeBytes: config.fileBytes,
      createChunk: deterministicChunkSource(config, `memory-planned-payload:create:${index}`),
      operation: 'create',
      driver: 'benchmark-filesystem-file',
      chunkSizeBytes: config.chunkSizeBytes,
      maxBufferedBytes: config.maxBufferedBytes,
    });
    recordResult({ coverage, result });
    if (result.applied && result.storageGuard.outcome === 'applied' && result.storageGuard.renameAttempted === true) {
      coverage.writes.createsApplied += 1;
      coverage.bytes.renamedBytes += result.storageGuard.bytesWrittenToTemp;
    } else {
      coverage.failures.push(`create:${index}: absent storage did not rename under memory ceiling`);
    }
    assertTargetHash({ rootDir, logicalPath, expectedHash: result.storageGuard.plannedStorageHash, coverage, label: `create:${index}` });
  }
}

function runStaleCoverage({ rootDir, config, coverage }) {
  for (let index = 0; index < config.staleFiles; index += 1) {
    const logicalPath = logicalBenchmarkPath('stale', index);
    const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const driftLabel = `memory-drift-payload:stale:${index}`;
    const result = applyFilesystemMemoryCeilingWrite({
      rootDir,
      logicalPath,
      expectedResource: resourceEvidence('stale', logicalPath, expectedStorage),
      expectedStorage,
      plannedSizeBytes: config.fileBytes,
      createChunk: deterministicChunkSource(config, `memory-planned-payload:stale:${index}`),
      operation: 'update',
      driver: 'benchmark-filesystem-file',
      chunkSizeBytes: config.chunkSizeBytes,
      maxBufferedBytes: config.maxBufferedBytes,
      afterTempWrite: ({ absolutePath }) => {
        writeDeterministicFileByPath({
          absolutePath,
          sizeBytes: config.fileBytes,
          chunkSizeBytes: config.chunkSizeBytes,
          seed: config.seed,
          label: driftLabel,
        });
      },
    });
    recordResult({ coverage, result });
    if (!result.applied && result.storageGuard.outcome === 'stale-at-write') {
      coverage.writes.staleAtWrite += 1;
    } else {
      coverage.failures.push(`stale:${index}: drifted storage was not rejected under memory ceiling`);
    }
    if (result.storageGuard.renameAttempted === true) {
      coverage.writes.unsafeRenameOnStale += 1;
      coverage.failures.push(`stale:${index}: stale guard attempted rename under memory ceiling`);
    }
    const afterStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });
    const driftHash = filesystemStorageHash(deterministicFileDescriptor({
      sizeBytes: config.fileBytes,
      chunkSizeBytes: config.chunkSizeBytes,
      seed: config.seed,
      label: driftLabel,
    }));
    if (filesystemStorageHash(afterStorage) === driftHash) {
      coverage.writes.stalePreserved += 1;
      coverage.bytes.driftPreservedBytes += config.fileBytes;
    } else {
      coverage.failures.push(`stale:${index}: drifted bytes were not preserved`);
    }
  }
}

function recordResult({ coverage, result }) {
  coverage.writes.attempted += 1;
  recordMemoryEvidence(coverage, result.storageGuard.memoryCeiling);
  recordEvidenceSample(coverage, result.storageGuard);
  coverage.bytes.tempWrittenBytes += result.storageGuard.bytesWrittenToTemp;
  coverage.bytes.comparedBytes += result.storageGuard.bytesCompared;

  if (result.applied) {
    coverage.writes.applied += 1;
  }
}

function recordMemoryEvidence(coverage, memoryCeiling) {
  coverage.memory.totalPlannedBytes += memoryCeiling.totalPlannedBytes;
  coverage.memory.chunkCount += memoryCeiling.chunkCount;
  coverage.memory.maxObservedBufferedBytes = Math.max(
    coverage.memory.maxObservedBufferedBytes,
    memoryCeiling.maxObservedBufferedBytes,
  );
  if (!memoryCeiling.ceilingHeld) {
    coverage.memory.ceilingBreaches += 1;
  }
  if (memoryCeiling.fullPayloadBufferUsed) {
    coverage.memory.fullPayloadBufferWrites += 1;
  }
  if (memoryCeiling.plannedPayloadMaterialized) {
    coverage.memory.materializedPayloadWrites += 1;
  }
  if (memoryCeiling.payloadBytesGreaterThanCeiling) {
    coverage.memory.payloadBytesGreaterThanCeilingWrites += 1;
  }
  if (memoryCeiling.chunkCount > 1) {
    coverage.memory.streamedWrites += 1;
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
    boundary: FILESYSTEM_MEMORY_CEILING_BOUNDARY,
    engine: 'filesystem',
    adapter: FILESYSTEM_MEMORY_CEILING_ADAPTER,
    comparedFields: ['exists', 'type', 'sizeBytes', 'contentHash'],
    tempPlacement: 'same-directory',
    visibilityBoundary: 'same-directory-rename-after-streamed-temp-write',
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
    memoryCeiling: coverage.memory,
    bytes: coverage.bytes,
    process: processResources,
    tempLeaks: coverage.tempLeaks,
    runtimeBudget: runtime.budgets,
  };
}

function evaluateFilesystemMemoryCeilingGates({ coverage, resources, runtime, config }) {
  return [
    gate('deterministic-memory-ceiling-guard-behavior', coverage.failures.length === 0, {
      failures: coverage.failures,
      attempted: coverage.writes.attempted,
      applied: coverage.writes.applied,
      staleAtWrite: coverage.writes.staleAtWrite,
    }),
    gate('memory-ceiling-held-before-live-compare',
      coverage.memory.ceilingBreaches === 0
        && coverage.memory.fullPayloadBufferWrites === 0
        && coverage.memory.materializedPayloadWrites === 0
        && coverage.memory.maxObservedBufferedBytes <= config.maxBufferedBytes
        && coverage.memory.payloadBytesGreaterThanCeilingWrites === coverage.writes.attempted
        && coverage.memory.streamedWrites === coverage.writes.attempted,
      {
        maxObservedBufferedBytes: coverage.memory.maxObservedBufferedBytes,
        maxBufferedBytes: config.maxBufferedBytes,
        payloadBytesGreaterThanCeilingWrites: coverage.memory.payloadBytesGreaterThanCeilingWrites,
        streamedWrites: coverage.memory.streamedWrites,
        writesAttempted: coverage.writes.attempted,
        fullPayloadBufferWrites: coverage.memory.fullPayloadBufferWrites,
        materializedPayloadWrites: coverage.memory.materializedPayloadWrites,
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
          evidence.boundary === FILESYSTEM_MEMORY_CEILING_BOUNDARY
          && evidence.sameDirectoryTemp === true
          && evidence.compareBeforeRename === true
          && evidence.atomicVisibilityBoundary === 'same-directory-rename'
          && evidence.memoryCeiling.enforcePoint === 'before-live-storage-compare'
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
    profile: coverage.profile,
    workload: coverage.workload,
    writes: coverage.writes,
    memory: coverage.memory,
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
  return `wp-content/uploads/rpp-0717/${kind}/${shard}/file-${String(index).padStart(4, '0')}.bin`;
}

function writeDeterministicFile({ rootDir, logicalPath, sizeBytes, chunkSizeBytes, seed, label }) {
  const absolutePath = path.join(rootDir, logicalPath);
  ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
  writeDeterministicFileByPath({ absolutePath, sizeBytes, chunkSizeBytes, seed, label });
}

function writeDeterministicFileByPath({ absolutePath, sizeBytes, chunkSizeBytes, seed, label }) {
  const fd = fs.openSync(absolutePath, 'w', 0o600);
  try {
    let offset = 0;
    while (offset < sizeBytes) {
      const size = Math.min(chunkSizeBytes, sizeBytes - offset);
      const chunk = deterministicChunk({ seed, label, offset, size });
      writeBufferFully(fd, chunk);
      offset += chunk.byteLength;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function deterministicFileDescriptor({ sizeBytes, chunkSizeBytes, seed, label }) {
  const hash = crypto.createHash('sha256');
  let offset = 0;
  while (offset < sizeBytes) {
    const size = Math.min(chunkSizeBytes, sizeBytes - offset);
    const chunk = deterministicChunk({ seed, label, offset, size });
    hash.update(chunk);
    offset += chunk.byteLength;
  }
  return {
    exists: true,
    value: {
      type: 'file',
      sizeBytes,
      contentHash: `sha256:${hash.digest('hex')}`,
    },
  };
}

function deterministicChunkSource(config, label) {
  return ({ offset, size }) => deterministicChunk({
    seed: config.seed,
    label,
    offset,
    size,
  });
}

function deterministicChunk({ seed, label, offset, size }) {
  const buffer = Buffer.allocUnsafe(size);
  let written = 0;
  let blockIndex = 0;
  while (written < buffer.length) {
    const block = crypto
      .createHash('sha256')
      .update(`${seed}:${label}:${offset + written}:${blockIndex}`)
      .digest();
    const copied = Math.min(block.length, buffer.length - written);
    block.copy(buffer, written, 0, copied);
    written += copied;
    blockIndex += 1;
  }
  return buffer;
}

function writeBufferFully(fd, buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    offset += fs.writeSync(fd, buffer, offset, buffer.byteLength - offset, null);
  }
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
    } else if (key === 'chunk-size-bytes') {
      options.chunkSizeBytes = Number.parseInt(value, 10);
    } else if (key === 'max-buffered-bytes') {
      options.maxBufferedBytes = Number.parseInt(value, 10);
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
    const report = runFilesystemMemoryCeilingProofBenchmark(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
