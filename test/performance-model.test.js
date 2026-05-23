import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBenchmarkModel,
  DEFAULT_LIMITS,
  MIB,
} from '../scripts/bench/performance-model.js';

test('benchmark model covers large uploads and plugin installs', () => {
  const model = buildBenchmarkModel();
  const largeUpload = model.schedules.find((schedule) => schedule.kind === 'large-upload');
  const pluginInstall = model.schedules.find((schedule) => schedule.kind === 'plugin-install');

  assert.ok(largeUpload, 'large upload workload exists');
  assert.ok(pluginInstall, 'plugin install workload exists');
  assert.ok(largeUpload.totals.uploadBytes >= 1024 * MIB, 'large upload is at least 1 GiB');
  assert.ok(largeUpload.totals.uploadChunks > 100, 'large upload is chunked enough to exercise resumability');
  assert.ok(pluginInstall.totals.uploadBytes >= 64 * MIB, 'plugin install includes substantial file transfer');
  assert.ok(pluginInstall.totals.dbRows >= 10_000, 'plugin install includes large row batches');
  assert.equal(pluginInstall.atomicGroupId, 'install-commerce-stack');
});

test('chunk uploads stay staged until a guarded publish step', () => {
  const model = buildBenchmarkModel();
  const chunkUploads = model.schedules.flatMap((schedule) =>
    schedule.actions.filter((action) => action.type === 'chunk-upload'),
  );
  const filePublishes = model.schedules.flatMap((schedule) =>
    schedule.actions.filter((action) => action.type === 'file-publish'),
  );

  assert.ok(chunkUploads.length > 0);
  assert.ok(chunkUploads.every((action) => action.destination === 'plan-staging'));
  assert.ok(chunkUploads.every((action) => action.canonicalVisible === false));
  assert.ok(chunkUploads.every((action) => action.chunkDigest.startsWith('sha256:')));
  assert.ok(chunkUploads.every((action) => action.idempotencyKey));

  assert.ok(filePublishes.length > 0);
  assert.ok(filePublishes.every((action) => action.precondition?.expectedHash));
  assert.ok(filePublishes.every((action) => action.assembledHash?.startsWith('sha256:')));
});

test('database batching is bounded and keeps per-row preconditions', () => {
  const model = buildBenchmarkModel();
  const dbBatches = model.schedules.flatMap((schedule) =>
    schedule.actions.filter((action) => action.type === 'db-row-batch'),
  );

  assert.ok(dbBatches.length > 10, 'benchmark has enough batches to exercise batching');
  assert.ok(dbBatches.every((batch) => batch.rowCount <= DEFAULT_LIMITS.maxDbBatchRows));
  assert.ok(dbBatches.every((batch) => batch.preconditions.kind === 'per-row-hash'));
  assert.ok(dbBatches.every((batch) => batch.preconditions.count === batch.rowCount));
  assert.ok(dbBatches.every((batch) => batch.order === 'primary-key'));
  assert.ok(dbBatches.every((batch) => batch.idempotencyKey));
});

test('plugin install remains invisible until the atomic group commit', () => {
  const model = buildBenchmarkModel();
  const pluginInstall = model.schedules.find((schedule) => schedule.kind === 'plugin-install');
  const memberActions = pluginInstall.actions.filter((action) =>
    action.atomicGroupId === pluginInstall.atomicGroupId && action.type !== 'atomic-group-commit',
  );
  const commit = pluginInstall.actions.find((action) => action.type === 'atomic-group-commit');
  const visibleBeforeCommit = memberActions.filter((action) => action.canonicalVisible === true);

  assert.ok(memberActions.length > 0);
  assert.deepEqual(visibleBeforeCommit, []);
  assert.ok(commit);
  assert.equal(commit.atomicGroupId, pluginInstall.atomicGroupId);
  assert.equal(commit.commitPolicy, 'all-or-nothing');
  assert.equal(commit.preconditions, 'recheck-all-member-resource-hashes');
});

test('parallelism limits and backpressure budgets are explicit', () => {
  const model = buildBenchmarkModel();

  assert.equal(model.remoteIndex.use, 'planning-only');
  assert.equal(model.remoteIndex.forbiddenUse, 'apply-authorization');

  for (const schedule of model.schedules) {
    assert.equal(schedule.parallelism.remoteIndex, 1);
    assert.ok(schedule.parallelism.hash <= DEFAULT_LIMITS.maxHashConcurrency);
    assert.ok(schedule.parallelism.upload <= DEFAULT_LIMITS.maxUploadConcurrency);
    assert.ok(schedule.parallelism.dbPerTable <= DEFAULT_LIMITS.maxDbConcurrencyPerTable);
    assert.ok(schedule.backpressure.maxInFlightUploadBytes <= DEFAULT_LIMITS.maxBufferedUploadBytes);
    assert.ok(schedule.backpressure.maxQueuedDbBatches <= DEFAULT_LIMITS.maxPendingDbBatches);
    assert.ok(schedule.backpressure.pauseWhen.includes('journal-fsync-lag'));
  }
});
