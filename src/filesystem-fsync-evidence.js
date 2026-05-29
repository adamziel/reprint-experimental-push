import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest } from './stable-json.js';
import {
  absentFilesystemStorageDescriptor,
  ensureFilesystemDirectoryUsable,
  filesystemDescriptorFromBuffer,
  filesystemStorageHash,
  filesystemStorageDescriptorsMatch,
  normalizeFilesystemStorageDescriptor,
  readFilesystemStorageDescriptorByPath,
  resolveFilesystemGuardPath,
} from './filesystem-compare-rename-write.js';

export const FILESYSTEM_FSYNC_BOUNDARY = 'filesystem-fsync-evidence';
export const FILESYSTEM_FSYNC_ADAPTER = 'filesystem-compare-rename-fsync';
export const FILESYSTEM_FSYNC_TEMP_PREFIX = '.reprint-push-fsync-';
export const FILESYSTEM_FSYNC_FAST_PATH_LANE = 'filesystem-fsync-fast-path';
export const FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS = Object.freeze([
  'temp-file-fsync-before-live-compare',
  'live-storage-precondition-match',
  'rename-after-correct-live-compare',
  'target-directory-fsync-after-rename',
  'post-rename-storage-matches-planned',
]);
export const FILESYSTEM_FSYNC_COMPARED_FIELDS = Object.freeze([
  'exists',
  'type',
  'sizeBytes',
  'contentHash',
]);

