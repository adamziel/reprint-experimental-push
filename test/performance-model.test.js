import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBenchmarkModel,
  DEFAULT_LIMITS,
  FAST_PATH_GATES,
  MIB,
  SAFE_FAST_PATHS,
  SAFE_SPEEDUP_AREAS,
} from '../scripts/bench/performance-model.js';

test('benchmark model covers large uploads and plugin installs', () => {
  const model = buildBenchmarkModel();
  const largeUpload = model.schedules.find((schedule) => schedule.kind === 'large-upload');
  const pluginInstall = model.schedules.find((schedule) => schedule.kind === 'plugin-install');
  const pluginUpdate = model.schedules.find((schedule) => schedule.kind === 'plugin-update');
  const pluginUpdateWorkload = model.workloads.find((workload) => workload.kind === 'plugin-update');

  assert.ok(largeUpload, 'large upload workload exists');
  assert.ok(pluginInstall, 'plugin install workload exists');
  assert.ok(pluginUpdate, 'plugin update workload exists');
  assert.ok(largeUpload.totals.uploadBytes >= 1024 * MIB, 'large upload is at least 1 GiB');
  assert.ok(largeUpload.totals.uploadChunks > 100, 'large upload is chunked enough to exercise resumability');
  assert.ok(
    largeUpload.actions.some(
      (action) => action.type === 'compression-decision' && action.transportEncoding === 'zstd',
    ),
    'large upload models compression for a compressible large body',
  );
  assert.ok(
    largeUpload.actions.some(
      (action) => action.type === 'file-hash' && action.resourceKey.endsWith('catalog-manifest.json'),
    ),
    'large upload includes a compressible manifest alongside the archive',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'chunk-hash'),
    'large upload models chunk hashing for resumable staging',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'file-hash'),
    'large upload models file hashing',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'chunk-upload'),
    'large upload models chunk uploads',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'backpressure-pause'),
    'large upload models an explicit backpressure pause point',
  );
  assert.ok(
    largeUpload.actions.some(
      (action) => action.type === 'file-publish' && action.publishMode === 'compare-and-swap',
    ),
    'large upload still ends in a guarded publish step',
  );
  assert.ok(
    largeUpload.backpressure.resumeRequires.includes('durable-chunk-receipts'),
    'large upload resumes only from durable chunk evidence',
  );
  assert.ok(
    largeUpload.backpressure.resumeRequires.includes('database-batch-commit-records'),
    'large upload keeps recovery records explicit even without DB work',
  );
  assert.ok(pluginInstall.totals.uploadBytes >= 64 * MIB, 'plugin install includes substantial file transfer');
  assert.ok(pluginInstall.totals.dbRows >= 10_000, 'plugin install includes large row batches');
  assert.ok(pluginUpdate.totals.dbRows >= 6_000, 'plugin update includes dependency-heavy row batches');
  assert.ok(pluginUpdateWorkload.atomicGroup.dependencies.includes('payments'));
  assert.ok(pluginUpdateWorkload.atomicGroup.dependencies.includes('subscriptions'));
  assert.ok(
    pluginInstall.totals.uploadChunks > 10,
    'plugin install includes enough chunked file work to exercise staged retries',
  );
  assert.ok(
    pluginInstall.totals.filePublishes >= 4,
    'plugin install includes multiple files crossing the group barrier',
  );
  assert.equal(pluginInstall.atomicGroupId, 'install-commerce-stack');
  assert.equal(pluginUpdate.atomicGroupId, 'update-commerce-stack');
  assert.equal(pluginInstall.totals.groupStagingFinalizes, 1);
  assert.equal(pluginUpdate.totals.groupStagingFinalizes, 1);
  assert.equal(pluginInstall.totals.atomicGroupCommits, 1);
  assert.equal(pluginUpdate.totals.atomicGroupCommits, 1);
  assert.equal(pluginInstall.backpressure.onPressure, 'pause-upstream-producers');
  assert.equal(pluginUpdate.backpressure.onPressure, 'pause-upstream-producers');
  assert.ok(
    pluginInstall.backpressure.resumeRequires.includes('database-batch-commit-records'),
    'plugin install backpressure resumes only from durable batch evidence',
  );
  assert.ok(
    pluginUpdate.backpressure.resumeRequires.includes('database-batch-commit-records'),
    'plugin update backpressure resumes only from durable batch evidence',
  );
  assert.ok(
    pluginInstall.backpressure.resumeRequires.includes('durable-chunk-receipts'),
    'plugin install backpressure resumes only from durable chunk evidence',
  );
  assert.ok(
    pluginUpdate.backpressure.resumeRequires.includes('durable-chunk-receipts'),
    'plugin update backpressure resumes only from durable chunk evidence',
  );
  assert.ok(
    largeUpload.actions.some((action) => action.type === 'compression-decision'),
    'large upload models compression decisions',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'remote-index-probe'),
    'plugin install models remote planning indexes',
  );
  assert.ok(pluginInstall.actions.some((action) => action.type === 'file-hash'));
  assert.ok(pluginInstall.actions.some((action) => action.type === 'chunk-hash'));
  assert.ok(pluginInstall.actions.some((action) => action.type === 'chunk-upload'));
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'backpressure-pause'),
    'plugin install models an explicit backpressure pause point',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'compression-decision'),
    'plugin install models compression decisions for staged files',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'db-row-batch'),
    'plugin install models database row batching',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'db-row-batch'),
    'plugin update models database row batching',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'backpressure-pause'),
    'plugin update models an explicit backpressure pause point',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'group-staging-finalize'),
    'plugin install models the group staging finalize barrier',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'group-staging-finalize'),
    'plugin update models the group staging finalize barrier',
  );
  assert.ok(
    pluginInstall.actions.some(
      (action) => action.type === 'atomic-group-commit' && action.canonicalVisible === true,
    ),
    'plugin install models the final atomic-group commit as the only visibility point',
  );
  assert.ok(
    pluginUpdate.actions.some(
      (action) => action.type === 'atomic-group-commit' && action.canonicalVisible === true,
    ),
    'plugin update models the final atomic-group commit as the only visibility point',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'remote-index-probe' && action.applyMustRevalidate === true),
    'plugin update keeps remote indexes planning-only',
  );
  assert.ok(
    pluginUpdate.actions.some(
      (action) =>
        action.type === 'remote-index-probe' &&
        action.freshnessEvidence === 'generation-and-scanner-cursor' &&
        action.authorizesApply === false,
    ),
    'plugin update records planning-only remote index evidence',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'plugin-metadata-stage'),
    'plugin update models staged plugin metadata before commit',
  );
  assert.equal(pluginInstall.parallelism.atomicGroupCommit, 1);
  assert.equal(largeUpload.backpressure.onPressure, 'pause-upstream-producers');
  assert.ok(
    pluginInstall.backpressure.pauseWhen.includes('staging-disk-budget-hit'),
    'plugin install backpressure should cover staging disk pressure',
  );
  assert.ok(
    pluginUpdate.backpressure.pauseWhen.includes('staging-disk-budget-hit'),
    'plugin update backpressure should cover staging disk pressure',
  );
  assert.ok(
    pluginInstall.backpressure.resumeRequires.includes('database-batch-commit-records'),
    'plugin install backpressure should require durable batch receipts before resume',
  );
  assert.ok(
    pluginUpdate.backpressure.pauseWhen.includes('remote-latency-budget-hit'),
    'plugin update backpressure should model remote latency as a stop condition',
  );
  assert.equal(pluginUpdate.backpressure.forbiddenResponse, 'drop-evidence-or-mark-unacknowledged-work-complete');
});

