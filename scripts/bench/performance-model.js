#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

export const DEFAULT_LIMITS = Object.freeze({
  chunkSizeBytes: 8 * MIB,
  maxUploadConcurrency: 4,
  maxHashConcurrency: 2,
  maxDbBatchRows: 500,
  maxDbConcurrencyPerTable: 2,
  maxBufferedUploadBytes: 32 * MIB,
  maxPendingDbBatches: 4,
  maxJournalLagMs: 250,
  maxStagingDiskBytes: 4 * GIB,
});

export const SAFE_SPEEDUP_AREAS = Object.freeze([
  'file-hashing',
  'chunk-upload',
  'database-row-batching',
  'remote-indexes',
  'compression',
  'parallelism-limits',
  'backpressure',
]);

export const FAST_PATH_GATES = Object.freeze([
  {
    id: 'skip',
    requirement: 'duplicate work can be skipped only from digest, receipt, or planning-index evidence',
  },
  {
    id: 'live',
    requirement: 'mutating storage writes still check live resource preconditions',
  },
  {
    id: 'group',
    requirement: 'atomic groups keep one visibility boundary for all coupled members',
  },
  {
    id: 'recovery',
    requirement: 'failure recovery can classify old, new, or blocked from durable evidence',
  },
]);

export const SAFE_FAST_PATHS = Object.freeze([
  {
    area: 'file-hashing',
    reduces: ['duplicate-local-hash-work', 'remote-body-fetches'],
    allowedShortcut: 'skip-local-rehash-on-fingerprint-plus-previous-strong-digest',
    guardrails: [
      'cache-entry-includes-previous-digest',
      'apply-uses-live-remote-resource-hash',
    ],
    gateProofs: {
      skip: 'local fingerprint matches a cache entry that includes the previous strong digest',
      live: 'publish still compares the live remote resource hash with the plan precondition',
      group: 'plugin-owned files only move from file staging into atomic group staging before group commit',
      recovery: 'cache evidence is advisory; durable publish or group records classify mutation recovery',
    },
    visibilityBoundary: 'compare-and-swap-file-publish',
    failureEvidence: 'cached digest, file fingerprint, and plan resource hash',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'chunk-upload',
    reduces: ['duplicate-body-transfer', 'lost-response-retries'],
    allowedShortcut: 'resume-plan-scoped-chunks-with-matching-receipts',
    guardrails: [
      'chunks-write-only-to-plan-staging',
      'finalize-requires-complete-chunk-receipts',
    ],
    gateProofs: {
      skip: 'chunk resend is skipped only for a matching plan-scoped durable receipt',
      live: 'final file publish still uses compare-and-swap against the current live resource hash',
      group: 'plugin file chunks finalize into group staging and remain invisible until group commit',
      recovery: 'chunk receipts identify the exact plan, resource, local hash, byte range, and digest',
    },
    visibilityBoundary: 'file-finalize-or-atomic-group-commit',
    failureEvidence: 'chunk receipt keyed by plan, resource, local hash, range, and digest',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['round-trips', 'statement-setup-cost'],
    allowedShortcut: 'reuse-statement-shapes-for-bounded-primary-key-batches',
    guardrails: [
      'one-expected-remote-hash-per-row',
      'batch-transaction-or-group-staging-record',
    ],
    gateProofs: {
      skip: 'statement setup is reused, but no row precondition is skipped',
      live: 'each row in the batch keeps an expected remote hash',
      group: 'plugin-owned rows are staged under their atomic group instead of committed independently',
      recovery: 'batch idempotency keys and commit or staging records prove whether rows advanced',
    },
    visibilityBoundary: 'batch-transaction-or-atomic-group-commit',
    failureEvidence: 'batch idempotency key with row count and precondition count',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'remote-indexes',
    reduces: ['remote-body-fetches', 'planning-round-trips'],
    allowedShortcut: 'plan-from-indexed-strong-hash-listing',
    guardrails: [
      'index-is-planning-evidence-only',
      'apply-revalidates-live-resource-hash',
    ],
    gateProofs: {
      skip: 'remote body fetches are skipped only from indexed strong resource hashes',
      live: 'index entries never authorize writes; apply revalidates live storage state',
      group: 'index metadata can partition by plugin owner but cannot split group visibility',
      recovery: 'the plan records the index cursor, while mutation recovery relies on later receipts',
    },
    visibilityBoundary: 'none-planning-only',
    failureEvidence: 'index cursor recorded with the plan but not used as a lock',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'compression',
    reduces: ['wire-bytes', 'staging-io-for-text-payloads'],
    allowedShortcut: 'compress-transport-frames-with-canonical-uncompressed-digest',
    guardrails: [
      'canonical-hash-over-uncompressed-value',
      'encoded-payload-digest-recorded-separately',
    ],
    gateProofs: {
      skip: 'already-compressed payloads use identity encoding from type evidence and canonical digest',
      live: 'compare-and-swap hashes remain hashes of the uncompressed canonical resource value',
      group: 'transport encoding never changes the atomic group membership or commit boundary',
      recovery: 'canonical and encoded digests distinguish content state from wire integrity',
    },
    visibilityBoundary: 'transport-only',
    failureEvidence: 'canonical digest plus encoded payload digest',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'parallelism-limits',
    reduces: ['idle-time', 'head-of-line-blocking'],
    allowedShortcut: 'run-independent-staging-work-within-per-site-and-per-kind-budgets',
    guardrails: [
      'atomic-groups-remain-dependency-barriers',
      'per-site-and-per-kind-concurrency-budgets',
    ],
    gateProofs: {
      skip: 'no completion is skipped; only independent staging work overlaps',
      live: 'each worker carries the same live precondition into its storage-boundary write',
      group: 'atomic group commits remain serialized per site behind complete member receipts',
      recovery: 'per-worker journal records keep plan-scoped idempotency keys after interruption',
    },
    visibilityBoundary: 'atomic-group-commit-barrier',
    failureEvidence: 'per-worker journal records tied to plan-scoped idempotency keys',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'backpressure',
    reduces: ['retry-amplification', 'memory-and-staging-pressure'],
    allowedShortcut: 'pause-upstream-producers-when-ack-or-journal-budgets-are-hit',
    guardrails: [
      'bounded-queues-retain-resource-level-evidence',
      'resume-requires-durable-receipts-and-journal-catch-up',
    ],
    gateProofs: {
      skip: 'pressure pauses work instead of dropping or summarizing resource evidence',
      live: 'paused work resumes with the original live preconditions still attached',
      group: 'pressure cannot mark a group member complete or commit a group without receipts',
      recovery: 'durable queues and journals retain affected resource identifiers through pause or crash',
    },
    visibilityBoundary: 'none-pause-only',
    failureEvidence: 'durable queue and journal entries with affected resource identifiers',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
]);

export const FAILURE_INJECTION_BOUNDARIES = Object.freeze([
  {
    boundary: 'chunk-ack',
    beforeState: 'chunk-not-complete',
    afterState: 'chunk-complete-in-plan-staging',
    recoveryEvidence: 'chunk digest plus plan-scoped idempotency key',
  },
  {
    boundary: 'db-batch-commit',
    beforeState: 'batch-not-visible',
    afterState: 'batch-visible-or-group-staged',
    recoveryEvidence: 'row count, per-row precondition count, batch idempotency key',
  },
  {
    boundary: 'group-staging-finalize',
    beforeState: 'group-member-staged-but-not-visible',
    afterState: 'group-member-ready-for-commit',
    recoveryEvidence: 'member resource hash, staging hash, atomic group id',
  },
  {
    boundary: 'atomic-group-commit',
    beforeState: 'no-group-members-visible',
    afterState: 'all-group-members-visible',
    recoveryEvidence: 'commit record after all member preconditions are rechecked',
  },
]);

export const REJECTED_FAST_PATHS = Object.freeze([
  {
    id: 'live-chunk-publish',
    proposal: 'write uploaded chunks directly to the live file path',
    rejectedBecause: 'a partial upload can become user-visible and ambiguous after failure',
    rejectedGate: 'recovery',
    violates: ['known-terminal-state', 'atomic-file-publish'],
  },
  {
    id: 'visible-staging-object-completes-chunk',
    proposal: 'treat a visible staging object as a completed chunk without a durable receipt',
    rejectedBecause: 'staging presence is not durable proof that the chunk reached the remote intact',
    rejectedGate: 'recovery',
    violates: ['durable-progress', 'chunk-receipts'],
  },
  {
    id: 'receipt-only-chunk-publish',
    proposal: 'publish staged chunk bytes as soon as a receipt exists, without a guarded finalize step',
    rejectedBecause: 'a receipt proves staging progress, not that the live file can be made visible safely',
    rejectedGate: 'group',
    violates: ['atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'fresh-dry-run-authorizes-apply',
    proposal: 'skip apply preconditions when the dry-run plan is recent',
    rejectedBecause: 'remote edits after dry-run would be overwritten without a live compare',
    rejectedGate: 'live',
    violates: ['live-preconditions'],
  },
  {
    id: 'remote-index-authorizes-mutation',
    proposal: 'treat a remote index generation as permission to mutate',
    rejectedBecause: 'indexes are planning evidence and can be stale before apply',
    rejectedGate: 'live',
    violates: ['live-preconditions'],
  },
  {
    id: 'metadata-only-conflict-check',
    proposal: 'use mtime, size, row count, or table checksum instead of resource hashes',
    rejectedBecause: 'metadata equality is not proof that the guarded resource value is unchanged',
    rejectedGate: 'live',
    violates: ['strong-resource-hashes'],
  },
  {
    id: 'digest-as-authority',
    proposal: 'treat a cached digest or index entry as a substitute for the live compare',
    rejectedBecause: 'a shortcut digest can skip work, but it cannot authorize the mutation boundary',
    rejectedGate: 'live',
    violates: ['live-preconditions'],
  },
  {
    id: 'split-plugin-install',
    proposal: 'publish plugin files before database rows, metadata, dependency checks, and activation state',
    rejectedBecause: 'the plugin can become half-installed and cannot be classified as old or new',
    rejectedGate: 'group',
    violates: ['atomic-groups'],
  },
  {
    id: 'blind-sql-replace',
    proposal: 'bulk replay SQL with REPLACE statements and no row-level compare-and-swap',
    rejectedBecause: 'row ownership and concurrent remote edits are overwritten silently',
    rejectedGate: 'live',
    violates: ['row-preconditions', 'idempotent-replay'],
  },
  {
    id: 'compressed-canonical-hash',
    proposal: 'hash compressed bytes as the canonical resource value',
    rejectedBecause: 'transport encoding changes would look like content changes or hide them',
    rejectedGate: 'live',
    violates: ['canonical-resource-hashes'],
  },
  {
    id: 'compression-skips-precondition',
    proposal: 'use compression to skip the live precondition that guards the uncompressed value',
    rejectedBecause: 'encoding efficiency does not replace the mutation precondition on the canonical resource',
    rejectedGate: 'live',
    violates: ['live-preconditions'],
  },
  {
    id: 'unbounded-parallelism',
    proposal: 'raise concurrency without in-flight byte, queue, or journal-lag budgets',
    rejectedBecause: 'the sender can lose the evidence needed to resume or classify failure',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'durable-progress'],
  },
  {
    id: 'staged-bytes-as-published',
    proposal: 'treat complete-looking staged chunks or row batches as visible without guarded finalize or commit',
    rejectedBecause: 'staging presence does not prove the live preconditions or group commit have completed',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'durable-progress'],
  },
  {
    id: 'skip-plugin-validators-on-package-hash',
    proposal: 'skip dependency, metadata, and activation validators when a plugin package hash is cached',
    rejectedBecause: 'package identity does not prove that coupled remote resources are ready to commit',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'plugin-preconditions'],
  },
  {
    id: 'cross-group-row-batch',
    proposal: 'merge database rows from different plugin owners or atomic groups into one visible batch',
    rejectedBecause: 'recovery could not prove which group owns a partial row result after failure',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'row-preconditions'],
  },
  {
    id: 'index-cursor-as-lock',
    proposal: 'treat a remote index cursor, generation, or ETag as a lock for later apply writes',
    rejectedBecause: 'index evidence can speed planning but cannot prove live storage state at mutation time',
    rejectedGate: 'live',
    violates: ['live-preconditions'],
  },
  {
    id: 'commit-group-with-missing-receipts',
    proposal: 'commit an atomic group before every staged file, row batch, metadata entry, and validator has a receipt',
    rejectedBecause: 'the commit could expose a half-installed plugin or leave no durable proof of what was included',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'durable-progress'],
  },
  {
    id: 'resume-chunk-without-receipt',
    proposal: 'skip a chunk resend whenever a staging object appears present even if the durable receipt is missing',
    rejectedBecause: 'a present-looking object without a receipt cannot prove which bytes were acknowledged after failure',
    rejectedGate: 'recovery',
    violates: ['durable-progress', 'chunk-receipts'],
  },
  {
    id: 'backpressure-drops-evidence',
    proposal: 'summarize or drop queued precondition evidence when upload or journal queues are over budget',
    rejectedBecause: 'pressure handling must pause producers, not erase the evidence needed to classify recovery',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'durable-progress'],
  },
  {
    id: 'queue-empty-means-complete',
    proposal: 'advance an upstream producer because the queue is empty even though receipts are missing',
    rejectedBecause: 'an empty queue is not proof that the remote acknowledged the work',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'durable-progress'],
  },
  {
    id: 'fresh-index-empty-queue-completes-apply',
    proposal: 'treat a fresh remote index plus an empty local queue as proof that apply is complete',
    rejectedBecause: 'planning evidence and local idleness cannot prove the live mutation finished safely',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'backpressure', 'durable-progress'],
  },
  {
    id: 'parallelize-atomic-group-commit',
    proposal: 'run atomic group commits in parallel so independent work can publish sooner',
    rejectedBecause: 'the commit barrier is part of the atomic group and must stay a single visibility point',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'visibility-boundary'],
  },
]);

