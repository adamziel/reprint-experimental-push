import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_COMPARE_RENAME_BOUNDARY,
  applyFilesystemCompareRenameWrite,
  createFilesystemCompareRenameTempRoot,
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

test('filesystem compare-and-rename applies matching update and create writes with hash-only evidence', () => {
  const rootDir = createFilesystemCompareRenameTempRoot('reprint-rpp-0704-test-');
  const updatePath = 'wp-content/uploads/rpp-0704/update.txt';
  const createPath = 'wp-content/uploads/rpp-0704/create.txt';
  writeFixture(rootDir, updatePath, 'rpp0704 old bytes');

  const expectedUpdate = readFilesystemStorageDescriptor({ rootDir, logicalPath: updatePath });
  const update = applyFilesystemCompareRenameWrite({
    rootDir,
    logicalPath: updatePath,
    expectedResource: { resourceKeyHash: 'update-resource-hash', expectedStorageHash: filesystemStorageHash(expectedUpdate) },
    expectedStorage: expectedUpdate,
    plannedContents: 'rpp0704 planned bytes',
    operation: 'update',
    driver: 'unit-test-file',
  });
  assert.equal(update.applied, true);
  assert.equal(readFixture(rootDir, updatePath), 'rpp0704 planned bytes');
  assert.equal(update.storageGuard.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(update.storageGuard.operation, 'update');
  assert.equal(update.storageGuard.outcome, 'applied');
  assert.equal(update.storageGuard.sameDirectoryTemp, true);
  assert.equal(update.storageGuard.compareBeforeRename, true);
  assert.equal(update.storageGuard.renameAttempted, true);
  assert.match(update.storageGuard.physicalPathHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.actualStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.plannedStorageHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(update.storageGuard.comparedFields, ['exists', 'type', 'sizeBytes', 'contentHash']);
  assert.deepEqual(update.storageGuard.steps, [
    'write-temp-same-directory',
    'read-live-storage',
    'compare-expected-storage-hash',
    'rename-temp-to-target',
  ]);

  const expectedCreate = readFilesystemStorageDescriptor({ rootDir, logicalPath: createPath });
  const create = applyFilesystemCompareRenameWrite({
    rootDir,
    logicalPath: createPath,
    expectedResource: { resourceKeyHash: 'create-resource-hash', expectedStorageHash: filesystemStorageHash(expectedCreate) },
    expectedStorage: expectedCreate,
    plannedContents: Buffer.from('rpp0704 created bytes'),
    operation: 'create',
    driver: 'unit-test-file',
  });
  assert.equal(create.applied, true);
  assert.equal(readFixture(rootDir, createPath), 'rpp0704 created bytes');
  assert.equal(create.storageGuard.operation, 'create');
  assert.equal(create.storageGuard.outcome, 'applied');
  assert.equal(create.storageGuard.renameAttempted, true);
  assert.equal(create.storageGuard.bytesCompared, 0);
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);

  for (const evidence of [update.storageGuard, create.storageGuard]) {
    const serialized = JSON.stringify(evidence);
    assert.doesNotMatch(serialized, /rpp0704 (?:old|planned|created) bytes/);
    assert.doesNotMatch(serialized, new RegExp(rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('filesystem compare-and-rename rejects stale storage after temp write and removes the temp file', () => {
  const rootDir = createFilesystemCompareRenameTempRoot('reprint-rpp-0704-stale-test-');
  const logicalPath = 'wp-content/uploads/rpp-0704/stale.txt';
  writeFixture(rootDir, logicalPath, 'rpp0704 expected bytes');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  const stale = applyFilesystemCompareRenameWrite({
    rootDir,
    logicalPath,
    expectedResource: { resourceKeyHash: 'stale-resource-hash', expectedStorageHash: filesystemStorageHash(expectedStorage) },
    expectedStorage,
    plannedContents: 'rpp0704 should not overwrite drift',
    operation: 'update',
    driver: 'unit-test-file',
    afterTempWrite: ({ absolutePath }) => {
      fs.writeFileSync(absolutePath, 'rpp0704 drifted bytes');
    },
  });

  assert.equal(stale.applied, false);
  assert.equal(stale.storageGuard.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.storageGuard.renameAttempted, false);
  assert.equal(stale.storageGuard.tempRemovedOnStale, true);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0704 drifted bytes');
  assert.notEqual(stale.storageGuard.actualStorageHash, stale.storageGuard.expectedStorageHash);
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
  assert.doesNotMatch(JSON.stringify(stale.storageGuard), /expected bytes|drifted bytes|should not overwrite/);
});

test('filesystem compare-and-rename rejects paths outside the storage root', () => {
  const rootDir = createFilesystemCompareRenameTempRoot('reprint-rpp-0704-path-test-');

  assert.throws(
    () => resolveFilesystemGuardPath(rootDir, '../outside.txt'),
    /escapes rootDir/,
  );
  assert.throws(
    () => applyFilesystemCompareRenameWrite({
      rootDir,
      logicalPath: path.join('..', 'outside.txt'),
      expectedStorage: { exists: false, value: null },
      plannedContents: 'blocked',
    }),
    /escapes rootDir/,
  );
});
