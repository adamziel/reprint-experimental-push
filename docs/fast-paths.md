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

The benchmark model encodes the same gates in `fastPathGates`. Each
`safeFastPaths` entry must carry a concrete proof for all four gates, even when
the proof is that a gate is not doing mutation work, such as remote indexes or
backpressure pauses. The executable fixture in `test/performance-model.test.js`
also proves that the recovery path keeps bounded chunk-window sizing, row-batch
parallelism, and atomic-group commit evidence visible together with the cursor,
compression, memory ceiling, and pause records. It also forces the model to
cover the full speedup surface for file hashing, chunk upload, database row
batching, remote indexes, compression, parallelism limits, memory ceilings,
and backpressure. Each rejected entry names the first gate it breaks through
`rejectedGate`; `violates` records the broader contract breaks that make the
proposal unsafe. That keeps "fast but ambiguous after failure" proposals out of
the safe list even when they improve a throughput metric.

Current executable gate:

- `timeout 40s node scripts/bench/guarded-executor-benchmark.js --profile=ci`
- Current result: `productionThroughput.status === "blocked"`
- Fast-path mode remains disabled for production claims until the reliable and
  recovery lanes provide storage receipts, atomic-group commit evidence, and
  row-batch executor evidence.
- The benchmark report now also exposes `claims.productionThroughputDetails`
  so blocked proof runs carry the current throughput, executor capabilities,
  resource ceiling, recovery status, atomic-group context, chunk resume cursor,
  and blocker list without depending on the thrown error.
- The same details now expose receipt-cursor headroom against the measured
  memory ceiling so a cursor-sized resume proof stays fail-closed instead of
  inferring safety from the raw cursor alone.
- The production-throughput gate also fails closed if the recorded receipt
  cursor no longer fits the bounded queue budget, so the backpressure evidence
  stays aligned with the replayable cursor state.
- The production-throughput gate also fails closed if the queue never paused
  before overflow, so a runaway sender cannot masquerade as bounded
  backpressure evidence.
- The production-throughput gate also fails closed if queue slack appears
  without a queue pause, so an orphaned slack record cannot masquerade as a
  bounded backpressure proof.
- The production-throughput gate also fails closed if the measured-and-aligned
  queue-slack proof bit is missing, so a paused record cannot look complete
  when the backpressure alignment proof itself is absent.
- The production-throughput gate also fails closed if a paused queue reports
  zero or negative headroom, so a stalled sender cannot masquerade as bounded
  backpressure evidence.
- The production-throughput gate also fails closed if a paused sender never
  measured receipt-cursor queue slack, so the pause evidence cannot stand in
  for the companion slack measurement.
- The production-throughput gate also fails closed if the explicit measured
  receipt-cursor queue-slack proof bit is missing, so a paused record cannot
  look complete when the slack measurement proof itself is absent.
- The production-throughput gate also fails closed if the explicit measured
  receipt-cursor backpressure bit is missing, so a paused record cannot look
  complete when the backpressure measurement itself is absent.
- The production-throughput gate also fails closed if a paused sender reports
  queue slack that does not match the resource headroom and queue headroom
  records, so a partial pause record cannot masquerade as bounded backpressure
  evidence.
- The production-throughput gate also exposes whether a paused sender's queue
  slack is both measured and aligned, so a tampered pause record cannot look
  complete when the slack values disagree.
- The production-throughput gate also fails closed if the explicit measured-
  and-aligned queue-slack bit is missing, so a paused record cannot look
  complete when the alignment proof itself is absent.
- The production-throughput gate also fails closed if the explicit measured-
  and-aligned backpressure bit is missing, so a paused record cannot look
  complete when the backpressure proof itself is absent.
- The production-throughput gate also fails closed if the explicit
  backpressure-aligned queue-slack bit is missing, so a paused record cannot
  look complete when the slack alignment proof itself is absent.
- The production-throughput gate also fails closed if the explicit measured
  queue-headroom bit is missing, so a paused queue cannot look complete when
  the headroom measurement itself is absent.
- The production-throughput gate also fails closed if paused queue slack no
  longer fits the measured resource headroom, so a slack record cannot be
  reused when the resource ceiling and chunk window no longer match.
- The production-throughput gate also fails closed if paused queue slack no
  longer aligns with the recorded backpressure bytes, so a tampered pause
  record cannot mix a valid-looking slack value with a mismatched cursor.
- The production-throughput gate also fails closed if paused queue slack no
  longer fits inside the measured memory ceiling, so a tampered pause record
  cannot reuse an impossible slack value.
- The production-throughput gate also fails closed if receipt-cursor queue
  slack appears without a queue pause, so orphaned slack evidence cannot stand
  in for bounded backpressure.
- The production-throughput gate also fails closed if the success journal no
  longer keeps receipt flushes grouped by kind, so journal lag savings cannot
  hide interleaved recovery evidence.
- The production-throughput gate also fails closed if the success receipt-kind
  ledger no longer matches the recorded success count, so a truncated journal
  summary cannot masquerade as complete recovery evidence.
- The report now also fails closed if receipt-cursor queue slack is missing on
  any path, so the benchmark cannot quietly accept an under-instrumented
  backpressure record.
- The report now also cross-checks receipt-cursor memory headroom against queue
  headroom so a tampered buffer budget cannot make the production claim look
  consistent when the recorded cursor and queue view disagree.
- The report now also exposes whether the receipt-cursor headroom and queue
  headroom match, so the bounded backpressure proof can be audited directly
  without changing the claim gate.
- The report now also exposes whether receipt-cursor headroom is covered by
  the queue budget, so the cursor audit can fail closed even when the exact
  headroom values drift apart.
- The report now also fails closed if queue slack and memory headroom disagree,
  so a tampered slack record cannot make the backpressure summary look stable.
- The report now also fails closed if queue slack and queue headroom disagree,
  so a tampered queue view cannot make the backpressure summary look stable.
- The report now also fails closed if queue slack is measured as zero or
  negative, so a degenerate paused queue cannot masquerade as supported
  headroom.
- The detail surface now also treats zero-slack pauses as unproven queue
  slack, so the audit view stays aligned with the blocker.
- The report now also fails closed when the recorded receipt-cursor
  backpressure exceeds the queue budget, so a tampered backpressure record
  cannot hide behind a still-valid headroom calculation.
- The report now also exposes whether the pause state had measured
  receipt-cursor backpressure, so a paused sender cannot masquerade as bounded
  evidence without an actual measurement.
- The report now also fails closed if a paused queue does not explicitly prove
  measured receipt-cursor queue slack, so a partial pause summary cannot stand
  in for the aligned backpressure evidence.
- The report now also blocks when receipt-cursor headroom no longer fits inside
  the queue budget, so the claim gate fails closed on a budget drift instead of
  relying only on a derived detail.
- The report now also exposes whether the receipt-cursor backpressure bytes
  stay within the remaining queue headroom, so a tampered cursor cannot look
  safe just because the queue budget still exists.
- The report now also exposes a `backpressureConsistency` summary for queue
  budget, receipt cursor, and headroom alignment so tampering shows up as a
  named evidence mismatch rather than a silent detail drift.
- The report now also exposes whether receipt-cursor queue slack stays within
  the measured resource headroom, so the bounded pause proof can be audited
  without recomputing the slack bound from separate fields.
- The report now also allows a durable receipt cursor to size the next journal
  batch after a pause, but only as planning evidence. The pause boundary, raw
  receipt order, and journal records still decide whether recovery can resume
  without ambiguity.
- The same summary now also cross-checks queue headroom against the measured
  resource ceiling, so a forged queue budget cannot leave the backpressure
  proof looking internally consistent.
- The report now also rejects a backpressure budget that does not match the
  measured resource ceiling, so a copied budget cannot make the proof look
  stronger than the actual ceiling.
- The report now also exposes whether the receipt cursor's memory headroom
  matches the measured resource ceiling, so the cursor audit can be read
  directly without recomputing that relationship from separate fields.
- The report now also exposes an explicit memory-ceiling-versus-queue-budget
  proof bit for paused backpressure, so the paused-queue proof does not rely
  only on a derived detail.
- The report `results` payload also carries explicit failure-probe details for
  the pre-commit and partial-commit probes, including inspection status,
  journal path, remote-unchanged classification, and journal record types so a
  stalled wrapper does not erase the concrete failure evidence.
- The release gate does not move on lab throughput alone; the fast-path claim
  stays off until those release receipts exist and can be replayed.
- Latest measured lab throughput:
  - `labStagedMiBPerSecond: 59.54`
  - `labApplyMutationsPerSecond: 62.29`
- Current blockers:
  - `production-atomic-group-commit-not-measured`
  - `production-storage-receipts-not-measured`
  - `production-row-batch-executor-not-measured`
- Status meaning: the lane still has no production proof for atomic-group commit,
  storage receipts, or row-batch executor behavior, so the release gate stays
  closed.

## Safe Speedups

