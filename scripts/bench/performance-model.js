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
    area: 'file-hashing',
    reduces: ['duplicate-local-hash-work', 'planning-round-trips'],
    allowedShortcut: 'reuse-remote-index-cursor-to-skip-unchanged-file-hash-planning',
    guardrails: [
      'remote-index-remains-planning-evidence-only',
      'live-publish-still-revalidates-remote-resource-hash',
    ],
    gateProofs: {
      skip: 'the planner can reuse a remote-index cursor to avoid re-scanning unchanged files while it prepares strong hashes',
      live: 'the eventual publish still compares the live remote resource hash against the expected file precondition',
      group: 'the cursor only shortens planning for one file boundary and never widens an atomic group',
      recovery: 'the planning cursor is advisory; durable chunk receipts and the guarded publish record still classify failure',
    },
    visibilityBoundary: 'planning-only-before-file-publish',
    failureEvidence: 'planning cursor plus cached digest and guarded file-publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'file-hashing',
    reduces: ['duplicate-chunk-rehash-work', 'resume-recompute-time'],
    allowedShortcut: 'reuse-plan-scoped-chunk-digests-for-large-file-resume',
    guardrails: [
      'chunk-digests-are-plan-scoped',
      'live-publish-still-compares-remote-resource-hash',
    ],
    gateProofs: {
      skip: 'resumed large files can skip duplicate chunk rehashing only when every cached chunk digest matches the plan-scoped receipt ledger',
      live: 'the final publish still compares the live remote resource hash against the expected file precondition',
      group: 'chunk reuse only narrows recomputation inside the same file boundary and never widens an atomic group',
      recovery: 'chunk digest receipts and the publish record classify whether the upload stopped before or after guarded visibility',
    },
    visibilityBoundary: 'plan-staging-reuse-only',
    failureEvidence: 'plan-scoped chunk digest ledger plus guarded file-publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'file-hashing',
    reduces: ['duplicate-chunk-rehash-work', 'resume-recompute-time'],
    allowedShortcut: 'reuse-cached-chunk-ledger-for-resume-with-live-publish-check',
    guardrails: [
      'chunk-ledger-is-resume-evidence-only',
      'live-publish-still-compares-remote-resource-hash',
    ],
    gateProofs: {
      skip: 'a cached chunk ledger can skip duplicate chunk rehashing only when every chunk digest matches the plan-scoped ledger',
      live: 'the final publish still compares the live remote resource hash against the expected file precondition',
      group: 'ledger reuse stays inside one file boundary and never widens an atomic group',
      recovery: 'the chunk ledger is advisory; durable chunk receipts and the publish record still classify whether the upload survived failure',
    },
    visibilityBoundary: 'plan-staging-reuse-only',
    failureEvidence: 'cached chunk ledger plus guarded file-publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'file-hashing',
    reduces: ['duplicate-chunk-rehash-work', 'resume-recompute-time'],
    allowedShortcut: 'hash-large-files-in-bounded-parallel-chunks-within-budget',
    guardrails: [
      'chunk-hashing-stays-plan-scoped',
      'final-publish-still-requires-durable-chunk-receipts',
    ],
    gateProofs: {
      skip: 'bounded parallel chunk hashing can reuse durable chunk receipts instead of rehashing the whole body on every retry',
      live: 'the final publish still compares the live remote resource hash before visibility changes',
      group: 'chunk hashing may overlap, but only inside the same file boundary and budgeted plan scope',
      recovery: 'chunk digest receipts plus the guarded publish record classify whether the upload stopped before or after visibility',
    },
    visibilityBoundary: 'plan-staging-hash-only',
    failureEvidence: 'bounded chunk digest ledger plus guarded file-publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'file-hashing',
    reduces: ['duplicate-rehash-work', 'resume-recompute-time', 'planning-round-trips'],
    allowedShortcut: 'reuse-file-hash-ledger-to-size-large-upload-resume-with-guarded-publish-check',
    guardrails: [
      'hash-ledger-is-resume-evidence-only',
      'publish-still-compares-the-live-resource-hash',
    ],
    gateProofs: {
      skip: 'a recorded file-hash ledger can skip duplicate rehashing and planning rescans for a large-upload resume when the ledger matches the plan-scoped receipt set',
      live: 'the guarded publish step still compares the live remote resource hash before any bytes become visible',
      group: 'hash-ledger reuse stays inside one file boundary and never widens an atomic group',
      recovery: 'the ledger is only resume evidence; durable chunk receipts and the publish record still classify whether the upload stopped before or after visibility',
    },
    visibilityBoundary: 'plan-staging-resume-only',
    failureEvidence: 'file-hash ledger plus guarded file-publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'chunk-upload',
    reduces: ['planning-round-trips', 'duplicate-body-transfer', 'idle-time'],
    allowedShortcut: 'reuse-remote-index-cursor-to-size-bounded-chunk-windows',
    guardrails: [
      'remote-index-stays-planning-evidence-only',
      'chunk-window-stays-within-byte-and-receipt-budgets',
    ],
    gateProofs: {
      skip: 'the sender can reuse the remote-index cursor to avoid rescanning unchanged planning data while sizing the next large-upload chunk window',
      live: 'the eventual file publish still compares the live remote resource hash before any bytes become visible',
      group: 'chunk-window sizing only shortens planning inside the same file boundary and never widens an atomic group',
      recovery: 'the planning cursor stays advisory while chunk receipts and the guarded publish record classify pause, retry, or crash',
    },
    visibilityBoundary: 'plan-staging-window-only',
    failureEvidence: 'planning cursor plus bounded chunk receipt ledger',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'chunk-upload',
    reduces: ['planning-round-trips', 'duplicate-body-transfer', 'idle-time'],
    allowedShortcut: 'reuse-plan-scoped-chunk-receipts-to-resume-bounded-windowing',
    guardrails: [
      'chunk-receipts-are-plan-scoped-and-durable',
      'window-sizing-stays-within-byte-and-receipt-budgets',
    ],
    gateProofs: {
      skip: 'a plan-scoped chunk receipt set can avoid rescanning already-acknowledged chunks while sizing the next bounded upload window',
      live: 'the eventual publish still compares the live remote resource hash before any staged bytes become visible',
      group: 'window reuse stays inside the same file boundary and never widens an atomic group',
      recovery: 'durable chunk receipts and the guarded publish record still classify pause, retry, or crash',
    },
    visibilityBoundary: 'plan-staging-window-resume-only',
    failureEvidence: 'plan-scoped chunk receipts plus guarded file-publish record',
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
    area: 'chunk-upload',
    reduces: ['idle-time', 'lost-response-retries', 'duplicate-body-transfer'],
    allowedShortcut: 'pipeline-independent-chunks-within-byte-and-receipt-budgets',
    guardrails: [
      'chunks-remain-plan-scoped-and-addressed-by-digest',
      'finalize-still-requires-complete-durable-receipts',
    ],
    gateProofs: {
      skip: 'independent chunk sends may overlap when each chunk keeps its own digest, byte range, and idempotency key',
      live: 'the final file publish still compares the live remote resource hash against the expected precondition',
      group: 'chunk pipelining only advances work inside the same plan or atomic group and never widens the visibility boundary',
      recovery: 'durable chunk receipts and the guarded publish record still classify whether a crash happened before or after finalize',
    },
    visibilityBoundary: 'plan-staging-pipeline-only',
    failureEvidence: 'plan-scoped receipt ledger plus guarded publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'chunk-upload',
    reduces: ['idle-time', 'planning-round-trips', 'duplicate-body-transfer'],
    allowedShortcut: 'compress-chunk-transit-frames-and-reuse-plan-scoped-receipts-within-budgets',
    guardrails: [
      'chunk-body-encoding-is-transport-only',
      'chunk-receipts-stay-plan-scoped-and-durable',
      'parallelism-stays-within-byte-and-journal-budgets',
    ],
    gateProofs: {
      skip: 'compressed chunk frames and plan-scoped receipts can reduce resend work and planning churn without skipping any acknowledged chunk',
      live: 'the final file publish still compares the live remote resource hash against the expected file precondition',
      group: 'compression and receipt reuse stay inside the same file boundary and never widen the atomic-group barrier',
      recovery: 'compressed frames remain transport state while durable chunk receipts and the guarded publish record still classify pause, retry, or crash',
    },
    visibilityBoundary: 'transport-only',
    failureEvidence: 'compressed chunk frame plus plan-scoped receipt ledger and guarded publish record',
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
    area: 'chunk-upload',
    reduces: ['idle-time', 'planning-round-trips', 'duplicate-body-transfer'],
    allowedShortcut: 'reuse-remote-index-cursor-to-size-bounded-chunk-windows',
    guardrails: [
      'remote-index-is-planning-evidence-only',
      'chunk-window-stays-within-byte-and-receipt-budgets',
    ],
    gateProofs: {
      skip: 'the sender can use a recorded remote-index cursor to avoid rescanning unchanged resources while sizing the next chunk window',
      live: 'every staged chunk still compares its live publish precondition before visibility changes',
      group: 'the window only controls staging concurrency and never widens the file or atomic-group visibility boundary',
      recovery: 'the index cursor, chunk receipts, and guarded publish record still classify pause, retry, or crash without guessing',
    },
    visibilityBoundary: 'plan-staging-window-only',
    failureEvidence: 'planning cursor plus bounded chunk receipt ledger',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['round-trips', 'parse-work', 'bind-work'],
    allowedShortcut: 'reuse-one-prepared-statement-per-table-and-batch-shape-within-an-atomic-group',
    guardrails: [
      'prepared-statements-do-not-override-row-preconditions',
      'atomic-group-barrier-stays-fixed',
    ],
    gateProofs: {
      skip: 'prepared SQL lowers duplicate parse and bind work without skipping any live row predicate',
      live: 'each batched mutation still carries its own expected remote hash at the storage boundary',
      group: 'the prepared statement is scoped to one atomic group and cannot widen visibility across owners',
      recovery: 'batch receipts and plan-scoped idempotency keys still classify partial failure unambiguously',
    },
    visibilityBoundary: 'batch-transaction-or-atomic-group-commit',
    failureEvidence: 'prepared-statement scope plus batch receipts and idempotency keys',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['idle-time', 'head-of-line-blocking', 'statement-setup-cost'],
    allowedShortcut: 'run-bounded-row-batch-parallelism-within-an-atomic-group-and-per-table-budget',
    guardrails: [
      'parallel-row-batches-stay-within-per-table-and-per-site-budgets',
      'atomic-group-barrier-stays-fixed',
    ],
    gateProofs: {
      skip: 'independent row batches may overlap inside one group when each batch keeps its own row preconditions, idempotency key, and table budget',
      live: 'each row in every batch still rechecks its live compare at the storage boundary',
      group: 'bounded row-batch parallelism never widens the atomic-group barrier or merges ownership across plugin groups',
      recovery: 'batch receipts and the group staging record still classify pause, retry, or crash without guessing which rows advanced',
    },
    visibilityBoundary: 'bounded-parallel-batch-staging-only',
    failureEvidence: 'per-table batch receipts plus group staging record',
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
    area: 'remote-indexes',
    reduces: ['remote-body-fetches', 'planning-round-trips', 'wire-bytes-for-index-scans'],
    allowedShortcut: 'compress-index-listings-without-changing-planning-semantics',
    guardrails: [
      'index-remains-planning-evidence-only',
      'apply-still-revalidates-live-state',
    ],
    gateProofs: {
      skip: 'index response bodies can be compressed because the planning listing is not the mutation authority',
      live: 'the compressed listing still cannot authorize writes; apply rechecks the live resource hash',
      group: 'index metadata may help partition by owner, but it never widens or shortens the atomic-group barrier',
      recovery: 'the plan keeps the index cursor for planning while recovery relies on later receipts and commit records',
    },
    visibilityBoundary: 'transport-only',
    failureEvidence: 'compressed index response with the recorded planning cursor',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'remote-indexes',
    reduces: ['remote-body-fetches', 'planning-round-trips'],
    allowedShortcut: 'cache-planning-cursor-with-strong-hash-listing',
    guardrails: [
      'index-remains-planning-evidence-only',
      'cursor-is-not-an-apply-lock',
    ],
    gateProofs: {
      skip: 'the planner can reuse a recorded cursor and strong-hash listing to avoid rescanning unchanged remote resources',
      live: 'the cursor never authorizes mutation and apply still rechecks the live resource hash',
      group: 'cursor reuse does not split or widen the atomic-group barrier',
      recovery: 'the recorded cursor stays attached to the plan only as recovery evidence for planning replay',
    },
    visibilityBoundary: 'transport-only',
    failureEvidence: 'planning cursor plus strong-hash listing',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'remote-indexes',
    reduces: ['remote-body-fetches', 'dependency-recheck-round-trips', 'planning-round-trips'],
    allowedShortcut: 'reuse-planned-dependency-graph-for-plugin-update-with-live-finalize',
    guardrails: [
      'dependency-graph-is-planning-evidence-only',
      'finalize-still-rechecks-live-member-preconditions',
    ],
    gateProofs: {
      skip: 'a dependency-heavy plugin update can reuse a recorded dependency graph and indexed listing to avoid recomputing unchanged plan shape',
      live: 'the eventual metadata and row writes still recheck live per-row and per-member preconditions at the storage boundary',
      group: 'the dependency graph only informs planning; the plugin update still crosses visibility through one atomic-group commit barrier',
      recovery: 'the plan retains the dependency graph, index cursor, and finalize record so a retry can classify old, new, or blocked without guessing',
    },
    visibilityBoundary: 'planning-only-until-atomic-group-commit',
    failureEvidence: 'planning cursor, dependency graph, and finalize record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'remote-indexes',
    reduces: ['planning-round-trips', 'idle-time', 'owner-isolation-overhead'],
    allowedShortcut: 'parallelize-independent-owner-index-scans-within-site-budgets',
    guardrails: [
      'index-scan-stays-planning-only',
      'owner-partitions-stay-within-per-site-concurrency-budgets',
    ],
    gateProofs: {
      skip: 'independent owner partitions can scan in parallel so long as each scan only produces planning evidence for the next live compare',
      live: 'each later mutation still rechecks its own live resource precondition at the storage boundary',
      group: 'parallel index scans do not widen the atomic-group barrier for any plugin-owned file, row batch, or activation state',
      recovery: 'the planning cursors, owner partitions, and later receipts still classify pause or crash without guessing which owner advanced',
    },
    visibilityBoundary: 'planning-only-with-site-budgets',
    failureEvidence: 'owner-partitioned planning cursor plus per-owner durable receipts',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'remote-indexes',
    reduces: ['planning-round-trips', 'idle-time'],
    allowedShortcut: 'parallelize-independent-owner-index-scans-to-size-bounded-batches',
    guardrails: [
      'index-scan-stays-planning-only',
      'batch-sizing-stays-within-per-site-concurrency-budgets',
    ],
    gateProofs: {
      skip: 'independent owner scans may run in parallel to size later batches without rescanning unchanged planning data',
      live: 'each later mutation still rechecks its own live resource precondition at the storage boundary',
      group: 'the scans only size batches and never widen the atomic-group barrier for any owner',
      recovery: 'the planning cursors and later durable receipts still classify pause or crash without guessing which owner advanced',
    },
    visibilityBoundary: 'planning-only-with-site-budgets',
    failureEvidence: 'owner-partitioned planning cursor plus per-owner batch receipts',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['round-trips', 'rescan-work', 'batch-shape-recomputation'],
    allowedShortcut: 'reuse-planned-dependency-graph-to-presize-bounded-plugin-update-batches',
    guardrails: [
      'dependency-graph-is-planning-evidence-only',
      'batch-bounds-still-honor-row-preconditions',
    ],
    gateProofs: {
      skip: 'a dependency-heavy plugin update can reuse a recorded dependency graph and indexed plan to avoid rescanning unchanged resources when sizing row batches',
      live: 'every row in the batch still rechecks its live compare at the storage boundary',
      group: 'the batch shape only narrows planning work inside the same atomic group and never widens visibility across owners',
      recovery: 'the planning graph, cursor, and batch receipts still classify retry, pause, or crash without guessing',
    },
    visibilityBoundary: 'planning-only-until-batch-commit',
    failureEvidence: 'planning cursor, dependency graph, and batch idempotency key',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['round-trips', 'rescan-work', 'batch-shape-recomputation'],
    allowedShortcut: 'reuse-remote-index-cursor-and-dependency-graph-to-presize-bounded-plugin-install-batches',
    guardrails: [
      'remote-index-remains-planning-only',
      'batch-bounds-still-honor-row-preconditions',
    ],
    gateProofs: {
      skip: 'a plugin install can reuse the remote index cursor and dependency graph to avoid rescanning unchanged resources when sizing row batches',
      live: 'every row in the batch still rechecks its live compare at the storage boundary',
      group: 'the batch shape only narrows planning work inside the same atomic group and never widens visibility across owners',
      recovery: 'the index cursor, dependency graph, and batch receipts still classify retry, pause, or crash without guessing',
    },
    visibilityBoundary: 'planning-only-until-batch-commit',
    failureEvidence: 'index cursor, dependency graph, and batch idempotency key',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['round-trips', 'wire-bytes-for-planning', 'batch-shape-recomputation'],
    allowedShortcut: 'compress-remote-index-listings-and-reuse-cursor-to-presize-bounded-plugin-update-batches',
    guardrails: [
      'compressed-index-remains-planning-evidence-only',
      'batch-bounds-still-honor-row-preconditions',
    ],
    gateProofs: {
      skip: 'a plugin update can reuse a compressed remote-index listing and cursor to avoid rescanning unchanged planning data when sizing row batches',
      live: 'every row in the batch still rechecks its live compare at the storage boundary before visibility changes',
      group: 'the compressed listing only narrows planning work inside the same atomic group and never widens visibility across owners',
      recovery: 'the compressed index cursor, dependency graph, and batch receipts still classify retry, pause, or crash without guessing',
    },
    visibilityBoundary: 'planning-only-until-batch-commit',
    failureEvidence: 'compressed index cursor, dependency graph, and batch idempotency key',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'database-row-batching',
    reduces: ['round-trips', 'wire-bytes-for-planning', 'batch-shape-recomputation'],
    allowedShortcut: 'compress-remote-index-listings-and-reuse-cursor-to-presize-bounded-plugin-install-batches',
    guardrails: [
      'compressed-index-remains-planning-evidence-only',
      'batch-bounds-still-honor-row-preconditions',
    ],
    gateProofs: {
      skip: 'a plugin install can reuse a compressed remote-index listing and cursor to avoid rescanning unchanged planning data when sizing row batches',
      live: 'every row in the batch still rechecks its live compare at the storage boundary before visibility changes',
      group: 'the compressed listing only narrows planning work inside the same atomic group and never widens visibility across owners',
      recovery: 'the compressed index cursor, dependency graph, and batch receipts still classify retry, pause, or crash without guessing',
    },
    visibilityBoundary: 'planning-only-until-batch-commit',
    failureEvidence: 'compressed index cursor, dependency graph, and batch idempotency key',
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
    area: 'chunk-upload',
    reduces: ['wire-bytes', 'idle-time', 'duplicate-body-transfer'],
    allowedShortcut: 'compress-chunk-transit-frames-with-canonical-chunk-digests',
    guardrails: [
      'chunk-body-encoding-is-transport-only',
      'chunk-digests-and-receipts-stay-plan-scoped',
    ],
    gateProofs: {
      skip: 'chunk transport frames can be compressed while the sender keeps canonical chunk digests and plan-scoped receipts for retry decisions',
      live: 'the final file publish still compares the live remote resource hash against the expected file precondition',
      group: 'compressed chunk transit stays inside plan staging and never exposes a partial plugin or upload as visible',
      recovery: 'compressed wire frames are advisory transport state; durable chunk receipts and the guarded publish record still classify failures',
    },
    visibilityBoundary: 'transport-only',
    failureEvidence: 'compressed chunk frame plus plan-scoped receipt and guarded publish record',
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
  {
    area: 'backpressure',
    reduces: ['fsync-count', 'idle-time', 'duplicate-recovery-writes'],
    allowedShortcut: 'batch-durable-receipt-flushes-within-bounded-journal-lag',
    guardrails: [
      'journal-batches-retain-raw-receipts',
      'flush-never-crosses-an-atomic-group-commit',
    ],
    gateProofs: {
      skip: 'receipt writes can be batched when each batch still preserves the raw chunk, row, or group receipts that were already produced',
      live: 'the underlying storage-boundary write still keeps the same live preconditions for each chunk, row, or group member',
      group: 'receipt batching only changes when journal data is flushed, not which atomic group owns the visibility boundary',
      recovery: 'batched journal records still keep the exact receipt keys needed to classify a crash, retry, or pause',
    },
    visibilityBoundary: 'journal-flush-only',
    failureEvidence: 'batched journal record plus raw durable receipts',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'backpressure',
    reduces: ['memory-pressure', 'idle-time', 'queue-drain-time'],
    allowedShortcut: 'treat-drained-upload-buffer-as-publish-ready',
    guardrails: [
      'drained-buffer-is-not-a-durable-receipt',
      'publish-still-requires-live-file-compare',
    ],
    gateProofs: {
      skip: 'a drained upload buffer can shorten queue handling, but only after chunk receipts and journal records already exist',
      live: 'the large-upload publish still compares the live remote resource hash before any bytes become visible',
      group: 'buffer drainage never moves the atomic-file-publish barrier or merges independent uploads',
      recovery: 'buffer state is advisory only; durable chunk receipts and the guarded publish record still classify pause, retry, or crash',
    },
    visibilityBoundary: 'none-pause-only',
    failureEvidence: 'drained buffer state plus durable chunk receipts and guarded publish record',
    bypassesLivePreconditions: false,
    splitsAtomicGroup: false,
    publishesStagedDataEarly: false,
  },
  {
    area: 'compression',
    reduces: ['wire-bytes', 'storage-footprint-for-recovery-evidence'],
    allowedShortcut: 'compress-durable-receipt-logs-with-stable-receipt-keys',
    guardrails: [
      'compressed-receipts-still-preserve-raw-receipt-keys',
      'compression-does-not-replace-durable-progress',
    ],
    gateProofs: {
      skip: 'receipt payloads can be compressed after they are durably recorded, so recovery keeps the same key and classification data while using fewer bytes',
      live: 'compressed receipt logs never authorize a write; the original live precondition still guards the storage boundary',
      group: 'receipt compression does not split or widen the atomic-group barrier',
      recovery: 'stable receipt keys and journal records still classify the exact chunk, row, or group state after a crash or pause',
    },
    visibilityBoundary: 'recovery-evidence-only',
    failureEvidence: 'compressed receipt log plus original durable receipt key',
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
    id: 'parallelize-finalize-across-groups',
    proposal: 'finalize large uploads and plugin changes from multiple atomic groups in parallel and treat the combined drain as completion',
    rejectedBecause: 'parallel work can overlap staging, but it cannot merge finalization across groups without hiding which receipt or commit record belongs to the partial failure',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'backpressure', 'durable-progress'],
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
    id: 'backpressure-pause-means-complete',
    proposal: 'treat a backpressure pause as proof that a large upload or plugin install is complete',
    rejectedBecause: 'a pause only stops producers; it does not prove that chunk receipts, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'chunk-receipts', 'row-preconditions', 'atomic-groups', 'durable-progress'],
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
    id: 'compressed-index-completes-apply',
    proposal: 'treat a compressed remote index response as proof that apply is complete',
    rejectedBecause: 'compression can shrink the planning listing, but it cannot authorize mutation or prove the live resource state survived failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'live-preconditions', 'durable-progress'],
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
    id: 'batched-receipt-journal-flush',
    proposal: 'batch durable chunk, row, or group receipts into fewer journal fsyncs while keeping the raw receipts intact',
    rejectedBecause: 'journaling can be batched for speed, but it cannot replace the raw receipt records needed to classify recovery after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-receipts-replace-durable-progress',
    proposal: 'compress chunk or batch receipts into a summary and treat the summary as the durable record',
    rejectedBecause: 'a compressed summary can save space, but it can also erase the per-chunk or per-row evidence needed to classify partial failure after a crash or lost response',
    rejectedGate: 'recovery',
    violates: ['compression', 'chunk-receipts', 'durable-progress', 'row-preconditions'],
  },
  {
    id: 'compressed-receipt-summary-replaces-recovery-log',
    proposal: 'treat a compressed receipt summary as the only recovery record for uploads or plugin changes',
    rejectedBecause: 'a compressed summary can reduce storage, but it cannot preserve the original receipt keys or classify a partial failure unambiguously',
    rejectedGate: 'recovery',
    violates: ['compression', 'chunk-receipts', 'row-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-receipt-log-completes-apply',
    proposal: 'treat a compressed receipt log as proof that apply or finalize already completed',
    rejectedBecause: 'compressed receipts can shrink recovery evidence, but they cannot prove the live compare, row preconditions, or atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'live-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
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
    id: 'index-and-compressed-queue-skips-large-upload-resume',
    proposal: 'treat a fresh remote index plus a compressed queue as enough proof to skip large-upload resume decisions',
    rejectedBecause: 'planning evidence and queue compression can reduce idle work, but they cannot prove which chunk acknowledgements survived a crash or whether the guarded publish record still exists',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-file-hash-cache-skips-large-upload-resume',
    proposal: 'treat a compressed file-hash cache as enough proof to skip missing chunk receipts during large-upload resume',
    rejectedBecause: 'hash compression can shrink the cache, but it cannot prove which chunk acknowledgements survived a crash or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-file-hash-cache-skips-large-upload-resume-after-pause',
    proposal: 'treat a compressed file-hash cache plus a paused queue as enough proof to skip missing chunk receipts during large-upload resume',
    rejectedBecause: 'hash compression and a paused queue can reduce recovery work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-file-hash-cache-and-paused-queue-skips-large-upload-publish',
    proposal: 'treat a compressed file-hash cache and a paused queue as proof that a large upload can skip the guarded publish step',
    rejectedBecause: 'hash compression and queue pressure only change recovery cost; they do not prove which chunk acknowledgements survived or that the publish barrier is still intact',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-windowing',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip chunk-window sizing for a large upload',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup work, but they cannot prove the live compare, chunk receipts, or the guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip large-upload chunk upload after a pause',
    rejectedBecause: 'planning evidence and cached hashes can reduce recovery work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'atomic-file-publish', 'durable-progress'],
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
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions',
    proposal: 'use a compressed remote index plus a cached dependency graph to skip row preconditions in a plugin update',
    rejectedBecause: 'planning evidence and dependency graphs can reduce rescanning, but they cannot replace the live per-row compares or the atomic-group barrier',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'atomic-groups', 'plugin-preconditions'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing',
    proposal: 'use a compressed remote index plus a cached dependency graph to skip bounded plugin-update batch sizing',
    rejectedBecause: 'planning evidence and dependency graphs can reduce rescanning, but they cannot prove the live row preconditions, batch receipts, or atomic-group boundary survived failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
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
    id: 'index-and-cached-row-batch-completes-plugin-install',
    proposal: 'treat a fresh remote index plus cached row-batch receipts as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and cached row receipts can reduce lookup work, but they cannot prove every live row precondition and the atomic-group commit barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'row-preconditions', 'atomic-groups', 'durable-progress'],
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
    id: 'remote-index-and-cached-package-hash-skips-plugin-dependency-checks',
    proposal: 'treat a fresh remote index plus a cached package hash as enough proof to skip plugin dependency checks',
    rejectedBecause: 'planning evidence and a cached hash can skip duplicate lookup work, but they cannot prove the dependency checks, metadata writes, or atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-package-cache-skips-plugin-validators',
    proposal: 'treat a fresh remote index plus a compressed package cache as enough proof to skip plugin validators and the atomic-group barrier',
    rejectedBecause: 'planning evidence and compressed package storage can reduce lookup work, but they cannot prove dependency readiness, metadata writes, or group commit completion',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-package-cache-skips-plugin-activation',
    proposal: 'treat a fresh remote index plus a compressed package cache as enough proof to skip plugin activation and the atomic-group barrier',
    rejectedBecause: 'planning evidence and compressed package storage can reduce lookup work, but they cannot prove activation state, dependency readiness, or group commit completion',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-package-cache-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed package cache as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and compressed package storage can reduce lookup work, but they cannot prove dependency checks, metadata writes, file receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-manifest-completes-plugin-install',
    proposal: 'treat a compressed manifest or package summary as proof that a plugin install already finished',
    rejectedBecause: 'a compressed manifest can reduce lookup work, but it cannot prove dependency checks, metadata writes, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
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
    id: 'index-and-cached-dependency-graph-skips-plugin-update-finalize',
    proposal: 'treat a fresh remote index plus a cached dependency graph as enough proof to skip plugin-update finalize',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove the live row compares, member metadata writes, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-update finalize',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove the live row compares, member metadata writes, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-update activation after pause and backpressure',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove the activation change, live row compares, or atomic-group barrier survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-update dependency checks',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove live dependency checks, row preconditions, or the atomic-group barrier survived failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-row-batch-replaces-atomic-group',
    proposal: 'treat a compressed row batch as the atomic-group commit for a plugin install or update',
    rejectedBecause: 'compression can shrink the batch, but it cannot replace the group commit barrier that keeps coupled files, rows, metadata, and activation state visible together',
    rejectedGate: 'group',
    violates: ['compression', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'parallel-finalize-merged-across-groups',
    proposal: 'merge finalization for multiple atomic groups into one combined commit to reduce tail latency',
    rejectedBecause: 'parallel work can overlap, but one combined finalize would hide which group owns a partial failure after a crash or lost response',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'parallelism-limits', 'durable-progress'],
  },
  {
    id: 'backpressure-drops-queued-receipts',
    proposal: 'shed queued chunk or row receipts when memory pressure spikes so the producer can keep running',
    rejectedBecause: 'pressure handling must preserve the exact receipts needed to classify recovery; dropping them turns a retry into guesswork',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'chunk-receipts', 'row-preconditions', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-batch-skips-row-preconditions',
    proposal: 'use a fresh remote index plus a compressed row batch to skip per-row preconditions in a dependency-heavy plugin update',
    rejectedBecause: 'planning evidence and batch compression can shorten lookup work, but each live row still needs its own compare-and-swap predicate and the group barrier still has to survive failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'live-preconditions'],
  },
  {
    id: 'index-and-compressed-row-batch-skips-backpressure',
    proposal: 'treat a fresh remote index plus a compressed row batch as proof that backpressure can be skipped for a plugin update',
    rejectedBecause: 'planning evidence and batch compression can reduce queue pressure, but they cannot prove the paused work already has durable row receipts, dependency checks, or the atomic-group commit record needed after failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-batch-skips-live-compare',
    proposal: 'treat a fresh remote index plus a compressed row batch as enough proof to skip the live row compare in a plugin update',
    rejectedBecause: 'planning evidence and compressed batches can reduce lookup and replay work, but they cannot replace the live compare-and-swap predicate on each row',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'live-preconditions'],
  },
  {
    id: 'index-and-compressed-row-summary-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a compressed row summary as proof that a plugin update already finished',
    rejectedBecause: 'planning evidence and a compressed row summary can reduce lookup work, but they cannot prove the dependency checks, row receipts, or the atomic-group commit survived failure',
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
    id: 'compressed-row-summary-skips-live-batch-preconditions',
    proposal: 'treat a compressed row summary as enough proof to skip live per-row preconditions in a database batch',
    rejectedBecause: 'compression can shrink recovery data, but it cannot replace the compare-and-swap predicate required for each row at apply time',
    rejectedGate: 'live',
    violates: ['compression', 'row-preconditions', 'live-preconditions'],
  },
  {
    id: 'compressed-row-batch-skips-group-finalize',
    proposal: 'treat a compressed row batch as enough proof to skip the group finalize barrier for a dependency-heavy plugin update',
    rejectedBecause: 'compressed batches can reduce recovery work, but they cannot prove the dependency checks held, the group finalize ran, or the atomic-group visibility boundary survived failure',
    rejectedGate: 'group',
    violates: ['compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-row-batch-skips-live-compare',
    proposal: 'treat a compressed row batch as enough proof to skip the live per-row compare during plugin apply',
    rejectedBecause: 'compressed batches can reduce replay work, but they cannot replace the live compare-and-swap predicate required for each row at mutation time',
    rejectedGate: 'live',
    violates: ['compression', 'row-preconditions', 'live-preconditions'],
  },
  {
    id: 'index-and-compressed-row-summary-completes-plugin-activation',
    proposal: 'treat a fresh remote index plus a compressed row summary as proof that plugin activation already finished',
    rejectedBecause: 'planning evidence and a compressed batch summary can reduce lookup work, but they cannot prove the per-row receipts, activation state change, or atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-summary-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed row summary as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and a compressed row summary can reduce lookup work, but they cannot prove the dependency checks, row receipts, or atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-batch-completes-plugin-install',
    proposal: 'treat a fresh remote index plus a compressed row batch as proof that a plugin install already finished',
    rejectedBecause: 'planning evidence and batch compression can reduce work, but they cannot prove per-row preconditions, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install',
    proposal: 'treat a compressed remote index plus cached row receipts as enough proof to skip plugin-install finalization',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay work, but they cannot prove the dependency checks, metadata writes, or atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus cached row receipts as enough proof to skip plugin-update finalization',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay work, but they cannot prove the live row compares, dependency checks, or atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    proposal: 'treat a compressed remote index plus cached row receipts as enough proof to skip plugin-update finalize after a pause',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay work, but they cannot prove the live row compares, dependency checks, or the atomic-group finalize survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
    proposal: 'treat a compressed remote index plus cached row receipts as enough proof to skip plugin-update activation',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay work, but they cannot prove the activation change, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin-install finalization',
    rejectedBecause: 'planning evidence and cached hashes can skip duplicate lookup and rehash work, but they cannot prove dependency checks, staged rows, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached manifest hash as enough proof to skip plugin-install finalization',
    rejectedBecause: 'planning evidence and cached manifest hashes can reduce lookup work, but they cannot prove dependency checks, staged rows, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin-install finalization',
    rejectedBecause: 'planning evidence and cached package hashes can reduce planning and lookup work, but they cannot prove dependency checks, metadata writes, staged files, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin install activation',
    rejectedBecause: 'planning evidence and cached package hashes can reduce planning and lookup work, but they cannot prove dependency checks, activation writes, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin install activation after a pause',
    rejectedBecause: 'planning evidence and cached package hashes can reduce recovery work, but they cannot prove the paused dependency checks, activation writes, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin-install dependency checks',
    rejectedBecause: 'planning evidence and cached package hashes can reduce lookup work, but they cannot prove dependency checks, metadata writes, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup and rehash work, but they cannot prove dependency checks, staged files, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin install activation',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup and rehash work, but they cannot prove dependency checks, staged metadata, or the atomic-group activation barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin-install finalize after a pause',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup and rehash work, but they cannot prove dependency checks, staged rows, or the atomic-group finalize survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize-after-pause',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin-update finalize after a pause',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup and rehash work, but they cannot prove live row compares, dependency checks, or the atomic-group finalize survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin-install finalize after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce replay work, but they cannot prove dependency checks, staged rows, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk digests as enough proof to skip plugin-install finalize after a pause',
    rejectedBecause: 'planning evidence and cached chunk digests can reduce replay work, but they cannot prove dependency checks, chunk receipts, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and cached package hashes can reduce lookup work, but they cannot prove dependency checks, metadata writes, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached package cache as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and a cached package cache can reduce lookup work, but they cannot prove dependency checks, staged files, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks',
    proposal: 'treat a compressed remote index plus a cached package cache as enough proof to skip plugin-install dependency checks',
    rejectedBecause: 'planning evidence and a cached package cache can reduce lookup work, but they cannot prove dependency checks, metadata writes, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-install dependency checks',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove dependency checks, metadata writes, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-install activation',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove activation writes, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-row-preconditions',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-install row preconditions',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove the live per-row compares, dependency checks, or the atomic-group barrier survived failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin-install finalize',
    rejectedBecause: 'planning evidence and a cached dependency graph can reduce lookup work, but they cannot prove staged metadata, dependency checks, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation',
    proposal: 'treat a compressed remote index plus a cached package cache as enough proof to skip plugin install activation',
    rejectedBecause: 'planning evidence and a cached package cache can reduce lookup work, but they cannot prove dependency checks, staged metadata, or the atomic-group activation barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus a paused upload queue as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and backpressure can pause work, but they cannot prove dependency checks, staged files, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus a compressed upload queue as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and queue compression can reduce replay work, but they cannot prove dependency checks, staged files, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus a cached manifest hash as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and cached manifest hashes can reduce lookup work, but they cannot prove dependency checks, staged files, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-batch-completes-plugin-activation',
    proposal: 'treat a fresh remote index plus a compressed row batch as proof that plugin activation already finished',
    rejectedBecause: 'planning evidence and batch compression can reduce work, but they cannot prove the activation state change, per-row receipts, or the atomic-group commit survived failure',
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
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip large-upload resume decisions',
    rejectedBecause: 'planning evidence and cached hashes can skip lookup and rehash work, but they cannot prove which chunk acknowledgements survived failure or whether the guarded publish record still exists',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached hashes can skip lookup and rehash work, but they cannot prove the live compare, every chunk acknowledgement, or the guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip the guarded publish step after a resume',
    rejectedBecause: 'planning evidence and cached hashes cannot prove which chunk acknowledgements survived the pause or restore the live publish compare',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached manifest hash as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached manifest hashes can trim lookup work, but they cannot prove the live compare, chunk acknowledgements, or guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-digest-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached file digest as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached digests can trim lookup and hashing work, but they cannot prove the live compare, chunk acknowledgements, or guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause',
    proposal: 'treat a compressed remote index plus a cached file digest as enough proof to skip large-upload resume after a pause',
    rejectedBecause: 'planning evidence, cached digests, and backpressure pauses can reduce recovery work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip large-upload resume after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce replay work, but they cannot prove the live compare or the guarded publish barrier survived a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip the large-upload publish step after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce recovery work, but they cannot prove the live compare, the guarded publish record, or which acknowledgements survived the pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-manifest-hash-completes-large-upload',
    proposal: 'treat a fresh remote index plus a compressed manifest hash as proof that a large upload already finished',
    rejectedBecause: 'planning evidence and a compressed manifest hash can reduce lookup work, but they cannot prove the live compare, every chunk receipt, or the guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'live-preconditions', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'index-and-compressed-chunk-receipts-completes-large-upload',
    proposal: 'treat a fresh remote index plus compressed chunk receipts as proof that a large upload already finished',
    rejectedBecause: 'planning evidence and compressed chunk receipts can reduce recovery work, but they cannot prove the live compare, guarded publish, or every chunk acknowledgement survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'live-preconditions', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached receipts can reduce replay work, but they cannot prove the live compare or guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-paused-queue-cached-file-hash-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a paused upload queue and cached file hash as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence, queue pressure, and cached hashes can reduce recovery work, but they cannot prove the live compare, chunk acknowledgements, or guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
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
    id: 'remote-index-and-cached-file-hash-skips-plugin-update',
    proposal: 'treat a fresh remote index plus a cached file hash as enough proof to skip a plugin update',
    rejectedBecause: 'planning evidence and cached hashes can skip duplicate lookup and rehash work, but they cannot prove dependency checks, staged rows, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-activation',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin activation',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup work, but they cannot prove the activation state, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-package-cache-completes-plugin-update',
    proposal: 'treat a fresh remote index plus a compressed plugin package cache as proof that a plugin update already finished',
    rejectedBecause: 'planning evidence and package compression can reduce transfer work, but they cannot prove dependency checks, metadata writes, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-file-hash-completes-large-upload',
    proposal: 'treat a compressed file-hash cache as proof that a large upload already finished',
    rejectedBecause: 'a compressed hash cache can reduce rehash work, but it cannot prove chunk receipts or the guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-file-hash-skips-chunk-receipts',
    proposal: 'treat a compressed file-hash cache as enough proof to skip missing chunk receipts during a large-upload resume',
    rejectedBecause: 'hash compression can reduce lookup work, but it cannot prove which chunk acknowledgements survived a crash or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-manifest-hash-skips-live-compare',
    proposal: 'treat a compressed manifest hash as enough proof to skip the live file compare before a large upload publish',
    rejectedBecause: 'a compressed manifest hash can shrink recovery data, but it cannot prove the live object still matches the publish precondition after a crash or retry',
    rejectedGate: 'live',
    violates: ['compression', 'file-hashing', 'live-preconditions', 'chunk-receipts'],
  },
  {
    id: 'cached-manifest-hash-skips-large-upload-publish',
    proposal: 'treat a cached manifest hash as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'a cached manifest hash can avoid duplicate lookup and hashing, but it cannot prove the live compare, chunk acknowledgements, or publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'fingerprint-and-compressed-upload-queue-completes-large-upload',
    proposal: 'treat a local fingerprint plus a compressed upload queue as proof that a large upload already finished',
    rejectedBecause: 'a fingerprint can skip duplicate hashing and compression can reduce queue pressure, but neither can prove chunk acknowledgements or the guarded publish survived failure',
    rejectedGate: 'recovery',
    violates: ['file-hashing', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'fingerprint-and-cached-digest-completes-large-upload',
    proposal: 'treat a local fingerprint plus a cached digest as proof that a large upload already finished',
    rejectedBecause: 'a fingerprint can skip duplicate rehashing, but it cannot prove chunk receipts or the guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['file-hashing', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'chunk-ledger-completes-large-upload',
    proposal: 'treat a cached chunk ledger as proof that a large upload already finished',
    rejectedBecause: 'chunk-ledger reuse can skip duplicate hashing, but it cannot prove the live compare, guarded publish, or every chunk acknowledgement survived failure',
    rejectedGate: 'recovery',
    violates: ['file-hashing', 'chunk-receipts', 'live-preconditions', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'cached-chunk-ledger-skips-large-upload-finalize',
    proposal: 'treat a cached chunk ledger as enough proof to skip the guarded publish finalize for a large upload',
    rejectedBecause: 'a cached ledger can skip duplicate hashing, but it cannot prove the live compare or guarded publish record survived failure',
    rejectedGate: 'recovery',
    violates: ['file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-chunk-receipts-complete-large-upload',
    proposal: 'treat compressed chunk receipts as proof that a large upload already finished',
    rejectedBecause: 'compression can shrink receipt storage, but it cannot prove the live compare, guarded publish, or every chunk acknowledgement survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-upload-queue-skips-large-upload-resume',
    proposal: 'treat a compressed upload queue as enough proof to skip missing chunk receipts during a large-upload resume',
    rejectedBecause: 'queue compression can reduce memory pressure, but it cannot prove which chunk acknowledgements survived a crash or restore the guarded publish boundary',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-upload-queue-skips-backpressure',
    proposal: 'treat a compressed upload queue as proof that backpressure can be skipped for large uploads',
    rejectedBecause: 'queue compression can lower memory pressure, but it cannot prove the sender still has the receipts and journal order needed to recover after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-upload-queue-skips-backpressure',
    proposal: 'treat a compressed remote index plus a compressed upload queue as enough proof to skip backpressure pauses on a large upload',
    rejectedBecause: 'planning evidence and smaller queued buffers can reduce request volume, but they cannot prove which chunk acknowledgements or journal records survived failure, so the sender still has to pause under pressure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-upload-queue-replaces-chunk-receipts',
    proposal: 'treat a compressed upload queue as a substitute for chunk receipts after a failed upload',
    rejectedBecause: 'queue compression can lower pressure, but it cannot replace the durable per-chunk acknowledgements needed to classify partial failure or resume safely',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-upload-queue-after-pause-skips-chunk-receipts',
    proposal: 'treat a compressed upload queue that was paused under backpressure as enough proof to skip missing chunk receipts during resume',
    rejectedBecause: 'pausing the queue only stops producers; compression can shrink the queued state, but it cannot prove which chunk acknowledgements survived the pause or replace the recovery record',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-chunk-receipts-complete-large-upload',
    proposal: 'treat a fresh remote index plus compressed chunk receipts as proof that a large upload already finished',
    rejectedBecause: 'planning evidence and compressed receipts can reduce recovery work, but they cannot prove the live compare, guarded publish, or every chunk acknowledgement survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-receipts-plus-cached-hash-complete-large-upload',
    proposal: 'treat compressed chunk receipts plus a cached file hash as proof that a large upload already finished',
    rejectedBecause: 'a cached hash and compressed receipts can reduce recovery work, but they still cannot prove the live compare, guarded publish, or every chunk acknowledgement survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-manifest-hash-plus-cached-chunk-receipts-skips-large-upload-publish',
    proposal: 'treat a compressed manifest hash plus cached chunk receipts as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'manifest compression and cached receipts can reduce recovery work, but they cannot prove the live compare or guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-paused-upload-queue-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a paused upload queue as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and queue pressure can reduce work, but they cannot prove the chunk receipts, live compare, or publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-upload-buffer-completes-large-upload',
    proposal: 'treat a fresh remote index plus a compressed upload buffer as proof that a large upload already finished',
    rejectedBecause: 'planning evidence and a smaller buffered queue can reduce memory pressure, but they cannot prove the live compare, durable chunk receipts, or guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-upload-buffer-skips-large-upload-publish',
    proposal: 'treat a fresh remote index plus a compressed upload buffer as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and a smaller buffered queue can reduce memory pressure, but they cannot prove the live compare, durable chunk receipts, or guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-upload-buffer-skips-large-upload-publish-after-pause',
    proposal: 'treat a compressed remote index plus a cached upload buffer as enough proof to skip the guarded publish step for a large upload after a pause',
    rejectedBecause: 'planning evidence and a cached buffer can reduce replay work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip large-upload backpressure after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce recovery work, but they cannot prove the queue stayed bounded, which chunk acknowledgements survived the pause, or whether the guarded publish barrier is still intact',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-after-pause',
    proposal: 'treat a compressed remote index plus a cached manifest hash as enough proof to skip large-upload resume after a pause',
    rejectedBecause: 'planning compression and cached manifest state can reduce recovery work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a compressed upload queue as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and smaller queued buffers can reduce memory pressure, but they cannot prove which chunk acknowledgements survived failure or that the live compare and publish barrier still hold',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'fingerprint-completes-large-upload',
    proposal: 'treat a local fingerprint plus cached file hash as proof that a large upload already finished',
    rejectedBecause: 'a local fingerprint can skip duplicate hashing, but it cannot prove chunk receipts, guarded publish, or durable upload completion survived failure',
    rejectedGate: 'recovery',
    violates: ['file-hashing', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'fingerprint-skips-live-publish-compare',
    proposal: 'treat a local fingerprint match as enough proof to skip the live remote compare before publish',
    rejectedBecause: 'a local fingerprint can skip duplicate rehash work, but it cannot authorize the live mutation boundary or replace the storage precondition that guards publish',
    rejectedGate: 'live',
    violates: ['file-hashing', 'live-preconditions', 'visibility-boundary'],
  },
  {
    id: 'index-and-compressed-chunk-receipts-completes-plugin-update',
    proposal: 'treat a fresh remote index plus compressed chunk receipts as proof that a plugin update already finished',
    rejectedBecause: 'chunk receipts can prove staged upload progress, but compression and planning evidence cannot prove dependency checks, row receipts, or the atomic-group commit survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-receipts-completes-plugin-update',
    proposal: 'treat a fresh remote index plus compressed row receipts as proof that a dependency-heavy plugin update already finished',
    rejectedBecause: 'compressed row receipts can save recovery space, but planning evidence and summaries cannot prove the dependency checks, per-row preconditions, or atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'index-and-compressed-row-receipts-skips-group-finalize',
    proposal: 'treat a fresh remote index plus compressed row receipts as enough proof to skip the group finalize barrier for a plugin update',
    rejectedBecause: 'compressed row receipts can summarize durable progress, but they cannot prove the group finalize ran, the dependency checks held, or the atomic-group visibility boundary survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin update finalize',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the dependency checks, per-row preconditions, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    proposal: 'use a compressed remote index plus cached row receipts to skip backpressure pauses during plugin update resume',
    rejectedBecause: 'planning evidence and cached receipts can reduce replay work, but they cannot prove the queue order, journal order, or atomic-group commit order needed to recover a partial plugin update',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus a compressed row batch as enough proof to skip plugin update finalize',
    rejectedBecause: 'planning compression and compressed row batches can reduce replay work, but they cannot prove the dependency checks, live row compares, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin-update finalization',
    rejectedBecause: 'planning evidence and cached package hashes can reduce planning and lookup work, but they cannot prove dependency checks, metadata writes, staged rows, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin update row preconditions',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the live per-row compares, dependency checks, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin update activation',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the activation change, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin update finalize',
    rejectedBecause: 'planning evidence and cached row receipts can trim replay work, but they cannot prove the live row compares, dependency checks, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
    proposal: 'treat a compressed remote index plus batched receipt flushes as enough proof to skip plugin update activation',
    rejectedBecause: 'planning evidence and batched receipts can reduce fsync work, but they cannot prove the activation change, row preconditions, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus batched receipt flushes as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning evidence and batched receipts can reduce fsync work, but they cannot prove the live compare, staged rows, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus batched receipt flushes as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and batched receipts can reduce fsync work, but they cannot prove dependency checks, staged metadata, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-update',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip a plugin update',
    rejectedBecause: 'compression can shrink planning traffic and cached hashes can skip duplicate hashing, but neither can prove plugin dependency checks, staged metadata writes, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin update finalize',
    rejectedBecause: 'planning evidence and cached hashes can skip lookup and rehash work, but they cannot prove the live compare, staged rows, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-row-preconditions',
    proposal: 'treat a compressed remote index plus a cached file fingerprint as enough proof to skip plugin update row preconditions',
    rejectedBecause: 'planning evidence and cached file fingerprints can trim duplicate lookup work, but they cannot prove the live row compares or the atomic-group barrier survived failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus a cached file fingerprint as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning evidence and cached file fingerprints can trim duplicate lookup work, but they cannot prove the live row compares, metadata writes, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus a cached manifest hash as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning evidence and cached manifest hashes can reduce lookup work, but they cannot prove the live compare, staged rows, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning evidence and cached chunk acknowledgements can reduce lookup work, but they cannot prove the live row compares, staged metadata writes, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning evidence and cached dependency shape can reduce rescanning, but they cannot prove the live row compares, metadata writes, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin update writeback after a pause',
    rejectedBecause: 'planning evidence and cached receipts can reduce replay work, but they cannot prove the live row compares, dependency checks, or the atomic-group barrier survived the interruption',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus cached database batch receipts as enough proof to skip plugin update finalize',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove dependency checks, row preconditions, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-activation',
    proposal: 'treat a compressed remote index plus cached database batch receipts as enough proof to skip plugin update activation',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the activation change, dependency checks, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip a plugin update',
    rejectedBecause: 'planning evidence and chunk receipts can reduce replay work, but they cannot prove dependency checks, staged rows, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip a plugin install',
    rejectedBecause: 'planning evidence and chunk receipts can reduce replay work, but they cannot prove dependency checks, staged files, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip a plugin install',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup work, but they cannot prove dependency checks, staged files, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip a plugin install',
    rejectedBecause: 'planning evidence and compressed batch receipts can reduce recovery work, but they cannot prove dependency checks, per-row preconditions, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation-after-pause',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin-install activation after a pause',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay work, but after a pause they still cannot prove the activation change, per-row preconditions, or atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin-install writeback',
    rejectedBecause: 'planning evidence and cached row receipts can trim replay work, but they cannot prove the plugin metadata writes, per-row compares, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin-install writeback',
    rejectedBecause: 'planning evidence and cached file hashes can reduce lookup work, but they cannot prove plugin metadata writes, per-row compares, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-db-batch-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus a compressed database batch as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning compression and batch compression can reduce replay traffic, but they cannot prove the live row compares, dependency checks, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the dependency checks, per-row preconditions, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus cached database batch receipts as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and cached database receipts can trim replay work, but they cannot prove the dependency checks, staged files, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    proposal: 'use a compressed remote index plus cached row-batch receipts to skip plugin-install backpressure during resume',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the install still has bounded queue order or the journal evidence needed to recover a partial failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-parallel-row-batch-skips-plugin-install-barrier',
    proposal: 'treat a compressed remote index plus parallel row batches as enough proof to skip the plugin-install atomic-group barrier',
    rejectedBecause: 'parallel row batches can reduce wait time, but they cannot prove which owner owns a partial row result or that the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-parallel-row-batch-skips-plugin-update-activation',
    proposal: 'treat a compressed remote index plus parallel row batches as enough proof to skip plugin-update activation',
    rejectedBecause: 'parallel row batches can reduce wait time, but they cannot prove the activation change, per-row compares, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin update dependency checks',
    rejectedBecause: 'planning evidence and cached batch receipts can trim replay work, but they cannot prove the dependency checks, live row compares, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-dependency-checks',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin update dependency checks',
    rejectedBecause: 'planning evidence and cached chunk receipts can trim replay work, but they cannot prove dependency checks, metadata writes, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin update dependency checks',
    rejectedBecause: 'planning evidence and cached file hashes can trim lookup and rehash work, but they cannot prove the dependency checks, live row compares, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-update-writeback',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin update writeback',
    rejectedBecause: 'planning evidence and cached package hashes can trim lookup and rehash work, but they cannot prove dependency checks, metadata writes, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-update-activation',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin update activation',
    rejectedBecause: 'planning evidence and cached file hashes can trim lookup and rehash work, but they cannot prove the activation change, live row compares, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-finalize',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin update finalize',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce replay work, but they cannot prove the dependency checks, row preconditions, or the plugin update barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce replay work, but they cannot prove the live compare, the guarded publish barrier, or which chunk acknowledgements survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and cached file hashes can trim lookup and rehash work, but they cannot prove dependency checks, staged files, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin install row preconditions',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the live per-row compares, dependency checks, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip plugin install activation',
    rejectedBecause: 'planning evidence and cached batch receipts can reduce replay work, but they cannot prove the activation change, dependency checks, or the atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-final-activation',
    proposal: 'treat a compressed remote index plus cached row-batch receipts as enough proof to skip the final plugin install activation step',
    rejectedBecause: 'planning evidence and cached batch receipts can trim replay work, but they cannot prove the activation state, dependency checks, or the atomic-group barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and chunk receipts can reduce replay work, but they cannot prove the dependency checks, staged files, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin install activation',
    rejectedBecause: 'planning evidence and chunk receipts can trim replay work, but they cannot prove dependency checks, staged metadata, or the atomic-group activation barrier survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin install writeback',
    rejectedBecause: 'planning evidence and chunk receipts can reduce replay work, but they cannot prove dependency checks, staged metadata, or the atomic-group writeback survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip plugin install writeback after a pause',
    rejectedBecause: 'planning evidence and chunk receipts can reduce replay work, but they cannot prove dependency checks, staged metadata, or the atomic-group writeback survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-paused-row-queue-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a paused row queue as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and a paused queue can reduce replay work, but they cannot prove dependency checks, per-row preconditions, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause',
    proposal: 'treat a compressed remote index plus a cached dependency graph as enough proof to skip plugin install finalize after a pause',
    rejectedBecause: 'planning evidence and a cached dependency graph can trim replay work, but they cannot prove dependency checks, staged rows, or the atomic-group finalize survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin install finalize after a pause',
    rejectedBecause: 'planning evidence and cached package hashes can trim replay work, but they cannot prove dependency checks, staged rows, or the atomic-group finalize survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    proposal: 'treat a compressed remote index plus a cached package hash as enough proof to skip plugin install finalize after a pause and backpressure event',
    rejectedBecause: 'planning evidence and cached package hashes can trim replay work, but they cannot prove dependency checks, staged rows, backpressure state, or the atomic-group finalize survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup and hashing work, but they cannot prove chunk receipts, the live compare, or the guarded publish survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip plugin install finalize',
    rejectedBecause: 'planning evidence and cached hashes can reduce lookup work, but they cannot prove dependency checks, staged metadata, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-after-pause',
    proposal: 'treat a compressed remote index plus a cached file hash as enough proof to skip large-upload resume after a pause',
    rejectedBecause: 'planning evidence and cached hashes can trim duplicate work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index plus cached file hashes to skip backpressure pauses during large-upload resume',
    rejectedBecause: 'planning evidence and cached hashes can trim duplicate hashing, but they cannot prove the sender still has the bounded queue order and journal evidence needed to recover after pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-resume-publish-after-pause',
    proposal: 'use a compressed remote index plus a cached file hash to skip the large-upload resume-and-publish boundary after a pause',
    rejectedBecause: 'planning evidence and cached hashes can trim duplicate hashing, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier after recovery',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-hash-backpressure',
    proposal: 'use a compressed remote index plus cached file hashes to skip backpressure pauses during large-upload chunk hashing',
    rejectedBecause: 'planning evidence and cached hashes can trim duplicate hashing, but they cannot prove the sender still has the bounded queue order and journal evidence needed to recover after pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index plus cached manifest hashes to skip backpressure pauses during large-upload resume',
    rejectedBecause: 'planning evidence and cached manifest hashes can trim lookup work, but they cannot prove the bounded queue order and durable chunk acknowledgements needed to recover after pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-after-pause',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip large-upload resume after a pause',
    rejectedBecause: 'planning evidence and cached receipts can reduce replay work, but they cannot prove the bounded queue order, the surviving acknowledgements, or the guarded publish barrier after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-upload',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip chunk upload work during a large upload',
    rejectedBecause: 'planning evidence and cached receipts can trim replay work, but they cannot prove the sender still has the live per-chunk compare, bounded queue order, and durable acknowledgement needed to classify a partial failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure',
    proposal: 'treat a compressed remote index plus cached chunk receipts as enough proof to skip backpressure for a large upload',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce lookup work, but they cannot prove the queue stayed bounded or that the durable receipts survived a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-chunk-upload-after-pause',
    proposal: 'use a compressed remote index plus cached chunk hashes to skip large-upload chunk upload work after a pause',
    rejectedBecause: 'planning evidence and cached chunk hashes can reduce recomputation, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish boundary',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'chunk-upload', 'backpressure', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-digests-skips-large-upload-chunk-upload-after-pause',
    proposal: 'use a compressed remote index plus cached chunk digests to skip large-upload chunk upload work after a pause',
    rejectedBecause: 'planning evidence and cached chunk digests can reduce recomputation, but they cannot prove which chunk acknowledgements survived the pause, whether backpressure stayed bounded, or that the guarded publish boundary is still intact',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'chunk-upload', 'backpressure', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached chunk ledger as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and a cached chunk ledger can reduce lookup and rehash work, but they cannot prove which chunk acknowledgements survived failure or that the live publish compare still holds',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a compressed chunk ledger as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'compressed planning evidence and compressed chunk ledgers can trim replay work, but they cannot prove which chunk acknowledgements survived failure or that the live compare still holds',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached manifest hash as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and manifest hashing can reduce lookup work, but they cannot prove the live compare, every chunk acknowledgement, or the guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-digest-skips-large-upload-publish',
    proposal: 'treat a compressed remote index plus a cached file digest as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'planning evidence and cached file digests can trim lookup work, but they cannot prove the live compare, every chunk acknowledgement, or the guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-publish',
    proposal: 'use a compressed remote index plus a cached file hash to skip the guarded chunk-publish step for a large upload',
    rejectedBecause: 'planning evidence and cached file hashes can trim duplicate hashing, but they cannot prove the live chunk compare, the surviving chunk acknowledgements, or the guarded publish barrier after a pause, retry, or crash',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload',
    proposal: 'use a compressed remote index plus a cached file hash to skip the remaining chunk upload work for a large upload',
    rejectedBecause: 'planning evidence and cached file hashes can trim duplicate hashing, but they cannot prove each chunk was uploaded, acknowledged, and preserved through the guarded publish boundary after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause',
    proposal: 'use a compressed remote index plus a cached file hash to skip chunk upload after a pause',
    rejectedBecause: 'planning evidence and cached file hashes can trim duplicate hashing, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-chunk-upload-after-pause',
    proposal: 'use a compressed remote index plus a cached file fingerprint to skip large-upload chunk upload after a pause',
    rejectedBecause: 'planning evidence and cached fingerprints can trim duplicate hashing, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-backpressure-after-pause',
    proposal: 'use a compressed remote index plus a cached file hash to skip large-upload chunk-upload backpressure after a pause',
    rejectedBecause: 'planning evidence and cached hashes can trim duplicate hashing, but they cannot prove the bounded queue order, chunk acknowledgements, or guarded publish barrier survived the pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-ledger-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index plus a cached chunk ledger to skip large-upload backpressure',
    rejectedBecause: 'planning evidence and a cached chunk ledger can reduce duplicate work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-receipt-summary-skips-large-upload-publish',
    proposal: 'treat a compressed receipt summary as enough proof to skip the guarded publish step for a large upload',
    rejectedBecause: 'a compressed summary can reduce recovery storage, but it cannot prove the live compare or guarded publish barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-receipt-log-authorizes-apply',
    proposal: 'treat a compressed durable receipt log as enough proof to authorize apply after a crash',
    rejectedBecause: 'receipt compression can shrink recovery storage, but it cannot prove the live compare or the atomic-group barrier survived failure',
    rejectedGate: 'recovery',
    violates: ['compression', 'live-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-receipt-log-authorizes-apply-after-pause',
    proposal: 'treat a compressed receipt log flushed within journal lag as enough proof to authorize apply after a pause',
    rejectedBecause: 'journal batching can reduce fsync cost, but a flushed log still cannot prove the live compare or atomic-group barrier survived the pause',
    rejectedGate: 'recovery',
    violates: ['compression', 'backpressure', 'live-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'parallelize-atomic-group-commit',
    proposal: 'run atomic group commits in parallel so independent work can publish sooner',
    rejectedBecause: 'the commit barrier is part of the atomic group and must stay a single visibility point',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'visibility-boundary'],
  },
  {
    id: 'compressed-remote-index-and-parallel-owner-index-scans-skips-live-write',
    proposal: 'use a compressed remote index and parallel owner scans to skip the live write check during a plugin change',
    rejectedBecause: 'parallel owner scans can size batches faster, but they cannot authorize a live write or replace the storage-boundary compare',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'live-preconditions', 'planning-only'],
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
  {
    id: 'unbounded-parallel-large-upload-resume',
    proposal: 'resume large uploads with unlimited concurrent chunk sends once a cached receipt set exists',
    rejectedBecause: 'cached receipts can skip duplicate work, but unlimited concurrency can drop the backpressure evidence and journal order needed to resume or classify a partial failure',
    rejectedGate: 'recovery',
    violates: ['backpressure', 'durable-progress', 'chunk-receipts'],
  },
  {
    id: 'unbounded-parallel-plugin-install-finalize',
    proposal: 'run plugin install finalize work for all dependency groups at once once row staging is done',
    rejectedBecause: 'row staging can overlap, but unlimited finalize parallelism can erase the backpressure and commit ordering needed to tell which plugin group owns a partial failure',
    rejectedGate: 'group',
    violates: ['atomic-groups', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure',
    proposal: 'use a compressed remote index to justify unbounded upload parallelism once staging has started',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded parallelism can still outrun the receipt and journal order needed to recover after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-parallel-chunk-sends-skips-backpressure',
    proposal: 'use a compressed remote index plus parallel chunk sends to skip backpressure pauses during a large upload',
    rejectedBecause: 'planning evidence and parallel chunk sends can reduce wait time, but they cannot prove the sender kept bounded queue order, complete chunk receipts, and journal evidence across a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip backpressure pauses during large-upload resume',
    rejectedBecause: 'planning evidence and cached receipts can trim replay work, but they cannot prove the sender still has the bounded queue order and journal evidence needed to recover after pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-send-backpressure',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip backpressure during large-upload chunk sends',
    rejectedBecause: 'planning evidence and cached receipts can trim duplicate work, but they cannot prove the sender kept bounded chunk fanout, complete receipt order, and durable journal evidence across a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-backpressure',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip backpressure before the large-upload publish step',
    rejectedBecause: 'planning evidence and cached receipts can trim duplicate work, but they cannot prove the queue stayed bounded, the chunk acknowledgements survived the pause, or the guarded publish barrier is still intact',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip large-upload window sizing after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can trim duplicate replay, but they cannot prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-window-sizing',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip large-upload window sizing after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can trim duplicate replay, but they cannot prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-digests-skips-large-upload-window-sizing',
    proposal: 'use a compressed remote index plus cached chunk digests to skip large-upload window sizing after a pause',
    rejectedBecause: 'planning evidence and cached chunk digests can trim duplicate replay, but they cannot prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-manifest-hash-skips-large-upload-window-sizing',
    proposal: 'use a compressed remote index plus a cached manifest hash to skip large-upload window sizing after a pause',
    rejectedBecause: 'planning evidence and cached manifest hashes can trim duplicate replay, but they cannot prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'file-hashing', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-live-compare-before-publish',
    proposal: 'use a compressed remote index plus a cached file fingerprint to skip the live compare before publishing a large upload',
    rejectedBecause: 'planning evidence and cached fingerprints can trim duplicate rehash work, but they cannot prove the live remote resource still matches or that the chunk acknowledgements and publish barrier survived failure',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-db-parallelism-skips-atomic-group-barriers',
    proposal: 'use a compressed remote index to justify unbounded database row parallelism across plugin groups once batching begins',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded row parallelism can still erase the group-owned commit order and backpressure evidence needed to recover a partial failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'atomic-groups', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-barrier',
    proposal: 'use a compressed remote index to justify unbounded row-batch parallelism for plugin installs once staging has begun',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded row-batch parallelism can still erase the per-row preconditions and install barrier needed to recover a partial failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'atomic-groups', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-barrier',
    proposal: 'use a compressed remote index to justify unbounded row-batch parallelism for plugin updates once staging has begun',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded row-batch parallelism can still erase the per-row preconditions and update barrier needed to recover a partial failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'atomic-groups', 'parallelism-limits', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-update-recovery',
    proposal: 'use a compressed remote index plus unbounded row-batch parallelism to skip plugin-update recovery after failure',
    rejectedBecause: 'planning evidence and row fanout can reduce lookup work, but they cannot prove the row preconditions, atomic-group order, or backpressure evidence needed to classify a partial plugin update',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'atomic-groups', 'backpressure', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-barrier-with-parallel-batches',
    proposal: 'use a compressed remote index plus cached row receipts to skip the plugin-update barrier while running parallel row batches',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay, but they cannot prove the live row compares, dependency checks, or atomic-group barrier survived failure while parallel batches were in flight',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'parallelism-limits', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions',
    proposal: 'use a compressed remote index plus cached row-batch receipts to skip plugin-install row preconditions',
    rejectedBecause: 'planning evidence and cached batch receipts can trim duplicate lookup work, but they cannot prove the live row compares or the plugin-install barrier survived a pause, retry, or partial failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-chunk-parallelism-skips-guarded-publish',
    proposal: 'use a compressed remote index to justify unbounded chunk upload parallelism and treat the drained queue as publish-ready',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded chunk parallelism can still erase the receipt order and backpressure evidence needed to recover after pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure',
    proposal: 'use a compressed remote index to justify unbounded file-hash fanout and treat the resulting queue as backpressure-safe',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded hash fanout can still outrun the bounded queue order and journal evidence needed to recover after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'file-hashing', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index and batched receipt flushes to skip backpressure pauses during large-upload resume',
    rejectedBecause: 'planning evidence and receipt batching can reduce fsync cost, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  },
  {
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-large-upload-publish-after-pause',
    proposal: 'use a compressed remote index and batched receipt flushes to skip the guarded publish step for a large upload after a pause',
    rejectedBecause: 'planning evidence and batched receipt flushes can reduce journal cost, but they cannot prove which chunk acknowledgements survived the pause or that the guarded publish barrier is still intact',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-backpressure',
    proposal: 'use a compressed remote index and batched row receipts to skip plugin-update backpressure during resume',
    rejectedBecause: 'planning evidence and receipt batching can reduce journal cost, but they cannot prove which row acknowledgements survived the pause or restore the atomic-group barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-summary-skips-plugin-update-finalize',
    proposal: 'use a compressed remote index and a cached row summary to skip plugin-update finalize',
    rejectedBecause: 'planning evidence and row summaries can reduce lookup work, but they cannot prove the live row compares, dependency checks, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    proposal: 'use a compressed remote index plus a cached dependency graph to skip plugin-update backpressure after a pause',
    rejectedBecause: 'planning evidence and dependency shape can reduce rescans, but they cannot prove which row receipts, plugin preconditions, or atomic-group evidence survived the pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize-after-pause',
    proposal: 'use a compressed remote index plus a cached dependency graph to skip plugin-install finalize after a pause',
    rejectedBecause: 'planning evidence and dependency shape can reduce duplicate lookup work, but they cannot prove the live row compares, staged metadata writes, or the atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    proposal: 'use a compressed remote index plus cached row receipts to skip plugin-install backpressure after a pause',
    rejectedBecause: 'planning evidence and cached row receipts can reduce replay work, but they cannot prove the queue order, plugin preconditions, or atomic-group evidence survived the pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    proposal: 'use a compressed remote index plus batched row receipt flushes to skip plugin-install finalize after a pause',
    rejectedBecause: 'planning evidence and batched row receipts can reduce fsync work, but they cannot prove the live row compares, dependency checks, or the atomic-group finalize survived the pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-db-receipts-skips-plugin-install-row-preconditions-after-pause',
    proposal: 'use a compressed remote index plus batched database row receipts to skip plugin-install row preconditions after a pause',
    rejectedBecause: 'planning evidence and row-receipt batching can reduce replay cost, but they cannot prove the live row compares, plugin-install dependency checks, or the atomic-group barrier survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'database-row-batching', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit',
    proposal: 'treat a compressed remote index plus a cached release manifest as enough proof to skip the release-bundle commit barrier',
    rejectedBecause: 'planning evidence and a cached manifest can reduce scans, but they cannot prove the dependent plugin files, row batches, and atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'atomic-groups', 'plugin-preconditions', 'row-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-planning',
    proposal: 'use a compressed remote index plus a cached release manifest to skip release-bundle planning rescans',
    rejectedBecause: 'planning evidence and a cached manifest can reduce planning work, but they cannot turn a remote index into apply authorization or prove the dependent files and rows survived failure',
    rejectedGate: 'skip',
    violates: ['remote-indexes', 'remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
    proposal: 'use a compressed remote index plus batched row receipts to skip the release-bundle commit barrier',
    rejectedBecause: 'planning evidence and batched row receipts can reduce replay cost, but they cannot prove the dependent plugin files, row batches, and atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'atomic-groups', 'plugin-preconditions', 'row-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    proposal: 'use a compressed remote index plus batched receipt flushes to skip the release-bundle commit barrier after a pause',
    rejectedBecause: 'planning evidence and batched receipt flushing can reduce fsync work, but they cannot prove the dependent plugin files, row batches, or atomic-group commit survived the pause',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'atomic-groups', 'plugin-preconditions', 'row-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    proposal: 'use a compressed remote index plus batched chunk and database receipts to skip the release-bundle commit barrier after a pause',
    rejectedBecause: 'planning evidence and batched receipts can reduce replay cost, but they cannot prove the live file compares, row preconditions, or the atomic-group commit survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'database-row-batching', 'backpressure', 'chunk-receipts', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-compressed-db-batches-skips-release-bundle-commit',
    proposal: 'use a compressed remote index plus compressed database batches to skip the release-bundle commit barrier',
    rejectedBecause: 'planning evidence and batch compression can reduce fsync cost, but they cannot prove the dependent plugin files, database row batches, and atomic-group commit survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'database-row-batching', 'atomic-groups', 'plugin-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-unbounded-hash-fanout-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index to justify unbounded hash fanout and skip large-upload backpressure during a resume',
    rejectedBecause: 'planning evidence can reduce lookup cost, but unbounded hashing can still outrun the bounded queue order and journal evidence needed to recover after a pause or crash',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'file-hashing', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-backpressure',
    proposal: 'use a compressed remote index plus bounded chunk parallelism to skip large-upload backpressure after a pause',
    rejectedBecause: 'planning evidence and bounded chunk fan-out can reduce duplicate work, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-backpressure-after-pause',
    proposal: 'use a compressed remote index plus a cached file fingerprint to skip large-upload backpressure after a pause',
    rejectedBecause: 'planning evidence and cached fingerprints can trim duplicate rehashing, but they cannot prove the queue stayed bounded, which chunk acknowledgements survived the pause, or that the guarded publish barrier remained intact',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-publish-after-pause-and-backpressure',
    proposal: 'use a compressed remote index plus a cached file fingerprint to skip large-upload publish after a pause and backpressure event',
    rejectedBecause: 'planning evidence and cached fingerprints can trim duplicate rehashing, but they cannot prove the chunk acknowledgements, live compare, or guarded publish barrier survived the pause, so the upload would become ambiguous after failure',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure-after-pause',
    proposal: 'use a compressed remote index plus cached chunk receipts to skip large-upload backpressure after a pause',
    rejectedBecause: 'planning evidence and cached chunk receipts can reduce duplicate upload work, but they cannot prove the queue stayed bounded or that the paused sender still has enough journaled evidence to resume or abort without ambiguity',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-fingerprint-skips-large-upload-resume-after-pause',
    proposal: 'use a compressed remote index plus a cached file fingerprint to skip large-upload resume after a pause',
    rejectedBecause: 'planning evidence and cached fingerprints can trim duplicate rehashing, but they cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier',
    rejectedGate: 'recovery',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-publish-after-pause',
    proposal: 'use a compressed remote index plus bounded chunk parallelism to publish a large upload immediately after a pause',
    rejectedBecause: 'a paused upload still needs durable chunk receipts and the live publish compare; planning compression does not prove the staged bytes are safe to expose',
    rejectedGate: 'live',
    violates: ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'live-preconditions', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    proposal: 'use a compressed remote index plus cached row receipts to skip plugin-update finalize after a pause',
    rejectedBecause: 'planning evidence and cached row receipts can trim replay, but they cannot prove the live row compares, dependency checks, or atomic-group finalize survived failure',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause',
    proposal: 'use a compressed remote index plus a cached package hash to skip plugin-install finalize after a pause',
    rejectedBecause: 'planning evidence and cached package hashes can reduce duplicate inspection, but they cannot prove the install rows, activation checks, or atomic-group barrier survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    proposal: 'use a compressed remote index plus a cached package hash to skip plugin-install activation after a pause and backpressure event',
    rejectedBecause: 'planning evidence and cached package hashes can reduce duplicate inspection, but they cannot prove the activation checks, staged metadata writes, backpressure state, or atomic-group barrier survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'backpressure', 'file-hashing', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  },
  {
    id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
    proposal: 'use a compressed remote index plus a cached file hash to skip release-bundle commit after a pause',
    rejectedBecause: 'planning evidence and cached hashes can trim duplicate scanning, but they cannot prove the chunk acknowledgements, row receipts, backpressure state, or atomic-group commit barrier survived the pause',
    rejectedGate: 'group',
    violates: ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'row-preconditions', 'backpressure', 'atomic-groups', 'durable-progress'],
  },
]);

export function buildBenchmarkModel(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const workloads = [
    largeUploadWorkload(),
    pluginInstallWorkload(),
    pluginUpdateWorkload(),
    releaseBundleWorkload(),
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

export function buildFastPathFixture(overrides = {}) {
  const model = buildBenchmarkModel(overrides);
  const scheduleByKind = new Map(model.schedules.map((schedule) => [schedule.kind, schedule]));
  const fixtureKinds = ['large-upload', 'plugin-install', 'plugin-update', 'release-bundle'];
  const schedules = fixtureKinds.map((kind) => scheduleByKind.get(kind)).filter(Boolean);

  return {
    schemaVersion: model.schemaVersion,
    safetyContract: model.safetyContract,
    fastPathGates: model.fastPathGates,
    safeSpeedupAreas: model.safeSpeedupAreas,
    fixture: {
      purpose: 'large-upload-and-plugin-apply-safety-evidence',
      workloads: model.workloads.filter((workload) => fixtureKinds.includes(workload.kind)),
      schedules,
      totals: summarizeSchedules(schedules),
    },
    rejectedFastPaths: model.rejectedFastPaths.filter((fastPath) =>
      fastPath.violates.includes('atomic-groups') ||
      fastPath.violates.includes('live-preconditions') ||
      fastPath.violates.includes('chunk-receipts') ||
      fastPath.violates.includes('row-preconditions') ||
      fastPath.violates.includes('remote-index-planning-only') ||
      fastPath.violates.includes('compression') ||
      fastPath.violates.includes('parallelism-limits') ||
      fastPath.violates.includes('backpressure')
    ),
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

function releaseBundleWorkload() {
  const atomicGroup = {
    id: 'release-bundle-commerce-stack',
    kind: 'plugin-update',
    dependencies: ['payments', 'subscriptions', 'analytics'],
    commitPolicy: 'all-or-nothing',
  };

  return {
    id: 'release-bundle-commerce-stack',
    kind: 'release-bundle',
    description: 'A mixed large-upload and dependency-heavy plugin release that exercises shared backpressure and atomic barriers.',
    planId: 'plan-release-bundle-commerce-stack-v1',
    atomicGroup,
    files: [
      {
        resourceKey: 'file:wp-content/uploads/2026/05/release-notes.json',
        path: 'wp-content/uploads/2026/05/release-notes.json',
        sizeBytes: 128 * MIB,
        mimeType: 'application/json',
        compressible: true,
        baseHash: 'sha256:base-release-notes',
        remoteBeforeHash: 'sha256:base-release-notes',
        localHash: 'sha256:local-release-notes',
      },
      pluginFile('file:wp-content/plugins/commerce/assets/release-banner.js', 10 * MIB, 'application/javascript', true, atomicGroup.id),
    ],
    rowGroups: [
      rowGroup('wp_options', 260, 1100, atomicGroup.id),
      rowGroup('wp_postmeta', 7600, 680, atomicGroup.id),
      rowGroup('wp_termmeta', 1200, 520, atomicGroup.id),
      rowGroup('wp_actionscheduler_actions', 1800, 920, atomicGroup.id),
    ],
    pluginResources: [
      {
        resourceKey: 'plugin:payments',
        remoteBeforeHash: 'sha256:payments-2.1.1-active',
        localHash: 'sha256:payments-2.2.0-active',
        atomicGroupId: atomicGroup.id,
      },
      {
        resourceKey: 'plugin:subscriptions',
        remoteBeforeHash: 'sha256:subscriptions-1.5.0-active',
        localHash: 'sha256:subscriptions-1.6.0-active',
        atomicGroupId: atomicGroup.id,
      },
      {
        resourceKey: 'plugin:analytics',
        remoteBeforeHash: 'sha256:absent',
        localHash: 'sha256:analytics-1.0.0-active',
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

  const durableReceiptCount = actions.filter((action) =>
    action.type === 'chunk-upload' ||
    action.type === 'db-row-batch' ||
    action.type === 'plugin-metadata-stage' ||
    action.type === 'file-publish',
  ).length;

  if (durableReceiptCount > 0) {
    actions.push({
      type: 'durable-receipt-flush',
      workloadId: workload.id,
      planId: workload.planId,
      receiptCount: durableReceiptCount,
      maxJournalLagMs: limits.maxJournalLagMs,
      canonicalVisible: false,
      durableEvidence: 'batched-journal-record',
      preservesRawReceipts: true,
      flushMode: 'bounded-journal-lag',
      resumeRequires: [
        'raw-durable-receipts',
        'journal-fsync-caught-up',
      ],
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
  if (file.sizeBytes > limits.chunkSizeBytes) {
    actions.push({
      type: 'chunk-window-sizing',
      resourceKey: file.resourceKey,
      sizeBytes: file.sizeBytes,
      chunkSizeBytes: limits.chunkSizeBytes,
      remoteIndexCursor: 'generation-and-scanner-cursor',
      reusesPlanningCursor: true,
      reusesDurableReceipts: true,
      livePublishPrecondition: {
        resourceKey: file.resourceKey,
        expectedHash: file.remoteBeforeHash,
      },
      boundedByReceiptBudget: true,
      canonicalVisible: false,
      durableEvidence: 'planning-cursor-and-window-sizing-record',
    });
  }

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
  if (batchCount > 1) {
    actions.push({
      type: 'db-batch-parallelism',
      table: rowGroupEntry.table,
      atomicGroupId: rowGroupEntry.atomicGroupId || null,
      batchCount,
      perTableLimit: limits.maxDbConcurrencyPerTable,
      perSiteLimit: limits.maxDbConcurrencyPerTable,
      boundedByReceiptBudget: true,
      boundedByAtomicGroup: Boolean(rowGroupEntry.atomicGroupId),
      canonicalVisible: false,
      durableEvidence: 'per-table-parallel-batch-plan-record',
      idempotencyKey: `${planId}:${rowGroupEntry.atomicGroupId || 'independent'}:${rowGroupEntry.table}:parallelism`,
    });
  }

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
