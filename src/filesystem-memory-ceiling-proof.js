import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_COMPARE_RENAME_COMPARED_FIELDS,
  FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
  createFilesystemCompareRenameTempRoot,
  ensureFilesystemDirectoryUsable,
  filesystemStorageDescriptorsMatch,
  filesystemStorageHash,
  normalizeFilesystemStorageDescriptor,
  readFilesystemStorageDescriptorByPath,
  resolveFilesystemGuardPath,
} from './filesystem-compare-rename-write.js';
import { digest } from './stable-json.js';

export const FILESYSTEM_MEMORY_CEILING_BOUNDARY = 'filesystem-memory-ceiling';
export const FILESYSTEM_MEMORY_CEILING_ADAPTER = 'filesystem-streaming-compare-rename';
export const FILESYSTEM_MEMORY_CEILING_DEFAULT_CHUNK_BYTES = 64 * 1024;

export function applyFilesystemMemoryCeilingWrite({
  rootDir,
  logicalPath,
  expectedResource = null,
  expectedStorage,
  plannedSizeBytes,
  createChunk,
  operation = null,
  driver = 'filesystem-file',
  chunkSizeBytes = FILESYSTEM_MEMORY_CEILING_DEFAULT_CHUNK_BYTES,
  maxBufferedBytes = chunkSizeBytes,
  tempPrefix = FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
  afterTempWrite = null,
}) {
  const resolved = resolveFilesystemGuardPath(rootDir, logicalPath);
  const expectedDescriptor = normalizeFilesystemStorageDescriptor(expectedStorage, 'expectedStorage');
  const plannedLength = nonNegativeSafeInteger(plannedSizeBytes, 'plannedSizeBytes');
  const chunkSize = positiveSafeInteger(chunkSizeBytes, 'chunkSizeBytes');
  const memoryCeiling = positiveSafeInteger(maxBufferedBytes, 'maxBufferedBytes');
  if (chunkSize > memoryCeiling) {
    throw new Error('Filesystem memory ceiling chunkSizeBytes must not exceed maxBufferedBytes.');
  }
  if (typeof createChunk !== 'function') {
    throw new Error('Filesystem memory ceiling createChunk callback is required.');
  }

  const writeOperation = operation || (expectedDescriptor.exists ? 'update' : 'create');
  if (!['update', 'create'].includes(writeOperation)) {
    throw new Error(`Filesystem memory ceiling operation must be update or create; got ${writeOperation}.`);
  }

  const parentDir = path.dirname(resolved.absolutePath);
  ensureFilesystemDirectoryUsable(resolved.rootDir, parentDir);

  let tempPath = null;
  let tempFd = null;
  let renamed = false;
  let plannedDescriptor = null;
  let memoryEvidence = null;
  const steps = ['stream-planned-chunks-to-temp'];

  try {
    ({ tempPath, fd: tempFd } = openFilesystemTempFile(parentDir, tempPrefix));
    const streamed = streamPlannedBytesToFile({
      fd: tempFd,
      plannedLength,
      chunkSize,
      memoryCeiling,
      createChunk,
    });
    plannedDescriptor = filesystemDescriptorFromHash({
      sizeBytes: plannedLength,
      digestHex: streamed.digestHex,
    });
    memoryEvidence = memoryCeilingEvidence({
      plannedLength,
      chunkSize,
      memoryCeiling,
      chunkCount: streamed.chunkCount,
      maxObservedBufferedBytes: streamed.maxObservedBufferedBytes,
    });

    fs.closeSync(tempFd);
    tempFd = null;

    if (typeof afterTempWrite === 'function') {
      afterTempWrite({
        rootDir: resolved.rootDir,
        logicalPath: resolved.logicalPath,
        absolutePath: resolved.absolutePath,
      });
    }

    steps.push('read-live-storage', 'compare-expected-storage-hash');
    const observedDescriptor = readFilesystemStorageDescriptorByPath(resolved.absolutePath);
    if (!filesystemStorageDescriptorsMatch(observedDescriptor, expectedDescriptor)) {
      return {
        applied: false,
        storageGuard: filesystemMemoryCeilingEvidence({
          resolved,
          driver,
          operation: writeOperation,
          expectedResource,
          expectedStorage: expectedDescriptor,
          actualStorage: observedDescriptor,
          plannedStorage: plannedDescriptor,
          memoryCeiling: memoryEvidence,
          outcome: 'stale-at-write',
          renameAttempted: false,
          tempRemovedOnStale: true,
          steps,
        }),
      };
    }

    steps.push('rename-temp-to-target');
    fs.renameSync(tempPath, resolved.absolutePath);
    renamed = true;
    tempPath = null;

    return {
      applied: true,
      storageGuard: filesystemMemoryCeilingEvidence({
        resolved,
        driver,
        operation: writeOperation,
        expectedResource,
        expectedStorage: expectedDescriptor,
        actualStorage: observedDescriptor,
        plannedStorage: plannedDescriptor,
        memoryCeiling: memoryEvidence,
        outcome: 'applied',
        renameAttempted: true,
        tempRemovedOnStale: false,
        steps,
      }),
    };
  } finally {
    if (tempFd !== null) {
      try {
        fs.closeSync(tempFd);
      } catch {
        // Best-effort cleanup follows.
      }
    }
    if (!renamed && typeof tempPath === 'string' && tempPath !== '') {
      try {
        fs.unlinkSync(tempPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
}

export function createFilesystemMemoryCeilingTempRoot(prefix = 'reprint-fs-memory-ceiling-') {
  return createFilesystemCompareRenameTempRoot(prefix);
}

function streamPlannedBytesToFile({
  fd,
  plannedLength,
  chunkSize,
  memoryCeiling,
  createChunk,
}) {
  const hash = crypto.createHash('sha256');
  let offset = 0;
  let chunkCount = 0;
  let maxObservedBufferedBytes = 0;

  while (offset < plannedLength) {
    const requestedSize = Math.min(chunkSize, plannedLength - offset);
    const chunk = normalizePlannedChunk(createChunk({
      index: chunkCount,
      offset,
      size: requestedSize,
      remainingBytes: plannedLength - offset,
    }), requestedSize, chunkCount);
    if (chunk.byteLength > memoryCeiling) {
      throw new Error(
        `Filesystem memory ceiling exceeded: chunk ${chunkCount} held ${chunk.byteLength} bytes above ${memoryCeiling}.`,
      );
    }
    maxObservedBufferedBytes = Math.max(maxObservedBufferedBytes, chunk.byteLength);
    writeBufferFully(fd, chunk);
    hash.update(chunk);
    offset += chunk.byteLength;
    chunkCount += 1;
  }

  return {
    digestHex: hash.digest('hex'),
    chunkCount,
    maxObservedBufferedBytes,
  };
}

function filesystemMemoryCeilingEvidence({
  resolved,
  driver,
  operation,
  expectedResource,
  expectedStorage,
  actualStorage,
  plannedStorage,
  memoryCeiling,
  outcome,
  renameAttempted,
  tempRemovedOnStale,
  steps,
}) {
  return {
    boundary: FILESYSTEM_MEMORY_CEILING_BOUNDARY,
    adapter: FILESYSTEM_MEMORY_CEILING_ADAPTER,
    engine: 'filesystem',
    driver,
    operation,
    logicalPath: resolved.logicalPath,
    physicalPathHash: hashString(resolved.absolutePath),
    comparedFields: [...FILESYSTEM_COMPARE_RENAME_COMPARED_FIELDS],
    expectedResourceHash: digest(expectedResource ?? expectedStorage),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
    actualStorageHash: filesystemStorageHash(actualStorage),
    plannedStorageHash: filesystemStorageHash(plannedStorage),
    outcome,
    sameDirectoryTemp: true,
    compareBeforeRename: true,
    renameAttempted,
    tempRemovedOnStale,
    atomicVisibilityBoundary: 'same-directory-rename',
    memoryCeiling,
    bytesCompared: actualStorage.exists && Number.isSafeInteger(actualStorage.value?.sizeBytes)
      ? actualStorage.value.sizeBytes
      : 0,
    bytesWrittenToTemp: plannedStorage.value.sizeBytes,
    steps: [...steps],
  };
}

function memoryCeilingEvidence({
  plannedLength,
  chunkSize,
  memoryCeiling,
  chunkCount,
  maxObservedBufferedBytes,
}) {
  return {
    policy: 'planned-payload-streamed-in-bounded-chunks',
    enforcePoint: 'before-live-storage-compare',
    totalPlannedBytes: plannedLength,
    chunkSizeBytes: chunkSize,
    maxBufferedBytes: memoryCeiling,
    maxObservedBufferedBytes,
    chunkCount,
    payloadBytesGreaterThanCeiling: plannedLength > memoryCeiling,
    ceilingHeld: maxObservedBufferedBytes <= memoryCeiling,
    fullPayloadBufferUsed: false,
    plannedPayloadMaterialized: false,
  };
}

function filesystemDescriptorFromHash({ sizeBytes, digestHex }) {
  return {
    exists: true,
    value: {
      type: 'file',
      sizeBytes,
      contentHash: `sha256:${digestHex}`,
    },
  };
}

function openFilesystemTempFile(parentDir, tempPrefix) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = `${process.pid}-${Date.now()}-${attempt}-${crypto.randomBytes(6).toString('hex')}`;
    const tempPath = path.join(parentDir, `${tempPrefix}${suffix}.tmp`);
    try {
      return { tempPath, fd: fs.openSync(tempPath, 'wx', 0o600) };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('Could not allocate a unique filesystem memory ceiling temporary file.');
}

function writeBufferFully(fd, buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    offset += fs.writeSync(fd, buffer, offset, buffer.byteLength - offset, null);
  }
}

function normalizePlannedChunk(value, expectedSize, index) {
  let chunk;
  if (Buffer.isBuffer(value)) {
    chunk = value;
  } else if (value instanceof Uint8Array) {
    chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else if (typeof value === 'string') {
    chunk = Buffer.from(value);
  } else {
    throw new Error(`Filesystem memory ceiling chunk ${index} must be a Buffer, Uint8Array, or string.`);
  }
  if (chunk.byteLength !== expectedSize) {
    throw new Error(
      `Filesystem memory ceiling chunk ${index} returned ${chunk.byteLength} bytes; expected ${expectedSize}.`,
    );
  }
  return chunk;
}

function nonNegativeSafeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return number;
}

function positiveSafeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return number;
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