| Area | Safe fast path | Required guardrail |
| --- | --- | --- |
| File hashing | Cache strong file hashes behind a local fingerprint such as size, mtime, inode, mode, and the previous digest. Stream only uncached or fingerprint-changed files, and keep per-chunk hashes for large files so resume can skip work safely. | Size, mtime, or inode can only skip a rehash when they match a cached strong digest. The apply precondition remains the live remote resource hash. |
| File hashing | Reuse a remote-index cursor to avoid rescanning unchanged files while planning the next strong hash set. | The cursor is planning evidence only. The eventual publish still revalidates the live remote resource hash before any file becomes visible. |
| File hashing | Reuse plan-scoped chunk digests for large-file resume so the sender can skip recomputing chunk hashes that already have durable receipts. | Cached chunk digests are only resume evidence. They do not replace the live publish compare or the guarded file-publish record. |
| File hashing | Reuse a cached chunk ledger for large-file resume so duplicate chunk hashing can be skipped when the ledger matches the plan-scoped receipt set. | The chunk ledger only trims duplicate hashing. The live publish compare and guarded publish record still decide visibility. |
| File hashing | Hash large files in bounded parallel chunks within the plan-scoped budget so retries can reuse durable chunk receipts without rehashing the whole body. | Chunk hashing may overlap, but each chunk still needs a durable receipt and the guarded publish compare still decides visibility. |
| Chunk upload | Upload large file bodies to plan-scoped staging objects in digest-addressed chunks, then assemble or publish the file with one compare-and-swap finalize step. | Chunk writes must not mutate the live path. Each chunk needs a checksum, idempotency key, and durable journal entry before the sender advances. |
| Chunk upload | Pipeline independent chunk sends within a plan-scoped byte and receipt budget so retry-only chunks can overlap while final visibility stays on the same guarded publish step. | Pipelining may overlap chunk sends, but it cannot widen the visibility boundary or skip the complete durable receipt set required by finalize. |
| Chunk upload | Reuse a remote-index cursor to size bounded chunk windows for large-upload resume so the sender can skip rescanning unchanged planning data. | The cursor is planning evidence only. Chunk windows stay within byte and receipt budgets, and live publish preconditions still decide visibility. |
| Chunk upload | Reuse a plan-scoped chunk receipt set to resume bounded window sizing for large uploads so already-acknowledged chunks do not get rescanned. | The receipt set is durable resume evidence only. Window sizing still stays inside byte and receipt budgets, and the live publish compare still decides visibility. |
| Chunk upload | Compress remote-index listings and reuse the planning cursor to size bounded large-upload windows so resume scans move fewer bytes before the guarded publish step. | Compression stays transport-only. The compressed listing and cursor cannot authorize publish, widen the queue, or replace the durable chunk receipt set. |
| Chunk upload | Compress chunk transit frames while keeping canonical chunk digests and plan-scoped receipts so large uploads move fewer bytes without changing the guarded publish step. | Transport compression stays advisory. Canonical chunk digests, chunk receipts, and the live publish compare still decide visibility. |
| Database row batching | Group row mutations by table and operation shape, then execute bounded batches in stable primary-key order with one precondition per row. | Every row in the batch still needs its expected remote hash, and the batch must commit atomically or be replayable with the same idempotency key. |
| Database row batching | Reuse one prepared statement per table and batch shape inside a single atomic group so large plugin installs and updates avoid repeated parse and bind work. | Prepared statements only remove duplicate SQL setup. Each row still needs its live compare, the batch still needs durable receipts, and the atomic-group barrier stays fixed. |
| Database row batching | Run bounded row-batch parallelism within one atomic group and per-table concurrency budget so large plugin installs and updates can overlap independent batches without widening visibility. | Parallel batches still need their own row preconditions, batch receipts, and group-staging record. The atomic-group barrier stays fixed. |
| Database row batching | Reuse a recorded dependency graph and remote index cursor to pre-size bounded plugin-update batches so rescans do not repeat unchanged dependency shape. | The dependency graph is planning evidence only. It cannot skip row preconditions, widen the batch past its row budget, or move the atomic-group barrier. |
| Database row batching | Compress remote-index listings and reuse the cursor to pre-size bounded plugin-update batches so rescans move fewer bytes before the live compare. | Compression is transport-only. The compressed listing still cannot skip row preconditions, batch receipts, or the atomic-group barrier. |
| Database row batching | Reuse a remote-index cursor and dependency graph to pre-size bounded plugin-install batches so rescans do not repeat unchanged dependency shape. | The index cursor is planning evidence only. It cannot skip row preconditions, widen the batch past its row budget, or move the atomic-group barrier. |
| Database row batching | Compress remote-index listings and reuse the cursor to pre-size bounded plugin-install batches so rescans move fewer bytes before the live compare. | Compression is transport-only. The compressed listing still cannot skip row preconditions, batch receipts, or the atomic-group barrier. |
| Remote indexes | Ask the remote for an indexed resource listing with keys, type, size, generation, tombstone state, strong hash, and owner so planning can avoid fetching unchanged resources. | The index speeds up planning only. Apply must recheck live preconditions against the current resource state. |
| Remote indexes | Compress index responses and cache the planning cursor so repeated scans move fewer bytes without changing planning semantics. | Compression stays transport-only, and a compressed index response still cannot authorize apply or widen the atomic-group barrier. |
| Remote indexes | Reuse a recorded planning cursor with a strong-hash listing to avoid rescanning unchanged resources during incremental planning. | The cursor is planning evidence only. It does not become an apply lock, and the live compare still guards mutation. |
| Remote indexes | Reuse a planned dependency graph for dependency-heavy plugin updates so repeated planning avoids recomputing stable dependency shape before the live finalize step. | The dependency graph is planning evidence only. It cannot skip live per-row compares or the atomic-group commit barrier. |
| Remote indexes | Parallelize independent owner-partition index scans within the per-site budget so large uploads and plugin changes can plan different owners at once without widening any live boundary. | The scans only produce planning evidence. Each later write still rechecks its own live precondition, and no atomic group becomes visible early. |
| Remote indexes | Parallelize independent owner-partition index scans to size bounded batches within per-site concurrency budgets. | Batch sizing stays planning-only. The later write still rechecks each live precondition, and the atomic-group barrier does not move. |
| Compression | Compress transport frames for JSON, SQL batches, manifests, and text files. Skip already-compressed file types and keep the canonical hash over the uncompressed resource value. | Content encoding is transport metadata. It must not change the hash used for conflict detection or compare-and-swap. |
| Compression | Compress durable receipt logs after they have been recorded so large-upload and plugin-recovery evidence uses fewer bytes without changing receipt keys. | Receipt compression is storage-only. It does not replace the original durable receipt keys, the live precondition, or the commit boundary. |
| Parallelism limits | Run independent hash, index, file chunk, and database batch work concurrently within per-site and per-kind budgets. | Atomic groups define dependency barriers. Parallel work can stage data, but cannot publish outside the group's commit boundary. |
| Parallelism limits | Run mixed release-bundle work, including large uploads and dependency-heavy plugin changes, within the same bounded per-site budgets so shared planning does not widen the recovery boundary. | The mixed bundle still needs its own receipts, live preconditions, and atomic-group barrier. Parallelism may overlap staging, but it cannot claim visibility early. |
| Parallelism limits | Keep mixed release-bundle fanout within per-kind budgets so upload, hash, and row work can overlap without widening the bundle boundary. | The fanout remains staging-only. Each mutating file or row still rechecks its live precondition, and the bundle staging record still classifies recovery. |
| Parallelism limits | Partition owner-scoped index scans and bounded hash planning within per-site budgets so independent planning can overlap before the live compare. | Partitioned planning stays advisory, each later mutation still rechecks its live resource precondition, and the atomic-group barrier does not move. |
| Backpressure | Use bounded producer queues for hashing, chunk upload, and database batching. Pause earlier stages when upload acks, journal fsyncs, memory, disk, or remote latency exceed budget. | A paused or failed sender must have enough durable state to resume or abort without guessing which bytes or rows reached the remote. |
| Backpressure | Pause upstream producers when staging-disk headroom falls below the plan reserve so the sender avoids overflow thrash and failed spill writes. | The reserve is plan-scoped and bounded. It can stop new staging early, but it cannot change live compares or widen an atomic-group boundary. |
| Backpressure | Compress planning evidence and then pause producers within the same bounded queue and journal budget. | Compression may shrink the planning trail, but it cannot authorize apply or finalize, and durable receipts still decide recovery. |
| Backpressure | Compress planning evidence and batch already-produced raw receipts within the journal lag budget so replay moves fewer bytes without changing the raw receipt set. | Planning compression stays transport-only. Raw receipt order and keys still decide replay, and the live precondition and atomic-group barrier stay fixed. |
| Backpressure | Compress durable receipt logs after they have been recorded, then reuse the original receipt keys for bounded replay. | Receipt compression is recovery-only. It cannot authorize apply, widen the queue, or replace the live precondition or atomic-group barrier. |
| Backpressure | Batch durable chunk, row, or group receipt flushes within a bounded journal lag so fsync work amortizes without changing the raw receipt set. | Batching may delay flushes, but it cannot drop raw receipts, cross an atomic-group boundary, or claim completion before durable evidence exists. |
| Backpressure | Batch chunk, row, or group receipts by kind within the journal budget while preserving raw key order. | Kind-scoped batching only reduces flush overhead. It cannot change the live precondition, merge owners, or reorder replay evidence. |
| Backpressure | Flush upload and row receipts in separate kind-scoped journal batches so journal work amortizes without changing the raw receipt set. | Kind-scoped flushing only changes journal timing. It cannot cross an atomic-group boundary or replace the live precondition. |
| Backpressure | Keep kind-scoped receipt ledgers within the memory ceiling so retry and replay can reuse ordered raw keys without rereading the whole journal trail. | The bounded ledger is recovery evidence only. It cannot authorize apply, merge owners, or change the live precondition. |
| Backpressure | Summarize the receipt ledger by kind so the replay cursor can be audited against the same journal boundary without changing the raw receipt order. | The summary is audit evidence only. It cannot replace the raw receipt keys, the live precondition, or the atomic-group barrier. |

Concrete failure modes stay rejected even when the throughput gain looks tempting:

