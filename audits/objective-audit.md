# Objective Audit

## Verdict

The repository currently proves an early JSON-snapshot safety model plus
lab-only, fixture-scoped Playground push endpoints, including a local-only REST
slice over real HTTP, not a production-safe WordPress push transport. That
distinction matters: most of the strongest no-data-loss, reliability, and speed
claims still depend on design intent, not direct executable evidence at the
production boundary.

Release status: **not releasable as a production push path**. It is acceptable
as a lab harness for planner invariants, fixture-scoped Playground protocol
evidence, and local-only HTTP-style REST evidence if all public status and docs
keep that scope explicit.

## Explicit Requirements From The Objective

The objective is to push local edits back to the original source WordPress site
after a pull, while the source site may still be live and may have changed.
From that, the minimum requirements are:

| ID | Requirement |
| --- | --- |
| R1 | Use a three-way comparison between pulled base, edited local state, and current live remote state before any mutation. |
| R2 | Preserve every remote change made after the pull unless a deliberate, reviewed conflict resolution says otherwise. |
| R3 | Apply local changes only when the remote resource preconditions still match immediately before mutation. |
| R4 | Stop on local/remote conflicts and keep durable evidence explaining what blocked the push. |
| R5 | Treat coupled file, database, plugin, activation, and option changes as atomic groups; never report success for a split plugin/application state. |
| R6 | Avoid generic merges for plugin-owned or serialized data unless a plugin-specific validator or merge driver proves the repair. |
| R7 | Survive failures with a known final state: old state, new state, or blocked recovery state with artifacts. |
| R8 | Be resumable across chunks and process failures without weakening preconditions or conflict policy. |
| R9 | Prove behavior against real WordPress file and database stores, not only object snapshots. |
| R10 | Prove that speed work is bounded, chunked, and benchmarked, and that it does not bypass no-data-loss checks. |
| R11 | Keep dry-run output honest: a dry run is only a plan, not a guarantee that a later apply will succeed on a live source. |
| R12 | Provide audit records sufficient for an operator to understand skipped remote changes, applied local changes, conflicts, blockers, and recovery state. |

## Evidence Table

