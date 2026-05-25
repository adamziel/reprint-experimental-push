import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBenchmarkModel,
  buildFastPathFixture,
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
  const releaseBundle = model.schedules.find((schedule) => schedule.kind === 'release-bundle');

  assert.ok(largeUpload, 'large upload workload exists');
  assert.ok(pluginInstall, 'plugin install workload exists');
  assert.ok(pluginUpdate, 'plugin update workload exists');
  assert.ok(releaseBundle, 'release bundle workload exists');
  assert.ok(largeUpload.totals.uploadBytes >= 1024 * MIB, 'large upload is at least 1 GiB');
  assert.ok(largeUpload.totals.uploadChunks > 100, 'large upload is chunked enough to exercise resumability');
  assert.ok(pluginInstall.totals.uploadBytes >= 64 * MIB, 'plugin install includes substantial file transfer');
  assert.ok(pluginInstall.totals.dbRows >= 10_000, 'plugin install includes large row batches');
  assert.ok(pluginInstall.totals.uploadChunks > 10, 'plugin install is chunked enough to exercise chunk receipts');
  assert.equal(pluginInstall.atomicGroupId, 'install-commerce-stack');
  assert.ok(pluginUpdate.totals.uploadBytes >= 16 * MIB, 'plugin update includes substantial file transfer');
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'db-row-batch'),
    'plugin update includes row batching',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'db-batch-parallelism'),
    'plugin install includes bounded row-batch parallelism',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'db-batch-parallelism'),
    'plugin update includes bounded row-batch parallelism',
  );
  assert.ok(pluginUpdate.atomicGroupId, 'plugin update has an atomic group id');
  assert.notEqual(pluginUpdate.atomicGroupId, pluginInstall.atomicGroupId);
  assert.equal(releaseBundle.atomicGroupId, 'release-bundle-commerce-stack');
  assert.ok(releaseBundle.totals.uploadBytes >= 128 * MIB, 'release bundle includes large upload traffic');
  assert.ok(releaseBundle.totals.dbRows >= 10_000, 'release bundle includes large row batches');
  assert.ok(releaseBundle.actions.some((action) => action.type === 'remote-index-probe'), 'release bundle models remote-index planning');
  assert.ok(releaseBundle.actions.some((action) => action.type === 'compression-decision'), 'release bundle models compression decisions');
  assert.ok(releaseBundle.actions.some((action) => action.type === 'backpressure-pause'), 'release bundle models backpressure pauses');
  assert.ok(releaseBundle.actions.some((action) => action.type === 'group-staging-finalize'), 'release bundle preserves atomic-group finalization');

  assert.ok(
    largeUpload.actions.some((action) => action.type === 'compression-decision'),
    'large upload models compression decisions',
  );
  assert.ok(
    largeUpload.actions.some(
      (action) =>
        action.type === 'compression-decision' &&
        action.transportEncoding === 'zstd' &&
        action.canonicalHashEncoding === 'uncompressed-resource-value',
    ),
    'large upload models transport-only compression for compressible content',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'chunk-window-sizing' && action.reusesPlanningCursor === true),
    'large upload models bounded chunk-window sizing from planning evidence',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'chunk-window-sizing' && action.reusesDurableReceipts === true),
    'large upload models bounded chunk-window sizing from durable receipts',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'backpressure-pause'),
    'large upload models backpressure pauses',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'durable-receipt-flush' && action.preservesRawReceipts),
    'large upload models bounded durable-receipt flushing',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'remote-index-probe'),
    'plugin install models remote-index planning',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'compression-decision'),
    'plugin install models compression decisions',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'remote-index-probe'),
    'plugin update models remote-index planning',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'backpressure-pause'),
    'plugin update models backpressure pauses',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'compression-decision' && action.transportEncoding === 'zstd'),
    'plugin update models transport-only compression for compressible assets',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'durable-receipt-flush'),
    'plugin update models bounded durable-receipt flushing',
  );
  assert.ok(
    releaseBundle.actions.some((action) => action.type === 'durable-receipt-flush' && action.preservesRawReceipts),
    'release bundle models bounded durable-receipt flushing',
  );
  assert.ok(
    releaseBundle.actions.some((action) => action.type === 'atomic-group-commit' && action.commitPolicy === 'all-or-nothing'),
    'release bundle keeps the atomic group commit barrier explicit',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'chunk-upload' && action.durableEvidence),
    'large upload exposes durable chunk receipts',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'db-row-batch' && action.durableEvidence),
    'plugin install exposes durable row receipts',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'group-staging-finalize'),
    'plugin update exposes group finalize records',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'file-hash'),
    'large upload models file hashing',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'remote-index-probe' && action.applyMustRevalidate === true),
    'large upload keeps remote-index planning separate from apply authorization',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'file-publish' && action.publishMode === 'compare-and-swap'),
    'large upload uses guarded file publish',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'remote-index-probe'),
    'plugin install models remote-index planning',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'backpressure-pause'),
    'plugin install models backpressure pauses',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'remote-index-probe' && action.applyMustRevalidate === true),
    'plugin install keeps remote-index planning separate from apply authorization',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'durable-receipt-flush'),
    'plugin install models bounded durable-receipt flushing',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'plugin-metadata-stage' && action.canonicalVisible === false),
    'plugin install keeps metadata staging invisible until commit',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'group-staging-finalize' && action.finalizeMode === 'receipts-plus-live-preconditions'),
    'plugin install keeps the group barrier intact during finalize',
  );
  assert.ok(
    pluginInstall.actions.some(
      (action) =>
        action.type === 'db-batch-parallelism' &&
        action.boundedByAtomicGroup === true &&
        action.perTableLimit === DEFAULT_LIMITS.maxDbConcurrencyPerTable,
    ),
    'plugin install keeps row-batch parallelism inside the atomic-group boundary',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'atomic-group-commit' && action.commitPolicy === 'all-or-nothing'),
    'plugin install keeps the atomic group commit barrier explicit',
  );
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

