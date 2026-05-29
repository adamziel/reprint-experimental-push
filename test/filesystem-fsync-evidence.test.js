import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
  FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS,
  FILESYSTEM_FSYNC_FAST_PATH_LANE,
  applyFilesystemFsyncEvidenceWrite,
  createFilesystemFsyncTempRoot,
} from '../src/filesystem-fsync-evidence.js';
import {
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
  resolveFilesystemGuardPath,
} from '../src/filesystem-compare-rename-write.js';

function writeFixture(rootDir, logicalPath, contents) {
  const absolutePath = path.join(rootDir, logicalPath);
  ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents);
}

function readFixture(rootDir, logicalPath) {
  return fs.readFileSync(path.join(rootDir, logicalPath), 'utf8');
}

function codedError(code) {
  const error = new Error(`fixture ${code} failure should not be serialized`);
  error.code = code;
  return error;
}

test('filesystem fsync evidence applies matching update and create writes after correctness gates hold', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0705-test-');
  const updatePath = 'wp-content/uploads/rpp-0705/update.txt';
  const createPath = 'wp-content/uploads/rpp-0705/create.txt';
  writeFixture(rootDir, updatePath, 'rpp0705 old bytes');

  const expectedUpdate = readFilesystemStorageDescriptor({ rootDir, logicalPath: updatePath });
  const update = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath: updatePath,
    expectedResource: { resourceKeyHash: 'update-resource-hash', expectedStorageHash: filesystemStorageHash(expectedUpdate) },
    expectedStorage: expectedUpdate,
    plannedContents: 'rpp0705 planned bytes',
    operation: 'update',
    driver: 'unit-test-file',
  });

  assert.equal(update.applied, true);
  assert.equal(update.fastPathLaneUpdated, true);
  assert.equal(readFixture(rootDir, updatePath), 'rpp0705 planned bytes');
  assert.equal(update.storageGuard.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(update.storageGuard.operation, 'update');
  assert.equal(update.storageGuard.outcome, 'applied');
  assert.equal(update.storageGuard.sameDirectoryTemp, true);
  assert.equal(update.storageGuard.compareBeforeRename, true);
  assert.equal(update.storageGuard.renameAttempted, true);
  assert.equal(update.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(update.storageGuard.fsyncEvidence.targetDirectory.status, 'passed');
  assert.equal(update.storageGuard.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(update.storageGuard.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true);
  assert.equal(update.storageGuard.fastPathLane.correctnessGatesHold, true);
  assert.equal(update.storageGuard.fastPathLane.updated, true);
  assert.deepEqual(update.storageGuard.fastPathLane.blockedBy, []);
  assert.deepEqual(update.storageGuard.correctnessGates.map((gate) => gate.id), FILESYSTEM_FSYNC_CORRECTNESS_GATE_IDS);
  assert.deepEqual([...new Set(update.storageGuard.correctnessGates.map((gate) => gate.status))], ['pass']);
  assert.deepEqual(update.storageGuard.steps, [
    'write-temp-same-directory',
    'fsync-temp-before-live-compare',
    'read-live-storage',
    'compare-expected-storage-hash',
    'rename-temp-to-target',
    'fsync-target-directory-after-rename',
    'read-post-rename-storage',
  ]);
  assert.match(update.storageGuard.physicalPathHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.actualStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.plannedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.postRenameStorageHash, /^[a-f0-9]{64}$/);

  const expectedCreate = readFilesystemStorageDescriptor({ rootDir, logicalPath: createPath });
  const create = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath: createPath,
    expectedResource: { resourceKeyHash: 'create-resource-hash', expectedStorageHash: filesystemStorageHash(expectedCreate) },
    expectedStorage: expectedCreate,
    plannedContents: Buffer.from('rpp0705 created bytes'),
    operation: 'create',
    driver: 'unit-test-file',
  });

  assert.equal(create.applied, true);
  assert.equal(create.fastPathLaneUpdated, true);
  assert.equal(readFixture(rootDir, createPath), 'rpp0705 created bytes');
  assert.equal(create.storageGuard.operation, 'create');
  assert.equal(create.storageGuard.outcome, 'applied');
  assert.equal(create.storageGuard.bytesCompared, 0);
  assert.equal(create.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(create.storageGuard.fsyncEvidence.targetDirectory.status, 'passed');
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);

  for (const evidence of [update.storageGuard, create.storageGuard]) {
    const serialized = JSON.stringify(evidence);
    assert.doesNotMatch(serialized, /rpp0705 (?:old|planned|created) bytes/);
    assert.doesNotMatch(serialized, new RegExp(rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('filesystem fsync evidence rejects stale storage after temp fsync without a lane update', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0705-stale-test-');
  const logicalPath = 'wp-content/uploads/rpp-0705/stale.txt';
  writeFixture(rootDir, logicalPath, 'rpp0705 expected bytes');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  const stale = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath,
    expectedResource: { resourceKeyHash: 'stale-resource-hash', expectedStorageHash: filesystemStorageHash(expectedStorage) },
    expectedStorage,
    plannedContents: 'rpp0705 should not overwrite drift',
    operation: 'update',
    driver: 'unit-test-file',
    afterTempFsync: ({ absolutePath }) => {
      fs.writeFileSync(absolutePath, 'rpp0705 drifted bytes');
    },
  });

  assert.equal(stale.applied, false);
  assert.equal(stale.fastPathLaneUpdated, false);
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(stale.storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(stale.storageGuard.renameAttempted, false);
  assert.equal(stale.storageGuard.tempRemovedOnBlockedWrite, true);
  assert.equal(stale.storageGuard.fastPathLane.updated, false);
  assert.ok(stale.storageGuard.fastPathLane.blockedBy.includes('live-storage-mismatch'));
  assert.equal(stale.storageGuard.correctnessGates.find((gate) => gate.id === 'live-storage-precondition-match').status, 'fail');
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0705 drifted bytes');
  assert.notEqual(stale.storageGuard.actualStorageHash, stale.storageGuard.expectedStorageHash);
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
  assert.doesNotMatch(JSON.stringify(stale.storageGuard), /expected bytes|drifted bytes|should not overwrite/);
});

test('filesystem fsync evidence blocks rename and lane update when temp fsync fails', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0705-temp-fsync-test-');
  const logicalPath = 'wp-content/uploads/rpp-0705/temp-fsync.txt';
  writeFixture(rootDir, logicalPath, 'rpp0705 stable bytes');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  const blocked = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath,
    expectedResource: { resourceKeyHash: 'temp-fsync-resource-hash', expectedStorageHash: filesystemStorageHash(expectedStorage) },
    expectedStorage,
    plannedContents: 'rpp0705 unfsynced bytes',
    operation: 'update',
    driver: 'unit-test-file',
    fsyncFileSync: () => {
      throw codedError('EIO');
    },
  });

  assert.equal(blocked.applied, false);
  assert.equal(blocked.fastPathLaneUpdated, false);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0705 stable bytes');
  assert.equal(blocked.storageGuard.outcome, 'fsync-failed-before-rename');
  assert.equal(blocked.storageGuard.fsyncEvidence.tempFile.status, 'failed');
  assert.equal(blocked.storageGuard.fsyncEvidence.tempFile.errorCode, 'EIO');
  assert.equal(blocked.storageGuard.fsyncEvidence.targetDirectory.status, 'not-attempted');
  assert.equal(blocked.storageGuard.renameAttempted, false);
  assert.ok(blocked.storageGuard.fastPathLane.blockedBy.includes('temp-file-fsync-missing'));
  assert.equal(blocked.storageGuard.correctnessGates[0].status, 'fail');
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
  assert.doesNotMatch(JSON.stringify(blocked.storageGuard), /unfsynced bytes|stable bytes|fixture EIO failure/);
});