export function buildBenchmarkModel(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const workloads = [
    largeUploadWorkload(),
    pluginInstallWorkload(),
  ];
  const schedules = workloads.map((workload) => scheduleWorkload(workload, limits));

  return {
    schemaVersion: 1,
    safetyContract: {
      priority: 'fast-fourth',
      acceptableTerminalStates: [
        'unchanged',
        'fully-changed',
        'blocked-with-durable-recovery-evidence',
      ],
      forbids: [
        'ambiguous-after-failure',
        'precondition-bypass',
        'atomic-group-split',
      ],
    },
    limits,
    fastPathGates: FAST_PATH_GATES,
    safeSpeedupAreas: SAFE_SPEEDUP_AREAS,
    safeFastPaths: SAFE_FAST_PATHS,
    failureInjectionBoundaries: FAILURE_INJECTION_BOUNDARIES,
    rejectedFastPaths: REJECTED_FAST_PATHS,
    remoteIndex: {
      use: 'planning-only',
      requiredFields: [
        'resourceKey',
        'resourceType',
        'strongHash',
        'sizeBytes',
        'generation',
        'pluginOwner',
        'tombstone',
      ],
      forbiddenUse: 'apply-authorization',
    },
    workloads,
    schedules,
    totals: summarizeSchedules(schedules),
  };
}