- A chunk upload that looks complete in staging but lacks a durable receipt is not complete.
- A matching chunk digest still cannot stand in for the missing durable receipt during resume.
- A plugin install that has finished file staging but not validator, metadata, and row receipts is still not visible.
- A compressed payload can reduce wire bytes, but it cannot stand in for the canonical uncompressed hash.
- A remote index cursor can guide planning, but it cannot authorize a live write.
- A compressed remote index response can reduce planning traffic, but it still cannot authorize a live write.
- A cached file hash can skip duplicate hashing, but it cannot replace the live publish compare.
- A chunk upload can overlap or compress transit, but it cannot make staged bytes visible before the guarded finalize step.
- A database batch can reuse statement shapes, but it cannot cross atomic-group boundaries or skip row preconditions.
- A remote index can compress planning traffic, but it cannot become a lock or a live mutation authorization.
- A compressed remote index plus parallel owner scans still cannot skip the live write check, because planning concurrency does not replace the storage-boundary compare.
- A compressed remote index plus parallel row batches still cannot skip the plugin-update commit barrier, because extra fan-out does not prove the live compares or atomic-group record survived failure.
- Compression can reduce wire bytes and receipt-log size, but it cannot change the canonical hash or recover missing receipts.
- Parallelism can overlap independent staging, but it cannot widen a commit barrier or merge group finalization.
- Extra parallelism is only safe while it preserves the same preconditions, receipts, and atomic barrier.
- Backpressure must pause producers; it cannot claim success by draining evidence into memory.
- A backpressure pause cannot mean completion, because the paused work still needs chunk receipts, row receipts, and the atomic-group commit record to survive failure.
- A compressed planning trail cannot mean completion, because it still cannot authorize apply or cross an atomic-group barrier.
- Compressing buffered evidence can save memory, but it cannot stand in for a receipt or commit record.
- A compressed queue that has drained is still not proof that the remote acknowledged every staged chunk or row.
- A compressed receipt log can reduce storage, but it still cannot stand in for the original receipt keys or the guarded recovery record.
- A compressed durable receipt log still cannot authorize apply after a crash, because receipt compression does not prove the live compare or the atomic-group barrier survived failure.
- A compressed receipt summary can reduce journal bytes, but it still cannot replace the raw receipt keys needed to classify a crash, retry, or pause.
- A compressed receipt log still cannot skip replaying paused upload recovery, because smaller journal bytes do not prove which acknowledgements survived the pause or restore the guarded publish record.
- Batching receipt flushes can reduce fsync cost, but it still cannot prove which chunk acknowledgements survived a pause or restore the guarded publish barrier.
- A remote index cursor plus a cached dependency graph can pre-size plugin-install batches, but it still cannot skip the live row compares or the atomic-group commit barrier.
- Batched receipt flushes can reduce fsync overhead, but they still cannot prove plugin-update activation or any other atomic-group commit survived failure.
- Cached row receipts still cannot skip a plugin-update barrier while parallel batches are in flight, because planning evidence and receipt reuse cannot prove the live row compares, dependency checks, or atomic-group barrier survived failure.
- A compressed remote index plus a cached file hash still cannot skip the guarded publish step for a large upload, because planning evidence and cached hashes do not prove chunk receipts or the live compare survived failure.
- A compressed remote index plus a cached file digest still cannot skip the guarded publish step for a large upload, because planning evidence and cached digests do not prove chunk acknowledgements, the live compare, or the guarded publish record survived failure.
- A compressed remote index plus a cached file hash still cannot skip large-upload resume after a pause, because planning evidence and cached hashes do not prove which chunk acknowledgements survived the pause or restore the guarded publish barrier.
- A compressed remote index plus a cached file hash still cannot skip chunk-window sizing for a large upload, because planning evidence and cached hashes do not prove the live compare, chunk receipts, or the guarded publish barrier survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload window sizing after a pause and backpressure event, because planning evidence and cached receipts do not prove the next bounded window still matches the live queue order or restore the guarded publish barrier after interruption.
- A compressed remote index plus a cached file hash still cannot skip large-upload backpressure, because planning evidence and cached hashes do not prove the bounded queue order or journal evidence needed after a pause or crash.
- A compressed remote index plus a cached file hash still cannot skip large-upload chunk-upload backpressure after a pause, because planning evidence and cached hashes do not prove the bounded queue order, chunk acknowledgements, or guarded publish barrier survived the pause.
- A compressed remote index plus a cached file fingerprint still cannot skip large-upload publish after a pause and backpressure event, because planning evidence and cached fingerprints do not prove the chunk acknowledgements, live compare, or guarded publish barrier survived failure.
- A compressed remote index plus a cached chunk ledger still cannot skip large-upload backpressure, because planning evidence and cached ledgers do not prove which chunk acknowledgements survived the pause or restore the guarded publish barrier.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload chunk-send backpressure, because cached receipts do not prove bounded fanout, complete receipt order, or durable journal evidence across a pause or crash.
- A compressed remote index plus unbounded database-row parallelism still cannot skip a plugin-update barrier, because planning evidence does not preserve row preconditions, atomic-group order, or the backpressure evidence needed to recover partial failure.
- A compressed remote index plus unbounded row-batch parallelism still cannot skip plugin-update recovery, because planning evidence and row fanout do not preserve row preconditions, atomic-group order, or the backpressure evidence needed after failure.
- A compressed remote index plus parallel row batches still cannot skip plugin-update backpressure after a pause, because planning evidence and fanout cannot prove the paused row receipts, idempotency keys, or atomic-group commit record survived failure.
- A compressed remote index plus parallel row batches still cannot skip plugin-install backpressure after a pause, because planning evidence and fanout cannot prove the paused install rows, queue order, or atomic-group evidence survived the interruption.
- A compressed remote index plus cached row batch receipts still cannot skip the plugin-update commit barrier after a pause, because planning evidence and cached receipts do not prove the paused group still has its live compares, staged metadata writes, or atomic-group commit record intact.
- A cached dependency graph plus a remote index cursor still cannot skip plugin-update row-batch revalidation after a pause, because planning evidence does not prove the live row compares, batch receipts, or atomic-group barrier survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-update row-batch recovery after a pause, because planning evidence and cached receipts do not prove the live row compares, batch ordering, or atomic-group barrier survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-update row preconditions after a pause, because planning evidence and cached receipts do not prove the live row compares, dependency checks, or atomic-group barrier survived the interruption.
- A compressed remote index plus cached chunk receipts still cannot skip backpressure before large-upload publish, because cached receipts do not prove the queue stayed bounded, the chunk acknowledgements survived the pause, or the guarded publish barrier remained intact.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload backpressure after a pause, because cached receipts do not prove the queue stayed bounded, which chunk acknowledgements survived the pause, or that the guarded publish barrier remained intact.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload backpressure after a pause, because cached receipts do not prove the paused sender can resume or abort without ambiguity, or that the guarded publish barrier survived failure.
- A compressed remote index plus extra chunk parallelism still cannot skip large-upload backpressure after a pause, because wider fan-out and planning evidence cannot prove the bounded queue order, which acknowledgements survived the pause, or that the guarded publish barrier survived failure.
- Orphaned receipt-cursor slack still cannot prove bounded backpressure, because slack without a real queue pause does not show the sender was actually held below overflow.
- A compressed remote index plus cached file hashes still cannot skip backpressure during chunk hashing, because planning evidence and cached hashes do not prove the bounded queue order or journal evidence needed to recover after pause or crash.
- A cached receipt cursor plus queue headroom still cannot skip the backpressure pause after a retry, because headroom evidence can size the next bounded queue, but it cannot prove the pause happened before overflow or that the journal trail is durable enough to recover without guessing which receipts survived the retry.
- A paused queue still cannot claim bounded backpressure unless the receipt-cursor backpressure was actually measured, because a pause without measured receipt-cursor pressure does not prove the queue stayed within the supported release-candidate envelope.
- A cached receipt cursor plus journal lag still cannot skip the backpressure pause after a retry, because lag evidence can summarize flush timing, but it cannot prove the pause happened before overflow or that raw receipt order survived the retry without guessing which acknowledgements were durable.
- A compressed remote index plus a cached file hash still cannot skip plugin-install finalize after a pause, because planning evidence and cached hashes do not prove the dependency checks, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached file fingerprint still cannot skip plugin-install finalize after a pause, because planning evidence and cached fingerprints do not prove the dependency checks, staged metadata writes, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached file hash still cannot skip plugin-install and large-upload finalize after a pause, because planning evidence and cached hashes do not prove the dependency checks, staged rows, chunk acknowledgements, or the guarded publish and commit records survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin-install finalize after a pause, because planning evidence and cached package hashes do not prove the dependency checks, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin-install finalize after a pause and backpressure event, because planning evidence and cached package hashes do not prove the dependency checks, staged rows, backpressure state, or the atomic-group finalize survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin-install finalize after a pause, because cached row receipts do not prove the staged metadata writes, dependency checks, or atomic-group finalize survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin-install activation after a pause and backpressure event, because planning evidence and cached package hashes do not prove the activation checks, staged metadata writes, backpressure state, or the atomic-group barrier survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-install activation after a pause and backpressure event, because planning evidence and cached structure do not prove the activation change, staged rows, backpressure state, or the atomic-group barrier survived failure.
- A compressed remote index plus a cached file hash still cannot skip plugin-update finalize after a pause, because planning evidence and cached hashes do not prove the live row compares, dependency checks, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached release manifest still cannot skip a release-bundle commit, because planning evidence and cached manifests do not prove the dependent plugin files, row batches, or atomic-group barrier survived failure.
- A compressed remote index plus a cached release manifest and batched receipt flushes still cannot skip a release-bundle commit after a pause, because planning evidence, cached manifests, and fsync savings do not prove the dependent plugin files, row batches, or atomic-group barrier survived failure.
- A compressed remote index plus a cached release manifest still cannot skip release-bundle planning, because a planning cursor does not become apply authorization and cached manifests do not prove the dependent files or rows survived failure.
- A compressed remote index plus batched row receipts still cannot skip a release-bundle commit, because planning evidence and compressed receipts do not prove the dependent plugin files, row batches, or atomic-group barrier survived failure.
- A compressed remote index plus batched receipt flushes still cannot skip a release-bundle commit after a pause, because fsync savings do not prove the dependent plugin files, row batches, or atomic-group barrier survived failure.
- A compressed remote index plus compressed database batches still cannot skip a release-bundle commit, because planning evidence and batch compression do not prove the dependent plugin files, database row batches, or atomic-group barrier survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip a release-bundle commit after a pause, because planning evidence and dependency shape do not prove the mixed upload-and-database bundle, live row preconditions, or atomic-group barrier survived failure.
- A compressed remote index plus batched database row receipts still cannot skip plugin-install row preconditions after a pause, because planning evidence and receipt batching do not prove the live row compares, dependency checks, or the atomic-group barrier survived failure.
- A compressed remote index plus batched receipt flushes still cannot skip plugin-install finalize after a pause, because fsync savings do not prove the dependency checks, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-install finalize after a pause, because planning evidence and dependency shape do not prove the live row compares, staged metadata writes, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-install activation after a pause, because planning evidence and dependency shape do not prove the activation change, staged rows, or the atomic-group barrier survived the pause.
- A compressed remote index plus cached row receipts still cannot skip plugin-install finalize after a pause, because planning evidence and cached receipts do not prove the dependency checks, staged metadata writes, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached termmeta summary still cannot skip plugin-update finalize after a pause, because planning evidence and cached termmeta summaries do not prove the live row compares, dependency checks, or the atomic-group finalize survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip plugin-install finalize after a pause, because cached receipts do not prove the dependency checks, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus cached chunk digests still cannot skip plugin-install finalize after a pause, because cached digests do not prove the dependency checks, chunk receipts, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached chunk ledger still cannot skip the guarded publish step for a large upload, because planning evidence and cached ledgers do not prove which chunk acknowledgements survived failure or that the live compare still holds.
- A compressed remote index plus cached chunk digests still cannot skip large-upload window sizing after a pause, because planning evidence and cached digests do not prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure.
- A large upload cannot publish staged bytes just because compression made the queue smaller, because transport savings do not prove chunk acknowledgements or the guarded publish boundary.
- A batched journal flush can reduce fsync overhead, but it still cannot replace the raw chunk, row, or group receipts needed for recovery.
- A fresh remote index plus a cached plugin package hash still cannot skip dependency checks, metadata writes, or the atomic-group barrier.
- A compressed package cache still cannot skip plugin dependency checks or the atomic-group barrier, because package identity and transport compression do not prove group commit completion.
- A compressed row batch still cannot replace the atomic-group commit barrier, because the coupled files, rows, metadata, and activation state must become visible together.
- Finalizing multiple atomic groups together is still rejected, because one combined finalize hides which group owns a partial crash or retry.
- Backpressure still cannot drop queued receipts, because the missing receipts are what make recovery unambiguous after pause or crash.
- A fresh remote index plus a cached digest still cannot skip per-row preconditions for a database batch.
- A fresh remote index plus a table checksum still cannot skip per-row preconditions or plugin metadata checks.
- A fresh remote index plus a compressed upload queue still cannot prove a plugin update finished, because dependency checks, staged files, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed package cache still cannot skip plugin validators or the atomic-group barrier, because planning evidence and compressed storage do not prove dependency readiness or metadata writes.
- A fresh remote index plus a compressed package cache still cannot skip plugin activation or the atomic-group barrier, because planning evidence and compressed storage do not prove the activation state or group commit completion.
- A fresh remote index plus a compressed package cache still cannot make plugin activation visible early, because the activation state, dependency checks, and atomic-group barrier still need durable evidence.
- A compressed remote index plus parallel row batches still cannot skip plugin update activation, because planning concurrency does not prove the activation change, per-row compares, or the atomic-group barrier survived failure.
- A fresh remote index plus a cached package hash still cannot skip plugin dependency checks, because lookup evidence and cached identity do not prove the dependency checks, metadata writes, or atomic-group commit survived failure.
- A fresh remote index plus a compressed package cache still cannot prove a plugin install finished, because dependency checks, metadata writes, file receipts, and the atomic-group commit still need durable evidence.
- A compressed remote index plus a cached package cache still cannot skip plugin install finalize, because planning evidence and cached package storage do not prove dependency checks, staged files, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached package cache still cannot skip plugin install activation, because planning evidence and cached package storage do not prove dependency checks, staged metadata, or the atomic-group activation barrier survived failure.
- A compressed remote index plus a cached file hash still cannot skip plugin install finalize, because planning evidence and cached hashes do not prove dependency checks, staged metadata, or the atomic-group finalize survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip a plugin install, because planning evidence and staged upload acknowledgements do not prove dependency checks, staged files, or the atomic-group commit survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip plugin install finalize after a pause, because planning evidence and cached dependency shape do not prove the dependency checks, staged rows, or the atomic-group finalize survived the pause.
- A compressed remote index plus a cached file hash still cannot skip a plugin update, because planning compression and cached identity do not prove dependency checks, metadata writes, or the atomic-group commit survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin update writeback, because planning evidence and cached package identity do not prove dependency checks, metadata writes, or the atomic-group writeback survived failure.
- A compressed remote index plus a cached file hash still cannot skip large-upload resume or guarded publish, because planning evidence and cached hashes cannot prove which chunk acknowledgements survived failure.
- A compressed manifest or package summary still cannot prove a plugin install finished, because dependency checks, metadata writes, row receipts, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed row batch still cannot prove a plugin install finished, because per-row preconditions, dependency checks, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed row batch still cannot prove plugin activation finished, because the activation state change, per-row receipts, and atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed row batch still cannot skip per-row preconditions, because planning evidence and batch compression cannot replace the live compare-and-swap predicate on each row.
- Parallel owner-partition index scans still cannot authorize a live write, because planning concurrency does not become a lock on the remote state.
- Unbounded parallel file hashing still cannot skip backpressure, because extra workers do not preserve the bounded queue order or the durable evidence needed after pause or crash.
- A fresh remote index plus a compressed row summary still cannot prove plugin activation finished, because the per-row receipts, activation state change, and atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed row summary still cannot prove plugin install finished, because dependency checks, row receipts, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed row batch still cannot skip backpressure for a plugin update, because queue pressure can pause work without proving the paused rows, validators, or group commit survived failure.
- A fresh remote index plus cached row-batch receipts still cannot prove plugin install finished, because live row preconditions and the atomic-group commit still need durable evidence.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin install activation, because planning evidence and cached batch receipts cannot prove the activation change, dependency checks, or the atomic-group commit survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip plugin install activation, because planning evidence and chunk receipts cannot prove dependency checks, staged metadata, or the atomic-group barrier survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip the final plugin-install activation step, because planning evidence and cached batch receipts cannot prove the activation state, dependency checks, or the atomic-group barrier survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin-install row preconditions, because planning evidence and cached receipts cannot replace the live per-row compares or the atomic-group barrier.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin-install row preconditions, because cached batch receipts do not prove the live row compares or the plugin-specific barrier survived failure.
- A compressed remote index plus unbounded row-batch parallelism still cannot skip plugin install or update barriers, because planning evidence and extra fan-out cannot prove the per-row preconditions, batch receipts, or atomic-group commit survived failure.
- A compressed remote index plus a paused row queue still cannot skip plugin install finalize, because planning evidence and backpressure state cannot prove dependency checks, row preconditions, or the atomic-group finalize survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip plugin install finalize, because planning evidence and chunk acknowledgements cannot prove dependency checks, staged files, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached row summary still cannot skip plugin-update finalize, because planning evidence and summaries cannot prove the live row compares, dependency checks, or the atomic-group finalize survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin update finalize, because planning evidence and cached batch receipts cannot prove dependency checks, per-row preconditions, or the atomic-group finalize survived failure.
- A compressed remote index plus cached database batch receipts still cannot skip plugin update activation, because planning evidence and cached receipts cannot prove the activation change, dependency checks, or the atomic-group barrier survived failure.
- A compressed remote index plus a compressed row batch still cannot skip plugin update finalize, because planning compression and batch compression cannot prove dependency checks, live row compares, or the atomic-group finalize survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-update finalize, because planning evidence and cached row receipts cannot prove the live row compares, dependency checks, or the atomic-group finalize survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin-update commit after a pause, because planning evidence and cached row-batch receipts cannot prove the live dependency checks, per-row compares, or the atomic-group commit barrier survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-update finalize after a pause, because planning evidence and cached row receipts cannot prove the live row compares, dependency checks, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached file fingerprint still cannot skip plugin-update finalize after a pause, because planning evidence and cached fingerprints cannot prove the live row compares, dependency checks, or the atomic-group finalize survived failure.
- A compressed remote index plus cached row receipts still cannot skip the release-bundle commit after a pause, because planning evidence and cached row receipts cannot prove the mixed upload-and-database bundle, live row preconditions, or the atomic-group commit barrier survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip the release-bundle commit after a pause and backpressure event, because planning evidence and cached batch receipts cannot prove the mixed upload-and-database bundle, live row preconditions, backpressure state, or the atomic-group commit barrier survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-update activation, because planning evidence and cached row receipts cannot prove the activation change, dependency checks, or the atomic-group commit survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-install backpressure after a pause, because planning evidence and cached receipts cannot prove the queue order, plugin preconditions, or atomic-group evidence survived the interruption.
- A compressed remote index plus unbounded hash fanout still cannot skip large-upload backpressure, because planning evidence and wider fan-out cannot prove the bounded queue order or journal evidence needed to recover after a pause or crash.
- A compressed remote index plus a cached file hash still cannot skip plugin update activation, because planning evidence and cached hashes do not prove the activation change, live row compares, or the atomic-group commit survived failure.
- A compressed file-hash cache plus a paused upload queue still cannot skip the large-upload publish step, because hash compression and queue pressure do not prove which chunk acknowledgements survived or that the publish barrier is intact.
- A compressed remote index plus a cached file hash still cannot skip plugin-update writeback after a pause, because planning evidence and cached hashes do not prove the live row compares, dependency checks, or the atomic-group writeback barrier survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin update finalize, because planning evidence and cached package identity cannot prove dependency checks, metadata writes, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin update row preconditions, because planning evidence and cached batch receipts cannot prove the live per-row compares, dependency checks, or the atomic-group barrier survived failure.
- A compressed remote index plus cached row receipts still cannot skip plugin-update batch parallelism after a pause, because planning evidence and cached receipts cannot prove the live row compares, queue order, or atomic-group barrier survived failure.
- A fresh remote index plus a cached dependency graph still cannot skip plugin update finalize, because planning evidence can reduce lookup work but cannot prove the live row compares, member metadata writes, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin update finalize, because planning evidence and cached package identity cannot prove dependency checks, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip a plugin update, because planning evidence and chunk acknowledgements do not prove dependency checks, staged rows, or the atomic-group commit survived failure.
- A fresh remote index plus a cached file hash still cannot skip a plugin update, because lookup evidence and cached hashes do not prove dependency checks, staged rows, or the atomic-group commit survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip plugin update writeback, because planning evidence and cached acknowledgements cannot prove the live row compares, staged metadata writes, or the atomic-group barrier survived failure.
- A compressed remote index plus a compressed database batch still cannot skip plugin update writeback, because planning compression and batch compression cannot prove the live row compares, dependency checks, or the atomic-group barrier survived failure.
- A fresh remote index plus compressed row receipts still cannot prove a dependency-heavy plugin update finished, because compressed summaries cannot prove the per-row preconditions, dependency checks, or atomic-group commit survived failure.
- A fresh remote index plus compressed row receipts still cannot skip the group finalize barrier for a plugin update, because compressed summaries cannot prove the finalize ran, the dependency checks held, or the atomic-group visibility boundary survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip a plugin install, because planning evidence and compressed batch receipts cannot prove dependency checks, per-row preconditions, or the atomic-group commit survived failure.
- A compressed remote index plus a cached file hash still cannot skip plugin-install writeback, because planning evidence and cached hashes do not prove the plugin metadata writes, per-row compares, or the atomic-group barrier survived failure.
- A compressed database batch still cannot stand in for batch receipts, because compression can reduce recovery work but cannot prove every row reached the remote.
- A fresh remote index plus durable chunk receipts still cannot skip the live file compare before publish.
- A fresh remote index plus cached chunk receipts still cannot skip the guarded publish finalize for a large upload.
- A dependency-heavy plugin update still cannot use a fresh remote index or a cached package hash to skip dependency preconditions at the atomic-group barrier.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-update dependency checks, because planning evidence and dependency shape do not prove the live row preconditions, member metadata writes, or the atomic-group barrier survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-update writeback, because planning evidence and dependency shape do not prove the live row compares, metadata writes, or the atomic-group barrier survived failure.
- A fresh remote index plus a compressed in-memory buffer still cannot prove a plugin install finished, because dependency checks, metadata writes, file receipts, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed in-memory buffer still cannot prove plugin activation finished, because the activation change, dependency checks, and the atomic-group commit still need durable evidence.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-update row preconditions, because planning evidence and dependency shape do not replace the live per-row compares or the atomic-group barrier.
- A compressed remote index plus a cached file fingerprint still cannot skip plugin-update row preconditions, because planning evidence and cached fingerprints cannot prove the live row compares or the atomic-group barrier survived failure.
- A compressed remote index plus a cached file fingerprint still cannot skip plugin-update writeback, because planning evidence and cached fingerprints cannot prove the live row compares, metadata writes, or the atomic-group barrier survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip bounded plugin-update batch sizing, because planning evidence and dependency shape do not replace the live row preconditions, batch receipts, or the atomic-group barrier.
- A remote index cursor plus a cached dependency graph still cannot skip plugin-install row preconditions, because planning evidence can reduce lookup work but cannot prove the live row compares, metadata writes, or the atomic-group barrier survived failure.
- A fresh remote index plus a compressed file-hash cache still cannot prove a plugin install finished, because dependency checks, staged files, row receipts, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed file-hash cache still cannot prove a plugin update finished, because dependency checks, staged files, row receipts, and the atomic-group commit still need durable evidence.
- A compressed file-hash cache still cannot prove a large upload finished, because chunk receipts and the guarded publish record still need to survive failure.
- A compressed file-hash cache still cannot skip missing chunk receipts during large-upload resume, because hash compression cannot prove which acknowledgements survived a crash or restore the guarded publish barrier.
- A compressed file-hash cache plus a paused queue still cannot skip missing chunk receipts during large-upload resume, because backpressure relief cannot prove which acknowledgements survived the pause or restore the guarded publish barrier.
- A cached chunk ledger still cannot prove a large upload finished, because the live compare, guarded publish, and every chunk acknowledgement still need to survive failure.
- A cached chunk ledger still cannot skip the guarded publish finalize for a large upload, because the ledger can narrow duplicate hashing but cannot prove the live compare or publish barrier survived failure.
- A local fingerprint still cannot skip the live remote compare before publish, because size, mtime, inode, or mode can only skip a rehash and cannot authorize the mutation boundary.
- A compressed manifest hash still cannot skip the live file compare before a large upload publish, because compression can shrink recovery data but cannot prove the live object still matches the publish precondition after a crash or retry.
- A compressed remote index plus a cached file hash still cannot skip the guarded publish step for a large upload, because planning evidence and cached hashes cannot prove the live compare, every chunk acknowledgement, or the publish barrier survived failure.
- A compressed remote index plus cached source identity still cannot skip live revalidation after a pause, because planning evidence and cached identity do not prove the live remote resource still matches, which chunk acknowledgements survived the pause, or that the guarded publish barrier survived failure.
- A compressed remote index plus a cached dependency graph still cannot skip plugin-install finalize, because planning evidence and cached structure do not prove the dependency checks, staged rows, or the atomic-group finalize survived failure.
- A compressed remote index plus a paused upload queue still cannot skip the guarded publish step for a large upload, because planning evidence and backpressure state cannot prove chunk receipts, the live compare, or the publish barrier survived failure.
- A fresh remote index plus a compressed upload buffer still cannot prove a large upload finished, because smaller buffered state cannot prove the live compare, durable chunk receipts, or the guarded publish barrier survived failure.
- A fresh remote index plus a compressed upload buffer still cannot skip the guarded publish step for a large upload, because planning evidence and smaller buffered state cannot prove the live compare, durable chunk receipts, or the guarded publish barrier survived failure.
- A compressed remote index plus a cached upload buffer still cannot skip the guarded publish step after a pause, because the cached buffer cannot prove which chunk acknowledgements survived or that the publish barrier is still intact.
- A compressed remote index plus cached chunk receipts still cannot skip backpressure pauses during large-upload resume, because planning evidence and cached receipts cannot prove the bounded queue order and journal evidence needed after pause or crash.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload resume after a pause, because planning evidence and cached receipts cannot prove the live compare or guarded publish barrier survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip the large-upload publish step after a pause, because planning evidence and cached receipts cannot prove the live compare, the guarded publish record, or which acknowledgements survived the pause.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload window sizing after a pause, because planning evidence and cached receipts cannot prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure.
- A compressed remote index plus cached chunk hashes still cannot skip large-upload chunk upload after a pause, because planning evidence and cached hashes cannot prove which chunk acknowledgements survived the pause or restore the guarded publish boundary.
- A compressed remote index plus cached chunk hashes still cannot skip large-upload publish after a pause, because planning evidence and cached hashes cannot prove the live compare, surviving chunk acknowledgements, or guarded publish barrier.
- A compressed remote index plus a cached file hash still cannot skip large-upload chunk upload after a pause, because planning evidence and cached hashes cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier.
- A compressed remote index plus a cached manifest hash still cannot skip large-upload window sizing after a pause, because planning evidence and cached hashes cannot prove the next bounded window still matches the live queue order or restore the guarded publish barrier after failure.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload chunk upload work, because planning evidence and cached receipts cannot prove the live per-chunk compare, bounded queue order, or durable acknowledgement needed after failure.
- A compressed remote index plus a cached file fingerprint still cannot skip large-upload chunk upload work after a pause, because planning evidence and cached fingerprints cannot prove which acknowledgements survived or restore the guarded publish barrier.
- A compressed remote index plus unbounded upload parallelism still cannot skip backpressure, because planning evidence and bigger fan-out cannot prove the receipt order or journal order needed to recover after a pause or crash.
- A compressed remote index plus unbounded hash fanout still cannot skip backpressure, because planning evidence and wider fan-out cannot prove the bounded queue order or journal evidence needed to recover after a pause or crash.
- A compressed remote index plus unbounded chunk parallelism still cannot treat a drained queue as publish-ready, because planning evidence and fan-out cannot prove the receipt order, backpressure evidence, or guarded publish barrier survived failure.
- Compressed chunk transit still cannot replace durable chunk receipts, because wire savings do not prove which acknowledgements survived a crash or that the guarded publish step remains valid.
- A compressed remote index plus unbounded database row parallelism still cannot skip atomic-group barriers, because planning evidence and more fan-out cannot prove which group owns the commit order or the backpressure evidence needed to recover a partial failure.
- Compressed chunk receipts still cannot prove a large upload finished, because the live compare, guarded publish, and every chunk acknowledgement still need to survive failure.
- A fresh remote index plus compressed chunk receipts still cannot prove a plugin update finished, because chunk acknowledgements do not replace dependency checks, row receipts, or the atomic-group commit.
- A fresh remote index plus compressed chunk receipts still cannot prove a dependency-heavy plugin update finished, because dependency checks, staged rows, and the atomic-group commit still need durable evidence.
- A dependency-heavy plugin update cannot publish rows early just because the remote index looked fresh, because the dependency graph is planning evidence only.
- Backpressure cannot treat a drained compressed queue as proof of completion, because queue size is not the same as durable acknowledgement.
- Parallelism cannot publish multiple atomic groups together, because recovery must still identify which group owns each partial failure.
- A fresh remote index plus compressed chunk receipts still cannot prove a large upload finished, because the live compare, guarded publish, and every chunk acknowledgement still need durable evidence.
- A compressed remote index plus cached chunk receipts still cannot skip the guarded publish step for a large upload, because planning evidence and cached receipts cannot prove the live compare or publish barrier survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip the guarded publish step for a large upload, because planning evidence and cached receipts cannot prove the live compare, the guarded publish barrier, or which acknowledgements survived failure.
- A compressed remote index plus cached chunk receipts still cannot skip large-upload publish under backpressure, because cached receipts do not prove the queue stayed bounded or that the guarded publish barrier survived failure.
- A compressed remote index plus bounded chunk parallelism still cannot skip large-upload publish after a pause, because bounded fan-out and planning evidence cannot prove which acknowledgements survived the pause or restore the guarded publish barrier.
- A compressed remote index plus unbounded row-batch parallelism still cannot skip plugin-install finalize after a pause, because planning evidence and extra fan-out do not prove row preconditions, plugin checks, or the atomic-group finalize survived failure.
- A compressed remote index plus a cached package hash still cannot skip plugin-install activation after a pause and backpressure event, because planning evidence and cached hashes do not prove activation checks, staged rows, backpressure state, or the atomic-group barrier survived failure.
- A local fingerprint match still cannot skip the live file compare before publish, because size, mtime, inode, or mode can only skip a rehash and cannot authorize the mutation boundary.
- A compressed remote index plus batched receipt flushes still cannot skip the guarded publish step for a large upload after a pause, because journal batching cannot prove which chunk acknowledgements survived the pause or that the guarded publish barrier is still intact.
- A compressed remote index plus bounded chunk parallelism still cannot skip large-upload backpressure after a pause, because bounded fan-out and planning evidence cannot prove which chunk acknowledgements survived the pause or restore the guarded publish barrier.
- A compressed remote index plus a cached file fingerprint still cannot skip the live compare before publish, because planning evidence and cached fingerprints cannot prove the live remote resource, chunk acknowledgements, or guarded publish barrier survived failure.
- A fresh remote index plus a compressed upload queue still cannot prove a large upload finished, because the live compare and durable chunk receipts still need to survive failure.
- A fresh remote index plus a compressed upload buffer still cannot prove a large upload finished, because the live compare and durable chunk receipts still need to survive failure.
- A compressed upload queue still cannot skip missing chunk receipts during a large-upload resume, because queue compression cannot prove which acknowledgements survived a crash or restore the guarded publish boundary.
- A compressed upload queue still cannot skip backpressure for large uploads, because queue compression cannot prove the sender still has the receipts and journal order needed to recover after a pause or crash.
- A fresh remote index plus a compressed in-memory buffer still cannot prove chunk resume is complete, because compressed pressure relief does not replace missing chunk acknowledgements.
- Compressed chunk receipts plus a cached file hash still cannot prove a large upload finished, because the live compare, guarded publish, and every chunk acknowledgement still need to survive failure.
- A compressed manifest hash plus cached chunk receipts still cannot skip the guarded publish step for a large upload, because manifest compression and cached receipts cannot prove the live compare or guarded publish barrier survived failure.
- A fresh remote index plus a compressed in-memory buffer still cannot prove a dependency-heavy plugin update finished, because dependency checks, row receipts, and the atomic-group commit still need durable evidence.
- A fresh remote index plus a compressed row batch still cannot skip live row compares, because planning evidence and batch compression cannot replace the live compare-and-swap predicate on each row.
- A fresh remote index plus a cached file digest still cannot prove a large upload finished, because chunk receipts and the guarded publish record still need to survive failure.
- A compressed remote index plus a cached file hash still cannot skip the guarded chunk-publish step, because duplicate hashing does not prove the live chunk compare or the surviving acknowledgements.
- A compressed remote index plus a cached file hash still cannot skip the remaining chunk upload work, because cached hashing does not prove each chunk was uploaded, acknowledged, or preserved through the guarded publish boundary.
- A compressed remote index plus a cached file hash still cannot skip plugin-install writeback, because cached hashes do not prove the metadata writes, row compares, or atomic-group barrier survived failure.
- A fresh remote index plus a compressed manifest hash still cannot prove a large upload finished, because the live compare, every chunk receipt, and the guarded publish record still need to survive failure.
- A matching archive hash still cannot replace missing chunk receipts during large-upload resume, because the hash does not prove which acknowledgements survived a crash or lost response.
- Unlimited parallel chunk sends during large-upload resume still cannot replace backpressure evidence, because the sender must preserve queue order and journal order to classify partial failure safely.
- Publishing database batches from different atomic groups in parallel still cannot make their visibility boundary safe, because recovery must keep each coupled group pinned to its own commit barrier.
- A compressed upload buffer still cannot stand in for per-chunk receipts or the guarded publish step.
- A matching manifest or archive hash still cannot stand in for missing chunk receipts or the guarded publish finalize record.
- A fresh remote index plus a drained compressed queue still cannot prove apply is complete or that the live precondition survived failure.
- A compressed remote index plus cached row-batch receipts still cannot skip plugin-update dependency checks, because live row compares and the atomic-group barrier still have to survive failure.
- A compressed remote index plus a cached manifest hash still cannot skip the guarded publish step for a large upload, because the live compare and every chunk acknowledgement still need durable proof.
- A cached manifest hash still cannot skip the guarded publish step for a large upload, because duplicate lookup and hashing do not prove the live compare, chunk acknowledgements, or publish barrier survived failure.
- File hashing cannot treat the previous digest alone as authority, because the local fingerprint only skips duplicate rehash work and the live remote compare still guards apply.
- A local fingerprint plus a cached digest still cannot prove a large upload finished, because chunk receipts and the guarded publish record still need to survive failure.
- Chunk upload cannot treat a visible staging object as completion, because the finalize step still needs durable receipts and a guarded publish boundary.
- Chunk upload cannot treat a matching chunk digest as completion, because the receiver still needs durable acknowledgement.
- A fresh remote index plus a compressed queue still cannot skip large-upload resume decisions, because compressed backpressure state cannot prove which chunk acknowledgements survived a crash or whether the guarded publish record still exists.
- A compressed remote index plus a compressed upload queue still cannot skip backpressure pauses, because smaller queued buffers do not prove which chunk acknowledgements or journal records survived failure.
- A drained upload buffer still cannot count as publish-ready, because queue pressure relief does not prove chunk receipts, the live compare, or the guarded publish barrier survived failure.
- Database row batching cannot widen a batch across plugin owners or atomic groups, because recovery needs one stable commit boundary per coupled set of rows.
- Remote indexes cannot become a lock, because the listing is only planning evidence and may be stale by the time apply runs.
- Compression cannot hash compressed bytes as canonical state, because transport encoding must not change the compare-and-swap value.
- Parallelism cannot move the atomic-group commit barrier, because independent staging work is not the same as shared visibility.
- Parallelism cannot run plugin install finalize work for every dependency group at once, because the shared backpressure and commit ordering would no longer identify which group owns a partial failure.
- Backpressure cannot clear a queue and call the work complete, because durable receipts are still required to classify recovery.