test('fast-path proofs and rejections carry the expected gate metadata', () => {
  const model = buildBenchmarkModel();
  const rejectedById = new Map(model.rejectedFastPaths.map((fastPath) => [fastPath.id, fastPath]));
  const rejectedAreas = new Set(model.rejectedFastPaths.map((fastPath) => fastPath.violates).flat());

  assert.ok(model.safeFastPaths.length > 0);
  assert.ok(model.rejectedFastPaths.length > 0);
  assert.ok(
    model.safeFastPaths.every((fastPath) =>
      fastPath.gateProofs &&
      typeof fastPath.gateProofs.skip === 'string' &&
      typeof fastPath.gateProofs.live === 'string' &&
      typeof fastPath.gateProofs.group === 'string' &&
      typeof fastPath.gateProofs.recovery === 'string' &&
      typeof fastPath.visibilityBoundary === 'string' &&
      typeof fastPath.failureEvidence === 'string' &&
      fastPath.bypassesLivePreconditions === false &&
      fastPath.splitsAtomicGroup === false &&
      fastPath.publishesStagedDataEarly === false,
    ),
  );
  assert.ok(
    model.rejectedFastPaths.every((fastPath) =>
      typeof fastPath.rejectedGate === 'string' &&
      Array.isArray(fastPath.violates) &&
      fastPath.violates.length > 0,
    ),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'cached-manifest-hash-skips-large-upload-publish')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-compressed-upload-queue-skips-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-window-sizing')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-live-compare-before-publish')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause')?.violates.includes('file-hashing'),
    'cached chunk hashes still cannot bypass file hashing preconditions',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause')?.violates.includes('chunk-receipts'),
    'cached chunk hashes still cannot bypass durable chunk receipts',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause')?.violates.includes('backpressure'),
    'cached chunk hashes still cannot bypass backpressure recovery evidence',
  );
  for (const area of [
    'file-hashing',
    'chunk-receipts',
    'row-preconditions',
    'remote-index-planning-only',
    'compression',
    'parallelism-limits',
    'backpressure',
    'atomic-groups',
  ]) {
    assert.ok(rejectedAreas.has(area), `missing rejection coverage for ${area}`);
  }
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-receipt-flush-skips-large-upload-publish-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-publish-after-pause')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-digest-skips-large-upload-publish')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-publish')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-digests-skips-large-upload-window-sizing')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-window-sizing')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-live-compare-before-publish')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-live-compare-before-publish')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-live-compare-before-publish')?.violates.includes('atomic-file-publish'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-summary-skips-plugin-update-finalize')?.rejectedGate,
    'group',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-summary-skips-plugin-update-finalize')?.violates.includes('atomic-groups'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-row-preconditions')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-writeback')?.rejectedGate,
    'group',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-row-preconditions')?.violates.includes('row-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-row-preconditions')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-writeback')?.violates.includes('durable-progress'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-db-receipts-skips-plugin-install-row-preconditions-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-hash-fanout-skips-large-upload-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-backpressure-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause')?.violates.includes('backpressure'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause')?.rejectedGate,
    'group',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.violates.includes('compression'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause')?.violates.includes('durable-progress'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-db-receipts-skips-plugin-install-row-preconditions-after-pause')?.violates.includes('database-row-batching'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-db-receipts-skips-plugin-install-row-preconditions-after-pause')?.violates.includes('row-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-db-receipts-skips-plugin-install-row-preconditions-after-pause')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-db-receipts-skips-plugin-install-row-preconditions-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-hash-fanout-skips-large-upload-backpressure')?.violates.includes('parallelism-limits'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-backpressure')?.violates.includes('parallelism-limits'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-backpressure')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-backpressure-after-pause')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-backpressure-after-pause')?.violates.includes('backpressure'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-publish-after-pause-and-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-publish-after-pause-and-backpressure')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause')?.violates.includes('durable-progress'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.violates.includes('compression'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause')?.violates.includes('durable-progress'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize-after-pause')?.violates.includes('row-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-barrier')?.rejectedGate,
    'group',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-barrier')?.violates.includes('parallelism-limits'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.rejectedGate,
    'group',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.violates.includes('compression'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.violates.includes('row-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery')?.violates.includes('durable-progress'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.violates.includes('compression'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause')?.violates.includes('durable-progress'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-barrier')?.violates.includes('row-preconditions'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'index-and-compressed-row-batch-completes-plugin-install')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'index-and-compressed-row-batch-completes-plugin-update')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-row-batch-skips-group-finalize')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-row-batch-skips-live-compare')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-row-summary-skips-live-batch-preconditions')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-publish')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-windowing')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-publish')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-publish')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.violates.includes('compression'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish-after-pause')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-windowing')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-windowing')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-publish')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-publish')?.violates.includes('live-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-publish')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause')?.violates.includes('durable-progress'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-hash-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-upload')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.rejectedBecause.includes('guarded publish barrier'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-chunk-upload-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-backpressure-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-backpressure')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-backpressure')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-hash-backpressure')?.violates.includes('file-hashing'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-hash-backpressure')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-chunk-upload-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-chunk-upload-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-backpressure-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-backpressure-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-backpressure-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-backpressure')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-after-pause')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-after-pause')?.violates.includes('live-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-after-pause')?.violates.includes('atomic-file-publish'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-upload')?.violates.includes('live-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-upload')?.violates.includes('backpressure'),
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-planned-dependency-graph-to-presize-bounded-plugin-update-batches')?.visibilityBoundary,
    'planning-only-until-batch-commit',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-remote-index-listings-and-reuse-cursor-to-presize-bounded-plugin-install-batches')?.visibilityBoundary,
    'planning-only-until-batch-commit',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-remote-index-cursor-and-dependency-graph-to-presize-bounded-plugin-install-batches')?.visibilityBoundary,
    'planning-only-until-batch-commit',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-remote-index-cursor-to-size-bounded-chunk-windows')?.visibilityBoundary,
    'plan-staging-window-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-remote-index-cursor-to-skip-unchanged-file-hash-planning')?.visibilityBoundary,
    'planning-only-before-file-publish',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions')?.rejectedGate,
    'group',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions')?.violates.includes('row-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions')?.violates.includes('atomic-groups'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure')?.violates.includes('backpressure'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'fingerprint-skips-live-publish-compare')?.rejectedGate,
    'live',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-file-hash-cache-skips-large-upload-resume')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-file-hash-cache-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-file-hash-cache-and-paused-queue-skips-large-upload-publish')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-queue-drains-means-complete')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-parallel-chunk-sends-skips-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-receipt-flush-skips-large-upload-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-receipt-flush-skips-large-upload-backpressure')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-receipt-flush-skips-large-upload-backpressure')?.violates.includes('atomic-file-publish'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('compression'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('row-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure')?.violates.includes('durable-progress'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-parallel-row-batch-skips-plugin-install-barrier')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-parallel-row-batch-skips-plugin-update-activation')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-remote-index-cursor-to-skip-unchanged-file-hash-planning')?.failureEvidence,
    'planning cursor plus cached digest and guarded file-publish record',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-file-hash-ledger-to-size-large-upload-resume-with-guarded-publish-check')?.visibilityBoundary,
    'plan-staging-resume-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-file-hash-ledger-to-size-large-upload-resume-with-guarded-publish-check')?.failureEvidence,
    'file-hash ledger plus guarded file-publish record',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-plan-scoped-chunk-receipts-to-resume-bounded-windowing')?.visibilityBoundary,
    'plan-staging-window-resume-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-plan-scoped-chunk-receipts-to-resume-bounded-windowing')?.failureEvidence,
    'plan-scoped chunk receipts plus guarded file-publish record',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-remote-index-cursor-to-size-bounded-chunk-windows')?.failureEvidence,
    'planning cursor plus bounded chunk receipt ledger',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-index-listings-without-changing-planning-semantics')?.visibilityBoundary,
    'transport-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-chunk-transit-frames-with-canonical-chunk-digests')?.visibilityBoundary,
    'transport-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-chunk-transit-frames-and-reuse-plan-scoped-receipts-within-budgets')?.failureEvidence,
    'compressed chunk frame plus plan-scoped receipt ledger and guarded publish record',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-durable-receipt-logs-with-stable-receipt-keys')?.visibilityBoundary,
    'recovery-evidence-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'parallelize-independent-owner-index-scans-within-site-budgets')?.visibilityBoundary,
    'planning-only-with-site-budgets',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'parallelize-independent-owner-index-scans-to-size-bounded-batches')?.visibilityBoundary,
    'planning-only-with-site-budgets',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-transport-frames-with-canonical-uncompressed-digest')?.failureEvidence,
    'canonical digest plus encoded payload digest',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'run-independent-staging-work-within-per-site-and-per-kind-budgets')?.visibilityBoundary,
    'atomic-group-commit-barrier',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'pause-upstream-producers-when-ack-or-journal-budgets-are-hit')?.visibilityBoundary,
    'none-pause-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'pause-upstream-producers-when-ack-or-journal-budgets-are-hit')?.failureEvidence,
    'durable queue and journal entries with affected resource identifiers',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'batch-durable-receipt-flushes-within-bounded-journal-lag')?.visibilityBoundary,
    'journal-flush-only',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'batch-durable-receipt-flushes-within-bounded-journal-lag')?.failureEvidence,
    'batched journal record plus raw durable receipts',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-durable-receipt-logs-with-stable-receipt-keys')?.failureEvidence,
    'compressed receipt log plus original durable receipt key',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'reuse-remote-index-cursor-and-dependency-graph-to-presize-bounded-plugin-install-batches')?.failureEvidence,
    'index cursor, dependency graph, and batch idempotency key',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-remote-index-listings-and-reuse-cursor-to-presize-bounded-plugin-update-batches')?.visibilityBoundary,
    'planning-only-until-batch-commit',
  );
  assert.equal(
    model.safeFastPaths.find((fastPath) => fastPath.allowedShortcut === 'compress-remote-index-listings-and-reuse-cursor-to-presize-bounded-plugin-update-batches')?.failureEvidence,
    'compressed index cursor, dependency graph, and batch idempotency key',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-row-batch-replaces-atomic-group')?.violates.includes('atomic-groups'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'batched-receipt-journal-flush')?.rejectedGate,
    'recovery',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-receipt-log-authorizes-apply')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-receipt-log-authorizes-apply')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-receipt-log-authorizes-apply')?.violates.includes('live-preconditions'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-receipt-log-authorizes-apply-after-pause')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-receipt-log-authorizes-apply-after-pause')?.violates.includes('backpressure'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-receipt-log-authorizes-apply-after-pause')?.violates.includes('atomic-groups'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-activation')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-finalize')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish')?.rejectedGate,
    'recovery',
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-finalize')?.violates.includes('chunk-receipts'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-finalize')?.violates.includes('plugin-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-finalize')?.violates.includes('atomic-groups'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish')?.violates.includes('live-preconditions'),
  );
  assert.ok(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish')?.violates.includes('atomic-file-publish'),
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-finalize')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-activation')?.rejectedGate,
    'group',
  );
  assert.equal(
    model.rejectedFastPaths.find((fastPath) => fastPath.id === 'compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize')?.rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-activation').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-activation').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-activation').violates.includes('atomic-groups'),
  );
});

