import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBenchmarkModel,
  DEFAULT_LIMITS,
  MIB,
  SAFE_SPEEDUP_AREAS,
} from '../scripts/bench/performance-model.js';
import {
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';

test('benchmark model covers large uploads and plugin installs', () => {
  const model = buildBenchmarkModel();
  const largeUpload = model.schedules.find((schedule) => schedule.kind === 'large-upload');
  const pluginInstall = model.schedules.find((schedule) => schedule.kind === 'plugin-install');
  const pluginUpdate = model.schedules.find((schedule) => schedule.kind === 'plugin-update');

  assert.ok(largeUpload, 'large upload workload exists');
  assert.ok(pluginInstall, 'plugin install workload exists');
  assert.ok(pluginUpdate, 'plugin update workload exists');
  assert.ok(largeUpload.totals.uploadBytes >= 1024 * MIB, 'large upload is at least 1 GiB');
  assert.ok(largeUpload.totals.uploadChunks > 100, 'large upload is chunked enough to exercise resumability');
  assert.ok(pluginInstall.totals.uploadBytes >= 64 * MIB, 'plugin install includes substantial file transfer');
  assert.ok(pluginInstall.totals.dbRows >= 10_000, 'plugin install includes large row batches');
  assert.equal(pluginInstall.atomicGroupId, 'install-commerce-stack');
  assert.ok(pluginUpdate.totals.uploadBytes >= 16 * MIB, 'plugin update includes substantial file transfer');
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'db-row-batch'),
    'plugin update includes row batching',
  );
  assert.ok(pluginUpdate.atomicGroupId, 'plugin update has an atomic group id');
  assert.notEqual(pluginUpdate.atomicGroupId, pluginInstall.atomicGroupId);
});

test('safety contract covers required speedup areas and terminal states', () => {
  const model = buildBenchmarkModel();

  assert.equal(model.safetyContract.priority, 'fast-fourth');
  assert.deepEqual(model.safeSpeedupAreas, SAFE_SPEEDUP_AREAS);

  for (const state of ['unchanged', 'fully-changed', 'blocked-with-durable-recovery-evidence']) {
    assert.ok(model.safetyContract.acceptableTerminalStates.includes(state));
  }

  for (const area of [
    'file-hashing',
    'chunk-upload',
    'database-row-batching',
    'remote-indexes',
    'compression',
    'parallelism-limits',
    'backpressure',
  ]) {
    assert.ok(model.safeSpeedupAreas.includes(area), `missing safe speedup area ${area}`);
  }
});

