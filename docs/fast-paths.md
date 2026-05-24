# Fast Paths

Fast is fourth priority for push. A fast path is acceptable only when a crash,
retry, concurrent remote edit, or partial upload still leaves the source site in
one of the known states: unchanged, fully changed, or blocked with durable
recovery evidence. Anything that makes the final state ambiguous is not a fast
path for this project.

The acceptance rule is simple: a speedup may reduce duplicate hashing, body
transfer, round trips, lock time, or idle time, but it may not remove live
preconditions, weaken canonical hashes, publish staged data early, split an
atomic group, or mark progress before durable evidence exists.

Every proposed fast path has to pass these gates before implementation:

- **Skip gate:** it may skip duplicate work only when the skipped work is
  backed by a strong digest, a matching plan-scoped receipt, or a remote index
  entry that is used for planning only.
- **Live gate:** every mutating write still has a live resource precondition at
  the storage boundary or a server-side compare-and-swap predicate.
- **Group gate:** plugin installs, upgrades, activation changes, and any
  plugin-owned rows cross visibility only through their atomic group commit.
- **Recovery gate:** after a lost response, crash, retry, or pressure pause, the
  executor can classify the remote as old, new, or blocked from durable
  receipts and journal records without inferring intent from partial artifacts.

## Safe Speedups

| Area | Safe fast path | Required guardrail |
| --- | --- | --- |
| File hashing | Cache strong file hashes keyed by a local fingerprint such as size, mtime, inode, permissions, and previous digest. Stream only uncached or fingerprint-changed files, and keep per-chunk hashes for large files. | Size, mtime, or inode can only skip a rehash when they match a cached strong digest. The apply precondition remains the remote resource hash. |
| Chunk upload | Upload large file bodies to plan-scoped staging objects in digest-addressed chunks, then assemble or publish the file with one compare-and-swap finalize step. | Chunk writes must not mutate the live path. Each chunk needs a checksum, idempotency key, and durable journal entry before the sender advances. |
| Database row batching | Group row mutations by table and operation shape, then execute bounded batches in stable primary-key order. | Every row in the batch still needs its expected remote hash, and the batch must commit atomically or be replayable with the same idempotency key. |
| Remote indexes | Ask the remote for an indexed resource listing with keys, type, size, generation, and strong hash so planning can avoid fetching unchanged resources. | The index speeds up planning only. Apply must recheck live preconditions against the current resource state. |
| Compression | Compress transport frames for JSON, SQL batches, manifests, and text files. Skip already-compressed file types and keep the canonical hash over the uncompressed resource value. | Content encoding is transport metadata. It must not change the hash used for conflict detection or compare-and-swap. |
| Parallelism limits | Run independent hash, index, file chunk, and database batch work concurrently within per-site and per-kind budgets. | Atomic groups define dependency barriers. Parallel work can stage data, but cannot publish outside the group's commit boundary. |
| Backpressure | Use bounded producer queues for hashing, chunk upload, and database batching. Pause earlier stages when upload acks, journal fsyncs, memory, disk, or remote latency exceed budget. | A paused or failed sender must have enough durable state to resume or abort without guessing which bytes or rows reached the remote. |

The safe version of a fast path is usually a "skip duplicate staging work" or
"stage earlier" optimization, not a "commit earlier" optimization. The commit
point is where no-data-loss guarantees are easiest to lose, so it stays narrow,
preconditioned, idempotent, and journaled.

Before a speedup moves from proposal to implementation, write down the proof
obligation in the benchmark model:

- What work gets faster, such as hashing, body transfer, round trips, lock
  time, or idle time.
- What shortcut is allowed and what exact evidence authorizes the shortcut.
- Which live precondition still guards the eventual storage-boundary write.
- Which visibility boundary remains unchanged.
- Which durable receipt, journal record, or cursor lets recovery classify a
  crash, retry, lost response, or pressure pause.
- Which unsafe variant is explicitly rejected if the proposal would otherwise
  be tempting under load.

The benchmark model records those fields in `safeFastPaths`. A proposed
optimization is incomplete if it can show lower request counts but cannot name
its unchanged visibility boundary and failure evidence.

## File Hashing

Use a two-level model:

1. A resource hash covers the canonical file value used by the planner and
   apply precondition.
2. Chunk hashes cover upload parts and resumability.

For large files, the local side can cache chunk hashes and a Merkle-style root
or full-file digest. The remote can return an index entry with size and strong
hash to avoid downloading the remote body during planning. That still does not
authorize apply. The finalize request must say, in effect: publish this staged
file only if `file:path` still has `remoteBeforeHash`.

Reject mtime-only, size-only, or path-only equality. They are useful cache
lookups, not data-loss guards.

## Chunk Upload

Chunk upload should be staged under a tuple like:

```text
plan id + resource key + local hash + chunk index + chunk digest
```

