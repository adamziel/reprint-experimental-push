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
    id: 'chunk-digest-completes-chunk',
    proposal: 'treat a matching chunk digest as enough proof that a chunk is complete without a durable receipt',
    rejectedBecause: 'a chunk digest can identify the bytes, but it cannot prove the remote acknowledged them after failure',
    rejectedGate: 'recovery',
    violates: ['chunk-receipts', 'durable-progress'],
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
    id: 'fingerprint-as-apply-authority',
    proposal: 'treat a local fingerprint match as enough proof to skip the live remote compare before publish',
    rejectedBecause: 'fingerprints can skip rehashing, but they cannot authorize the mutation boundary or prove the remote has not changed',
    rejectedGate: 'live',
    violates: ['live-preconditions', 'canonical-resource-hashes'],
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
    id: 'parallel-commit-widening',
    proposal: 'publish independent work from multiple atomic groups in one wider commit for throughput',
    rejectedBecause: 'parallel staging is fine, but widening the visibility boundary hides which group owns a partial failure',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'parallelism-limits'],
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
    id: 'full-digest-completes-chunk-resume',
    proposal: 'treat a matching full-file digest as enough proof to skip missing chunk receipts during resume',
    rejectedBecause: 'a full-file digest can identify content, but it cannot prove which chunk acknowledgements survived failure',
    rejectedGate: 'recovery',
    violates: ['chunk-receipts', 'durable-progress'],
  },
  {
    id: 'manifest-hash-completes-large-upload',
    proposal: 'treat a matching manifest or archive hash as proof that every chunk and guarded publish already succeeded',
    rejectedBecause: 'a full-object hash can confirm content identity, but it cannot prove each chunk receipt or the publish finalize record survived failure',
    rejectedGate: 'recovery',
    violates: ['chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'archive-hash-skips-chunk-receipts',
    proposal: 'treat a matching archive hash as enough proof to skip missing chunk receipts during large-upload resume',
    rejectedBecause: 'the archive hash can confirm the payload shape, but it cannot prove which chunk acknowledgements survived a crash or lost response',
    rejectedGate: 'recovery',
    violates: ['chunk-receipts', 'durable-progress'],
  },
  {
    id: 'backpressure-drops-evidence',
    proposal: 'summarize or drop queued precondition evidence when upload or journal queues are over budget',
    rejectedBecause: 'pressure handling must pause producers, not erase the evidence needed to classify recovery',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-buffer-means-complete',
    proposal: 'treat a compressed in-memory buffer as proof that upload or batch work is durable',
    rejectedBecause: 'compression can shrink buffered state, but it cannot replace the receipt or commit record needed after failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-queue-drains-means-complete',
    proposal: 'treat a drained compressed queue as proof that all staged work reached the remote',
    rejectedBecause: 'a smaller queue can reduce pressure, but it still cannot prove which chunks or rows were durably acknowledged',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-queue-completes-apply',
    proposal: 'treat a fresh remote index plus a drained compressed queue as proof that apply is complete',
    rejectedBecause: 'planning evidence and queue compression can reduce work, but they cannot prove the live mutation or its receipts survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-buffer-acknowledges-chunks',
    proposal: 'treat compressed staging buffers as durable proof that chunk uploads reached the remote',
    rejectedBecause: 'compression only shrinks buffered state; it does not replace per-chunk receipts or the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['compression', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-upload-queue-completes-large-upload',
    proposal: 'treat a drained compressed upload queue as proof that a large upload has fully completed',
    rejectedBecause: 'compression can reduce queued bytes, but it cannot prove the missing chunk receipts or guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-receipts-replace-durable-progress',
    proposal: 'compress chunk or batch receipts into a summary and treat the summary as the durable record',
    rejectedBecause: 'a compressed summary can save space, but it can also erase the per-chunk or per-row evidence needed to classify partial failure after a crash or lost response',
    rejectedGate: 'recovery',
    violates: ['compression', 'chunk-receipts', 'durable-progress', 'row-preconditions'],
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
    id: 'index-and-digest-completes-apply',
    proposal: 'treat a fresh remote index plus a cached digest as proof that the live apply already finished',
    rejectedBecause: 'planning evidence and cached hashes can skip work, but they cannot replace a live compare or recovery receipt',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'index-and-digest-completes-large-upload',
    proposal: 'treat a fresh remote index plus a cached file digest as proof that a large upload already finished',
    rejectedBecause: 'a cached digest can skip rehashing, but it cannot prove chunk receipts or the guarded publish survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-buffer-completes-large-upload',
    proposal: 'treat a fresh remote index plus a compressed upload buffer as proof that a large upload already finished',
    rejectedBecause: 'planning evidence and compressed buffers can reduce stalled work, but they cannot prove the live compare or durable chunk receipts survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'live-preconditions', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'index-and-digest-skips-row-preconditions',
    proposal: 'use a fresh remote index plus a cached digest to skip per-row preconditions in a database batch',
    rejectedBecause: 'row-level compare-and-swap still has to guard each mutating write at apply time',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'row-preconditions', 'live-preconditions'],
  },
  {
    id: 'index-and-chunk-receipts-skip-file-compare',
    proposal: 'use a fresh remote index plus durable chunk receipts to skip the live file compare before publish',
    rejectedBecause: 'planning evidence and chunk acknowledgements can prove staged progress, but they cannot prove the live file still matches the publish precondition',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'chunk-receipts', 'live-preconditions'],
  },
  {
    id: 'index-and-chunk-receipts-skip-guarded-publish',
    proposal: 'use a fresh remote index plus cached chunk receipts to skip the guarded publish finalize for a large upload',
    rejectedBecause: 'planning evidence and chunk receipts can prove staged progress, but they cannot prove the publish finalize record or live visibility boundary survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'index-and-table-checksum-skips-batch-preconditions',
    proposal: 'use a fresh remote index plus a table checksum to skip row-batch preconditions or plugin metadata checks',
    rejectedBecause: 'planning evidence and table-level metadata can shorten lookup work, but they cannot replace live per-row or per-member preconditions at mutation time',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'row-preconditions', 'plugin-preconditions', 'live-preconditions'],
  },
  {
    id: 'index-and-package-hash-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a cached plugin package hash as proof that the install can skip its live boundary',
    rejectedBecause: 'planning evidence and a package hash do not prove dependency checks, metadata writes, or atomic-group commit completion',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'plugin-preconditions', 'atomic-groups'],
  },
  {
    id: 'index-and-package-hash-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a cached plugin package hash as proof that the update can skip its live boundary',
    rejectedBecause: 'planning evidence and a package hash do not prove dependency checks, metadata writes, or atomic-group commit completion',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'plugin-preconditions', 'atomic-groups'],
  },
  {
    id: 'index-and-package-hash-skips-plugin-validators',
    proposal: 'use a fresh remote index plus a cached package hash to skip dependency, metadata, and activation validators',
    rejectedBecause: 'package identity can speed planning, but validators still need a live group-scoped commit barrier',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'plugin-preconditions', 'atomic-groups'],
  },
  {
    id: 'compressed-package-cache-skips-plugin-preconditions',
    proposal: 'treat a compressed package cache as enough proof to skip plugin dependency checks and the atomic-group barrier',
    rejectedBecause: 'compression can shrink cached package evidence, but it cannot prove dependency readiness, metadata writes, or group commit completion',
    rejectedGate: 'group',
    violates: ['compression', 'plugin-preconditions', 'atomic-groups'],
  },
  {
    id: 'index-and-compressed-package-cache-skips-plugin-validators',
    proposal: 'treat a fresh remote index plus a compressed package cache as enough proof to skip plugin validators and the atomic-group barrier',
    rejectedBecause: 'planning evidence and compressed package storage can reduce lookup work, but they cannot prove dependency readiness, metadata writes, or group commit completion',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-upload-queue-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed upload queue as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and queue compression can reduce work, but they cannot prove dependency checks, staged files, and the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-upload-queue-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a compressed upload queue as proof that a plugin update already finished',
    rejectedBecause: 'planning evidence and queue compression can reduce work, but they cannot prove dependency checks, staged files, and the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-batch-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a compressed row batch as proof that a plugin update already finished',
    rejectedBecause: 'planning evidence and batch compression can reduce work, but they cannot prove per-row preconditions, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-row-batch-skips-batch-receipts',
    proposal: 'treat a compressed database batch as durable proof that every row in the batch reached the remote',
    rejectedBecause: 'compression can lower queue pressure, but it cannot replace the per-row receipts and recovery record needed to classify partial batch failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'row-preconditions', 'backpressure', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-batch-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed row batch as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and batch compression can reduce work, but they cannot prove per-row preconditions, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-upload-queue-completes-large-upload',
    proposal: 'treat a fresh remote index plus a compressed upload queue as proof that a large upload already finished',
    rejectedBecause: 'planning evidence and queue compression can reduce work, but they cannot prove the live file compare or durable chunk receipts survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'live-preconditions', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-buffer-completes-chunk-resume',
    proposal: 'treat a fresh remote index plus a compressed in-memory buffer as enough proof to skip missing chunk receipts during resume',
    rejectedBecause: 'planning evidence and compressed buffers can reduce stalled work, but they cannot prove which chunk acknowledgements survived a crash or pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-buffer-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a compressed in-memory buffer as proof that a plugin update already finished',
    rejectedBecause: 'planning evidence and compressed staging buffers can reduce work, but they cannot prove dependency checks, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-buffer-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed in-memory buffer as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and compressed staging buffers can reduce work, but they cannot prove dependency checks, metadata writes, file receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-buffer-completes-plugin-activation',
    proposal: 'treat a fresh remote index plus a compressed staging buffer as proof that plugin activation already finished',
    rejectedBecause: 'planning evidence and compressed buffers can reduce work, but they cannot prove the activation change, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-file-hash-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed file-hash cache as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and hash compression can reduce rework, but they cannot prove dependency checks, staged files, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-file-hash-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a compressed file-hash cache as proof that a plugin update already finished',
    rejectedBecause: 'planning evidence and hash compression can reduce rework, but they cannot prove dependency checks, staged files, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-file-hash-completes-large-upload',
    proposal: 'treat a compressed file-hash cache as proof that a large upload already finished',
    rejectedBecause: 'a compressed hash cache can reduce rehash work, but it cannot prove chunk receipts or the guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-chunk-receipts-completes-plugin-update',
    proposal: 'treat a fresh remote index plus compressed chunk receipts as proof that a plugin update already finished',
    rejectedBecause: 'chunk receipts can prove staged upload progress, but compression and planning evidence cannot prove dependency checks, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'parallelize-atomic-group-commit',
    proposal: 'run atomic group commits in parallel so independent work can publish sooner',
    rejectedBecause: 'the commit barrier is part of the atomic group and must stay a single visibility point',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'visibility-boundary'],
  },
  {
    id: 'parallelize-db-batch-visibility-across-groups',
    proposal: 'publish database batches from different atomic groups in parallel once their SQL work is done',
    rejectedBecause: 'row work can overlap, but visibility still has to wait for each group-owned commit barrier so recovery can name the exact coupled state',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'row-preconditions', 'visibility-boundary'],
  },
  {
    id: 'parallelize-chunk-visibility-across-groups',
    proposal: 'let chunk uploads from different atomic groups become visible as soon as their receipts arrive',
    rejectedBecause: 'chunk receipts can overlap, but visibility still has to wait for the owning group barrier so a crash cannot expose a half-complete plugin or upload set',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'chunk-receipts', 'visibility-boundary'],
  },
]);