Area-specific rejection examples are worth keeping explicit because each one
fails in a different way:

- File hashing cannot fall back to mtime-only, size-only, or path-only equality
  when that would skip a live remote hash check.
- File hashing cannot treat a local fingerprint as apply authority when the
  live remote compare is still required.
- File hashing cannot treat a cached chunk ledger as publish authority when the
  live compare and guarded publish record are still required.
- File hashing cannot treat a local fingerprint as publish authority when the
  live remote compare is still required.
- File hashing can reuse a cached chunk ledger to skip duplicate hashing, but
  it still cannot skip the live publish compare or guarded publish record.
- File hashing can reuse a remote-index cursor to skip duplicate hash planning,
  but it still cannot skip the live publish compare or guarded publish record.
- Chunk upload cannot treat a visible staging object or a matching digest as a
  substitute for the durable receipt and guarded finalize step.
- Chunk upload for large archives cannot treat a cached manifest or archive hash
  as proof that every chunk receipt survived failure.
- Database row batching cannot merge rows across owners or atomic groups just to
  make a larger batch.
- Database row batching for plugin installs and updates cannot skip dependency
  or metadata preconditions by leaning on remote index freshness.
- Database row batching cannot treat a compressed batch as durable proof that
  every row reached the remote, because the missing per-row receipts are what
  make recovery unambiguous.
