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
    violates: ['known-terminal-state', 'atomic-file-publish'],
  },
  {
    id: 'fresh-dry-run-authorizes-apply',
    proposal: 'skip apply preconditions when the dry-run plan is recent',
    rejectedBecause: 'remote edits after dry-run would be overwritten without a live compare',
    violates: ['live-preconditions'],
  },
  {
    id: 'remote-index-authorizes-mutation',
    proposal: 'treat a remote index generation as permission to mutate',
    rejectedBecause: 'indexes are planning evidence and can be stale before apply',
    violates: ['live-preconditions'],
  },
  {
    id: 'metadata-only-conflict-check',
    proposal: 'use mtime, size, row count, or table checksum instead of resource hashes',
    rejectedBecause: 'metadata equality is not proof that the guarded resource value is unchanged',
    violates: ['strong-resource-hashes'],
  },
  {
    id: 'split-plugin-install',
    proposal: 'publish plugin files before database rows, metadata, dependency checks, and activation state',
    rejectedBecause: 'the plugin can become half-installed and cannot be classified as old or new',
    violates: ['atomic-groups'],
  },
  {
    id: 'blind-sql-replace',
    proposal: 'bulk replay SQL with REPLACE statements and no row-level compare-and-swap',
    rejectedBecause: 'row ownership and concurrent remote edits are overwritten silently',
    violates: ['row-preconditions', 'idempotent-replay'],
  },
  {
    id: 'compressed-canonical-hash',
    proposal: 'hash compressed bytes as the canonical resource value',
    rejectedBecause: 'transport encoding changes would look like content changes or hide them',
    violates: ['canonical-resource-hashes'],
  },
  {
    id: 'unbounded-parallelism',
    proposal: 'raise concurrency without in-flight byte, queue, or journal-lag budgets',
    rejectedBecause: 'the sender can lose the evidence needed to resume or classify failure',
    violates: ['backpressure', 'durable-progress'],
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
    safeSpeedupAreas: SAFE_SPEEDUP_AREAS,
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
    atomicGroup: null,
    files: [
      {
        resourceKey: 'file:wp-content/uploads/2026/05/catalog-export.zip',
        path: 'wp-content/uploads/2026/05/catalog-export.zip',
        sizeBytes: 1536 * MIB,
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
    },
  ];

  for (const file of workload.files) {
    actions.push(...scheduleFile(file, limits));
  }

  for (const rowGroupEntry of workload.rowGroups) {
    actions.push(...scheduleRowGroup(rowGroupEntry, limits));
  }

  for (const pluginResource of workload.pluginResources) {
    actions.push({
      type: 'plugin-metadata-stage',
      resourceKey: pluginResource.resourceKey,
      atomicGroupId: pluginResource.atomicGroupId,
      precondition: {
        resourceKey: pluginResource.resourceKey,
        expectedHash: pluginResource.remoteBeforeHash,
      },
      canonicalVisible: false,
      idempotencyKey: `${pluginResource.atomicGroupId}:${pluginResource.resourceKey}`,
    });
  }

  if (workload.atomicGroup) {
    actions.push({
      type: 'atomic-group-commit',
      atomicGroupId: workload.atomicGroup.id,
      dependencies: [...workload.atomicGroup.dependencies],
      preconditions: 'recheck-all-member-resource-hashes',
      commitPolicy: workload.atomicGroup.commitPolicy,
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
      pauseWhen: [
        'upload-acks-lag',
        'journal-fsync-lag',
        'staging-disk-budget-hit',
        'remote-latency-budget-hit',
      ],
    },
    actions,
    totals: summarizeActions(actions),
  };
}

function scheduleFile(file, limits) {
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
    actions.push({
      type: 'chunk-upload',
      resourceKey: file.resourceKey,
      atomicGroupId: file.atomicGroupId || null,
      chunkIndex,
      chunkCount,
      offsetBytes,
      sizeBytes,
      chunkDigest: `sha256:${file.resourceKey}:chunk:${chunkIndex}`,
      destination: 'plan-staging',
      canonicalVisible: false,
      durableEvidence: 'chunk-digest-and-idempotency-key',
      idempotencyKey: `${file.localHash}:${chunkIndex}`,
    });
  }

  actions.push({
    type: 'file-publish',
    resourceKey: file.resourceKey,
    atomicGroupId: file.atomicGroupId || null,
    source: 'plan-staging',
    destination: file.atomicGroupId ? 'atomic-group-staging' : 'live-path',
    canonicalVisible: !file.atomicGroupId,
    precondition: {
      resourceKey: file.resourceKey,
      expectedHash: file.remoteBeforeHash,
    },
    assembledHash: file.localHash,
    chunkCount,
  });

  return actions;
}

function scheduleRowGroup(rowGroupEntry, limits) {
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
      idempotencyKey: `${rowGroupEntry.atomicGroupId || 'independent'}:${rowGroupEntry.table}:${batchIndex}`,
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
      totals.atomicGroupCommits += schedule.totals.atomicGroupCommits;
      return totals;
    },
    {
      uploadChunks: 0,
      uploadBytes: 0,
      dbRows: 0,
      dbBatches: 0,
      filePublishes: 0,
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
    if (action.type === 'atomic-group-commit') {
      totals.atomicGroupCommits++;
    }
  }

  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(buildBenchmarkModel(), null, 2)}\n`);
}