export function applyFilesystemFsyncEvidenceWrite({
  rootDir,
  logicalPath,
  expectedResource = null,
  expectedStorage,
  plannedContents,
  operation = null,
  driver = 'filesystem-file',
  tempPrefix = FILESYSTEM_FSYNC_TEMP_PREFIX,
  afterTempFsync = null,
  fsyncFileSync = defaultFsyncSync,
  fsyncDirectorySync = defaultFsyncSync,
}) {
  const resolved = resolveFilesystemGuardPath(rootDir, logicalPath);
  const expectedDescriptor = normalizeFilesystemStorageDescriptor(expectedStorage, 'expectedStorage');
  const plannedBuffer = normalizePlannedContents(plannedContents);
  const plannedDescriptor = filesystemDescriptorFromBuffer(plannedBuffer);
  const writeOperation = operation || (expectedDescriptor.exists ? 'update' : 'create');
  if (!['update', 'create'].includes(writeOperation)) {
    throw new Error(`Filesystem fsync evidence operation must be update or create; got ${writeOperation}.`);
  }

  const parentDir = path.dirname(resolved.absolutePath);
  ensureFilesystemDirectoryUsable(resolved.rootDir, parentDir);

  let tempPath = null;
  let tempFd = null;
  let renamed = false;
  let observedDescriptor = absentFilesystemStorageDescriptor();
  let postRenameDescriptor = null;
  let tempFileFsync = fsyncNotAttempted('temp-file');
  let directoryFsync = fsyncNotAttempted('target-directory');
  let liveStorageMatched = false;
  let postRenameMatched = false;
  const steps = ['write-temp-same-directory'];

  try {
    ({ tempPath, fd: tempFd } = openFilesystemFsyncTempFile(parentDir, tempPrefix));
    writeBufferFully(tempFd, plannedBuffer);

    steps.push('fsync-temp-before-live-compare');
    tempFileFsync = callFsync({
      fd: tempFd,
      target: 'temp-file',
      fsyncSync: fsyncFileSync,
    });
    if (tempFileFsync.status !== 'passed') {
      safeCloseTempFd(tempFd);
      tempFd = null;
      return filesystemFsyncResult({
        applied: false,
        resolved,
        driver,
        operation: writeOperation,
        expectedResource,
        expectedStorage: expectedDescriptor,
        actualStorage: observedDescriptor,
        plannedStorage: plannedDescriptor,
        postRenameStorage: postRenameDescriptor,
        outcome: 'fsync-failed-before-rename',
        liveStorageMatched,
        postRenameMatched,
        renameAttempted: false,
        tempRemovedOnBlockedWrite: true,
        tempFileFsync,
        directoryFsync,
        steps,
      });
    }

    fs.closeSync(tempFd);
    tempFd = null;

    if (typeof afterTempFsync === 'function') {
      afterTempFsync({
        rootDir: resolved.rootDir,
        logicalPath: resolved.logicalPath,
        absolutePath: resolved.absolutePath,
      });
    }

    steps.push('read-live-storage', 'compare-expected-storage-hash');
    observedDescriptor = readFilesystemStorageDescriptorByPath(resolved.absolutePath);
    liveStorageMatched = filesystemStorageDescriptorsMatch(observedDescriptor, expectedDescriptor);
    if (!liveStorageMatched) {
      return filesystemFsyncResult({
        applied: false,
        resolved,
        driver,
        operation: writeOperation,
        expectedResource,
        expectedStorage: expectedDescriptor,
        actualStorage: observedDescriptor,
        plannedStorage: plannedDescriptor,
        postRenameStorage: postRenameDescriptor,
        outcome: 'stale-at-write',
        liveStorageMatched,
        postRenameMatched,
        renameAttempted: false,
        tempRemovedOnBlockedWrite: true,
        tempFileFsync,
        directoryFsync,
        steps,
      });
    }

    preserveExistingModeBestEffort(resolved.absolutePath, tempPath, observedDescriptor);
    steps.push('rename-temp-to-target');
    fs.renameSync(tempPath, resolved.absolutePath);
    renamed = true;
    tempPath = null;

    steps.push('fsync-target-directory-after-rename');
    directoryFsync = fsyncDirectory(parentDir, fsyncDirectorySync);

    steps.push('read-post-rename-storage');
    postRenameDescriptor = readFilesystemStorageDescriptorByPath(resolved.absolutePath);
    postRenameMatched = filesystemStorageDescriptorsMatch(postRenameDescriptor, plannedDescriptor);

    const outcome = directoryFsync.status === 'passed' && postRenameMatched
      ? 'applied'
      : 'applied-fsync-incomplete';

    return filesystemFsyncResult({
      applied: true,
      resolved,
      driver,
      operation: writeOperation,
      expectedResource,
      expectedStorage: expectedDescriptor,
      actualStorage: observedDescriptor,
      plannedStorage: plannedDescriptor,
      postRenameStorage: postRenameDescriptor,
      outcome,
      liveStorageMatched,
      postRenameMatched,
      renameAttempted: true,
      tempRemovedOnBlockedWrite: false,
      tempFileFsync,
      directoryFsync,
      steps,
    });
  } finally {
    if (tempFd !== null) {
      safeCloseTempFd(tempFd);
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

export function createFilesystemFsyncTempRoot(prefix = 'reprint-fs-fsync-') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  chmodDirectoryOwnerRwx(tempRoot);
  return tempRoot;
}

function filesystemFsyncResult({ applied, ...evidenceInput }) {
  const storageGuard = filesystemFsyncEvidence(evidenceInput);
  return {
    applied,
    fastPathLaneUpdated: storageGuard.fastPathLane.updated,
    storageGuard,
  };
}

function filesystemFsyncEvidence({
  resolved,
  driver,
  operation,
  expectedResource,
  expectedStorage,
  actualStorage,
  plannedStorage,
  postRenameStorage,
  outcome,
  liveStorageMatched,
  postRenameMatched,
  renameAttempted,
  tempRemovedOnBlockedWrite,
  tempFileFsync,
  directoryFsync,
  steps,
}) {
  const correctnessGates = filesystemFsyncCorrectnessGates({
    tempFileFsync,
    directoryFsync,
    liveStorageMatched,
    postRenameMatched,
    renameAttempted,
    postRenameStorage,
  });
  const failedBlockers = correctnessGates
    .filter((gate) => gate.status === 'fail')
    .map((gate) => gate.blocker)
    .filter(Boolean);
  const blockedBy = failedBlockers.length > 0
    ? failedBlockers
    : correctnessGates
      .filter((gate) => gate.status === 'blocked')
      .map((gate) => gate.blocker)
      .filter(Boolean);
  const correctnessGatesHold = correctnessGates.every((gate) => gate.status === 'pass');
  const fastPathLaneUpdated = outcome === 'applied' && correctnessGatesHold;

  return {
    boundary: FILESYSTEM_FSYNC_BOUNDARY,
    adapter: FILESYSTEM_FSYNC_ADAPTER,
    engine: 'filesystem',
    driver,
    operation,
    logicalPath: resolved.logicalPath,
    physicalPathHash: hashString(resolved.absolutePath),
    comparedFields: [...FILESYSTEM_FSYNC_COMPARED_FIELDS],
    expectedResourceHash: digest(expectedResource ?? expectedStorage),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
    actualStorageHash: filesystemStorageHash(actualStorage),
    plannedStorageHash: filesystemStorageHash(plannedStorage),
    postRenameStorageHash: postRenameStorage === null ? null : filesystemStorageHash(postRenameStorage),
    outcome,
    sameDirectoryTemp: true,
    compareBeforeRename: true,
    liveStorageMatched,
    renameAttempted,
    tempRemovedOnBlockedWrite,
    atomicVisibilityBoundary: 'same-directory-rename-after-temp-fsync',
    fsyncEvidence: {
      requested: true,
      strategy: 'temp-file-before-rename-and-directory-after-rename',
      tempFile: tempFileFsync,
      targetDirectory: directoryFsync,
    },
    correctnessGates,
    fastPathLane: {
      id: FILESYSTEM_FSYNC_FAST_PATH_LANE,
      updatePolicy: 'update-only-after-correctness-gates-pass',
      correctnessGatesEvaluatedBeforeUpdate: true,
      correctnessGatesHold,
      updated: fastPathLaneUpdated,
      blockedBy,
    },
    bytesCompared: actualStorage.exists && Number.isSafeInteger(actualStorage.value?.sizeBytes)
      ? actualStorage.value.sizeBytes
      : 0,
    bytesWrittenToTemp: plannedStorage.value.sizeBytes,
    steps: [...steps],
  };
}

function filesystemFsyncCorrectnessGates({
  tempFileFsync,
  directoryFsync,
  liveStorageMatched,
  postRenameMatched,
  renameAttempted,
  postRenameStorage,
}) {
  const tempFileSynced = tempFileFsync.status === 'passed';
  const liveCompared = tempFileSynced;
  const liveMatched = liveCompared && liveStorageMatched === true;
  const renameDone = liveMatched && renameAttempted === true;
  const directorySynced = renameDone && directoryFsync.status === 'passed';
  const postRenameChecked = renameDone && postRenameStorage !== null;
  const postRenameMatches = postRenameChecked && postRenameMatched === true;

  return [
    correctnessGate(
      'temp-file-fsync-before-live-compare',
      tempFileSynced ? 'pass' : 'fail',
      'temp-file-fsync-missing',
      {
        requested: tempFileFsync.requested,
        status: tempFileFsync.status,
        errorCode: tempFileFsync.errorCode,
      },
    ),
    correctnessGate(
      'live-storage-precondition-match',
      !liveCompared ? 'blocked' : liveMatched ? 'pass' : 'fail',
      'live-storage-mismatch',
      { liveStorageMatched: liveStorageMatched === true },
    ),
    correctnessGate(
      'rename-after-correct-live-compare',
      !liveMatched ? 'blocked' : renameDone ? 'pass' : 'fail',
      'rename-before-correctness-blocked',
      { renameAttempted: renameAttempted === true },
    ),
    correctnessGate(
      'target-directory-fsync-after-rename',
      !renameDone ? 'blocked' : directorySynced ? 'pass' : 'fail',
      'target-directory-fsync-missing',
      {
        requested: directoryFsync.requested,
        status: directoryFsync.status,
        errorCode: directoryFsync.errorCode,
      },
    ),
    correctnessGate(
      'post-rename-storage-matches-planned',
      !renameDone ? 'blocked' : postRenameMatches ? 'pass' : 'fail',
      'post-rename-storage-mismatch',
      { postRenameMatched: postRenameMatched === true },
    ),
  ];
}

function correctnessGate(id, status, blocker, evidence = {}) {
  return {
    id,
    status,
    blocker: status === 'pass' ? null : blocker,
    evidence,
  };
}

function openFilesystemFsyncTempFile(parentDir, tempPrefix) {
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
  throw new Error('Could not allocate a unique filesystem fsync evidence temporary file.');
}

function writeBufferFully(fd, buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    offset += fs.writeSync(fd, buffer, offset, buffer.byteLength - offset, offset);
  }
}

function callFsync({ fd, target, fsyncSync }) {
  try {
    fsyncSync(fd, { target });
    return fsyncPassed(target);
  } catch (error) {
    return fsyncFailed(target, error);
  }
}

function fsyncDirectory(dir, fsyncSync) {
  let dirFd;
  try {
    dirFd = fs.openSync(dir, 'r');
    return callFsync({ fd: dirFd, target: 'target-directory', fsyncSync });
  } catch (error) {
    return fsyncFailed('target-directory', error);
  } finally {
    if (dirFd !== undefined) {
      try {
        fs.closeSync(dirFd);
      } catch {
        // Best-effort close after fsync evidence is recorded.
      }
    }
  }
}

function fsyncPassed(target) {
  return {
    target,
    requested: true,
    status: 'passed',
    strategy: 'fsyncSync',
    errorCode: null,
  };
}

function fsyncFailed(target, error) {
  return {
    target,
    requested: true,
    status: 'failed',
    strategy: 'fsyncSync',
    errorCode: normalizeFsyncErrorCode(error),
  };
}

function fsyncNotAttempted(target) {
  return {
    target,
    requested: false,
    status: 'not-attempted',
    strategy: 'fsyncSync',
    errorCode: null,
  };
}

function normalizeFsyncErrorCode(error) {
  if (error && typeof error.code === 'string' && error.code.trim() !== '') {
    return error.code;
  }
  return 'FSYNC_FAILED';
}

function defaultFsyncSync(fd) {
  fs.fsyncSync(fd);
}

function preserveExistingModeBestEffort(absolutePath, tempPath, observedDescriptor) {
  if (!observedDescriptor.exists || observedDescriptor.value?.type !== 'file') {
    return;
  }
  try {
    const stat = fs.statSync(absolutePath);
    fs.chmodSync(tempPath, stat.mode & 0o777);
  } catch {
    // Mode preservation is best effort and not part of the fsync evidence claim.
  }
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
  throw new Error('Filesystem fsync evidence plannedContents must be a Buffer, Uint8Array, or string.');
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeCloseTempFd(fd) {
  try {
    fs.closeSync(fd);
  } catch {
    // Best-effort close before temp cleanup.
  }
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