Indirect evidence is treated as insufficient. Design notes are useful, but they
do not prove the behavior until executable checks exercise the same boundary the
production system will depend on.

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 three-way planning | `createPushPlan()` enumerates file, plugin, and row resources from base/local/remote and compares stable hashes. Tests cover unchanged remote, remote-only changes, non-overlapping changes, direct conflicts, and Playground fixture snapshots from real WordPress rows, options, and files. | No real Reprint exporter/importer snapshots. No coverage for WordPress IDs, postmeta relationships, taxonomies, plugin tables, serialized options, or multisite resources beyond narrow Playground fixture uploads/options/posts. | Yes. A production claim needs broader fixture-backed WordPress snapshots and resource identity rules. |
| R2 preserve remote changes | `keep-remote` decisions are produced when local equals base and remote differs. Tests assert a remote-only post title survives. | Only same-resource hash cases are tested. Cross-resource semantic loss is untested, such as remote changing a post while local changes dependent postmeta, attachments, menus, or plugin options. | Yes. Remote preservation is not proven for WordPress data graphs. |
| R3 preconditioned apply | `applyPlan()` validates mutation preconditions before applying to a staged clone. Tests reject drift on a planned file mutation. The Playground protocol smokes reject stale apply with `PRECONDITION_FAILED`; the local REST lab returns `412 PRECONDITION_FAILED` while preserving the drifted remote fixture. | Preconditions are lab hash checks, not production compare-and-swap writes on files, MySQL, SQLite, or authenticated Reprint HTTP endpoints. No test covers remote drift during a multi-resource production apply. | Yes. This is the central no-data-loss gate and currently has no production-boundary proof. |
| R4 conflict stop and evidence | Direct same-resource conflicts become `conflict`, and `applyPlan()` refuses non-ready plans. Plugin-owned row conflicts get a separate class. Playground conflict dry-run/apply return `PLAN_NOT_READY`; the local REST lab returns `409 PLAN_NOT_READY` with row, file, and plugin-data audit classes. | No reviewed resolution workflow, persisted conflict record, operator audit trail, or fixtures for realistic plugin-owned data. | Yes. Conflict detection without durable evidence is insufficient for release. |
| R5 atomic coupled changes | Push intents can group resources; tests cover missing dependencies, same-group dependencies, outside-group blocking, remote dependency drift, incompatible version ranges, and dependency hash mismatches. `applyPlan()` stages a clone before returning. | No transaction boundary exists for actual file/database/plugin writes. `requireAtomic` is metadata, not a production enforcement mechanism. Plugin activation, rollback, and mixed DB/filesystem failure are untested. | Yes. Partial plugin/application state is explicitly rejected by project docs. |
| R6 plugin/serialized data safety | Rows with `__pluginOwner` are classified as `plugin-data-conflict` on direct conflicts. Docs reject generic serialized-data merges. | No plugin validator contract, no real plugin fixtures, no serialized PHP option parser, and no proof that plugin-owned tables/options are discovered consistently. | Yes. This is a direct data-loss risk. |
| R7 crash recovery | One injected failure before staged clone return proves the original input object is not mutated in that narrow path. Source notes identify crash-consistency goals. | No durable journal, no kill-process tests, no after-commit failure tests, no recovery command, and no proof that the system can classify old/new/blocked state after interruption. | Yes. Current failure proof is not crash-recovery proof. |
| R8 resumable chunks | Source notes cite resumable pull and recommend chunked push. | No chunk journal, cursor, idempotency key, retry contract, resume tests, or stale-plan invalidation tests. | Yes. A live push cannot rely on one in-memory apply call. |
| R9 real WordPress execution | Playground base/local/remote fixtures export real WordPress posts/options/files, guarded apply writes a fresh source fixture with WordPress-visible readback, a fixture-scoped PHP endpoint smoke covers dry-run/apply/stale/conflict paths, and the standalone local REST lab verifies `reprint-push-lab/v1` routes over real HTTP on `127.0.0.1`. | No production Reprint HTTP source mutation endpoint, no production auth/session/nonce proof, no Docker/live-source executor, no database transaction tests, no filesystem permission tests, and no plugin activation/custom-table semantics. | Yes. The current project is a lab model only. |
| R10 speed | The model mutates only changed resources instead of replacing the whole site. Progress page marks fast path at 12 percent and lists chunking/streaming as open. | No benchmarks, complexity budget, large-file streaming, parallel upload tests, memory ceiling, or latency targets. | Yes for any speed claim beyond "not whole-site replacement in the model." |
| R11 honest dry run | README states apply can refuse if the live remote changes after dry run. Drift tests cover file mutation drift and Playground fixture stale apply. The protocol smokes verify ready apply with a supplied dry-run receipt, reject missing receipts with `MISSING_DRY_RUN_RECEIPT`, and reject tampered receipts with `RECEIPT_MISMATCH`. The local REST lab verifies the corresponding HTTP statuses: `428`, `409`, and `412`. Lab receipts bind to the plan fingerprint/hash, mutation and precondition sets, ordered resource keys, and dry-run actual hashes. | No stale-plan expiry, production signing/auth binding, UI/operator warning tests, or concurrency test for remote changes between individual production writes. | Blocking for UX/reliability release, not for the current lab scope. |
| R12 audit records | Plans include mutations, preconditions, decisions, conflicts, blockers, and atomic groups. The lab PHP endpoint records bounded fixture-scoped lab journal/audit option events for dry-run, apply, stale, non-ready, missing-receipt, and mismatch outcomes; the local REST lab reads the journal over `GET /journal`. | Records are still fixture-scoped lab option events unless the caller saves them. There is no durable production audit log, no recovery artifact schema, no redaction policy, and no operator-facing report. | Yes for production. |

## Test Audit

The current tests are useful, but they prove only narrow planner branches and
pure in-memory apply behavior.

