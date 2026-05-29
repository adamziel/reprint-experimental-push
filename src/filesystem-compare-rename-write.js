import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ABSENT, digest } from './stable-json.js';

export const FILESYSTEM_COMPARE_RENAME_BOUNDARY = 'filesystem-compare-rename';
export const FILESYSTEM_COMPARE_RENAME_ADAPTER = 'filesystem-compare-rename';
export const FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX = '.reprint-push-';
export const FILESYSTEM_COMPARE_RENAME_COMPARED_FIELDS = Object.freeze([
  'exists',
  'type',
  'sizeBytes',
  'contentHash',
]);

const HASH_CHUNK_BYTES = 1024 * 1024;

export function applyFilesystemCompareRenameWrite({
  rootDir,
  logicalPath,
  expectedResource = null,
  expectedStorage,
  plannedContents,
  operation = null,
  driver = 'filesystem-file',
  tempPrefix = FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
  afterTempWrite = null,
}) {
  const resolved = resolveFilesystemGuardPath(rootDir, logicalPath);
  const expectedDescriptor = normalizeFilesystemStorageDescriptor(expectedStorage, 'expectedStorage');
  const plannedBuffer = normalizePlannedContents(plannedContents);
  const plannedDescriptor = filesystemDescriptorFromBuffer(plannedBuffer);
  const writeOperation = operation || (expectedDescriptor.exists ? 'update' : 'create');
  if (!['update', 'create'].includes(writeOperation)) {
    throw new Error(`Filesystem compare-and-rename operation must be update or create; got ${writeOperation}.`);
  }

  const parentDir = path.dirname(resolved.absolutePath);
  ensureFilesystemDirectoryUsable(resolved.rootDir, parentDir);

  let tempPath = null;
  let tempFd = null;
  let renamed = false;
  let observedDescriptor = absentFilesystemStorageDescriptor();
  const steps = ['write-temp-same-directory'];

  try {
    ({ tempPath, fd: tempFd } = openFilesystemTempFile(parentDir, tempPrefix));
    writeBufferFully(tempFd, plannedBuffer);
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
    observedDescriptor = readFilesystemStorageDescriptorByPath(resolved.absolutePath);
    if (!filesystemStorageDescriptorsMatch(observedDescriptor, expectedDescriptor)) {
      return {
        applied: false,
        storageGuard: filesystemCompareRenameEvidence({
          resolved,
          driver,
          operation: writeOperation,
          expectedResource,
          expectedStorage: expectedDescriptor,
          actualStorage: observedDescriptor,
          plannedStorage: plannedDescriptor,
          outcome: 'stale-at-write',
          renameAttempted: false,
          tempRemovedOnStale: true,
          steps,
        }),
      };
    }

    preserveExistingModeBestEffort(resolved.absolutePath, tempPath, observedDescriptor);
    steps.push('rename-temp-to-target');
    fs.renameSync(tempPath, resolved.absolutePath);
    renamed = true;
    tempPath = null;

    return {
      applied: true,
      storageGuard: filesystemCompareRenameEvidence({
        resolved,
        driver,
        operation: writeOperation,
        expectedResource,
        expectedStorage: expectedDescriptor,
        actualStorage: observedDescriptor,
        plannedStorage: plannedDescriptor,
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

export function readFilesystemStorageDescriptor({ rootDir, logicalPath }) {
  const resolved = resolveFilesystemGuardPath(rootDir, logicalPath);
  return readFilesystemStorageDescriptorByPath(resolved.absolutePath);
}

export function readFilesystemStorageDescriptorByPath(absolutePath) {
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return absentFilesystemStorageDescriptor();
    }
    throw error;
  }

  if (!stat.isFile()) {
    return {
      exists: true,
      value: {
        type: filesystemNodeType(stat),
        sizeBytes: Number.isSafeInteger(stat.size) ? stat.size : null,
        contentHash: null,
      },
    };
  }

  const hashed = hashFileByPath(absolutePath);
  return {
    exists: true,
    value: {
      type: 'file',
      sizeBytes: hashed.sizeBytes,
      contentHash: `sha256:${hashed.digestHex}`,
    },
  };
}

export function filesystemDescriptorFromBuffer(contents) {
  const buffer = normalizePlannedContents(contents);
  return {
    exists: true,
    value: {
      type: 'file',
      sizeBytes: buffer.byteLength,
      contentHash: `sha256:${hashBuffer(buffer)}`,
    },
  };
}

export function absentFilesystemStorageDescriptor() {
  return { exists: false, value: null };
}

export function normalizeFilesystemStorageDescriptor(storage, label = 'storage') {
  if (storage === ABSENT || storage === undefined || storage === null) {
    return absentFilesystemStorageDescriptor();
  }
  if (Buffer.isBuffer(storage) || typeof storage === 'string' || storage instanceof Uint8Array) {
    return filesystemDescriptorFromBuffer(storage);
  }
  if (storage && typeof storage === 'object' && storage.exists === false) {
    return absentFilesystemStorageDescriptor();
  }
  if (storage && typeof storage === 'object' && storage.exists === true) {
    const value = storage.value;
    if (value && typeof value === 'object' && value.type === 'file' && Object.hasOwn(value, 'content')) {
      return filesystemDescriptorFromBuffer(String(value.content));
    }
    if (
      value
      && typeof value === 'object'
      && (typeof value.contentHash === 'string' || value.contentHash === null)
    ) {
      return {
        exists: true,
        value: {
          type: typeof value.type === 'string' ? value.type : 'file',
          sizeBytes: Number.isSafeInteger(value.sizeBytes) ? value.sizeBytes : null,
          contentHash: value.contentHash,
        },
      };
    }
  }
  if (storage && typeof storage === 'object' && storage.type === 'file' && Object.hasOwn(storage, 'content')) {
    return filesystemDescriptorFromBuffer(String(storage.content));
  }
  throw new Error(`Filesystem compare-and-rename ${label} must be absent, bytes, or a file descriptor.`);
}

export function filesystemStorageHash(storage) {
  const descriptor = normalizeFilesystemStorageDescriptor(storage, 'storage');
  return digest(descriptor.exists ? descriptor : ABSENT);
}

export function filesystemStorageDescriptorsMatch(left, right) {
  return filesystemStorageHash(left) === filesystemStorageHash(right);
}

export function resolveFilesystemGuardPath(rootDir, logicalPath) {
  if (typeof rootDir !== 'string' || rootDir.trim() === '') {
    throw new Error('Filesystem compare-and-rename rootDir is required.');
  }
  if (typeof logicalPath !== 'string' || logicalPath.trim() === '') {
    throw new Error('Filesystem compare-and-rename logicalPath is required.');
  }
  if (path.isAbsolute(logicalPath)) {
    throw new Error(`Filesystem compare-and-rename logicalPath must be relative: ${logicalPath}`);
  }

  const root = path.resolve(rootDir);
  const normalizedLogicalPath = logicalPath.split(/[\\/]+/).filter(Boolean).join(path.sep);
  const absolutePath = path.resolve(root, normalizedLogicalPath);
  const relative = path.relative(root, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Filesystem compare-and-rename logicalPath escapes rootDir: ${logicalPath}`);
  }

  return {
    rootDir: root,
    logicalPath: relative.split(path.sep).join('/'),
    absolutePath,
  };
}

export function ensureFilesystemDirectoryUsable(rootDir, targetDir) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetDir);
  const relative = path.relative(root, target);
  if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new Error(`Filesystem compare-and-rename directory escapes rootDir: ${targetDir}`);
  }

  fs.mkdirSync(root, { recursive: true });
  chmodDirectoryOwnerRwx(root);
  if (!relative) {
    return;
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }
    chmodDirectoryOwnerRwx(current);
  }
}

export function filesystemTempLeakPaths(rootDir) {
  const root = path.resolve(rootDir);
  const leaks = [];
  collectTempLeaks(root, leaks);
  return leaks.sort().map((filePath) => path.relative(root, filePath).split(path.sep).join('/'));
}

function filesystemCompareRenameEvidence({
  resolved,
  driver,
  operation,
  expectedResource,
  expectedStorage,
  actualStorage,
  plannedStorage,
  outcome,
  renameAttempted,
  tempRemovedOnStale,
  steps,
}) {
  return {
    boundary: FILESYSTEM_COMPARE_RENAME_BOUNDARY,
    adapter: FILESYSTEM_COMPARE_RENAME_ADAPTER,
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
    bytesCompared: actualStorage.exists && Number.isSafeInteger(actualStorage.value?.sizeBytes)
      ? actualStorage.value.sizeBytes
      : 0,
    bytesWrittenToTemp: plannedStorage.value.sizeBytes,
    steps: [...steps],
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
  throw new Error('Could not allocate a unique filesystem compare-and-rename temporary file.');
}

function writeBufferFully(fd, buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    offset += fs.writeSync(fd, buffer, offset, buffer.byteLength - offset, offset);
  }
}

function preserveExistingModeBestEffort(absolutePath, tempPath, observedDescriptor) {
  if (!observedDescriptor.exists || observedDescriptor.value?.type !== 'file') {
    return;
  }
  try {
    const stat = fs.statSync(absolutePath);
    fs.chmodSync(tempPath, stat.mode & 0o777);
  } catch {
    // Mode preservation is best effort and not part of the RPP-0704 claim.
  }
}

function hashFileByPath(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let sizeBytes = 0;
  const fd = fs.openSync(filePath, 'r');
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      sizeBytes += bytesRead;
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sizeBytes, digestHex: hash.digest('hex') };
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizePlannedContents(contents) {
  if (Buffer.isBuffer(contents)) {
    return contents;
  }
  if (contents instanceof Uint8Array) {
    return Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength);
  }
  if (typeof contents === 'string') {
    return Buffer.from(contents);
  }
  throw new Error('Filesystem compare-and-rename plannedContents must be a Buffer, Uint8Array, or string.');
}

function filesystemNodeType(stat) {
  if (stat.isDirectory()) {
    return 'directory';
  }
  if (stat.isSymbolicLink()) {
    return 'symlink';
  }
  if (stat.isBlockDevice()) {
    return 'block-device';
  }
  if (stat.isCharacterDevice()) {
    return 'character-device';
  }
  if (stat.isFIFO()) {
    return 'fifo';
  }
  if (stat.isSocket()) {
    return 'socket';
  }
  return 'other';
}

function chmodDirectoryOwnerRwx(directoryPath) {
  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return;
  }
  const ownerUsableMode = stat.mode | 0o700;
  if ((stat.mode & 0o777) !== (ownerUsableMode & 0o777)) {
    fs.chmodSync(directoryPath, ownerUsableMode & 0o777);
  }
}

function collectTempLeaks(currentDir, leaks) {
  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectTempLeaks(fullPath, leaks);
    } else if (entry.isFile() && entry.name.startsWith(FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX)) {
      leaks.push(fullPath);
    }
  }
}

export function createFilesystemCompareRenameTempRoot(prefix = 'reprint-fs-compare-rename-') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  chmodDirectoryOwnerRwx(tempRoot);
  return tempRoot;
}