- Database row batching for plugin updates cannot treat cached row-batch
  receipts as proof that dependency checks survived failure, because the live
  row compares and atomic-group barrier still have to run.
- Remote indexes cannot authorize mutation because the listing may be stale by
  the time apply runs.
- Remote indexes cannot become authoritative just because the listing is
  compressed, because transport encoding does not change the planning-only
  boundary.
- Compression cannot change the canonical hash or replace the compare-and-swap
  precondition on the uncompressed value.
- Parallelism cannot bypass the atomic group commit barrier.
- Parallelism cannot widen the atomic group commit barrier to make two groups
  visible together, because recovery would lose the owner of a partial result.
- Backpressure cannot drop evidence, because the missing receipts are what make
  recovery unambiguous after pause or crash.
- Backpressure cannot collapse journal flushes into a summary that loses the raw
  chunk, row, or group receipts, because recovery still needs the original
  evidence to classify a partial failure.
- Backpressure can batch mixed durable receipts only when the flush keeps raw
  receipt order and exact keys, because the journal batch is still recovery
  evidence rather than commit authority.
- Compressed receipt logs cannot authorize apply or recovery on their own,
  because raw receipt keys, request hashes, and commit records are still what
  distinguish "already committed" from "only staged" after a crash.
- Batched receipt flushes cannot move the commit boundary or merge atomic
  groups, because recovery still needs to know which members belong to which
  group when a partial failure lands mid-flight.

The safe version of a fast path is usually a "skip duplicate staging work" or
"stage earlier" optimization, not a "commit earlier" optimization. The commit
point is where no-data-loss guarantees are easiest to lose, so it stays narrow,
preconditioned, idempotent, and journaled.

The seven areas below are the only fast-path families this lane is proposing:
file hashing, chunk upload, database row batching, remote indexes,
compression, parallelism limits, and backpressure. If a proposed speedup in
one of those areas cannot explain its unchanged visibility boundary and its
durable failure evidence, it belongs in the reject list instead of the safe
list. Planning evidence, such as a remote index cursor or a local fingerprint,
can justify skipping duplicate work, but it never authorizes a live mutation
by itself.

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

The benchmark shape must stay realistic:

- A large upload workload exercises file hashing, chunk upload, compression
  decisions, and backpressure under a body size that is well beyond a toy case.
- A plugin-install workload exercises remote indexes, row batching, staged
  plugin metadata, and the atomic group commit barrier.
- A dependency-heavy plugin-update workload exercises the same barrier with
  nontrivial dependency evidence, staged rows, and a second atomic-group
  commit path.
- The executable guarded-executor benchmark also includes a `guardedLarge`
  profile so the same receipts and recovery checks are exercised at a much
  larger upload and row volume.
- The `guardedLarge` profile stays below any production throughput claim
  because the benchmark still measures lab-grade file receipts, per-row apply,
  and recovery evidence rather than production storage receipts.
- Each of those workloads keeps recovery evidence visible in the model: chunk
  receipts for uploads, batch receipts for rows, and group-finalize records
  for coupled plugin changes.
- A rejected-path workload proves that a visible staging object is not enough
  to complete a chunk, and that a fresh dry run still does not authorize apply.
- Large uploads and plugin installs must both include recovery edges, not just
  happy-path throughput. That means chunk receipts, batch receipts, and group
  finalize records must be present so a retry can still classify old, new, or
  blocked without guessing.
- Rejected fast paths are modeled alongside the safe ones so the benchmark can
  prove that the tempting shortcuts were rejected for the right reason, not
  just omitted from the happy path.
- Each safe family also needs at least one concrete rejection example in the
  model, so the lane keeps showing why file hashing, chunk upload, database
  batching, remote indexes, compression, parallelism limits, and backpressure
  all stop at the first unsafe gate instead of drifting into ambiguous
  failure handling.

The rejected examples are not abstract lint. They are concrete failure modes:

- A fresh dry run cannot authorize apply because the remote may change before
  the live compare.
- A visible staging object cannot complete a chunk because the durable receipt
  may be missing after a crash.
- A cross-group row batch cannot be merged for throughput because recovery
  would not know which coupled plugin owns the partial result.
- A remote index cannot become a lock because it only reflects planning-time
  state.
- A compressed hash cannot stand in for canonical content state because wire
  encoding and resource identity are different facts.
- A cached file hash cannot skip plugin install finalization because the hash
  can narrow duplicate hashing but cannot prove dependency checks, staged files,
  or the atomic-group commit survived failure.
- Parallel commits cannot be widened across atomic groups because the commit
  barrier is the visibility boundary.
- Parallel staging cannot be merged into one wider commit across atomic groups
  because the recovery record would no longer tell which group owns a partial
  failure.
- Parallel finalization across atomic groups cannot be treated as completion,
  because the receipt and commit records still need to identify each group's
  own failure boundary after a crash or lost response.
- A compressed row batch cannot replace the atomic-group commit, because
  compression changes storage footprint, not visibility boundaries.
- Chunk uploads cannot become visible across atomic groups as soon as receipts
  arrive, because the owning group barrier still has to keep the upload set
  classifiable after crash or retry.
- The large-profile guarded-executor benchmark still cannot claim production
  throughput, because production storage receipts, row-batch execution, and
  atomic-group commit behavior are not measured there.
- Backpressure cannot drop receipts or journals because the missing evidence is
  what makes failure classification unambiguous.
- Backpressure cannot be skipped just because the queue is compressed, because
  pressure relief cannot stand in for the receipts and journal order needed
  after a pause or crash.
- The performance-model test is meant to stay bounded. If a future edit makes
  `node --test test/performance-model.test.js` look stuck, isolate the named
  subtest or cap the newly introduced case before adding more speedup variants.

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

Also reject any hash shortcut that makes the digest itself the authority. A
cached digest can skip a rehash, but it cannot replace the live compare on the
remote resource.

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

Also reject batch shapes that cross plugin owners or atomic groups to chase a
fatter batch. That creates a faster failure mode, not a safe one, because the
recovery record can no longer prove which coupled rows belong together.

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