function largeUploadWorkload() {
  return {
    id: 'large-media-upload',
    kind: 'large-upload',
    description: 'A large archive upload that must be staged before a guarded publish.',
    planId: 'plan-large-media-upload-v1',
    atomicGroup: null,
    files: [
      {
        resourceKey: 'file:wp-content/uploads/2026/05/catalog-export.zip',
        path: 'wp-content/uploads/2026/05/catalog-export.zip',
        sizeBytes: 2048 * MIB,
        mimeType: 'application/zip',
        compressible: false,
        baseHash: 'sha256:base-catalog-export',
        remoteBeforeHash: 'sha256:base-catalog-export',
        localHash: 'sha256:local-catalog-export',
      },
    ],
    rowGroups: [],
    pluginResources: [],
  };
}

function pluginInstallWorkload() {
  const atomicGroup = {
    id: 'install-commerce-stack',
    kind: 'plugin-install',
    dependencies: ['payments'],
    commitPolicy: 'all-or-nothing',
  };

  return {
    id: 'plugin-install-commerce-stack',
    kind: 'plugin-install',
    description: 'A plugin install with files, plugin metadata, dependency checks, and large row batches.',
    planId: 'plan-plugin-install-commerce-stack-v1',
    atomicGroup,
    files: [
      pluginFile('file:wp-content/plugins/payments/payments.php', 2 * MIB, 'text/x-php', true, atomicGroup.id),
      pluginFile('file:wp-content/plugins/payments/assets/admin.js', 14 * MIB, 'application/javascript', true, atomicGroup.id),
      pluginFile('file:wp-content/plugins/commerce/commerce.php', 3 * MIB, 'text/x-php', true, atomicGroup.id),
      pluginFile('file:wp-content/plugins/commerce/assets/catalog.dat', 77 * MIB, 'application/octet-stream', false, atomicGroup.id),
    ],
    rowGroups: [
      rowGroup('wp_options', 420, 1200, atomicGroup.id),
      rowGroup('wp_postmeta', 9600, 700, atomicGroup.id),
      rowGroup('wp_actionscheduler_actions', 2600, 900, atomicGroup.id),
    ],
    pluginResources: [
      {
        resourceKey: 'plugin:payments',
        remoteBeforeHash: 'sha256:absent',
        localHash: 'sha256:payments-2.1.0-active',
        atomicGroupId: atomicGroup.id,
      },
      {
        resourceKey: 'plugin:commerce',
        remoteBeforeHash: 'sha256:absent',
        localHash: 'sha256:commerce-1.0.0-active',
        atomicGroupId: atomicGroup.id,
      },
    ],
  };
}

