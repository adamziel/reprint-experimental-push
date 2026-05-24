# Apply Journal Recovery States

The current recovery slices are lab evidence, not production durable recovery.
The Playground lab uses a bounded option journal to classify a failed apply
without storing raw before/after values. The JSON-model lab also has a
file-backed append-only JSONL journal with monotonic sequences and `fsync`
evidence after each append. A newer local-only Playground REST slice adds a
fixture-scoped DB table journal for apply idempotency, concurrent duplicate
claiming, DB-only process-kill recovery blocking, and DB-only missing-commit
finalization, plus an all-old stale-claim safe retry lab slice. These slices
are not production WordPress recovery: they do not prove production durability
and do not auto-repair a partial remote.

The production design target is a durable artifact that separates a safe retry
from an unsafe partial push. A failed apply must leave the system classifiable
as only one of these states:

- `old-remote`: no remote mutation was committed. The journal records the plan,
  before/after hashes, and the last completed boundary so the push can be
  retried after revalidating preconditions.
- `fully-updated-remote`: every planned mutation is present on the remote. A
  completed journal may be replayed, but replay must not reapply mutations.
- `blocked-recovery`: the remote may be partial, drifted, or otherwise
  ambiguous. The journal and observed remote snapshot are required artifacts,
  and automated retry must stop until recovery is resolved.

Any production partial remote mutation without a `blocked-recovery` artifact is
a release blocker.

## Boundaries

The current lab journal records these apply boundaries:

- `opened`: preconditions matched and the journal has before/after values.
- `staging`: at least one mutation was staged into the candidate remote.
- `staged`: every mutation was staged, but dependency validation has not
  completed.
- `dependencies-validated`: staged content satisfies atomic group dependencies.
- `committing`: mutations are being committed to the remote target.
- `completed`: all mutations were committed.
- `blocked`: commit did not finish cleanly and recovery requires inspection.

Completed replay validates that current remote resources still match the
journaled after hashes. If any resource drifted after completion, replay blocks
instead of resurrecting stale local data.

The JSON apply model can also be given a durable journal writer with
`appendEvent(type, payload)`. The writer receives hash-only JSONL-compatible
events before mutation work starts: `journal-opened`, one `target-planned` per
mutation, staging/dependency/commit boundaries, `mutation-observed`, terminal
`journal-completed`, or `recovery-state`. These records are sufficient for the
restart inspector to classify a failure as `old-remote`, `fully-updated-remote`,
or `blocked-recovery` without raw target values. A replayed in-memory journal
must exactly match the plan's mutation ids, resource keys, actions, before
hashes, and after hashes before it can suppress fresh mutation work.

Durable writer failures before the commit boundary are also classified. If the
writer fails while opening the journal, recording the staged boundary,
recording dependency validation, or entering `committing` before the first
target write, the executor reports `old-remote` and includes the in-memory
journal artifact in the error. If an injected old-remote failure cannot append
its terminal `recovery-state` event, the injected failure remains classified as
`old-remote`; the error records the durable append failure separately so the
caller does not mistake missing terminal JSONL evidence for a partial remote
mutation.

When an `old-remote` in-memory journal is retried while appending to the same
durable JSONL file, the apply model records `journal-retry-opened` and reuses
the original `target-planned` records. It does not append duplicate target
records, because duplicate target metadata would make restart inspection
ambiguous even when the retry finishes as `fully-updated-remote`.

When a completed in-memory journal is replayed into a fresh durable JSONL file,
the apply model first writes hash-only `journal-opened` and `target-planned`
records from the completed journal envelope, then appends `journal-replayed`.
That makes the fresh durable artifact restart-inspectable as
`fully-updated-remote` without reapplying inserts or stale local values.

## Current Playground Lab Evidence

