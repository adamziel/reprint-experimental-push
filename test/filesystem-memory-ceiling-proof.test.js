import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_MEMORY_CEILING_BOUNDARY,
  applyFilesystemMemoryCeilingWrite,
  createFilesystemMemoryCeilingTempRoot,
} from '../src/filesystem-memory-ceiling-proof.js';
import {
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
  resolveFilesystemGuardPath,
} from '../src/filesystem-compare-rename-write.js';

const chunkSizeBytes = 4096;
const maxBufferedBytes = 4096;

function writeFixture(rootDir, logicalPath, contents) {
  const absolutePath = path.join(rootDir, logicalPath);
  ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents);
}

function readFixture(rootDir, logicalPath) {
  return fs.readFileSync(path.join(rootDir, logicalPath), 'utf8');
}

function deterministicChunkSource(label) {
  return ({ offset, size }) => {
    const buffer = Buffer.allocUnsafe(size);
    let written = 0;
    let blockIndex = 0;
    while (written < buffer.length) {
      const block = crypto
        .createHash('sha256')
        .update(`rpp-0717-test:${label}:${offset + written}:${blockIndex}`)
        .digest();
      const copied = Math.min(block.length, buffer.length - written);
      block.copy(buffer, written, 0, copied);
      written += copied;
      blockIndex += 1;
    }
    return buffer;
  };
}