function pluginFile(resourceKey, sizeBytes, mimeType, compressible, atomicGroupId) {
  return {
    resourceKey,
    path: resourceKey.slice('file:'.length),
    sizeBytes,
    mimeType,
    compressible,
    baseHash: 'sha256:absent',
    remoteBeforeHash: 'sha256:absent',
    localHash: `sha256:local-${resourceKey}`,
    atomicGroupId,
  };
}

function rowGroup(table, rowCount, averageRowBytes, atomicGroupId) {
  return {
    table,
    rowCount,
    averageRowBytes,
    remoteBeforeHash: `sha256:base-${table}-rows`,
    localHash: `sha256:local-${table}-rows`,
    atomicGroupId,
  };
}

function scheduleWorkload(workload, limits) {
  const actions = [
    {
      type: 'remote-index-probe',
      workloadId: workload.id,
      purpose: 'avoid-body-fetch-during-planning',
      authorizesApply: false,
      bodyFetched: false,
      freshnessEvidence: 'generation-and-scanner-cursor',
      applyMustRevalidate: true,
      requiredFields: [
        'resourceKey',
        'resourceType',
        'strongHash',
        'sizeBytes',
        'generation',
        'pluginOwner',
        'tombstone',
      ],
    },
  ];

  for (const file of workload.files) {
    actions.push(...scheduleFile(file, workload.planId, limits));
  }

  for (const rowGroupEntry of workload.rowGroups) {
    actions.push(...scheduleRowGroup(rowGroupEntry, workload.planId, limits));
  }

  for (const pluginResource of workload.pluginResources) {
    actions.push({
      type: 'plugin-metadata-stage',
      planId: workload.planId,
      resourceKey: pluginResource.resourceKey,
      atomicGroupId: pluginResource.atomicGroupId,
      precondition: {
        resourceKey: pluginResource.resourceKey,
        expectedHash: pluginResource.remoteBeforeHash,
      },
      canonicalVisible: false,
      durableEvidence: 'plugin-metadata-staging-record',
      idempotencyKey: `${workload.planId}:${pluginResource.atomicGroupId}:${pluginResource.resourceKey}`,
    });
  }

  if (workload.atomicGroup) {
    actions.push(finalizeAtomicGroupStaging(workload, actions));
    actions.push({
      type: 'atomic-group-commit',
      planId: workload.planId,
      atomicGroupId: workload.atomicGroup.id,
      dependencies: [...workload.atomicGroup.dependencies],
      preconditions: 'recheck-all-member-resource-hashes',
      validators: [
        'dependency-preconditions',
        'plugin-metadata-preconditions',
        'activation-preconditions',
      ],
      commitPolicy: workload.atomicGroup.commitPolicy,
      requiresFinalizedGroupStaging: true,
      durableEvidence: 'atomic-group-commit-record',
      idempotencyKey: `${workload.planId}:${workload.atomicGroup.id}:atomic-group-commit`,
      canonicalVisible: true,
    });
  }

  return {
    workloadId: workload.id,
    kind: workload.kind,
    atomicGroupId: workload.atomicGroup?.id || null,
    parallelism: {
      remoteIndex: 1,
      hash: limits.maxHashConcurrency,
      upload: limits.maxUploadConcurrency,
      dbPerTable: limits.maxDbConcurrencyPerTable,
      atomicGroupCommit: workload.atomicGroup ? 1 : 0,
    },
    backpressure: {
      maxInFlightUploadBytes: Math.min(
        limits.maxBufferedUploadBytes,
        limits.chunkSizeBytes * limits.maxUploadConcurrency,
      ),
      maxQueuedDbBatches: limits.maxPendingDbBatches,
      maxJournalLagMs: limits.maxJournalLagMs,
      maxStagingDiskBytes: limits.maxStagingDiskBytes,
      pauseWhen: [
        'upload-acks-lag',
        'journal-fsync-lag',
        'staging-disk-budget-hit',
        'remote-latency-budget-hit',
      ],
      onPressure: 'pause-upstream-producers',
      forbiddenResponse: 'drop-evidence-or-mark-unacknowledged-work-complete',
      resumeRequires: [
        'durable-chunk-receipts',
        'database-batch-commit-records',
        'journal-fsync-caught-up',
      ],
    },
    actions,
    totals: summarizeActions(actions),
  };
}