This makes chunk PUT retries idempotent and lets a resumed client ask which
chunks are already present. The live file path changes only at finalize time.
If the resource is part of a plugin install or another atomic group, finalize
publishes into group staging and the group commit publishes all files, rows,
plugin metadata, and activation state together.

Useful defaults for the first production prototype:

- 4 MiB to 16 MiB chunks.
- 2 to 4 concurrent uploads per remote site.
- A maximum in-flight byte budget, not just a request count.
- A chunk journal that is fsynced or remote-acknowledged before more chunks are
  considered complete.

Resume is also a fast path, but only from receipts. A resumed sender may skip a
chunk PUT when staging already has a receipt for the same plan id, resource key,
local resource hash, chunk index, byte range, and chunk digest. Missing or
unreadable receipts make the chunk incomplete, even if the staging object looks
present. That rule keeps retry behavior monotonic: the sender can resend a
chunk, pause, or block, but it does not have to infer whether unacknowledged
bytes reached the remote.

## Database Row Batching

Batch rows for throughput, but keep conflict semantics per row. A safe batch
has:

- Table name and stable ordered primary keys.
- Operation shape, such as insert, update, or delete.
- One expected remote hash per row.
- One idempotency key for the batch.
- A transaction boundary or recovery record that proves whether the batch
  committed.

For normal independent rows, each batch can be an atomic unit. For plugin
installs, plugin upgrades, and other coupled changes, row batches are only
staging operations. The atomic group commit is the visibility boundary.

Reject blind `REPLACE INTO`, unordered SQL replay, and batches that use one
table-level timestamp as a substitute for per-row preconditions.

Do not merge rows from different plugin owners or atomic groups into the same
visibility batch just because their SQL shape matches. The executor can share a
prepared statement shape and still issue separate group-scoped batches. That
keeps recovery records tied to the rows that may become visible together.

## Remote Indexes

Remote indexes should make planning cheaper by listing resource metadata and
strong hashes without body transfer. A useful index entry has:

- Resource key and type.
- Strong hash over the canonical resource value.
- Size or row byte estimate.
- Remote generation or scanner cursor.
- Plugin owner when known.
- Deleted/tombstone state.

Indexes can be stale, incomplete, or invalidated by a live edit. Treat them as
planning evidence. The apply phase still reads the current remote hash or uses a
server-side compare-and-swap predicate before mutation.

An index generation or scanner cursor is useful for cache invalidation and
incremental planning, not authorization. A good client records the cursor next to
the plan so it can explain which listing was used, then discards that evidence
as soon as apply needs a live precondition check.

## Compression

Compression belongs to the transport layer. Hashing and conflict detection
should use canonical uncompressed values. Good candidates are JSON manifests,
row batches, text assets, and SQL-like payloads. Poor candidates are zip files,
images, video, gzip streams, and already-compressed plugin packages.

The receiver should record both the canonical digest and the encoded payload
digest. The canonical digest protects correctness; the encoded digest protects
wire/storage integrity.

## Parallelism And Backpressure

Parallelism should improve utilization without hiding failure order. Suggested
initial limits:

| Lane | Starting limit | Notes |
| --- | ---: | --- |
| Remote index scans | 1 per site | Keep cursor semantics simple. |
| Local file hashing | 2 workers | Usually CPU and disk bound. |
| Chunk uploads | 2 to 4 requests | Also capped by in-flight bytes. |
| Database batches | 1 to 2 per table | Avoid lock storms on busy sites. |
| Atomic group commits | 1 per site | Preserve a simple recovery story. |

Backpressure should be driven by concrete budgets: in-flight bytes, queued row
count, remote error rate, latency, staging disk usage, and journal lag. When a
budget is hit, upstream producers pause. They do not drop evidence, skip hashes,
or mark work complete before durable acknowledgement.

The important fast path is selective idling. Hashing can pause while uploads
drain, database batch construction can pause while row commits catch up, and
compression can stop feeding the upload queue while staging disk is high. Work
already acknowledged stays resumable through chunk receipts, row batch commit
records, and atomic group staging records.

Atomic group commits are a global barrier per site. Hashing, chunk upload,
compression, index scanning, and row staging may run ahead of the barrier, but
the group commit must wait for complete member receipts, live precondition
rechecks, dependency validators, plugin metadata validators, activation
validators, and the final durable commit record.

## Fast Paths To Reject

- Publishing chunks directly into the live file path.
- Skipping apply preconditions because the dry-run plan was just generated.
- Treating a remote index generation as permission to mutate.
- Using mtime, size, row count, or table checksum instead of strong resource
  hashes for conflict checks.
- Splitting a plugin install so files publish before database rows, dependency
  checks, plugin metadata, and activation state are ready.
- Activating or upgrading a plugin before validators and dependency
  preconditions pass.
- Replaying SQL dumps or bulk `REPLACE` statements without row-level
  compare-and-swap predicates.
- Retrying non-idempotent mutations without a plan id, resource key, and batch
  idempotency key.
- Compressing payloads and then comparing compressed bytes as the canonical
  resource hash.