test('file hashing and compression decisions preserve canonical hashes', () => {
  const model = buildBenchmarkModel();
  const hashActions = model.schedules.flatMap((schedule) =>
    schedule.actions.filter((action) => action.type === 'file-hash'),
  );
  const compressionActions = model.schedules.flatMap((schedule) =>
    schedule.actions.filter((action) => action.type === 'compression-decision'),
  );

  assert.ok(hashActions.length > 0);
  assert.ok(hashActions.every((action) => action.strongHashRequired === true));
  assert.ok(hashActions.every((action) => action.cacheKey.includes('previous-digest')));

  assert.ok(compressionActions.length > 0);
  assert.ok(
    compressionActions.every((action) =>
      action.canonicalHashEncoding === 'uncompressed-resource-value'
    ),
  );
  assert.ok(compressionActions.some((action) =>
    action.mimeType === 'application/zip' && action.transportEncoding === 'identity'
  ));
  assert.ok(compressionActions.some((action) => action.transportEncoding === 'zstd'));
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
  assert.ok(chunkUploads.every((action) => action.durableEvidence));
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
  assert.ok(dbBatches.every((batch) => batch.durableEvidence));
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

test('plugin update keeps staged work behind the same recovery barriers', () => {
  const model = buildBenchmarkModel();
  const pluginUpdate = model.schedules.find((schedule) => schedule.kind === 'plugin-update');
  const finalize = pluginUpdate.actions.find((action) => action.type === 'group-staging-finalize');
  const commit = pluginUpdate.actions.find((action) => action.type === 'atomic-group-commit');
  const visibleBeforeCommit = pluginUpdate.actions.filter(
    (action) => action.atomicGroupId === pluginUpdate.atomicGroupId && action.type !== 'atomic-group-commit' && action.canonicalVisible === true,
  );

  assert.ok(finalize, 'plugin update should include a staging finalize record');
  assert.equal(finalize.atomicGroupId, pluginUpdate.atomicGroupId);
  assert.equal(finalize.finalizeMode, 'receipts-plus-live-preconditions');
  assert.equal(commit.atomicGroupId, pluginUpdate.atomicGroupId);
  assert.equal(commit.commitPolicy, 'all-or-nothing');
  assert.equal(visibleBeforeCommit.length, 0);
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

test('rejected fast paths cover precondition bypasses and atomic group splits', () => {
  const model = buildBenchmarkModel();
  const rejectedById = new Map(
    model.rejectedFastPaths.map((fastPath) => [fastPath.id, fastPath]),
  );

  assert.equal(rejectedById.get('fresh-dry-run-authorizes-apply').violates[0], 'live-preconditions');
  assert.ok(rejectedById.get('remote-index-authorizes-mutation').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('split-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('live-chunk-publish').violates.includes('known-terminal-state'));
  assert.ok(rejectedById.get('blind-sql-replace').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-row-batch-replaces-atomic-group').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('parallel-finalize-merged-across-groups').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('backpressure-drops-queued-receipts').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('unbounded-parallel-large-upload-resume').violates.includes('backpressure'));
  assert.ok(rejectedById.get('unbounded-parallel-large-upload-resume').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('unbounded-parallel-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-skips-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-replaces-chunk-receipts').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-upload-queue-replaces-chunk-receipts').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-replaces-chunk-receipts').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume-after-pause').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume-after-pause').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('cached-chunk-ledger-skips-large-upload-finalize').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('cached-chunk-ledger-skips-large-upload-finalize').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-receipt-summary-replaces-recovery-log').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-receipt-summary-replaces-recovery-log').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('index-and-compressed-row-batch-skips-backpressure').violates.includes('backpressure'));
  assert.ok(rejectedById.get('index-and-compressed-row-batch-skips-backpressure').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('compression'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('remote-index-and-cached-package-hash-skips-plugin-dependency-checks').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('remote-index-and-cached-package-hash-skips-plugin-dependency-checks').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.ok(model.rejectedFastPaths.every((fastPath) => fastPath.rejectedBecause));
});

test('safe fast paths retain all gate proofs and stay non-rejectable', () => {
  const model = buildBenchmarkModel();

  assert.ok(model.safeFastPaths.length > 0);
  assert.ok(model.safeFastPaths.every((fastPath) => fastPath.bypassesLivePreconditions === false));
  assert.ok(model.safeFastPaths.every((fastPath) => fastPath.splitsAtomicGroup === false));
  assert.ok(model.safeFastPaths.every((fastPath) => fastPath.publishesStagedDataEarly === false));
  assert.ok(
    model.safeFastPaths.every((fastPath) =>
      fastPath.gateProofs.skip &&
      fastPath.gateProofs.live &&
      fastPath.gateProofs.group &&
      fastPath.gateProofs.recovery
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'reuse-cached-chunk-ledger-for-resume-with-live-publish-check' &&
      fastPath.gateProofs.recovery.includes('publish record')
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'compress-durable-receipt-logs-with-stable-receipt-keys' &&
      fastPath.gateProofs.recovery.includes('stable receipt keys')
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'compress-chunk-transit-frames-with-canonical-chunk-digests' &&
      fastPath.gateProofs.recovery.includes('durable chunk receipts')
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'reuse-planned-dependency-graph-for-plugin-update-with-live-finalize' &&
      fastPath.gateProofs.group.includes('atomic-group commit barrier')
    ),
  );
  assert.ok(
    model.safeFastPaths.every((fastPath) =>
      typeof fastPath.visibilityBoundary === 'string' && fastPath.visibilityBoundary.length > 0
    ),
  );
});

test('failure injection boundaries include every durable transition in the benchmark shape', () => {
  const model = buildBenchmarkModel();
  const boundaries = new Set(
    model.failureInjectionBoundaries.map((entry) => entry.boundary),
  );

  for (const boundary of [
    'chunk-ack',
    'db-batch-commit',
    'group-staging-finalize',
    'atomic-group-commit',
  ]) {
    assert.ok(boundaries.has(boundary), `missing failure injection boundary ${boundary}`);
  }

  assert.ok(
    model.failureInjectionBoundaries.every((entry) =>
      entry.beforeState && entry.afterState && entry.recoveryEvidence
    ),
  );
});

test('production throughput stays blocked until measured storage receipts exist', () => {
  const report = runGuardedExecutorBenchmark({ profile: 'unit' });
  const blockers = new Set(report.claims.productionThroughput.blockers);

  assert.equal(report.claims.productionThroughput.status, 'blocked');
  assert.ok(blockers.has('production-atomic-group-commit-not-measured'));
  assert.ok(blockers.has('production-storage-receipts-not-measured'));
  assert.ok(blockers.has('production-row-batch-executor-not-measured'));
});