export function buildBenchmarkModel(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const workloads = [
    largeUploadWorkload(),
    pluginInstallWorkload(),
    pluginUpdateWorkload(),
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
    description: 'A large archive and manifest upload that must be staged before a guarded publish.',
    planId: 'plan-large-media-upload-v1',
    atomicGroup: null,
    files: [
      {
        resourceKey: 'file:wp-content/uploads/2026/05/catalog-manifest.json',
        path: 'wp-content/uploads/2026/05/catalog-manifest.json',
        sizeBytes: 256 * MIB,
        mimeType: 'application/json',
        compressible: true,
        baseHash: 'sha256:base-catalog-manifest',
        remoteBeforeHash: 'sha256:base-catalog-manifest',
        localHash: 'sha256:local-catalog-manifest',
      },
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

function pluginUpdateWorkload() {
  const atomicGroup = {
    id: 'update-commerce-stack',
    kind: 'plugin-update',
    dependencies: ['payments', 'subscriptions'],
    commitPolicy: 'all-or-nothing',
  };

  return {
    id: 'plugin-update-commerce-stack',
    kind: 'plugin-update',
    description: 'A dependency-heavy plugin update with remote indexes, file staging, and row batching.',
    planId: 'plan-plugin-update-commerce-stack-v1',
    atomicGroup,
    files: [
      pluginFile('file:wp-content/plugins/commerce/commerce.php', 3 * MIB, 'text/x-php', true, atomicGroup.id),
      pluginFile('file:wp-content/plugins/commerce/assets/admin.css', 9 * MIB, 'text/css', true, atomicGroup.id),
      pluginFile(
        'file:wp-content/plugins/commerce/assets/catalog-sync.bin',
        64 * MIB,
        'application/octet-stream',
        false,
        atomicGroup.id,
      ),
    ],
    rowGroups: [
      rowGroup('wp_options', 180, 900, atomicGroup.id),
      rowGroup('wp_postmeta', 5400, 640, atomicGroup.id),
      rowGroup('wp_termmeta', 1400, 520, atomicGroup.id),
    ],
    pluginResources: [
      {
        resourceKey: 'plugin:payments',
        remoteBeforeHash: 'sha256:payments-2.1.0-active',
        localHash: 'sha256:payments-2.1.1-active',
        atomicGroupId: atomicGroup.id,
      },
      {
        resourceKey: 'plugin:subscriptions',
        remoteBeforeHash: 'sha256:subscriptions-1.4.0-active',
        localHash: 'sha256:subscriptions-1.5.0-active',
        atomicGroupId: atomicGroup.id,
      },
      {
        resourceKey: 'plugin:commerce',
        remoteBeforeHash: 'sha256:commerce-1.0.0-active',
        localHash: 'sha256:commerce-1.1.0-active',
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

  const backpressureSignals = [];
  const totalUploadBytes = actions
    .filter((action) => action.type === 'chunk-upload')
    .reduce((sum, action) => sum + action.sizeBytes, 0);
  const totalDbBatches = actions.filter((action) => action.type === 'db-row-batch').length;

  if (totalUploadBytes > limits.maxBufferedUploadBytes) {
    backpressureSignals.push('upload-acks-lag');
    backpressureSignals.push('staging-disk-budget-hit');
  }
  if (totalDbBatches > limits.maxPendingDbBatches) {
    backpressureSignals.push('journal-fsync-lag');
  }
  if (workload.atomicGroup) {
    backpressureSignals.push('remote-latency-budget-hit');
  }

  if (backpressureSignals.length > 0) {
    actions.push({
      type: 'backpressure-pause',
      workloadId: workload.id,
      planId: workload.planId,
      pauseWhen: [...new Set(backpressureSignals)],
      onPressure: 'pause-upstream-producers',
      forbiddenResponse: 'drop-evidence-or-mark-unacknowledged-work-complete',
      resumeRequires: [
        'durable-chunk-receipts',
        'database-batch-commit-records',
        'journal-fsync-caught-up',
      ],
      canonicalVisible: false,
      durableEvidence: 'backpressure-pause-record',
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
      type: 'chunk-hash',
      resourceKey: file.resourceKey,
      chunkIndex,
      chunkCount,
      offsetBytes,
      sizeBytes,
      chunkDigest,
      strongHashRequired: true,
      canonicalVisible: false,
      durableEvidence: 'chunk-hash-record',
      idempotencyKey: `${planId}:${file.resourceKey}:${chunkIndex}:chunk-hash`,
    });
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
    chunkHashes: 0,
    uploadChunks: 0,
    uploadBytes: 0,
    dbRows: 0,
    dbBatches: 0,
    filePublishes: 0,
    groupStagingFinalizes: 0,
    atomicGroupCommits: 0,
  };

  for (const action of actions) {
    if (action.type === 'chunk-hash') {
      totals.chunkHashes++;
    }
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