test('safety contract covers required speedup areas and terminal states', () => {
  const model = buildBenchmarkModel();

  assert.equal(model.safetyContract.priority, 'fast-fourth');
  assert.deepEqual(model.fastPathGates, FAST_PATH_GATES);
  assert.deepEqual(model.safeSpeedupAreas, SAFE_SPEEDUP_AREAS);
  assert.deepEqual(model.safeFastPaths, SAFE_FAST_PATHS);

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

test('safe fast path proposals retain proof obligations', () => {
  const model = buildBenchmarkModel();
  const gateIds = FAST_PATH_GATES.map((gate) => gate.id).sort();
  const fastPathByArea = new Map(
    model.safeFastPaths.map((fastPath) => [fastPath.area, fastPath]),
  );

  for (const area of model.safeSpeedupAreas) {
    assert.ok(fastPathByArea.has(area), `missing safe fast path proposal for ${area}`);
  }

  for (const fastPath of model.safeFastPaths) {
    assert.ok(fastPath.reduces.length > 0, `missing speed benefit for ${fastPath.area}`);
    assert.ok(fastPath.guardrails.length >= 2, `missing guardrails for ${fastPath.area}`);
    assert.ok(fastPath.allowedShortcut, `missing allowed shortcut for ${fastPath.area}`);
    assert.ok(fastPath.visibilityBoundary, `missing visibility boundary for ${fastPath.area}`);
    assert.ok(fastPath.failureEvidence, `missing recovery evidence for ${fastPath.area}`);
    assert.deepEqual(
      Object.keys(fastPath.gateProofs).sort(),
      gateIds,
      `missing gate proof for ${fastPath.area}`,
    );
    for (const [gateId, proof] of Object.entries(fastPath.gateProofs)) {
      assert.equal(typeof proof, 'string', `gate ${gateId} proof must be text`);
      assert.ok(proof.length > 20, `gate ${gateId} proof is too weak for ${fastPath.area}`);
    }
    assert.equal(fastPath.bypassesLivePreconditions, false);
    assert.equal(fastPath.splitsAtomicGroup, false);
    assert.equal(fastPath.publishesStagedDataEarly, false);
  }

  assert.ok(
    fastPathByArea.get('remote-indexes').guardrails.includes('apply-revalidates-live-resource-hash'),
  );
  assert.equal(fastPathByArea.get('remote-indexes').visibilityBoundary, 'none-planning-only');
  assert.equal(
    fastPathByArea.get('parallelism-limits').visibilityBoundary,
    'atomic-group-commit-barrier',
  );
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
  assert.ok(chunkUploads.every((action) => action.durableAckRequired === true));
  assert.ok(chunkUploads.every((action) => action.completionRule === 'complete-after-durable-ack'));
  assert.ok(chunkUploads.every((action) => action.idempotencyKey));
  assert.ok(chunkUploads.every((action) => action.receiptKey.includes(action.planId)));
  assert.ok(chunkUploads.every((action) => action.receiptKey.includes(action.resourceKey)));
  assert.ok(chunkUploads.every((action) => action.receiptKey.includes(action.chunkDigest)));
  assert.ok(chunkUploads.every((action) => action.resumeCursor?.chunkDigest === action.chunkDigest));
  assert.ok(chunkUploads.every((action) => action.resumeCursor?.offsetBytes === action.offsetBytes));

  assert.ok(filePublishes.length > 0);
  assert.ok(filePublishes.every((action) => action.precondition?.expectedHash));
  assert.ok(filePublishes.every((action) => action.publishMode === 'compare-and-swap'));
  assert.ok(
    filePublishes.every((action) => action.requiresCompleteChunkReceipts === action.chunkCount),
  );
  assert.ok(filePublishes.some((action) => action.canonicalVisible === false));
  assert.ok(filePublishes.every((action) => action.assembledHash?.startsWith('sha256:')));
  assert.ok(filePublishes.every((action) => action.durableEvidence));
  assert.ok(filePublishes.every((action) => action.idempotencyKey));
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
  const groupFinalize = pluginInstall.actions.find((action) => action.type === 'group-staging-finalize');
  const visibleBeforeCommit = memberActions.filter((action) => action.canonicalVisible === true);

  assert.ok(memberActions.length > 0);
  assert.deepEqual(visibleBeforeCommit, []);
  assert.ok(groupFinalize);
  assert.equal(groupFinalize.canonicalVisible, false);
  assert.equal(groupFinalize.preconditions, 'recheck-all-member-resource-hashes');
  assert.equal(groupFinalize.durableEvidence, 'group-staging-finalize-record');
  assert.ok(groupFinalize.requiredReceipts.chunkReceipts > groupFinalize.requiredReceipts.stagedFiles);
  assert.ok(groupFinalize.requiredReceipts.rowBatches > 10);
  assert.equal(groupFinalize.requiredReceipts.pluginMetadataEntries, 2);
  assert.ok(groupFinalize.failsClosedWhen.includes('missing-member-receipt'));
  assert.ok(commit);
  assert.equal(commit.atomicGroupId, pluginInstall.atomicGroupId);
  assert.equal(commit.commitPolicy, 'all-or-nothing');
  assert.equal(commit.preconditions, 'recheck-all-member-resource-hashes');
  assert.equal(commit.requiresFinalizedGroupStaging, true);
  assert.equal(commit.durableEvidence, 'atomic-group-commit-record');
  assert.ok(commit.idempotencyKey);
  assert.ok(commit.validators.includes('dependency-preconditions'));
  assert.ok(commit.validators.includes('plugin-metadata-preconditions'));
  assert.ok(commit.validators.includes('activation-preconditions'));
});

test('parallelism limits and backpressure budgets are explicit', () => {
  const model = buildBenchmarkModel();

  assert.equal(model.remoteIndex.use, 'planning-only');
  assert.equal(model.remoteIndex.forbiddenUse, 'apply-authorization');

  const remoteIndexProbes = model.schedules.flatMap((schedule) =>
    schedule.actions.filter((action) => action.type === 'remote-index-probe'),
  );
  assert.ok(remoteIndexProbes.every((action) => action.authorizesApply === false));
  assert.ok(remoteIndexProbes.every((action) => action.bodyFetched === false));
  assert.ok(remoteIndexProbes.every((action) => action.applyMustRevalidate === true));
  assert.ok(remoteIndexProbes.every((action) => action.requiredFields.includes('strongHash')));
  assert.ok(remoteIndexProbes.every((action) => action.requiredFields.includes('generation')));

  for (const schedule of model.schedules) {
    assert.equal(schedule.parallelism.remoteIndex, 1);
    assert.ok(schedule.parallelism.hash <= DEFAULT_LIMITS.maxHashConcurrency);
    assert.ok(schedule.parallelism.upload <= DEFAULT_LIMITS.maxUploadConcurrency);
    assert.ok(schedule.parallelism.dbPerTable <= DEFAULT_LIMITS.maxDbConcurrencyPerTable);
    assert.ok(schedule.backpressure.maxInFlightUploadBytes <= DEFAULT_LIMITS.maxBufferedUploadBytes);
    assert.ok(schedule.backpressure.maxQueuedDbBatches <= DEFAULT_LIMITS.maxPendingDbBatches);
    assert.ok(schedule.backpressure.maxJournalLagMs <= DEFAULT_LIMITS.maxJournalLagMs);
    assert.ok(schedule.backpressure.maxStagingDiskBytes <= DEFAULT_LIMITS.maxStagingDiskBytes);
    assert.ok(schedule.backpressure.pauseWhen.includes('journal-fsync-lag'));
    assert.equal(schedule.backpressure.onPressure, 'pause-upstream-producers');
    assert.equal(
      schedule.backpressure.forbiddenResponse,
      'drop-evidence-or-mark-unacknowledged-work-complete',
    );
    assert.ok(schedule.backpressure.resumeRequires.includes('durable-chunk-receipts'));
  }
});

test('large uploads and plugin work retain the required fast-path evidence', () => {
  const model = buildBenchmarkModel();

  for (const schedule of model.schedules) {
    const remoteIndexProbe = schedule.actions.find((action) => action.type === 'remote-index-probe');
    assert.ok(remoteIndexProbe, `${schedule.kind} should begin with remote planning evidence`);
    assert.equal(remoteIndexProbe.authorizesApply, false);
    assert.equal(remoteIndexProbe.applyMustRevalidate, true);
    assert.ok(remoteIndexProbe.requiredFields.includes('strongHash'));
    assert.ok(remoteIndexProbe.requiredFields.includes('generation'));

    const compressionDecisions = schedule.actions.filter(
      (action) => action.type === 'compression-decision',
    );
    assert.ok(compressionDecisions.length > 0, `${schedule.kind} should model compression choices`);
    assert.ok(
      compressionDecisions.every(
        (action) => action.canonicalHashEncoding === 'uncompressed-resource-value',
      ),
    );

    const chunkUploads = schedule.actions.filter((action) => action.type === 'chunk-upload');
    assert.ok(chunkUploads.length > 0, `${schedule.kind} should model chunk uploads`);
    assert.ok(chunkUploads.every((action) => action.durableAckRequired === true));
    assert.ok(chunkUploads.every((action) => action.destination === 'plan-staging'));
    assert.ok(chunkUploads.every((action) => action.receiptKey.includes(action.chunkDigest)));

    const dbBatches = schedule.actions.filter((action) => action.type === 'db-row-batch');
    if (schedule.kind === 'large-upload') {
      assert.equal(dbBatches.length, 0, 'large uploads should stay focused on file transfer');
    } else {
      assert.ok(dbBatches.length > 0, `${schedule.kind} should model row batches`);
      assert.ok(dbBatches.every((batch) => batch.preconditions.kind === 'per-row-hash'));
      assert.ok(dbBatches.every((batch) => batch.durableEvidence));
      const groupFinalize = schedule.actions.find((action) => action.type === 'group-staging-finalize');
      const commit = schedule.actions.find((action) => action.type === 'atomic-group-commit');
      assert.ok(groupFinalize, `${schedule.kind} should keep the group finalize barrier`);
      assert.ok(commit, `${schedule.kind} should keep the atomic group commit barrier`);
      assert.equal(groupFinalize.canonicalVisible, false);
      assert.equal(commit.canonicalVisible, true);
    }

    assert.equal(schedule.backpressure.onPressure, 'pause-upstream-producers');
    assert.ok(schedule.backpressure.pauseWhen.includes('staging-disk-budget-hit'));
    assert.ok(schedule.backpressure.resumeRequires.includes('durable-chunk-receipts'));
    assert.ok(schedule.backpressure.resumeRequires.includes('database-batch-commit-records'));
    assert.ok(schedule.backpressure.resumeRequires.includes('journal-fsync-caught-up'));

    const pause = schedule.actions.find((action) => action.type === 'backpressure-pause');
    assert.ok(pause, `${schedule.kind} should model an explicit pause point`);
    assert.equal(pause.onPressure, 'pause-upstream-producers');
    assert.ok(pause.pauseWhen.length > 0);
    assert.ok(pause.resumeRequires.includes('durable-chunk-receipts'));
    assert.ok(pause.resumeRequires.includes('database-batch-commit-records'));

    const filePublishes = schedule.actions.filter((action) => action.type === 'file-publish');
    assert.ok(filePublishes.every((action) => action.publishMode === 'compare-and-swap'));
    assert.ok(filePublishes.every((action) => action.durableEvidence));
    assert.ok(filePublishes.every((action) => action.requiresCompleteChunkReceipts > 0));
  }

  const largeUpload = model.schedules.find((schedule) => schedule.kind === 'large-upload');
  const pluginInstall = model.schedules.find((schedule) => schedule.kind === 'plugin-install');
  const pluginUpdate = model.schedules.find((schedule) => schedule.kind === 'plugin-update');

  assert.ok(
    largeUpload.actions.some((action) => action.type === 'file-publish' && action.publishMode === 'compare-and-swap'),
    'large uploads should keep publish visibility behind a guarded compare-and-swap',
  );
  assert.ok(
    largeUpload.actions.every((action) => action.type !== 'atomic-group-commit'),
    'large uploads should not invent an atomic-group commit that does not exist',
  );
  assert.ok(
    pluginInstall.actions.some((action) => action.type === 'group-staging-finalize'),
    'plugin install should model the group staging barrier',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'group-staging-finalize'),
    'plugin update should model the group staging barrier',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'atomic-group-commit' && action.canonicalVisible === true),
    'plugin update should only become visible at the atomic-group commit',
  );
  assert.ok(
    pluginUpdate.actions.some((action) => action.type === 'remote-index-probe' && action.applyMustRevalidate === true),
    'plugin update should keep remote indexes planning-only',
  );
});