function finalizeAtomicGroupStaging(workload, actions) {
  const groupId = workload.atomicGroup.id;
  const groupActions = actions.filter((action) => action.atomicGroupId === groupId);
  const chunkReceipts = groupActions.filter((action) => action.type === 'chunk-upload');
  const stagedFiles = groupActions.filter((action) => action.type === 'file-publish');
  const rowBatches = groupActions.filter((action) => action.type === 'db-row-batch');
  const pluginMetadataEntries = groupActions.filter((action) => action.type === 'plugin-metadata-stage');

  return {
    type: 'group-staging-finalize',
    planId: workload.planId,
    atomicGroupId: groupId,
    finalizeMode: 'receipts-plus-live-preconditions',
    canonicalVisible: false,
    requiredReceipts: {
      chunkReceipts: chunkReceipts.length,
      stagedFiles: stagedFiles.length,
      rowBatches: rowBatches.length,
      pluginMetadataEntries: pluginMetadataEntries.length,
    },
    preconditions: 'recheck-all-member-resource-hashes',
    validators: [
      'dependency-preconditions',
      'plugin-metadata-preconditions',
      'activation-preconditions',
    ],
    durableEvidence: 'group-staging-finalize-record',
    idempotencyKey: `${workload.planId}:${groupId}:group-staging-finalize`,
    failsClosedWhen: [
      'missing-member-receipt',
      'live-precondition-drift',
      'validator-missing',
    ],
  };
}