test('fast-path fixture isolates the release-safety benchmark shape', () => {
  const fixture = buildFastPathFixture();
  const workloadKinds = fixture.fixture.workloads.map((workload) => workload.kind);
  const rejectedAreas = new Set(fixture.rejectedFastPaths.map((fastPath) => fastPath.violates).flat());

  assert.equal(fixture.fixture.purpose, 'large-upload-and-plugin-apply-safety-evidence');
  assert.deepEqual(workloadKinds.sort(), ['large-upload', 'plugin-install', 'plugin-update', 'release-bundle']);
  assert.ok(fixture.fixture.totals.uploadBytes >= 1024 * MIB);
  assert.ok(fixture.fixture.totals.dbRows >= 10_000);
  assert.ok(fixture.fixture.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'remote-index-probe')));
  assert.ok(fixture.fixture.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'compression-decision')));
  assert.ok(fixture.fixture.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'backpressure-pause')));
  assert.ok(fixture.fixture.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'atomic-group-commit')));
  assert.ok(
    fixture.rejectedFastPaths.some((fastPath) =>
      fastPath.id === 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit' &&
      fastPath.rejectedGate === 'group' &&
      fastPath.violates.includes('plugin-preconditions')
    ),
  );
  assert.ok(
    fixture.rejectedFastPaths.some((fastPath) =>
      fastPath.id === 'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit' &&
      fastPath.rejectedGate === 'group' &&
      fastPath.violates.includes('row-preconditions')
    ),
  );
  assert.ok(
    fixture.rejectedFastPaths.some((fastPath) =>
      fastPath.id === 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause' &&
      fastPath.rejectedGate === 'recovery' &&
      fastPath.violates.includes('atomic-groups')
    ),
  );
  assert.ok(
    fixture.rejectedFastPaths.some((fastPath) =>
      fastPath.id === 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause' &&
      fastPath.rejectedGate === 'group' &&
      fastPath.violates.includes('chunk-receipts') &&
      fastPath.violates.includes('row-preconditions')
    ),
  );
  for (const area of [
    'file-hashing',
    'chunk-upload',
    'database-row-batching',
    'remote-indexes',
    'compression',
    'parallelism-limits',
    'backpressure',
    'atomic-groups',
  ]) {
    assert.ok(rejectedAreas.has(area), `missing rejected fast-path evidence for ${area}`);
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
  assert.ok(filePublishes.every((action) => action.durableEvidence));
  assert.ok(filePublishes.every((action) => action.idempotencyKey));
  assert.ok(filePublishes.every((action) => action.requiresCompleteChunkReceipts > 0));
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
  assert.ok(dbBatches.every((batch) => batch.resumeCursor?.planId));
});