`npm run test:playground:recovery` verifies the lab failpoint
`REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. In the
fail-after-2 scenario the PHP protocol reports
`LAB_INJECTED_APPLY_FAILURE` after two successful whole-resource mutations,
leaving `2 new` targets and `6 old` targets. CLI inspect and
`GET /recovery/inspect` classify the remote as `blocked-recovery`, with target
states reported as old, new, or blocked-unknown, and a retry refuses with
`PRECONDITION_FAILED`.

The journal records planned recovery entries, `mutation-applied`,
`apply-failed`, `recovery-required`, and current hashes without raw values. This
is enough to prove the lab classification path, but it is still not a durable
production journal, not a hard-kill/`fsync` path, and not an automated repair
mechanism.

## Current File-Backed JSONL Evidence

`npm run test:recovery:file-journal` verifies the JSON-model file-backed
recovery journal in `src/recovery-journal.js` and restart-style inspection in
`src/recovery-inspect.js`. The journal is append-only JSONL. Each record has a
monotonic sequence number and carries `fsync` evidence, and the writer calls
`fs.fsyncSync()` after each append.

The smoke covers these restart-style states:

- failure before mutation inspects as `old-remote`;
- fail-after-2 inspects as `blocked-recovery` with `2 new`, `6 old`, and
  `0` unknown targets;
- retry over the partial remote refuses with `PRECONDITION_FAILED` and does not
  change the remote;
- completed replay applies `0` additional mutations and inspects as fully
  updated or already committed;
- drift outside the journaled before/after hashes reports
  `blockedUnknown > 0`;
- journal files contain no raw fixture fields/data.

This is stronger than the earlier in-memory-only recovery model, but it is
still JSON-model lab evidence. It is not the production WordPress DB table
journal, not the local Playground process-kill smoke, and not a production
repair policy. Journal paths must be unique or reset intentionally because
opening a plan recovery journal defaults to `truncate`. The raw-value guard is
based on forbidden keys and fixture strings, not a complete allowlist schema for
every production record shape.

## Current DB Journal Idempotency Evidence

`npm run test:playground:db-journal-idempotency` verifies a fixture-scoped
DB-native apply journal over the local-only Playground REST path. This DB
journal is separate from the bounded `wp_options` lab journal exposed through
legacy `GET /journal`; `/journal` still exists for the option-backed evidence.

`POST /apply` requires `X-Reprint-Push-Idempotency-Key`. A missing key returns
`400 MISSING_IDEMPOTENCY_KEY` before mutation. With a key, the table
`wp_reprint_push_lab_push_journal` records `idempotency-opened`,
`apply-started`, per-mutation `mutation-prepared` before each target write,
per-mutation `mutation-applied` after observed hash calculation,
`apply-committed`, `apply-replayed`, and conflict evidence. Compact DB mutation
evidence stores hashes and metadata only: mutation order/id/resource key/type,
before hash, planned after hash, observed hash, phase/status, and
request/plan/receipt/idempotency hashes.

The current lab apply path also records just-in-time pre-write evidence. Before
each mutation write, the target resource is re-hashed and compared with that
mutation's bound expected hash. Hash-only evidence may include
`preWriteExpectedHash`, `preWriteActualHash`, `preconditionCheck`, and, for the
fixture plugin activation staged path, `preWriteStagingProof`. The staged proof
contains only declared atomic-group metadata, mutation ids/order, resource keys,
and hashes; it must not include plugin file contents, plugin option values, row
payloads, post content, or snapshots.

When the pre-write hash check rejects with `PRECONDITION_FAILED`, DB journal
evidence records `mutation-precondition-failed` and terminal `apply-rejected`
without a `mutation-applied` event for that mutation, without later mutation
events, and without `apply-committed`. Same key/body retry after this rejected
mid-apply drift replays the rejection with `idempotency.replayed: true` and no
fresh mutation work, or returns a conservative recovery block. Same key with a
different body remains `409 IDEMPOTENCY_KEY_CONFLICT`. Missing-commit
finalization must not turn a partial JIT rejection into a commit.

`npm run test:playground:storage-guarded-db-write` verifies the storage
boundary immediately after that JIT hash passes for a fixture-scoped update
set: existing `wp_posts` fixture rows, allowlisted `wp_options`, allowlisted
single-row `wp_postmeta`, and exact positive-id
`wp_reprint_push_forms_lab` rows. The write path uses one guarded
`$wpdb->query($wpdb->prepare(...))` `UPDATE` with expected stored-column
predicates. Journal and response evidence add hash-only `storageGuard` fields:
boundary, driver, logical and physical table, operation, compared column names,
expected resource hash, expected storage hash, rows affected, outcome, and SQL
shape hash.

If storage drifts after JIT but before SQL, including marker-empty ownership
drift for posts or postmeta parent posts, the guarded update affects zero rows,
returns `PRECONDITION_FAILED`, preserves the drifted target, records no
`mutation-applied` for the failed target, records no later mutations, and
records no `apply-committed`. Same key/body replay remains non-mutating with no
fresh mutation work, and same key/different body remains
`IDEMPOTENCY_KEY_CONFLICT`. The failure evidence uses the post-failure current
hash for observed/actual/recovery state while retaining the pre-write hash that
proves the JIT check passed.

`npm run test:playground:storage-guarded-file-write` verifies the storage
boundary immediately after that JIT hash passes for fixture file write
mutations. For accepted fixture upload paths, existing-file updates and creates
compare the live file bytes/hash against the storage value observed after JIT,
write the planned content to a temp file in the same directory, then rename
after the boundary comparison. Existing-file deletes compare the same storage
value before unlinking. Positive evidence covers an existing fixture upload
file update, a fixture upload file create, and a fixture upload file delete
with `storageGuard.outcome: applied`.

If a lab hook drifts the file after JIT but before update, create, or delete,
apply returns `PRECONDITION_FAILED`, preserves the drifted file state, records
no `mutation-applied` for the failed file, records no later mutations, and
records no `apply-committed`. Same key/body replay remains non-mutating with no
fresh mutation work, and same key/different body remains
`IDEMPOTENCY_KEY_CONFLICT`. File evidence is hash-only: boundary
`filesystem-compare-rename` for update/create or `filesystem-compare-unlink`
for delete, driver, operation, logical fixture path, compared fields, expected
resource/storage hashes, actual/planned storage hashes, physical path hash, and
outcome. It exposes neither raw file contents nor absolute host paths. The code
path also supports named fixture plugin file update paths, but this standalone
smoke exercises upload-file update/create/delete only.

The verified replay behavior is idempotent for the fixture batch: same key plus
same body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`,
does no fresh mutation work, adds no extra per-mutation events, and leaves the
snapshot unchanged. Same key plus a different body returns
`409 IDEMPOTENCY_KEY_CONFLICT` before mutation.