- Raising concurrency without an in-flight byte budget and durable progress
  journal.
- Reporting success when staged bytes, staged rows, or an atomic group commit
  are still unacknowledged.
- Skipping plugin dependency, metadata, or activation validators because a
  package hash was cached.
- Treating a present staging object as a completed chunk without a matching
  durable receipt.
- Merging database rows from different plugin owners or atomic groups into one
  commit-visible batch.
- Treating a remote index cursor, generation, or ETag as a lock that can cover
  later apply writes.
- Committing an atomic group when any staged file, row batch, plugin metadata
  entry, dependency check, or activation validator lacks a matching receipt.
- Letting backpressure drop queued precondition evidence or compress buffered
  state into a summary that cannot identify the affected resources after a
  crash.

## Benchmark Shape

Benchmarks need to model the expensive paths that can break safety, not only
tiny row updates:

- A multi-hundred-MiB or larger upload with chunk hashing, resumable staging,
  bounded parallel upload, compression skip, and final compare-and-swap publish.
- A plugin install with many files, plugin metadata, dependency checks,
  thousands of database rows, row batching, and one atomic visibility boundary.
- A mixed remote-index planning pass that avoids body fetches but still
  revalidates preconditions during apply.
- Backpressure scenarios where the remote slows down, staging disk fills, or
  journal fsync falls behind.
- Failure injection before and after every durable boundary: chunk ack, batch
  commit, group staging finalize, and atomic group commit.

The deterministic model in `scripts/bench/performance-model.js` captures these
benchmark shapes without touching a live site. It should stay aligned with the
planner invariants: speedups can reduce bytes, round trips, and duplicate work,
but cannot remove preconditions or split atomic groups.

The model intentionally treats receipts, cursors, and pressure budgets as
first-class fields. A benchmark that only proves fewer requests were made is not
enough; it must also prove which chunks, row batches, and group members can be
resumed after a failure.

`scripts/bench/guarded-executor-benchmark.js` moves one step past the static
model. It generates real file chunk buffers, writes them into benchmark staging,
fsyncs one durable chunk receipt per chunk through the recovery journal, builds a
planner/apply workload with row payload objects, and applies that workload
through the existing live-precondition `applyPlan` model. The workload includes:

- A large upload resource whose live file value is only changed after staged
  chunk receipts exist.
- A required `install-commerce-stack` atomic group with a plugin file, plugin
  metadata, dependency evidence for an existing `payments` plugin, and
  plugin-owned `wp_postmeta` row payloads. Those rows point only at stable
  `wp_posts` identities that are present and unchanged in base and live remote;
  the benchmark does not exercise identity remapping or stale graph references.
- A success path with restart-inspectable `fully-updated-remote` journal
  evidence.
- A pre-commit failure probe that leaves the remote unchanged and inspects as
  `old-remote`.
- A partial commit probe that mutates with `mutateRemote: true` and must inspect
  as `blocked-recovery`, not success.

The quick check is:

```sh
node scripts/bench/guarded-executor-benchmark.js --profile=ci
```

For a larger lab run:

```sh
node scripts/bench/guarded-executor-benchmark.js --profile=guardedLarge
```

The report's `throughput.productionThroughput` field is always `not-claimed`
unless the production claim gate passes. The current gate blocks with:

- `production-atomic-group-commit-not-measured`: the existing apply model can
  stage and classify failures, but it has not measured a production storage
  atomic commit where all group members cross visibility together.
- `production-storage-receipts-not-measured`: chunk receipts are fsynced lab
  journal records, not receipts from the production remote storage layer.
- `production-row-batch-executor-not-measured`: row payloads move through
  guarded per-row apply, but there is no measured production batch
  compare-and-swap executor yet.

That means the measured evidence is useful for guarded-executor cost and safety
shape, not production throughput. It also remains deliberately narrow on
WordPress graph identity: the report records stable post targets under
`evidence.wordpressGraphIdentity`, and the production claim gate fails closed if
those stable-reference checks are missing or false. The next proof needed is a
production-shaped executor that returns storage-backed receipts for chunk
staging, commits plugin-owned row batches with per-row hashes inside a bounded
batch primitive, and exposes one atomic group commit record that recovery can
inspect after a lost response or process failure.

The model exposes three contract lists that tests should keep current:

- `safeFastPaths` records each safe proposal's benefit, allowed shortcut,
  guardrails, visibility boundary, and failure evidence.
- `safeSpeedupAreas` covers file hashing, chunk upload, database row batching,
  remote indexes, compression, parallelism limits, and backpressure.
- `rejectedFastPaths` records proposals that are not allowed because they
  bypass preconditions, split atomic groups, publish staged data early, confuse
  canonical hashes with transport encoding, or lose durable progress evidence.
- `failureInjectionBoundaries` names the durable transitions that benchmarks
  must exercise: chunk ack, database batch commit, group staging finalize, and
  atomic group commit.