| Test area | What it proves | What it does not prove |
| --- | --- | --- |
| Local changes on unchanged remote | Planner creates mutations and staged apply returns local file/row values. | That WordPress writes are safe, transactional, ordered correctly, or reversible. |
| Remote-only changes | A direct remote-only row change is not overwritten. | Preservation of related data graphs, generated data, remote uploads, postmeta, menus, taxonomies, plugin tables, or object-cache state. |
| Non-overlapping changes | A local file addition and remote post change can coexist in the returned snapshot. | That "non-overlapping" is semantically true in WordPress. A file and database row can be coupled even when their resource keys differ. |
| Direct conflicts | Same-row divergent edits block apply and leave the input object untouched. | Delete/edit conflicts, rename/move conflicts, binary file conflicts, row identity collisions, foreign-key-like relationships, or reviewed conflict resolution. |
| Plugin-owned data conflict class | A manually annotated row gets `plugin-data-conflict`. | Discovery of plugin ownership in real tables/options or safe handling of serialized plugin data. |
| Atomic plugin install dependency | Missing dependencies, same-group dependencies, outside-group dependency mutations, remote dependency drift, incompatible version ranges, and dependency hash mismatches are covered. | Active/inactive state, activation hooks, mixed filesystem/database failure, or rollback. |
| Atomic group success | A grouped plugin stack applies to the staged object. | Production atomicity. The code returns a complete cloned site; it does not perform partially observable remote writes. |
| Remote drift after dry run | A changed planned file hash causes `PRECONDITION_FAILED`. | Drift on non-mutated dependencies, drift during an apply batch, stale plan expiry, or compare-and-swap at the storage layer. |
| Injected failure before commit | Throwing during staged mutation leaves the original object unchanged. | Crash consistency. There is no committed partial state, journal, recovery scan, or kill-process boundary in this test. |

## Additional Findings

1. **Atomic group membership is caller-trusted.** If a push intent omits a
   coupled resource, the planner has no independent way to discover that the
   group is incomplete. Production needs validators that can reject incomplete
   file/database/plugin sets before any write.

2. **The failure test is weaker than the reliability claim.** It proves that a
   JavaScript object is not mutated when a throw happens before a returned
   clone. It does not prove recovery after an interrupted process, failed file
   write, committed DB transaction, HTTP timeout, plugin activation fatal, or
   operator retry.

3. **Speed has almost no proof.** The only positive evidence is resource-level
   diffing in a small object model. There are no large-site benchmarks, memory
   ceilings, streaming assertions, or chunk scheduling tests. Speed claims
   should stay explicitly provisional.

4. **The Playground endpoints are intentionally not production endpoints.** They
   prove a narrow fixture-scoped protocol shape, including read-only dry-run,
   required receipt-backed ready apply, stale rejection, receipt mismatch
   refusal, conflict refusal, journal readback, and local-only REST routes under
   `reprint-push-lab/v1`.
   They do not provide production auth, sessions, durable journals, source-site
   capability checks, receipt signing, or receipt expiry.

## Required Release Gates

Before this project can claim production-grade no-data-loss push behavior, it
needs direct proof for these gates:

1. Broader real WordPress fixture suite covering files, uploads, posts, postmeta,
   taxonomies, options, plugin tables, serialized PHP data, plugin activation,
   and multisite if in scope.
2. Storage-level compare-and-swap or equivalent guarded writes for every file
   and database mutation.
3. Durable apply journal with recovery tests that kill the process at every
   write boundary and prove old/new/blocked state classification.
4. Atomic group enforcement for coupled file/database/plugin operations,
   including rollback or blocked recovery artifacts after partial external
   effects.
5. Plugin validator/merge-driver contract with at least one real plugin fixture
   and explicit fallback to preserve remote state.
6. Stale-plan and concurrency tests for remote changes before apply, during
   apply, and between chunks.
7. Benchmarks with large files and large tables proving speed improvements do
   not skip preconditions, journals, or validators.

Until those gates exist, the honest claim is: **the lab demonstrates planner
invariants for simplified JSON snapshots, fixture-scoped Playground push
protocol smoke, and local-only HTTP-style REST behavior; it does not yet prove
no data loss, reliability, or speed for a live WordPress push.**