function scheduleFile(file, planId, limits) {
  const chunkCount = Math.ceil(file.sizeBytes / limits.chunkSizeBytes);
  const actions = [
    {
      type: 'file-hash',
      resourceKey: file.resourceKey,
      sizeBytes: file.sizeBytes,
      cacheKey: 'size+mtime+inode+mode+previous-digest',
      resultHash: file.localHash,
      strongHashRequired: true,
    },
    {
      type: 'compression-decision',
      resourceKey: file.resourceKey,
      mimeType: file.mimeType,
      compressible: file.compressible,
      canonicalHashEncoding: 'uncompressed-resource-value',
      transportEncoding: file.compressible ? 'zstd' : 'identity',
    },
  ];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const offsetBytes = chunkIndex * limits.chunkSizeBytes;
    const sizeBytes = Math.min(limits.chunkSizeBytes, file.sizeBytes - offsetBytes);
    const chunkDigest = `sha256:${file.resourceKey}:chunk:${chunkIndex}`;
    actions.push({
      type: 'chunk-upload',
      planId,
      resourceKey: file.resourceKey,
      atomicGroupId: file.atomicGroupId || null,
      chunkIndex,
      chunkCount,
      offsetBytes,
      sizeBytes,
      chunkDigest,
      destination: 'plan-staging',
      canonicalVisible: false,
      durableEvidence: 'chunk-digest-and-idempotency-key',
      durableAckRequired: true,
      completionRule: 'complete-after-durable-ack',
      receiptKey: `${planId}:${file.resourceKey}:${file.localHash}:${chunkIndex}:${chunkDigest}`,
      resumeCursor: {
        planId,
        resourceKey: file.resourceKey,
        localHash: file.localHash,
        chunkIndex,
        chunkDigest,
        offsetBytes,
        sizeBytes,
      },
      idempotencyKey: `${planId}:${file.localHash}:${chunkIndex}`,
    });
  }

  actions.push({
    type: 'file-publish',
    planId,
    resourceKey: file.resourceKey,
    atomicGroupId: file.atomicGroupId || null,
    source: 'plan-staging',
    destination: file.atomicGroupId ? 'atomic-group-staging' : 'live-path',
    canonicalVisible: !file.atomicGroupId,
    publishMode: 'compare-and-swap',
    durableEvidence: file.atomicGroupId
      ? 'file-group-staging-record'
      : 'file-publish-commit-record',
    idempotencyKey: `${planId}:${file.resourceKey}:file-publish`,
    precondition: {
      resourceKey: file.resourceKey,
      expectedHash: file.remoteBeforeHash,
    },
    assembledHash: file.localHash,
    chunkCount,
    requiresCompleteChunkReceipts: chunkCount,
  });

  return actions;
}