Reject any shortcut that treats compressed bytes as the canonical resource
value, or that uses compression to bypass a live resource hash check. Encoding
can change wire efficiency, but it does not change the mutation precondition.

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

Reject any "fast" pressure response that sheds receipts, advances the cursor
without acknowledgment, or declares a sender complete because the queue was
drained into memory. Those choices lose the only evidence that makes recovery
unambiguous.

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
- Publishing staged chunks or row batches just because the staging objects
  exist and look complete.
- Publishing chunks before their durable receipts exist.
- Skipping apply preconditions because the dry-run plan was just generated.
- Treating a remote index generation as permission to mutate.
- Using mtime, size, row count, or table checksum instead of strong resource
  hashes for conflict checks.
- Treating a cached digest or index entry as a substitute for the live compare
  that guards a mutation.
- Splitting a plugin install so files publish before database rows, dependency
  checks, plugin metadata, and activation state are ready.
- Activating or upgrading a plugin before validators and dependency
  preconditions pass.
- Replaying SQL dumps or bulk `REPLACE` statements without row-level
  compare-and-swap predicates.
- Treating chunk receipts as optional and publishing staged bytes without a
  guarded finalize step.
- Publishing staged chunk bytes the moment a receipt exists, without the
  finalize comparison that still guards the live file path.
- Merging rows from different plugin owners or atomic groups into one visible
  batch because the SQL shape matches.
- Parallelizing atomic-group commits or interleaving them so the barrier is no
  longer a single visibility point.
- Using index freshness, cursor freshness, tombstone state, or a successful dry run as a live
  mutation authorization.
- Comparing compressed bytes as the canonical resource hash, or using
  compression to skip the precondition that guards the uncompressed value.
- Retrying non-idempotent mutations without a plan id, resource key, and batch
  idempotency key.
- Advancing an upstream producer because the queue is empty while receipts or
  journal records are still missing.
- Treating a fresh remote index and cached digest as proof that the live apply
  already finished.
- Raising concurrency without an in-flight byte budget and durable progress
  journal.
- Reporting success when staged bytes, staged rows, or an atomic group commit
  are still unacknowledged.
- Skipping plugin dependency, metadata, or activation validators because a
  package hash was cached.
- Treating a present staging object as a completed chunk without a matching
  durable receipt.
- Treating a matching chunk digest as proof that a chunk completed without a
  durable receipt.
- Treating a full-file digest as enough proof to resume chunk work when chunk
  receipts are missing.
- Treating pipelined chunk sends as proof that final publish already happened
  without the guarded receipt set.
- Treating a compressed in-memory buffer as proof that upload or batch work is
  durable.
- Treating a drained compressed queue as proof that all staged work reached the
  remote.
- Merging database rows from different plugin owners or atomic groups into one
  commit-visible batch.
- Treating a remote index cursor, generation, or ETag as a lock that can cover
  later apply writes.
- Committing an atomic group when any staged file, row batch, plugin metadata
  entry, dependency check, or activation validator lacks a matching receipt.
- Letting backpressure drop queued precondition evidence or compress buffered
  state into a summary that cannot identify the affected resources after a
  crash.

## Verification Note

The current benchmark model does not reproduce the earlier full-file test hang
in this workspace. The bounded checks below completed successfully on
2026-05-25:

- `timeout 20s node --test test/performance-model.test.js`
- `timeout 20s node --test --test-name-pattern='benchmark model covers large uploads and plugin installs' test/performance-model.test.js`
- `timeout 20s node --input-type=module -e "import('./scripts/bench/performance-model.js')"`

Observed runtimes were approximately 115 ms, 114 ms, and an immediate
successful module import, respectively.

The reject list is not just theoretical. It blocks the tempting shortcuts that
break the no-data-loss contract:

- File hashing cannot fall back to mtime-only, size-only, or path-only equality.
- Chunk upload cannot publish directly to the live file path or accept a chunk
  without a matching durable receipt.
- Chunk upload cannot treat pipelined chunk sends as final publish, because
  the guarded receipt set and compare-and-swap finalize step still decide
  visibility.
- Database row batching cannot use blind `REPLACE` or reorder rows across
  plugin owners or atomic groups.
- Remote indexes cannot authorize apply writes, even when the listing is fresh.
- Compression cannot change the canonical hash by hashing encoded bytes.
- Parallelism cannot cross the atomic-group barrier just because the work is
  independent on paper.
- Backpressure cannot erase evidence, mark work complete, or hide which bytes
  and rows are still pending.
- Compression cannot turn buffered state into durable proof of completion.

The rejected fast paths in the model are the ones most likely to be tempting
under load:

- live-path chunk publish is rejected because a crash after the first chunk
  would leave a half-uploaded file visible without a durable completion proof.
- dry-run freshness is rejected because a remote edit between plan and apply
  would be overwritten without a live compare-and-swap check.
- remote-index authorization is rejected because a stale listing can still
  plan quickly but cannot prove current storage state.
- remote-index plus compressed chunk receipts is rejected because planning
  evidence and compressed receipts can reduce recovery work, but they still
  cannot prove the live compare, guarded publish, or every chunk acknowledgement
  survived failure.
- remote-index plus paused-queue cached file hash is rejected because planning
  evidence, backpressure, and cached hashes can reduce recovery work, but they
  still cannot prove the live compare, chunk acknowledgements, or guarded
  publish barrier survived failure.
- compressed file-hash cache is rejected because hash compression can shrink
  recovery state, but it still cannot prove which chunk acknowledgements
  survived a crash or restore the guarded publish barrier.
- remote-index plus cached package hash is rejected because planning evidence
  and package identity cannot prove dependency checks, metadata writes, or the
  atomic-group commit.
- remote-index plus cached package hash is also rejected for plugin updates,
  because the update still needs the same dependency checks, metadata writes,
  and atomic-group commit before it can become visible.
- remote-index plus cached package hash cannot skip plugin validators because
  package identity is not a substitute for the live group-scoped commit barrier.
- remote-index plus compressed package cache cannot complete plugin install
  because dependency checks, metadata writes, file receipts, and the
  atomic-group commit still need durable evidence.
- compressed manifest or package summary cannot complete plugin install
  because dependency checks, metadata writes, row receipts, and the atomic-group
  commit still need durable evidence.
- compressed receipt summaries cannot replace the guarded publish barrier for
  large uploads, because recovery still needs the raw chunk receipts and live
  compare evidence.
- dependency-heavy plugin update cannot be fast-pathed by index freshness alone
  because dependency checks still have to survive the atomic-group barrier.
- split plugin install is rejected because files, rows, metadata, dependency
  checks, and activation state must cross visibility together.
- blind SQL replace is rejected because it removes per-row compare-and-swap
  guards and can silently overwrite concurrent remote edits.
- backpressure evidence dropping is rejected because a pause must preserve the
  exact rows, chunks, and validators needed to resume or classify failure.
- paused queue-slack proof spoofing is rejected because a paused sender must
  still show measured and aligned queue slack before the backpressure claim can
  move.
- compressed-buffer-completes-work is rejected because shrinking buffered
  evidence does not create the missing receipt or commit record.
- compressed-upload-queue-completes-large-upload is rejected because a drained
  compressed queue can still hide missing chunk receipts or the guarded
  publish record.
- compressed-upload-queue-replaces-chunk-receipts is rejected because queue
  compression can lower pressure, but it cannot replace the durable per-chunk
  acknowledgements needed to classify partial failure or resume safely.
- compressed-upload-queue-after-pause-skips-chunk-receipts is rejected because
  pausing the queue only stops producers, and compression cannot prove which
  chunk acknowledgements survived the pause or replace the recovery record.
- fingerprint-and-compressed-upload-queue-completes-large-upload is rejected
  because a local fingerprint and queue compression can reduce work, but they
  cannot prove chunk acknowledgements or the guarded publish survived failure.
- compressed-receipts-replace-durable-progress is rejected because compressing
  receipts can hide the per-chunk or per-row evidence needed to classify partial
  failure.
- compressed-queue-drains-completes-work is rejected because a drained queue
  can still hide missing chunk or batch acknowledgements.
- compressed-upload-queue-completes-large-upload is rejected because a drained
  compressed queue can still hide missing chunk receipts, the live compare, or
  the guarded publish record needed after a failure.
- fingerprint-completes-large-upload is rejected because a local fingerprint
  can skip duplicate hashing, but it cannot prove chunk receipts, guarded
  publish, or durable upload completion survived failure.
- fingerprint-skips-live-publish-compare is rejected because a local
  fingerprint can skip duplicate rehash work, but it cannot authorize the live
  mutation boundary or replace the storage precondition that guards publish.
- fingerprint-and-compressed-upload-queue-completes-large-upload is rejected
  because a local fingerprint and queue compression can reduce work, but they
  cannot prove chunk acknowledgements or the guarded publish survived failure.
- remote-index-plus-compressed-row-batch-completes-plugin-update is rejected
  because planning evidence and batch compression cannot prove row-level
  preconditions, dependency checks, or the atomic-group commit survived a
  failure.
- remote-index-plus-compressed-row-batch-skips-backpressure is rejected because
  planning evidence and batch compression can reduce queue pressure, but they
  cannot prove the paused rows, dependency checks, or atomic-group commit
  record survived failure.
- remote-index-plus-compressed-row-summary-completes-plugin-update is rejected
  because planning evidence and a compressed row summary cannot prove row
  receipts, dependency checks, or the atomic-group commit survived failure.
- remote-index-plus-compressed-package-cache-completes-plugin-update is
  rejected because package compression can reduce transfer work, but it still
  cannot prove dependency checks, metadata writes, row receipts, or the
  atomic-group commit survived failure.
- remote-index-plus-compressed-row-batch-completes-plugin-install is rejected
  for the same reason, because install row batches still need per-row
  preconditions, dependency checks, and the atomic-group commit barrier.
- compressed-row-batch-skips-live-compare is rejected because compression can
  reduce replay cost, but it cannot replace the live per-row compare that
  guards mutation time.
- compressed-row-batch-skips-group-finalize is rejected because a compressed
  batch still cannot prove the dependency checks held or that the atomic-group
  finalize ran.
- compressed-row-summary-skips-live-batch-preconditions is rejected because a
  summary can shrink recovery data, but it cannot replace the live per-row
  preconditions required at apply time.
- index-and-compressed-row-batch-completes-plugin-install is rejected because a
  fresh remote index and compressed batch can reduce lookup work, but they
  cannot prove the dependency checks, row receipts, or atomic-group commit.
- index-and-compressed-row-batch-completes-plugin-update is rejected for the
  same reason, because compressed planning evidence cannot prove per-row
  preconditions or the atomic-group commit survived failure.
- compressed-remote-index-and-cached-row-receipts-skips-plugin-install is
  rejected because planning evidence and cached row receipts can reduce replay
  work, but they cannot prove the dependency checks, metadata writes, or
  atomic-group commit survived failure.
- compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-
  commit-after-pause is rejected because planning evidence and batched receipts
  can reduce replay cost, but they cannot prove the live file compares, row
  preconditions, or the atomic-group commit survived the pause.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions
  is rejected because planning evidence and cached batch receipts can reduce
  replay work, but they cannot prove the live per-row compares, dependency
  checks, or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-row-preconditions-after-pause
  is rejected because planning evidence and cached batch receipts can reduce
  replay work, but they cannot prove the paused install still satisfies every
  row compare or that the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize
  is rejected because planning evidence and cached batch receipts can reduce
  replay work, but they cannot prove dependency checks, per-row preconditions,
  or the atomic-group finalize survived failure.
- compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize
  is rejected because planning evidence and cached database receipts can trim
  replay work, but they cannot prove dependency checks, staged files, or the
  atomic-group finalize survived failure.
- compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-install-finalize-after-pause
  is rejected because planning evidence and cached database receipts can trim
  replay work, but they cannot prove the paused dependency checks, staged
  files, or the atomic-group finalize survived the pause.
- compressed-remote-index-and-parallel-row-batch-skips-plugin-install-barrier
  is rejected because parallel row batches can reduce wait time, but they
  cannot prove which owner owns a partial row result or that the atomic-group
  barrier survived failure.
- compressed-remote-index-and-parallel-row-batch-skips-plugin-update-activation
  is rejected because parallel row batches can reduce wait time, but they
  cannot prove the activation change, per-row compares, or the atomic-group
  barrier survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation
  is rejected because planning evidence and cached batch receipts can reduce
  replay work, but they cannot prove activation validators passed, the live
  metadata writes happened, or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-
  activation-after-pause is rejected because cached planning evidence after a
  pause still cannot prove the activation change, row preconditions, or the
  atomic-group barrier survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-
  final-activation-after-pause is rejected because cached planning evidence
  after a pause still cannot prove the final activation state, row
  preconditions, or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback
  is rejected because planning evidence and cached row receipts can trim replay
  work, but they cannot prove the plugin metadata writes, per-row compares, or
  the atomic-group writeback survived failure.
- compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize is
  rejected because planning evidence and cached hashes can skip duplicate
  lookup and rehash work, but they cannot prove dependency checks, staged rows,
  or the atomic-group commit survived failure.
- compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-
  writeback is rejected because planning evidence and cached chunk receipts
  can reduce replay work, but they cannot prove dependency checks, staged
  metadata, or the atomic-group writeback survived failure.
- compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-
  writeback-after-pause is rejected because planning evidence and cached
  chunk receipts can reduce replay work, but they cannot prove dependency
  checks, staged metadata, or the atomic-group writeback survived the pause.
- compressed-remote-index-and-cached-file-hash-skips-plugin-activation is
  rejected because a compressed index and cached file hash can reduce lookup
  work, but they cannot prove the activation state, dependency checks, or the
  atomic-group commit survived failure.
- compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize
  is rejected because planning evidence and cached manifest hashes can reduce
  lookup work, but they cannot prove dependency checks, staged rows, or the
  atomic-group commit survived failure.
- compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize
  is rejected because planning evidence and cached package hashes can reduce
  planning and lookup work, but they cannot prove dependency checks, metadata
  writes, staged files, or the atomic-group commit survived failure.
- compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize
  is rejected because planning evidence and cached package caches can reduce
  lookup work, but they cannot prove dependency checks, staged files, or the
  atomic-group finalize survived failure, so the install could still be half-
  visible after a crash.
- compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks
  is rejected because planning evidence and cached package caches can reduce
  lookup work, but they cannot prove dependency checks, metadata writes, or
  the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-
  dependency-checks is rejected because planning evidence and a cached
  dependency graph can reduce lookup work, but they cannot prove dependency
  checks, metadata writes, or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-
  activation is rejected because planning evidence and a cached dependency
  graph can reduce lookup work, but they cannot prove activation writes,
  dependency checks, or the atomic-group commit survived failure.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-
  row-preconditions is rejected because planning evidence and a cached
  dependency graph can reduce lookup work, but they cannot prove the live
  per-row compares, dependency checks, or the atomic-group barrier survived
  failure.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-
  finalize is rejected because planning evidence and a cached dependency
  graph can reduce lookup work, but they cannot prove staged metadata,
  dependency checks, or the atomic-group finalize survived failure.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-
  activation-after-pause-and-backpressure is rejected because planning
  evidence and a cached dependency graph can reduce lookup work, but they
  cannot prove the activation change, live row compares, or atomic-group
  barrier survived the pause.
- compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation
  is rejected because planning evidence and cached package hashes can reduce
  planning and lookup work, but they cannot prove dependency checks,
  activation writes, or the atomic-group commit survived failure.
- compressed-remote-index-and-cached-package-hash-skips-plugin-install-
  dependency-checks is rejected because planning evidence and cached package
  hashes can reduce lookup work, but they cannot prove dependency checks,
  metadata writes, or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback is
  rejected because planning evidence and cached hashes can skip lookup and
  rehash work, but they cannot prove dependency checks, staged files, or the
  atomic-group commit survived failure.
- compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation
  is rejected because planning evidence and cached hashes can reduce lookup and
  rehash work, but they cannot prove dependency checks, staged metadata, or the
  atomic-group activation barrier survived failure.
- compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-finalize
  is rejected because planning evidence and cached chunk receipts can reduce
  replay work, but they cannot prove dependency checks, row preconditions, or
  the plugin update barrier survived failure.
- compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback
  is rejected because planning evidence and cached package hashes can reduce
  lookup work, but they cannot prove dependency checks, metadata writes, or
  the atomic-group writeback survived failure.
- compressed-remote-index-and-paused-upload-queue-skips-plugin-install-writeback
  is rejected because planning evidence and backpressure can pause work, but
  they cannot prove dependency checks, staged files, or the atomic-group
  commit survived failure.
- compressed-remote-index-and-compressed-upload-queue-skips-plugin-install-writeback
  is rejected because planning evidence and queue compression can reduce
  replay work, but they cannot prove dependency checks, staged files, or the
  atomic-group writeback survived failure.
- compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback
  is rejected because planning evidence and cached manifest hashes can reduce
  lookup work, but they cannot prove dependency checks, staged files, or the
  atomic-group commit survived failure.
- compressed-remote-index-and-cached-manifest-hash-skips-plugin-update-writeback
  is rejected because planning evidence and cached manifest hashes can reduce
  lookup work, but they cannot prove the live compare, staged rows, or the
  atomic-group writeback survived failure.
- compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback
  is rejected because planning evidence and batched receipts can reduce fsync
  work, but they cannot prove the live compare, staged rows, or the atomic-group
  writeback survived failure.
- compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-writeback-after-pause
  is rejected because planning evidence and cached receipts can reduce replay
  work, but they cannot prove the live row compares, dependency checks, or the
  atomic-group barrier survived the interruption.
- compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-writeback
  is rejected because planning evidence and batched receipts can reduce fsync
  work, but they cannot prove dependency checks, staged metadata, or the
  atomic-group writeback survived failure.
- compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation
  is rejected because planning evidence and cached batch receipts can reduce
  replay work, but they cannot prove the activation change, dependency checks,
  or the atomic-group commit survived failure.
- compressed-remote-index-and-cached-db-batch-receipts-skips-plugin-update-finalize
  is rejected because planning evidence and cached batch receipts can reduce
  replay work, but they cannot prove dependency checks, row preconditions, or
  the atomic-group finalize survived failure.
- compressed-remote-index-and-cached-chunk-receipts-skips-plugin-update-dependency-checks
  is rejected because planning evidence and cached chunk receipts can trim
  replay work, but they cannot prove dependency checks, metadata writes, or
  the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-file-hash-skips-plugin-update-dependency-checks
  is rejected because planning evidence and cached file hashes can trim lookup
  and rehash work, but they cannot prove dependency checks, live row compares,
  or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize
  is rejected because planning evidence and cached file hashes can trim lookup
  and rehash work, but they cannot prove dependency checks, staged files, or
  the atomic-group finalize survived failure.
- compressed-remote-index-and-cached-file-hash-skips-plugin-update-finalize is
  rejected because planning evidence and cached hashes can skip lookup and
  rehash work, but they cannot prove the live compare, staged rows, or the
  atomic-group finalize survived failure.
- compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure
  is rejected because planning evidence and cached row receipts can reduce
  replay work, but they cannot prove the queue order, journal order, or
  atomic-group commit order needed to recover a partial plugin update.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause
  is rejected because planning evidence and a cached dependency graph can
  reduce rescans, but they cannot prove which row receipts, plugin
  preconditions, or atomic-group evidence survived the pause.
- compressed-remote-index-and-compressed-row-batch-skips-plugin-update-finalize
  is rejected because planning compression and batch compression can reduce
  replay work, but they cannot prove the dependency checks, live row compares,
  or the atomic-group finalize survived failure.
- compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-
  after-pause is rejected because planning evidence and cached row receipts
  can reduce replay work, but they cannot prove the live row compares,
  dependency checks, or the atomic-group finalize survived a pause.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize
  is rejected because planning evidence and a cached dependency graph can
  reduce lookup work, but they cannot prove the live row compares, member
  metadata writes, or the atomic-group finalize survived failure.
- compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing
  is rejected because planning evidence and a cached dependency graph can
  reduce rescanning, but they cannot prove the live row preconditions, batch
  receipts, or the atomic-group barrier survived failure.
- compressed-remote-index-and-cached-package-hash-skips-plugin-update-finalize
  is rejected because planning evidence and cached package hashes can reduce
  planning and lookup work, but they cannot prove dependency checks, metadata
  writes, staged rows, or the atomic-group finalize survived failure.
- compressed-row-batch-skips-batch-receipts is rejected because compression
  can lower queue pressure, but it cannot replace per-row receipts or the
  recovery record needed to classify a partial batch.
- compressed-row-batch-skips-group-finalize is rejected because compressed row
  batches still cannot prove the dependency checks held, the group finalize
  ran, or the atomic-group visibility boundary survived failure.
- compressed-receipt-log-completes-apply is rejected because compressed
  receipts can shrink recovery evidence, but they cannot prove the live
  compare, row preconditions, or atomic-group commit survived failure.
- index-and-compressed-buffer-completes-chunk-resume is rejected because
  compressed buffers and planning evidence cannot prove which chunk receipts
  survived a crash or pause.
- compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish
  is rejected because planning evidence, compression, and cached receipts can
  reduce replay work, but they cannot prove the live compare or guarded
  publish barrier survived failure.
- compressed-remote-index-and-cached-manifest-hash-skips-large-upload-publish
  is rejected because planning evidence and cached manifest hashes can trim
  lookup work, but they cannot prove the live compare, chunk acknowledgements,
  or the guarded publish record survived failure.
- compressed-remote-index-and-cached-manifest-hash-skips-large-upload-resume-
  after-pause is rejected because planning compression and cached manifest
  state can reduce recovery work, but they cannot prove which chunk
  acknowledgements survived the pause or restore the guarded publish barrier.
- compressed-remote-index-and-cached-manifest-hash-skips-large-upload-backpressure
  is rejected because planning evidence and cached manifest hashes can reduce
  lookup work, but they cannot prove the bounded queue order or durable chunk
  acknowledgements needed to recover after pause or crash.
- compressed-remote-index-and-cached-file-digest-skips-large-upload-resume-after-pause
  is rejected because planning evidence, cached digests, and a pause can reduce
  recovery work, but they cannot prove which chunk acknowledgements survived
  the pause or restore the guarded publish barrier.
- compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-resume-
  after-pause is rejected because planning evidence and cached receipts can
  reduce replay work, but they cannot prove the bounded queue order, the
  surviving acknowledgements, or the guarded publish barrier after a pause or
  crash.
- compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-
  after-pause is rejected because planning evidence and cached file hashes can
  trim duplicate hashing, but they cannot prove which chunk acknowledgements
  survived the pause or restore the guarded publish barrier.
- compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-
  backpressure is rejected because planning evidence and bounded fan-out can
  reduce duplicate work, but they cannot prove the sender kept bounded queue
  order, the surviving chunk acknowledgements, or the guarded publish barrier
  after a pause or crash.
- compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-chunk-
  upload-after-pause is rejected because planning evidence and cached chunk
  hashes can trim duplicate hashing, but they cannot prove which chunk
  acknowledgements survived the pause, whether backpressure stayed bounded, or
  that the guarded publish barrier remained intact.
- compressed-remote-index-and-cached-chunk-digests-skips-large-upload-chunk-
  upload-after-pause is rejected because planning evidence and cached chunk
  digests can trim duplicate hashing, but they cannot prove which chunk
  acknowledgements survived the pause, whether backpressure stayed bounded, or
  that the guarded publish barrier remained intact.
- compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing
  is rejected because planning evidence and cached chunk receipts can trim
  duplicate replay, but they cannot prove the next bounded window still
  matches the live queue order or restore the guarded publish barrier after
  failure.
- compressed-remote-index-and-compressed-chunk-ledger-skips-large-upload-publish
  is rejected because compressed planning evidence and compressed chunk ledgers
  can trim replay work, but they cannot prove which chunk acknowledgements
  survived failure or that the live compare still holds.
- compressed-remote-index-and-compressed-upload-queue-skips-large-upload-publish
  is rejected because planning evidence and smaller queued buffers can reduce
  memory pressure, but they cannot prove which chunk acknowledgements
  survived failure or that the live compare and publish barrier still hold.
- compressed-remote-index-and-parallel-chunk-sends-skips-backpressure is
  rejected because planning evidence and parallel chunk sends can reduce wait
  time, but they cannot prove the sender kept bounded queue order, complete
  chunk receipts, and journal evidence across a pause or crash.
- compressed-remote-index-and-parallel-chunk-and-row-fanout-skips-large-upload-
  and-plugin-update-recovery-after-pause is rejected because extra fan-out can
  reduce wait time, but it cannot prove which chunk acknowledgements, row
  receipts, live compares, or atomic-group barriers survived a pause on the
  large-upload and plugin-update paths.
- compressed-remote-index-and-unbounded-row-batch-parallelism-skips-plugin-install-
  barrier is rejected because planning evidence and unbounded row-batch fan-out
  can reduce lookup time, but they cannot prove the per-row preconditions,
  group barrier, or durable recovery evidence for a plugin install after a
  pause or crash.