test('filesystem fsync evidence withholds fast-path lane update when directory fsync fails', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0705-dir-fsync-test-');
  const logicalPath = 'wp-content/uploads/rpp-0705/dir-fsync.txt';
  writeFixture(rootDir, logicalPath, 'rpp0705 before dir fsync');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  const incomplete = applyFilesystemFsyncEvidenceWrite({
    rootDir,
    logicalPath,
    expectedResource: { resourceKeyHash: 'dir-fsync-resource-hash', expectedStorageHash: filesystemStorageHash(expectedStorage) },
    expectedStorage,
    plannedContents: 'rpp0705 after dir fsync failure',
    operation: 'update',
    driver: 'unit-test-file',
    fsyncDirectorySync: () => {
      throw codedError('EINVAL');
    },
  });

  assert.equal(incomplete.applied, true);
  assert.equal(incomplete.fastPathLaneUpdated, false);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0705 after dir fsync failure');
  assert.equal(incomplete.storageGuard.outcome, 'applied-fsync-incomplete');
  assert.equal(incomplete.storageGuard.fsyncEvidence.tempFile.status, 'passed');
  assert.equal(incomplete.storageGuard.fsyncEvidence.targetDirectory.status, 'failed');
  assert.equal(incomplete.storageGuard.fsyncEvidence.targetDirectory.errorCode, 'EINVAL');
  assert.equal(incomplete.storageGuard.fastPathLane.updated, false);
  assert.ok(incomplete.storageGuard.fastPathLane.blockedBy.includes('target-directory-fsync-missing'));
  assert.equal(
    incomplete.storageGuard.correctnessGates.find((gate) => gate.id === 'target-directory-fsync-after-rename').status,
    'fail',
  );
  assert.equal(
    incomplete.storageGuard.correctnessGates.find((gate) => gate.id === 'post-rename-storage-matches-planned').status,
    'pass',
  );
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
});

test('filesystem fsync evidence rejects paths outside the storage root', () => {
  const rootDir = createFilesystemFsyncTempRoot('reprint-rpp-0705-path-test-');

  assert.throws(
    () => resolveFilesystemGuardPath(rootDir, '../outside.txt'),
    /escapes rootDir/,
  );
  assert.throws(
    () => applyFilesystemFsyncEvidenceWrite({
      rootDir,
      logicalPath: path.join('..', 'outside.txt'),
      expectedStorage: { exists: false, value: null },
      plannedContents: 'blocked',
    }),
    /escapes rootDir/,
  );
});