test('rejected fast paths cover precondition bypasses and atomic group splits', () => {
  const model = buildBenchmarkModel();
  const gateIds = new Set(FAST_PATH_GATES.map((gate) => gate.id));
  const rejectedById = new Map(
    model.rejectedFastPaths.map((fastPath) => [fastPath.id, fastPath]),
  );

  assert.ok(model.rejectedFastPaths.every((fastPath) => gateIds.has(fastPath.rejectedGate)));
  assert.equal(rejectedById.get('fresh-dry-run-authorizes-apply').violates[0], 'live-preconditions');
  assert.equal(rejectedById.get('fresh-dry-run-authorizes-apply').rejectedGate, 'live');
  assert.ok(rejectedById.get('remote-index-authorizes-mutation').violates.includes('live-preconditions'));
  assert.ok(
    rejectedById.get('fingerprint-as-apply-authority').violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById.get('fingerprint-as-apply-authority').violates.includes('canonical-resource-hashes'),
  );
  assert.equal(rejectedById.get('fingerprint-as-apply-authority').rejectedGate, 'live');
  assert.ok(rejectedById.get('split-plugin-install').violates.includes('atomic-groups'));
  assert.equal(rejectedById.get('split-plugin-install').rejectedGate, 'group');
  assert.ok(
    rejectedById.get('skip-plugin-validators-on-package-hash').violates.includes('plugin-preconditions'),
  );
  assert.ok(rejectedById.get('live-chunk-publish').violates.includes('known-terminal-state'));
  assert.ok(
    rejectedById.get('live-chunk-publish').violates.includes('atomic-file-publish'),
  );
  assert.ok(
    rejectedById.get('fresh-dry-run-authorizes-apply').proposal.includes('dry-run plan is recent'),
  );
  assert.ok(
    rejectedById.get('visible-staging-object-completes-chunk').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('chunk-digest-completes-chunk').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('chunk-digest-completes-chunk').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('receipt-only-chunk-publish').violates.includes('atomic-file-publish'),
  );
  assert.ok(rejectedById.get('blind-sql-replace').violates.includes('row-preconditions'));
  assert.ok(rejectedById.get('cross-group-row-batch').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('index-cursor-as-lock').violates.includes('live-preconditions'));
  assert.ok(
    rejectedById.get('commit-group-with-missing-receipts').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('resume-chunk-without-receipt').violates.includes('chunk-receipts'));
  assert.ok(
    rejectedById.get('full-digest-completes-chunk-resume').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('full-digest-completes-chunk-resume').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('manifest-hash-completes-large-upload').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('manifest-hash-completes-large-upload').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('manifest-hash-completes-large-upload').violates.includes('atomic-file-publish'),
  );
  assert.ok(
    rejectedById.get('archive-hash-skips-chunk-receipts').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('archive-hash-skips-chunk-receipts').violates.includes('durable-progress'),
  );
  assert.ok(rejectedById.get('backpressure-drops-evidence').violates.includes('backpressure'));
  assert.ok(rejectedById.get('compressed-buffer-means-complete').violates.includes('compression'));
  assert.ok(
    rejectedById.get('compressed-buffer-means-complete').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-queue-drains-means-complete').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-queue-drains-means-complete').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-queue-drains-means-complete').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-queue-completes-apply').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-queue-completes-apply').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-queue-completes-apply').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-queue-completes-apply').violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById.get('index-and-compressed-queue-completes-apply').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-queue-completes-apply').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-buffer-acknowledges-chunks').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-buffer-acknowledges-chunks').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('compressed-upload-queue-completes-large-upload').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-upload-queue-completes-large-upload').rejectedGate,
    'recovery',
  );
  assert.ok(rejectedById.get('unbounded-parallelism').violates.includes('backpressure'));
  assert.ok(rejectedById.get('digest-as-authority').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compression-skips-precondition').violates.includes('live-preconditions'));
  assert.ok(rejectedById.get('compressed-canonical-hash').violates.includes('canonical-resource-hashes'));
  assert.ok(rejectedById.get('unbounded-parallelism').violates.includes('backpressure'));
  assert.equal(rejectedById.get('parallelize-atomic-group-commit').rejectedGate, 'group');
  assert.ok(
    rejectedById.get('parallelize-atomic-group-commit').violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('parallelize-db-batch-visibility-across-groups').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById
      .get('parallelize-db-batch-visibility-across-groups')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('parallelize-db-batch-visibility-across-groups')
      .violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('parallelize-db-batch-visibility-across-groups')
      .violates.includes('visibility-boundary'),
  );
  assert.equal(
    rejectedById.get('parallelize-chunk-visibility-across-groups').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById
      .get('parallelize-chunk-visibility-across-groups')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('parallelize-chunk-visibility-across-groups')
      .violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById
      .get('parallelize-chunk-visibility-across-groups')
      .violates.includes('visibility-boundary'),
  );
  assert.ok(rejectedById.get('queue-empty-means-complete').violates.includes('backpressure'));
  assert.ok(rejectedById.get('queue-empty-means-complete').violates.includes('durable-progress'));
  assert.ok(rejectedById.get('queue-empty-means-complete').proposal.includes('queue is empty'));
  assert.ok(
    rejectedById.get('fresh-index-empty-queue-completes-apply').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('fresh-index-empty-queue-completes-apply').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('fresh-index-empty-queue-completes-apply').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('fresh-index-empty-queue-completes-apply').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('index-and-digest-skips-row-preconditions').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('index-and-digest-skips-row-preconditions').violates.includes('live-preconditions'),
  );
  assert.equal(
    rejectedById.get('index-and-digest-skips-row-preconditions').rejectedGate,
    'live',
  );
  assert.ok(
    rejectedById.get('index-and-chunk-receipts-skip-file-compare').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('index-and-chunk-receipts-skip-file-compare').violates.includes('live-preconditions'),
  );
  assert.equal(
    rejectedById.get('index-and-chunk-receipts-skip-file-compare').rejectedGate,
    'live',
  );
  assert.ok(
    rejectedById
      .get('index-and-chunk-receipts-skip-guarded-publish')
      .violates.includes('atomic-file-publish'),
  );
  assert.ok(
    rejectedById
      .get('index-and-chunk-receipts-skip-guarded-publish')
      .violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-chunk-receipts-skip-guarded-publish').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('index-and-table-checksum-skips-batch-preconditions').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('index-and-table-checksum-skips-batch-preconditions').violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById.get('index-and-table-checksum-skips-batch-preconditions').violates.includes('live-preconditions'),
  );
  assert.equal(
    rejectedById.get('index-and-table-checksum-skips-batch-preconditions').rejectedGate,
    'live',
  );
  assert.ok(
    rejectedById.get('index-and-digest-completes-apply').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('index-and-digest-completes-apply').violates.includes('live-preconditions'),
  );
  assert.equal(rejectedById.get('index-and-digest-completes-apply').rejectedGate, 'live');
  assert.ok(
    rejectedById.get('index-and-digest-completes-large-upload').violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById.get('index-and-digest-completes-large-upload').violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById.get('index-and-digest-completes-large-upload').violates.includes('live-preconditions'),
  );
  assert.equal(
    rejectedById.get('index-and-digest-completes-large-upload').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-completes-plugin-install')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-completes-plugin-install')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-completes-plugin-install')
      .violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('index-and-package-hash-completes-plugin-install').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-completes-plugin-update')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-completes-plugin-update')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-completes-plugin-update')
      .violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('index-and-package-hash-completes-plugin-update').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-skips-plugin-validators')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-package-hash-skips-plugin-validators')
      .violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('index-and-package-hash-skips-plugin-validators').rejectedGate,
    'group',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-install')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-install')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-install')
      .violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-install')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-install')
      .violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-upload-queue-completes-plugin-install').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-install')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-update')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-update')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-update')
      .violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-update')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-update')
      .violates.includes('atomic-groups'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-upload-queue-completes-plugin-update').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-plugin-update')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-row-batch-completes-plugin-update').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById.get('compressed-row-batch-skips-batch-receipts').violates.includes('compression'),
  );
  assert.ok(
    rejectedById.get('compressed-row-batch-skips-batch-receipts').violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById.get('compressed-row-batch-skips-batch-receipts').violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById.get('compressed-row-batch-skips-batch-receipts').violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('compressed-row-batch-skips-batch-receipts').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-update')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-row-batch-completes-plugin-install').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-row-batch-completes-plugin-install')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-large-upload')
      .violates.includes('remote-index-planning-only'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-large-upload')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-large-upload')
      .violates.includes('backpressure'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-large-upload')
      .violates.includes('live-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-large-upload')
      .violates.includes('chunk-receipts'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-upload-queue-completes-large-upload').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-upload-queue-completes-large-upload')
      .violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-chunk-resume')
      .violates.includes('compression'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-chunk-resume')
      .violates.includes('chunk-receipts'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-chunk-resume')
      .violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-buffer-completes-chunk-resume').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-update')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-update')
      .violates.includes('row-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-update')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-update')
      .violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-buffer-completes-plugin-update').rejectedGate,
    'recovery',
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-install')
      .violates.includes('plugin-preconditions'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-install')
      .violates.includes('atomic-groups'),
  );
  assert.ok(
    rejectedById
      .get('index-and-compressed-buffer-completes-plugin-install')
      .violates.includes('durable-progress'),
  );
  assert.equal(
    rejectedById.get('index-and-compressed-buffer-completes-plugin-install').rejectedGate,
    'recovery',
  );
  assert.ok(model.rejectedFastPaths.every((fastPath) => fastPath.rejectedBecause));
  assert.ok(
    model.rejectedFastPaths.every((fastPath) =>
      fastPath.rejectedGate === 'live' ||
      fastPath.rejectedGate === 'group' ||
      fastPath.rejectedGate === 'recovery'
    ),
    'rejected fast paths should map to a concrete bypass or ambiguity gate',
  );
  assert.ok(
    rejectedById.get('visible-staging-object-completes-chunk').violates.includes('durable-progress'),
  );
  assert.ok(
    rejectedById.get('staged-bytes-as-published').violates.includes('atomic-groups'),
  );
  assert.equal(rejectedById.get('staged-bytes-as-published').rejectedGate, 'group');
  assert.ok(rejectedById.get('live-chunk-publish').proposal.includes('live file path'));
  assert.ok(rejectedById.get('live-chunk-publish').violates.includes('atomic-file-publish'));
  assert.ok(rejectedById.get('fresh-dry-run-authorizes-apply').proposal.includes('dry-run plan is recent'));
  assert.ok(rejectedById.get('split-plugin-install').violates.includes('atomic-groups'));
  assert.ok(rejectedById.get('metadata-only-conflict-check').violates.includes('strong-resource-hashes'));
  assert.ok(rejectedById.get('remote-index-authorizes-mutation').proposal.includes('permission'));
  assert.ok(
    rejectedById.get('staged-bytes-as-published').proposal.includes('visible without guarded finalize'),
  );

  const rejectedIds = new Set(model.rejectedFastPaths.map((fastPath) => fastPath.id));
  for (const id of [
    'live-chunk-publish',
    'fresh-dry-run-authorizes-apply',
    'remote-index-authorizes-mutation',
    'split-plugin-install',
    'blind-sql-replace',
    'backpressure-drops-evidence',
    'compressed-buffer-means-complete',
    'compressed-queue-drains-means-complete',
    'chunk-digest-completes-chunk',
    'index-and-compressed-queue-completes-apply',
    'compressed-buffer-acknowledges-chunks',
    'queue-empty-means-complete',
    'fresh-index-empty-queue-completes-apply',
    'index-and-digest-completes-apply',
    'index-and-digest-completes-large-upload',
    'fingerprint-as-apply-authority',
    'index-and-chunk-receipts-skip-file-compare',
    'index-and-chunk-receipts-skip-guarded-publish',
    'index-and-package-hash-completes-plugin-install',
    'index-and-package-hash-completes-plugin-update',
    'index-and-package-hash-skips-plugin-validators',
    'index-and-compressed-upload-queue-completes-plugin-install',
    'index-and-compressed-upload-queue-completes-plugin-update',
    'index-and-compressed-row-batch-completes-plugin-update',
    'index-and-compressed-row-batch-completes-plugin-install',
    'index-and-compressed-upload-queue-completes-large-upload',
    'index-and-compressed-buffer-completes-chunk-resume',
    'index-and-compressed-buffer-completes-plugin-update',
    'index-and-compressed-buffer-completes-plugin-install',
    'archive-hash-skips-chunk-receipts',
    'compressed-upload-queue-completes-large-upload',
    'index-and-table-checksum-skips-batch-preconditions',
    'full-digest-completes-chunk-resume',
    'manifest-hash-completes-large-upload',
    'parallelize-atomic-group-commit',
    'parallelize-db-batch-visibility-across-groups',
    'parallelize-chunk-visibility-across-groups',
  ]) {
    assert.ok(rejectedIds.has(id), `missing rejected fast path ${id}`);
  }

  for (const area of model.safeSpeedupAreas) {
    const hasRejectedExample = model.rejectedFastPaths.some((fastPath) => {
      switch (area) {
        case 'file-hashing':
          return fastPath.violates.includes('canonical-resource-hashes');
        case 'chunk-upload':
          return fastPath.violates.includes('chunk-receipts');
        case 'database-row-batching':
          return fastPath.violates.includes('row-preconditions');
        case 'remote-indexes':
          return fastPath.violates.includes('remote-index-planning-only');
        case 'compression':
          return fastPath.violates.includes('compression');
        case 'parallelism-limits':
          return fastPath.violates.includes('backpressure');
        case 'backpressure':
          return fastPath.violates.includes('backpressure');
        default:
          return false;
      }
    });

    assert.ok(hasRejectedExample, `missing rejected fast path for ${area}`);
  }
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

  const actionTypes = new Set(model.schedules.flatMap((schedule) =>
    schedule.actions.map((action) => action.type),
  ));
  assert.ok(actionTypes.has('chunk-upload'), 'chunk ack is modeled by staged chunk uploads');
  assert.ok(actionTypes.has('db-row-batch'), 'database batch commit is modeled by row batches');
  assert.ok(actionTypes.has('group-staging-finalize'), 'group staging finalize is explicitly modeled');
  assert.ok(actionTypes.has('atomic-group-commit'), 'atomic group commit is explicitly modeled');
  assert.ok(actionTypes.has('backpressure-pause'), 'backpressure pause is explicitly modeled');
});