- compressed-remote-index-and-unbounded-hash-fanout-skips-backpressure is
  rejected because planning evidence and hash fan-out can reduce lookup time,
  but they cannot prove bounded queue order, durable hash receipts, or the
  recovery evidence needed after a pause or crash.
- compressed-remote-index-and-bounded-chunk-parallelism-skips-large-upload-
  publish-after-pause is rejected because planning evidence and bounded chunk
  fan-out can reduce duplicate work, but they cannot prove the live publish
  compare or the durable chunk receipts needed to expose staged bytes safely
  after a pause.
- batched-receipt-journal-flush is rejected because journal batching can reduce
  fsync work, but it cannot replace the raw chunk, row, or group receipts
  needed to classify a crash, retry, or pause.
- compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-update-
  backpressure is rejected because planning evidence and receipt batching can
  reduce journal cost, but they cannot prove which row acknowledgements
  survived the pause or restore the atomic-group barrier.

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
  journal lag forces the sender to pause instead of guessing which work landed.
  journal fsync falls behind.
- Explicit backpressure pause records in the model so large uploads and plugin
  changes cannot claim success just because the sender stopped producing.
- Failure injection before and after every durable boundary: chunk ack, batch
  commit, group staging finalize, and atomic group commit.

The deterministic model in `scripts/bench/performance-model.js` captures these
benchmark shapes without touching a live site. It should stay aligned with the
planner invariants: speedups can reduce bytes, round trips, and duplicate work,
but cannot remove preconditions or split atomic groups.
The executable benchmark should still prove remote-index planning, compression
choices, and backpressure pauses on the large-upload, plugin-install, and
plugin-update workloads, so a fast path never hides the failure boundaries it
is meant to preserve.
That means the same run should keep file hashing, chunk upload, database row
batches, remote-index probes, compression decisions, and pressure pauses
visible before the guarded publish or atomic-group commit can happen.
It should also expose the exact durable boundaries that recovery depends on:
chunk acknowledgements and guarded file publish for large uploads, row batch
commit records for plugin installs, group-staging finalize records for plugin
updates, and the atomic-group commit barrier that keeps coupled members
visible together.

The model intentionally treats receipts, cursors, and pressure budgets as
first-class fields. A benchmark that only proves fewer requests were made is not
enough; it must also prove which chunks, row batches, and group members can be
resumed after a failure.
The executable guarded-executor report should make those boundaries visible in
the same run: chunk receipts for the large upload, row receipts for the plugin
install, group-finalize evidence for the plugin update, plus the remote-index,
compression, and backpressure decisions that led to those outcomes.

The important rejection cases are modeled too:

- chunk receipts are required before a staged chunk can be considered complete.
- full-file digests can skip rehash work, but they cannot replace missing
  chunk receipts during resume.
- plugin installs cannot publish files early or activate before validators pass.
- remote indexes can guide planning only and never replace live apply
  preconditions.
- remote indexes plus cached package hashes still cannot skip plugin
  dependency checks, metadata writes, or the atomic-group commit.
- backpressure pauses upstream producers instead of compressing away evidence
  or treating an unacknowledged buffer as success.
- compressed durable receipt logs are allowed only as recovery-evidence
  transport, with stable receipt keys preserved so the original live
  precondition and atomic-group barrier still decide success.
- batched durable-receipt flushes are allowed only as journal-lag control, not
  as proof that a pause or crash already survived the live compare.
- compressed receipt logs cannot authorize apply after a pause, because the
  flushed log still does not prove the live compare or atomic-group barrier
  survived failure.

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
those stable-reference checks are missing or false. The claim gate now also
fails closed if the postmeta reference count no longer matches the row count,
so a partial graph-identity summary cannot masquerade as a complete same-site
proof. The next proof needed is a
production-shaped executor that returns storage-backed receipts for chunk
staging, commits plugin-owned row batches with per-row hashes inside a bounded
batch primitive, and exposes one atomic group commit record that recovery can
inspect after a lost response or process failure.

The model exposes three contract lists that tests should keep current:

- `fastPathGates` records the skip, live precondition, atomic group, and
  recovery gates that every speedup has to satisfy.
- `safeFastPaths` records each safe proposal's benefit, allowed shortcut,
  guardrails, gate proofs, visibility boundary, and failure evidence.
- `safeSpeedupAreas` covers file hashing, chunk upload, database row batching,
  remote indexes, compression, parallelism limits, and backpressure.
- `rejectedFastPaths` records proposals that are not allowed because they
  bypass preconditions, split atomic groups, publish staged data early, confuse
  canonical hashes with transport encoding, or lose durable progress evidence.
  Each rejection names the broken gate so precondition bypasses and atomic group
  splits stay visible in benchmark review.
- The bench fixture now ships a narrower `large-upload-and-plugin-install-recovery-evidence`
  subset alongside the broader release-safety fixture. That smaller shape keeps
  the large upload and plugin install recovery paths visible without relying on
  the release bundle to stand in for them, and it still exercises chunk
  receipts, row receipts, remote-index planning, compression, backpressure,
  durable flushing, and the guarded commit barriers.
- Safe chunk-upload speedups can compress transit frames and reuse plan-scoped
  receipts, but only when the receipts remain durable and the final publish
  still performs the live compare.
- The workload list includes a large upload, a dependency-heavy plugin install,
  and a dependency-heavy plugin update so the model covers both first-time
  installs and subsequent coupled changes. Those workloads must expose chunk
  receipts, row receipts, and group-finalize records directly so recovery can
  classify old, new, or blocked without guessing from throughput alone.
- The same benchmark run should keep the file-hash, chunk-upload, database-row,
  remote-index, compression, parallelism, and backpressure evidence visible for
  the large upload and plugin install paths, rather than collapsing them into a
  tiny-row microbenchmark that hides the recovery boundaries.
- `failureInjectionBoundaries` names the durable transitions that benchmarks
  must exercise: chunk ack, database batch commit, group staging finalize, and
  atomic group commit.

Rejected fast paths stay rejected even when they look fast on paper:

- File hashing cannot fall back to mtime-only, size-only, or path-only
  equality when that would skip a live remote hash check.
- File hashing cannot use a cached hash ledger to skip the guarded publish
  compare after a large-upload resume, because the ledger only trims duplicate
  rehash work and does not prove which chunk acknowledgements survived the
  pause.
- Chunk upload cannot publish staged chunks into the live file path before the
  finalize compare-and-swap.
- Database batching cannot use a table checksum, row count, or blind SQL replay
  as a substitute for per-row compare-and-swap.
- Remote indexes cannot authorize apply writes or replace the live precondition
  check at mutation time.
- Compression cannot make encoded bytes the canonical resource value.
- Parallelism cannot bypass the atomic group commit barrier.
- Parallelism cannot finalize large uploads or plugin installs from multiple atomic groups at once, because the combined drain hides which group owns the partial failure and which receipts still need replay.
- Unbounded database parallelism cannot skip the plugin-install atomic-group commit, because queue speed does not prove which group owns each row batch or preserve the visibility barrier after failure.
- Parallelism limits still matter even when chunk hashing or row batching is
  already guarded by receipts; unbounded fanout can still outrun the journal
  and make a retry ambiguous after a pause.
- Unbounded upload parallelism cannot skip backpressure just because chunk
  receipts exist or the remote index was compressed.
- Unbounded database parallelism cannot skip atomic group barriers just because
  the plugin update planner already has a dependency graph.
- A compressed remote index plus cached chunk receipts cannot skip large-upload
  backpressure, because the receipts do not prove the queue stayed bounded or
  that durable acknowledgements survived a pause or crash.
- A compressed remote index plus cached chunk digests cannot skip large-upload
  backpressure after a pause, because the digests do not prove which
  acknowledgements survived or that the queued work still has durable journal
  evidence for recovery.
- A compressed remote index plus cached chunk digests cannot skip large-upload
  chunk upload after a pause, because the digests do not prove which chunk
  acknowledgements survived, whether backpressure stayed bounded, or that the
  guarded publish barrier is still intact.
- A compressed remote index plus a cached file hash cannot skip the
  large-upload resume-and-publish boundary after a pause, because the hash does
  not prove which chunk acknowledgements survived or that the guarded publish
  barrier still applies.
- A compressed remote index plus a cached file hash cannot skip large-upload
  chunk upload after a pause, because the hash does not prove which chunk
  acknowledgements survived the pause, whether backpressure stayed bounded, or
  that the guarded publish barrier is still intact.
- A compressed remote index plus a cached file hash cannot skip large-upload
  window sizing after a pause, because the hash does not prove which chunk
  acknowledgements survived, how the next bounded window should be ordered, or
  that the guarded publish barrier is still intact.
- A compressed remote index plus a cached file hash cannot skip chunk-hash
  backpressure after a large-upload pause, because the hash does not prove the
  queue stayed bounded, which acknowledgements survived, or that the guarded
  publish barrier still applies.
- A compressed remote index plus a cached file hash cannot skip large-upload
  publish after a pause and backpressure event, because the hash does not
  prove which acknowledgements survived or that the guarded publish barrier is
  still intact.
- A compressed remote index plus a cached file hash cannot skip parallel
  chunk sends and publish after a pause, because the hash does not prove the
  live publish precondition, which chunk receipts survived the pause, or that
  extra fan-out preserved the guarded publish barrier.
- A compressed remote index plus a cached file fingerprint cannot skip
  large-upload resume after a pause, because the fingerprint does not prove
  which chunk acknowledgements survived or restore the guarded publish
  barrier.
- Backpressure cannot drop receipts or summarize evidence so recovery loses the
  ability to classify the remote state.
- A drained queue cannot prove that the remote acknowledged every staged chunk
  or row.
- A batched receipt flush can save fsyncs, but it cannot replace the raw
  receipts or move the commit boundary that keeps a plugin install or large
  upload recoverable.
- A compressed remote index plus cached row-batch receipts cannot skip
  plugin-install backpressure, because the receipts do not prove bounded queue
  order or journal evidence across a pause or crash.
- A compressed remote index plus batched row-receipt flushes cannot skip
  plugin-install finalize after a pause, because batching reduces fsync cost but
  does not prove the live row compares, dependency checks, or atomic-group
  finalize survived the interruption.
- A compressed receipt log can reduce recovery storage, but it cannot authorize
  apply or collapse the atomic-group boundary that still guards plugin writes.
- Cached row receipts cannot skip plugin-install writeback, because the
  metadata writes and atomic-group barrier still need durable proof.
- Cached row receipts cannot skip plugin-update finalize, because the live row
  compares, dependency checks, and atomic-group finalize still need durable
  proof.
- A compressed remote index plus a cached file hash cannot skip a release-
  bundle commit after a pause, because planning evidence and cached hashes do
  not prove the chunk receipts, row receipts, backpressure state, or
  atomic-group commit barrier survived failure.
- A compressed remote index plus cached row-batch receipts cannot skip a
  release-bundle commit after a pause, because cached batch receipts do not
  prove the mixed upload-and-database bundle, the live row preconditions, or
  the atomic-group commit barrier survived failure.
- A compressed remote index plus a cached file hash cannot skip plugin-install
  and large-upload recovery after a pause, because planning evidence and cached
  hashes do not prove the live row compares, chunk acknowledgements, or
  atomic-group commit barriers survived failure.
- A compressed remote index plus a cached file hash cannot skip plugin-update
  finalize after a pause, and cached row-batch receipts cannot skip
  release-bundle commit after a pause, because neither shortcut proves the live
  row preconditions or the atomic-group barrier survived failure.
- A compressed remote index plus a cached release manifest and batched receipt
  flushes cannot skip release-bundle planning after a pause, because planning
  evidence and fsync savings do not turn into apply authorization or prove the
  dependent files and rows survived failure.

The common failure mode across these rejections is the same: the shortcut
removes either a live precondition check, a durable receipt, or the atomic
group barrier that keeps coupled work visible together.

- File hashing and chunk upload are rejected when they try to use cached
  digests, chunk ledgers, or remote-index cursors as a substitute for the live
  publish compare.
- Database row batching is rejected when it tries to collapse row receipts,
  row compares, or dependency checks into a checksum, compressed summary, or
  cross-group batch.
- Remote indexes are rejected whenever they try to authorize apply writes,
  skip live revalidation, or act as a lock instead of planning evidence.
- Compression is rejected whenever it tries to change the canonical resource
  value or replace raw receipts with summaries.
- Parallelism limits are rejected whenever they are widened past the atomic
  group boundary or used to merge finalization for unrelated groups.
- Parallel chunk sends are rejected when they try to skip large-upload
  backpressure after a pause, because queue fan-out cannot prove which chunk
  acknowledgements survived or preserve journal order for recovery.
- Backpressure is rejected whenever it drops receipts, treats an empty queue as
  completion, or lets a drained buffer bypass the guarded publish barrier.