test('failure boundaries carry the receipts and commit records needed for recovery', () => {
  const model = buildBenchmarkModel();
  const boundaries = new Map(model.failureInjectionBoundaries.map((boundary) => [boundary.boundary, boundary]));
  const largeUpload = model.schedules.find((schedule) => schedule.kind === 'large-upload');
  const pluginInstall = model.schedules.find((schedule) => schedule.kind === 'plugin-install');
  const pluginUpdate = model.schedules.find((schedule) => schedule.kind === 'plugin-update');

  assert.ok(boundaries.get('chunk-ack'));
  assert.ok(boundaries.get('db-batch-commit'));
  assert.ok(boundaries.get('group-staging-finalize'));
  assert.ok(boundaries.get('atomic-group-commit'));
  assert.equal(boundaries.get('chunk-ack').recoveryEvidence, 'chunk digest plus plan-scoped idempotency key');
  assert.equal(
    boundaries.get('group-staging-finalize').recoveryEvidence,
    'member resource hash, staging hash, atomic group id',
  );
  assert.equal(
    boundaries.get('atomic-group-commit').recoveryEvidence,
    'commit record after all member preconditions are rechecked',
  );

  assert.ok(largeUpload.actions.some((action) => action.type === 'chunk-upload' && action.durableAckRequired));
  assert.ok(largeUpload.actions.some((action) => action.type === 'file-publish' && action.precondition?.expectedHash));
  assert.ok(pluginInstall.actions.some((action) => action.type === 'db-row-batch' && action.preconditions.kind === 'per-row-hash'));
  assert.ok(pluginInstall.actions.some((action) => action.type === 'group-staging-finalize' && action.requiredReceipts.rowBatches > 0));
  assert.ok(pluginInstall.actions.some((action) => action.type === 'plugin-metadata-stage' && action.canonicalVisible === false));
  assert.ok(pluginUpdate.actions.some((action) => action.type === 'group-staging-finalize' && action.failsClosedWhen.includes('validator-missing')));
  assert.ok(pluginUpdate.actions.some((action) => action.type === 'atomic-group-commit' && action.validators.includes('dependency-preconditions')));
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
  assert.ok(rejectedById.get('parallelize-finalize-across-groups').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('backpressure-drops-queued-receipts').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-receipt-log-authorizes-apply').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('batched-receipt-journal-flush').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('unbounded-parallel-large-upload-resume').violates.includes('backpressure'));
  assert.ok(rejectedById.get('unbounded-parallel-large-upload-resume').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('unbounded-parallel-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('unbounded-parallel-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('unbounded-parallel-plugin-install-finalize').violates.includes('backpressure'));
  assert.ok(rejectedById.get('unbounded-parallel-plugin-install-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('parallelize-atomic-group-commit').violates.includes('atomic-groups'));
  assert.equal(rejectedById.get('compressed-remote-index-and-parallel-owner-index-scans-skips-live-write').rejectedGate, 'live');
  assert.ok(rejectedById.get('parallelize-db-batch-visibility-across-groups').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('parallelize-chunk-visibility-across-groups').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-chunk-sends-skips-backpressure').violates.includes('parallelism-limits'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-chunk-sends-skips-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure').violates.includes('file-hashing'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure').violates.includes('parallelism-limits'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure').violates.includes('backpressure'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-backpressure').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-backpressure').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-backpressure').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('atomic-file-publish'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-finalize').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-finalize').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks').violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-dependency-checks').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-dependency-checks').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-dependency-checks').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-dependency-checks').violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('file-hashing'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('file-hashing'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-row-batch-skips-plugin-install-barrier').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-row-batch-skips-plugin-install-barrier').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-row-batch-skips-plugin-update-activation').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-row-batch-skips-plugin-update-activation').violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('parallelism-limits'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('compressed-upload-queue-skips-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-replaces-chunk-receipts').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-upload-queue-replaces-chunk-receipts').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-replaces-chunk-receipts').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('compressed-upload-queue-skips-backpressure').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-upload-queue-skips-backpressure').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-upload-queue-after-pause-skips-chunk-receipts').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume-after-pause').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-skips-large-upload-resume-after-pause').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-and-paused-queue-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-and-paused-queue-skips-large-upload-publish').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-file-hash-cache-and-paused-queue-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('cached-chunk-ledger-skips-large-upload-finalize').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('cached-chunk-ledger-skips-large-upload-finalize').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-receipt-summary-replaces-recovery-log').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-receipt-summary-replaces-recovery-log').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-receipt-summary-replaces-recovery-log').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-receipt-summary-replaces-recovery-log').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-receipt-log-authorizes-apply').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-receipt-log-authorizes-apply').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-receipt-log-authorizes-apply').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-receipt-log-authorizes-apply').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('index-and-compressed-package-cache-completes-plugin-update').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('index-and-compressed-package-cache-completes-plugin-update').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-package-cache-completes-plugin-update').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-package-cache-completes-plugin-update').violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-buffer-completes-chunk-resume').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('index-and-compressed-buffer-completes-chunk-resume').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-buffer-completes-chunk-resume').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-buffer-completes-chunk-resume').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-buffer-completes-chunk-resume').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('cached-manifest-hash-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('cached-manifest-hash-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('cached-manifest-hash-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-after-pause').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish').rejectedGate,
    'live',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing').rejectedGate,
    'live',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-resume').violates.includes('atomic-file-publish'));
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure').rejectedGate, 'recovery');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-send-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-send-backpressure').violates.includes('parallelism-limits'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-send-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-send-backpressure').violates.includes('chunk-receipts'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-backpressure').violates.includes('atomic-file-publish'),
  );
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').rejectedGate, 'recovery');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('atomic-file-publish'));
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-window-sizing').rejectedGate, 'recovery');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-window-sizing').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-window-sizing').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-final-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-final-activation').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-final-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-final-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-receipt-summary-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-receipt-summary-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-receipt-summary-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-receipt-summary-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-receipt-summary-skips-large-upload-publish').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-publish-after-pause').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-publish-after-pause').violates.includes('backpressure'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-digest-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('index-and-compressed-row-batch-skips-backpressure').violates.includes('backpressure'));
  assert.ok(rejectedById.get('index-and-compressed-row-batch-skips-backpressure').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('index-and-compressed-row-batch-skips-live-compare').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-row-batch-skips-live-compare').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('compression'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('index-and-compressed-chunk-receipts-completes-plugin-update').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('remote-index-and-cached-package-hash-skips-plugin-dependency-checks').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('remote-index-and-cached-package-hash-skips-plugin-dependency-checks').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('remote-index-and-cached-package-hash-skips-plugin-dependency-checks').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('remote-index-and-cached-package-hash-skips-plugin-dependency-checks').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('remote-index-and-cached-file-hash-skips-plugin-update').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks').rejectedGate,
    'live',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-receipt-log-completes-apply').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('compressed-receipt-log-completes-apply').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-receipt-log-completes-apply').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('index-and-compressed-package-cache-skips-plugin-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('index-and-compressed-package-cache-skips-plugin-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('index-and-compressed-package-cache-skips-plugin-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('index-and-compressed-package-cache-skips-plugin-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('index-and-compressed-package-cache-skips-plugin-activation').violates.includes('durable-progress'));
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
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').rejectedGate,
    'live',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').rejectedGate, 'group');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').rejectedGate, 'recovery');
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').rejectedGate, 'group');
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').rejectedGate, 'group');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').rejectedGate, 'group');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-install').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').rejectedGate, 'group');
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure').violates.includes('backpressure'),
  );
  assert.equal(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').rejectedGate, 'group');
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(rejectedById.get('batched-receipt-journal-flush').rejectedGate, 'recovery');
  assert.ok(rejectedById.get('batched-receipt-journal-flush').violates.includes('backpressure'));
  assert.ok(rejectedById.get('batched-receipt-journal-flush').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').rejectedGate,
    'group',
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause').rejectedGate,
    'group',
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure').rejectedGate,
    'group',
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure').rejectedGate,
    'group',
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause').violates.includes('file-hashing'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause').violates.includes('atomic-groups'),
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('file-hashing'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-large-upload-publish').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation-after-pause').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation-after-pause').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation-after-pause').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation-after-pause').violates.includes('atomic-groups'),
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions').violates.includes('atomic-groups'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize-after-pause').violates.includes('plugin-preconditions'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').rejectedGate,
    'group',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation').violates.includes('durable-progress'));
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
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize').violates.includes('plugin-preconditions'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize').violates.includes('durable-progress'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').violates.includes('remote-index-planning-only'));
  assert.ok(rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').violates.includes('compression'));
  assert.ok(rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').violates.includes('parallelism-limits'));
  assert.ok(rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').violates.includes('chunk-receipts'));
  assert.ok(rejectedById.get('compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish').violates.includes('atomic-file-publish'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure').violates.includes('parallelism-limits'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure').violates.includes('file-hashing'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').rejectedGate,
    'recovery',
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-skips-large-upload-publish').rejectedGate,
    'recovery',
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-upload-buffer-skips-large-upload-publish-after-pause').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-completes-large-upload').violates.includes('atomic-file-publish'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-skips-large-upload-publish').violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-skips-large-upload-publish').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-compressed-upload-buffer-skips-large-upload-publish').violates.includes('atomic-file-publish'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-upload-buffer-skips-large-upload-publish-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-upload-buffer-skips-large-upload-publish-after-pause').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-upload-buffer-skips-large-upload-publish-after-pause').violates.includes('atomic-file-publish'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause').violates.includes('atomic-file-publish'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-backpressure').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-backpressure').violates.includes('atomic-file-publish'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-chunk-upload-after-pause').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-chunk-upload-after-pause').violates.includes('chunk-upload'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-chunk-upload-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-chunk-upload-after-pause').violates.includes('atomic-file-publish'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause').violates.includes('file-hashing'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-publish-after-pause').violates.includes('live-preconditions'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-digests-skips-large-upload-chunk-upload-after-pause').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-digests-skips-large-upload-chunk-upload-after-pause').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-digests-skips-large-upload-chunk-upload-after-pause').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-digests-skips-large-upload-chunk-upload-after-pause').violates.includes('atomic-file-publish'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-parallel-chunk-sends-skips-backpressure').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-chunk-sends-skips-backpressure').violates.includes('parallelism-limits'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-chunk-sends-skips-backpressure').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-parallel-chunk-sends-skips-backpressure').violates.includes('chunk-receipts'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing').violates.includes('atomic-file-publish'),
  );
  const compressedLargeUploadWindowing = model.safeFastPaths.find(
    (fastPath) => fastPath.allowedShortcut === 'compress-remote-index-listings-and-reuse-cursor-to-size-bounded-large-upload-windows',
  );
  assert.ok(compressedLargeUploadWindowing, 'compressed large-upload windowing fast path exists');
  assert.equal(compressedLargeUploadWindowing.bypassesLivePreconditions, false);
  assert.equal(compressedLargeUploadWindowing.splitsAtomicGroup, false);
  assert.ok(compressedLargeUploadWindowing.gateProofs.skip.includes('compressed remote-index listing'));
  assert.ok(compressedLargeUploadWindowing.gateProofs.recovery.includes('durable chunk receipts'));
  assert.ok(
    rejectedById.get('compressed-index-finalizes-plugin-install').violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById.get('compressed-index-finalizes-plugin-install').violates.includes('plugin-preconditions'),
  );
  assert.equal(
    rejectedById.get('compressed-index-finalizes-plugin-install').rejectedGate,
    'group',
  );
  const drainedBufferFastPath = model.safeFastPaths.find(
    (fastPath) => fastPath.allowedShortcut === 'treat-drained-upload-buffer-as-publish-ready',
  );
  assert.ok(drainedBufferFastPath, 'drained upload buffer fast path exists');
  assert.equal(drainedBufferFastPath.bypassesLivePreconditions, false);
  assert.equal(drainedBufferFastPath.splitsAtomicGroup, false);
  assert.ok(drainedBufferFastPath.gateProofs.recovery.includes('durable chunk receipts'));
  assert.equal(
    rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation').violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('batched-receipt-journal-flush').violates.includes('backpressure'));
  assert.ok(rejectedById.get('batched-receipt-journal-flush').violates.includes('durable-progress'));
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
      fastPath.allowedShortcut === 'compress-durable-receipt-logs-with-stable-receipt-keys' &&
      fastPath.gateProofs.live.includes('original live precondition')
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
      fastPath.allowedShortcut === 'reuse-plan-scoped-chunk-receipts-to-resume-bounded-windowing' &&
      fastPath.gateProofs.group.includes('atomic group')
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'reuse-planned-dependency-graph-for-plugin-update-with-live-finalize' &&
      fastPath.gateProofs.group.includes('atomic-group commit barrier')
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'batch-durable-receipt-flushes-within-bounded-journal-lag' &&
      fastPath.gateProofs.group.includes('atomic group owns the visibility boundary')
    ),
  );
  assert.ok(
    model.safeFastPaths.some((fastPath) =>
      fastPath.allowedShortcut === 'compress-durable-receipt-logs-with-stable-receipt-keys' &&
      fastPath.gateProofs.recovery.includes('exact chunk, row, or group state')
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

test('guarded executor report keeps the large-upload and plugin-install evidence visible', () => {
  const report = runGuardedExecutorBenchmark({ profile: 'ci' });

  assert.equal(report.profile, 'ci');
  assert.ok(report.shape.fileBytes >= 16 * MIB);
  assert.ok(report.evidence.chunkReceipts.expected > 0);
  assert.equal(report.evidence.chunkReceipts.recorded, report.evidence.chunkReceipts.expected);
  assert.ok(report.evidence.chunkReceipts.finalStagingRecord);
  assert.equal(report.evidence.preconditions.everyMutationHasLiveRemotePrecondition, true);
  assert.equal(report.evidence.atomicGroup.requireAtomic, true);
  assert.equal(report.evidence.atomicGroup.successAllTargetsNew, true);
  assert.equal(report.evidence.recovery.successReplayInspectable, true);
  assert.equal(report.evidence.recovery.preCommitFailureInspectable, true);
  assert.equal(report.evidence.recovery.partialCommitBlocksRecovery, true);
  assert.equal(report.executorCapabilities.fileReceipts, 'lab-file-journal-receipts');
  assert.equal(report.executorCapabilities.rowApply, 'per-row-apply-model');
  assert.equal(report.executorCapabilities.productionAtomicCommit, 'not-measured');
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('guarded executor large profile still preserves receipts and stays blocked for production throughput', () => {
  const report = runGuardedExecutorBenchmark({ profile: 'guardedLarge' });
  const model = buildBenchmarkModel();
  const blockers = new Set(report.claims.productionThroughput.blockers);

  assert.equal(report.profile, 'guardedLarge');
  assert.ok(report.shape.fileBytes >= 384 * MIB);
  assert.ok(report.shape.rowCount >= 2_000);
  assert.ok(model.workloads.some((workload) => workload.kind === 'large-upload'));
  assert.ok(model.workloads.some((workload) => workload.kind === 'plugin-install'));
  assert.ok(model.workloads.some((workload) => workload.kind === 'plugin-update'));
  assert.ok(model.workloads.some((workload) => workload.kind === 'release-bundle'));
  assert.ok(model.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'remote-index-probe')));
  assert.ok(model.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'compression-decision')));
  assert.ok(model.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'backpressure-pause')));
  assert.ok(model.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'durable-receipt-flush')));
  assert.ok(model.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'group-staging-finalize')));
  assert.ok(model.schedules.some((schedule) => schedule.actions.some((action) => action.type === 'atomic-group-commit')));
  assert.ok(model.schedules.some((schedule) => schedule.totals.uploadChunks > 0));
  assert.ok(model.schedules.some((schedule) => schedule.totals.dbRows > 0));
  assert.ok(model.totals.uploadBytes >= 2 * 1024 * MIB);
  assert.ok(model.totals.dbRows >= 10_000);
  assert.equal(model.totals.filePublishes, 11);
  assert.ok(
    model.schedules.flatMap((schedule) => schedule.actions).filter((action) => action.type === 'backpressure-pause').length >= 2,
  );
  assert.ok(report.evidence.chunkReceipts.expected > 0);
  assert.equal(report.evidence.chunkReceipts.recorded, report.evidence.chunkReceipts.expected);
  assert.equal(report.evidence.preconditions.everyMutationHasLiveRemotePrecondition, true);
  assert.equal(report.evidence.atomicGroup.requireAtomic, true);
  assert.equal(report.evidence.atomicGroup.successAllTargetsNew, true);
  assert.equal(report.evidence.atomicGroup.productionAtomicCommitMeasured, false);
  assert.equal(report.evidence.recovery.partialCommitBlocksRecovery, true);
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
  assert.equal(report.claims.productionThroughput.status, 'blocked');
  assert.ok(blockers.has('production-atomic-group-commit-not-measured'));
  assert.ok(blockers.has('production-storage-receipts-not-measured'));
  assert.ok(blockers.has('production-row-batch-executor-not-measured'));
});