test('rejected fast paths keep unsafe shortcuts out of the safe families', () => {
  const model = buildBenchmarkModel();
  const rejectedById = new Map(model.rejectedFastPaths.map((entry) => [entry.id, entry]));

  const areaChecks = new Map([
    ['file-hashing', (entry) => entry.violates.includes('canonical-resource-hashes')],
    ['chunk-upload', (entry) => entry.violates.includes('chunk-receipts')],
    ['database-row-batching', (entry) => entry.violates.includes('row-preconditions')],
    ['remote-indexes', (entry) => entry.violates.includes('remote-index-planning-only')],
    ['compression', (entry) => entry.violates.includes('compression')],
    ['parallelism-limits', (entry) => entry.violates.includes('atomic-groups') || entry.violates.includes('backpressure')],
    ['backpressure', (entry) => entry.violates.includes('backpressure')],
  ]);

  for (const [area, predicate] of areaChecks) {
    assert.ok(
      model.rejectedFastPaths.some(predicate),
      `missing rejected fast path for ${area}`,
    );
  }

  assert.equal(rejectedById.get('fresh-dry-run-authorizes-apply').rejectedGate, 'live');
  assert.equal(rejectedById.get('visible-staging-object-completes-chunk').rejectedGate, 'recovery');
  assert.equal(rejectedById.get('cross-group-row-batch').rejectedGate, 'group');
  assert.equal(rejectedById.get('remote-index-authorizes-mutation').rejectedGate, 'live');
  assert.equal(rejectedById.get('compressed-canonical-hash').rejectedGate, 'live');
  assert.equal(rejectedById.get('parallelize-atomic-group-commit').rejectedGate, 'group');
  assert.equal(rejectedById.get('backpressure-drops-evidence').rejectedGate, 'recovery');

  for (const entry of model.rejectedFastPaths) {
    assert.ok(entry.id);
    assert.ok(entry.proposal.length > 20);
    assert.ok(entry.rejectedBecause.length > 20);
    assert.ok(entry.rejectedGate);
    assert.ok(Array.isArray(entry.violates) && entry.violates.length > 0);
  }
});