function scheduleRowGroup(rowGroupEntry, planId, limits) {
  const actions = [];
  const batchCount = Math.ceil(rowGroupEntry.rowCount / limits.maxDbBatchRows);

  for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
    const firstRow = batchIndex * limits.maxDbBatchRows;
    const rowCount = Math.min(limits.maxDbBatchRows, rowGroupEntry.rowCount - firstRow);
    actions.push({
      type: 'db-row-batch',
      table: rowGroupEntry.table,
      atomicGroupId: rowGroupEntry.atomicGroupId || null,
      batchIndex,
      batchCount,
      firstRow,
      rowCount,
      estimatedBytes: rowCount * rowGroupEntry.averageRowBytes,
      order: 'primary-key',
      transaction: rowGroupEntry.atomicGroupId ? 'group-staging' : 'batch-atomic',
      canonicalVisible: !rowGroupEntry.atomicGroupId,
      durableEvidence: 'batch-commit-record-or-group-staging-record',
      preconditions: {
        kind: 'per-row-hash',
        count: rowCount,
      },
      resumeCursor: {
        planId,
        table: rowGroupEntry.table,
        firstRow,
        rowCount,
        order: 'primary-key',
      },
      idempotencyKey: `${planId}:${rowGroupEntry.atomicGroupId || 'independent'}:${rowGroupEntry.table}:${batchIndex}`,
    });
  }

  return actions;
}

function summarizeSchedules(schedules) {
  return schedules.reduce(
    (totals, schedule) => {
      totals.uploadChunks += schedule.totals.uploadChunks;
      totals.uploadBytes += schedule.totals.uploadBytes;
      totals.dbRows += schedule.totals.dbRows;
      totals.dbBatches += schedule.totals.dbBatches;
      totals.filePublishes += schedule.totals.filePublishes;
      totals.groupStagingFinalizes += schedule.totals.groupStagingFinalizes;
      totals.atomicGroupCommits += schedule.totals.atomicGroupCommits;
      return totals;
    },
    {
      uploadChunks: 0,
      uploadBytes: 0,
      dbRows: 0,
      dbBatches: 0,
      filePublishes: 0,
      groupStagingFinalizes: 0,
      atomicGroupCommits: 0,
    },
  );
}

function summarizeActions(actions) {
  const totals = {
    uploadChunks: 0,
    uploadBytes: 0,
    dbRows: 0,
    dbBatches: 0,
    filePublishes: 0,
    groupStagingFinalizes: 0,
    atomicGroupCommits: 0,
  };

  for (const action of actions) {
    if (action.type === 'chunk-upload') {
      totals.uploadChunks++;
      totals.uploadBytes += action.sizeBytes;
    }
    if (action.type === 'db-row-batch') {
      totals.dbRows += action.rowCount;
      totals.dbBatches++;
    }
    if (action.type === 'file-publish') {
      totals.filePublishes++;
    }
    if (action.type === 'group-staging-finalize') {
      totals.groupStagingFinalizes++;
    }
    if (action.type === 'atomic-group-commit') {
      totals.atomicGroupCommits++;
    }
  }

  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(buildBenchmarkModel(), null, 2)}\n`);
}