The same harness verifies DB-native first-apply claiming. The journal table has
a unique nullable `claim_key_hash` column used only by `idempotency-opened`
rows. Concurrent same-key/same-body first applies create exactly one opened
claim and exactly one fresh mutation executor; the duplicate request returns
safe in-progress/retry/replay behavior without mutation. Concurrent
same-key/different-body requests reject the loser with
`409 IDEMPOTENCY_KEY_CONFLICT` before mutation.

`npm run test:playground:db-journal-process-kill` verifies local hard-kill
behavior in a host-mounted Playground lab. It sends `SIGKILL` to the localhost
Playground server process group during an in-flight DB-journaled REST apply,
restarts against the same WordPress mount, and verifies that DB
`idempotency-opened`/`apply-started` rows persist with no false
`apply-committed` or replay state. Live target hashes are explainable as old or
new from DB planned evidence plus live hashes, recovery inspection returns the
non-mutating `RECOVERY_BLOCKED` result, and retry does not overwrite the
partial state. The smoke does not rely on the legacy option journal for this
classification.

`npm run test:playground:db-journal-missing-commit-finalization` verifies the
DB-only missing-commit finalization path. A deterministic lab hook performs the
fixture target writes and DB mutation evidence, but omits the terminal
`apply-committed` row. Before finalization, the same key with a different body
still returns `409 IDEMPOTENCY_KEY_CONFLICT` without mutating. The same key with
the same body observes that every live target hash already matches the planned
after hash, appends the missing commit row, returns
`BATCH_RECOVERY_FINALIZED`, reports `fully-updated-remote`, and performs zero
fresh mutation work. A later replay returns `BATCH_ALREADY_COMMITTED`.

`npm run test:playground:db-journal-stale-claim-all-old` verifies a
deterministic all-old stale-claim retry path in the local Playground
SQLite/host-mount lab. The first request uses a lab hook that writes
`idempotency-opened`, `apply-started`, and `stale-claim-abandoned`, then stops
without mutation rows, terminal rows, or target mutation. Same key plus a
different body still returns `409 IDEMPOTENCY_KEY_CONFLICT` before retry logic.
Exact same key/body retry may run fresh mutation work only when the journal has
explicit abandonment evidence tied to the started row being retried, the
started recovery targets validate against the request, there is no
`mutation-prepared`, `mutation-applied`, or `mutation-precondition-failed`
evidence for that key/request, and every live target hash remains at the
planned old value. The retry appends a derived unique
`stale-claim-retry-started`, performs exactly one fresh mutation set, commits,
and later replays as `BATCH_ALREADY_COMMITTED`.

The same smoke proves a deterministic retry-claim guard without relying on
multiple Playground workers. If the derived stale retry claim already exists
before retry `apply-started` or mutation, a later exact retry returns
`IDEMPOTENCY_KEY_IN_PROGRESS`, appends only hash-only in-progress evidence, and
does not mutate. It also proves the retry-start negative: a retry
`apply-started` without matching abandonment evidence blocks with
`RECOVERY_BLOCKED` instead of reusing an older `stale-claim-abandoned` row.

This is useful DB-table shape and fixture storage-boundary evidence, but it is
still local Playground SQLite/host-mount lab evidence, not production durable
recovery, production source mutation, or storage-level crash proof. It does not
prove storage `fsync`, rollback, transactions, locking, exactly-once
production writes, generic MySQL/InnoDB or filesystem compare-and-swap
behavior, arbitrary plugin data safety, arbitrary file safety, create/delete
guarding, or storage guarding for plugin activation. The stale-claim lab slice
does not prove production stale-claim leases, fencing, claim expiry,
cross-process/shared-DB lock behavior, arbitrary production repair, or a
production retry policy. Tests mostly count mutation evidence rows rather than
deeply asserting every observed hash, and production auth, live source
mutation, and full push remain pending. Redaction is checked through forbidden
keys and fixture values, not by a formal sanitizer for arbitrary future journal
messages.

## Current Fixture Plugin Atomicity Failure Evidence

`npm run test:playground:plugin-atomic-install` adds fixture plugin install
failure classification on top of the local REST/DB journal shape. The
before-commit lab hook fails before the atomic group publishes any target
mutation; recovery reports `old-remote`, the target surface is unchanged, and
retry with the same key/body performs zero fresh mutation work.

The during-publish hook and fixture activation failure intentionally do not
claim rollback. They classify the result as blocked recovery or otherwise
non-fully-updated, preserve the observed partial target on retry, and report no
fresh retry mutation work. This is hard-coded Playground fixture evidence for
classification after plugin publish/activation failure, not production rollback
or production plugin recovery.