test('filesystem memory ceiling applies matching update and create writes with bounded payload chunks', () => {
  const rootDir = createFilesystemMemoryCeilingTempRoot('reprint-rpp-0717-test-');
  const updatePath = 'wp-content/uploads/rpp-0717/update.bin';
  const createPath = 'wp-content/uploads/rpp-0717/create.bin';
  const fileBytes = chunkSizeBytes * 3;
  writeFixture(rootDir, updatePath, 'rpp0717 old bytes');

  const expectedUpdate = readFilesystemStorageDescriptor({ rootDir, logicalPath: updatePath });
  const update = applyFilesystemMemoryCeilingWrite({
    rootDir,
    logicalPath: updatePath,
    expectedResource: { resourceKeyHash: 'update-resource-hash', expectedStorageHash: filesystemStorageHash(expectedUpdate) },
    expectedStorage: expectedUpdate,
    plannedSizeBytes: fileBytes,
    createChunk: deterministicChunkSource('update-planned'),
    operation: 'update',
    driver: 'unit-test-file',
    chunkSizeBytes,
    maxBufferedBytes,
  });

  assert.equal(update.applied, true);
  assert.equal(update.storageGuard.boundary, FILESYSTEM_MEMORY_CEILING_BOUNDARY);
  assert.equal(update.storageGuard.operation, 'update');
  assert.equal(update.storageGuard.outcome, 'applied');
  assert.equal(update.storageGuard.sameDirectoryTemp, true);
  assert.equal(update.storageGuard.compareBeforeRename, true);
  assert.equal(update.storageGuard.renameAttempted, true);
  assert.equal(update.storageGuard.bytesWrittenToTemp, fileBytes);
  assert.equal(update.storageGuard.memoryCeiling.totalPlannedBytes, fileBytes);
  assert.equal(update.storageGuard.memoryCeiling.chunkSizeBytes, chunkSizeBytes);
  assert.equal(update.storageGuard.memoryCeiling.maxBufferedBytes, maxBufferedBytes);
  assert.equal(update.storageGuard.memoryCeiling.maxObservedBufferedBytes, maxBufferedBytes);
  assert.equal(update.storageGuard.memoryCeiling.chunkCount, 3);
  assert.equal(update.storageGuard.memoryCeiling.payloadBytesGreaterThanCeiling, true);
  assert.equal(update.storageGuard.memoryCeiling.ceilingHeld, true);
  assert.equal(update.storageGuard.memoryCeiling.fullPayloadBufferUsed, false);
  assert.equal(update.storageGuard.memoryCeiling.plannedPayloadMaterialized, false);
  assert.deepEqual(update.storageGuard.steps, [
    'stream-planned-chunks-to-temp',
    'read-live-storage',
    'compare-expected-storage-hash',
    'rename-temp-to-target',
  ]);
  assert.match(update.storageGuard.physicalPathHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.expectedResourceHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.actualStorageHash, /^[a-f0-9]{64}$/);
  assert.match(update.storageGuard.plannedStorageHash, /^[a-f0-9]{64}$/);

  const updateAfter = readFilesystemStorageDescriptor({ rootDir, logicalPath: updatePath });
  assert.equal(filesystemStorageHash(updateAfter), update.storageGuard.plannedStorageHash);

  const expectedCreate = readFilesystemStorageDescriptor({ rootDir, logicalPath: createPath });
  const create = applyFilesystemMemoryCeilingWrite({
    rootDir,
    logicalPath: createPath,
    expectedResource: { resourceKeyHash: 'create-resource-hash', expectedStorageHash: filesystemStorageHash(expectedCreate) },
    expectedStorage: expectedCreate,
    plannedSizeBytes: fileBytes,
    createChunk: deterministicChunkSource('create-planned'),
    operation: 'create',
    driver: 'unit-test-file',
    chunkSizeBytes,
    maxBufferedBytes,
  });

  assert.equal(create.applied, true);
  assert.equal(create.storageGuard.operation, 'create');
  assert.equal(create.storageGuard.outcome, 'applied');
  assert.equal(create.storageGuard.bytesCompared, 0);
  assert.equal(create.storageGuard.memoryCeiling.chunkCount, 3);
  assert.equal(create.storageGuard.memoryCeiling.ceilingHeld, true);
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);

  for (const evidence of [update.storageGuard, create.storageGuard]) {
    const serialized = JSON.stringify(evidence);
    assert.doesNotMatch(serialized, /rpp0717 (?:old|planned|created) bytes/);
    assert.doesNotMatch(serialized, new RegExp(rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('filesystem memory ceiling rejects stale storage after streamed temp write and removes the temp file', () => {
  const rootDir = createFilesystemMemoryCeilingTempRoot('reprint-rpp-0717-stale-test-');
  const logicalPath = 'wp-content/uploads/rpp-0717/stale.txt';
  writeFixture(rootDir, logicalPath, 'rpp0717 expected bytes');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  const stale = applyFilesystemMemoryCeilingWrite({
    rootDir,
    logicalPath,
    expectedResource: { resourceKeyHash: 'stale-resource-hash', expectedStorageHash: filesystemStorageHash(expectedStorage) },
    expectedStorage,
    plannedSizeBytes: chunkSizeBytes * 2,
    createChunk: deterministicChunkSource('stale-planned'),
    operation: 'update',
    driver: 'unit-test-file',
    chunkSizeBytes,
    maxBufferedBytes,
    afterTempWrite: ({ absolutePath }) => {
      fs.writeFileSync(absolutePath, 'rpp0717 drifted bytes');
    },
  });

  assert.equal(stale.applied, false);
  assert.equal(stale.storageGuard.boundary, FILESYSTEM_MEMORY_CEILING_BOUNDARY);
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.storageGuard.renameAttempted, false);
  assert.equal(stale.storageGuard.tempRemovedOnStale, true);
  assert.equal(stale.storageGuard.memoryCeiling.ceilingHeld, true);
  assert.equal(stale.storageGuard.memoryCeiling.chunkCount, 2);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0717 drifted bytes');
  assert.notEqual(stale.storageGuard.actualStorageHash, stale.storageGuard.expectedStorageHash);
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
  assert.doesNotMatch(JSON.stringify(stale.storageGuard), /expected bytes|drifted bytes|should not overwrite/);
});

test('filesystem memory ceiling rejects paths outside the storage root', () => {
  const rootDir = createFilesystemMemoryCeilingTempRoot('reprint-rpp-0717-path-test-');

  assert.throws(
    () => resolveFilesystemGuardPath(rootDir, '../outside.txt'),
    /escapes rootDir/,
  );
  assert.throws(
    () => applyFilesystemMemoryCeilingWrite({
      rootDir,
      logicalPath: path.join('..', 'outside.txt'),
      expectedStorage: { exists: false, value: null },
      plannedSizeBytes: 1,
      createChunk: () => Buffer.from('x'),
    }),
    /escapes rootDir/,
  );
});

test('filesystem memory ceiling fails closed when chunk size exceeds the configured ceiling', () => {
  const rootDir = createFilesystemMemoryCeilingTempRoot('reprint-rpp-0717-ceiling-test-');

  assert.throws(
    () => applyFilesystemMemoryCeilingWrite({
      rootDir,
      logicalPath: 'wp-content/uploads/rpp-0717/too-large.txt',
      expectedStorage: { exists: false, value: null },
      plannedSizeBytes: 8,
      createChunk: () => Buffer.from('oversize'),
      chunkSizeBytes: 8,
      maxBufferedBytes: 4,
    }),
    /chunkSizeBytes must not exceed maxBufferedBytes/,
  );
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
});
