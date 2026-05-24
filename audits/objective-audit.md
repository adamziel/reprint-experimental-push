# Objective Audit

## Verdict

Not releasable as a production WordPress push path.

The repository has credible lab evidence for planner invariants, fixture-scoped recovery, a guarded executor model, and several local Playground flows. That is still not direct proof for the objective claim: pushing local edits back to a live source WordPress site without losing concurrent source changes, while remaining reliable and fast.

The current tests support a narrower statement:

- This is an executable safety model and local Playground lab.
- It is not yet a production-backed source mutation system.
- The strongest claims remain blocked until production storage, auth, recovery, and benchmark evidence exists.

## Evidence Standard

Only direct, executable evidence at the claimed boundary counts.

Model tests are useful, but they are indirect for production claims unless they exercise the same authentication, storage, journal, crash, concurrency, and WordPress data semantics that production will depend on. A test that proves a fixture row is guarded does not prove arbitrary MySQL/InnoDB rows are guarded. A test that proves a replay envelope is inspectable does not prove a live source site can recover after a process dies between writes.

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source site after a pull, even when the source remains live and may have changed. The release promise therefore needs all of these:

| ID | Requirement |
| --- | --- |
| R1 | Persist a complete pull-base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, and protocol metadata. |
| R2 | Read live remote state before planning and compare base, local, and remote in a three-way plan. |
| R3 | Preserve remote-only changes by default, including deletes, plugin state, files, rows, and related resources. |
| R4 | Stop on local/remote conflicts with durable, redacted evidence an operator can inspect. |
| R5 | Recheck a live precondition immediately before every write. |
| R6 | Enforce storage-boundary guarded writes, or equivalent CAS, for every production DB and filesystem mutation. |
| R7 | Treat coupled file, DB, plugin, option, activation, and schema changes as atomic groups. |
| R8 | Reject plugin-owned, serialized, custom-table, or schema-sensitive data unless a validator or semantic driver proves the mutation. |
| R9 | Authenticate and authorize mutation with production credentials, scoped push permissions, replay protection, and TLS outside local-only tests. |
| R10 | Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed remote state. |
| R11 | Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery. |
| R12 | Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, and operator retries. |
| R13 | Prove behavior against real WordPress data shapes: uploads, posts, postmeta, terms, users, options, plugin tables, plugin activation, schemas, and multisite if in scope. |
| R14 | Redact raw private data from plans, journals, conflict reports, recovery reports, and test artifacts. |
| R15 | Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard. |
| R16 | Provide a release test suite that actually runs the safety, recovery, auth, storage, plugin, and performance gates needed for public claims. |

## Evidence Table

| Req | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 base manifest | The planner and Playground fixture flows carry stable resource keys, hashes, and snapshot metadata for the modeled resources. | No production pull-base manifest contract. No proof for complete WordPress identity mapping, schema fingerprints, object cache state, arbitrary plugin ownership, multisite, or media metadata completeness. | Yes |
| R2 three-way planning | `createPushPlan()` compares base, local, and remote snapshots. `npm test` covers local-only changes, remote-only changes, independent changes, direct conflicts, deletions, file topology conflicts, plugin-state coupling, and atomic dependency metadata. | No production remote hash listing contract. No test starts from a real Reprint pull and pushes back through production-backed mutation internals. | Yes |
| R3 preserve remote changes | Tests keep remote-only row and plugin changes, stop local deletion versus remote update, stop directory deletion that would hide a remote-only descendant, and stop file type swaps that would hide remote-only descendants. | No proof for semantic graph preservation across posts/postmeta/attachments/terms/menus/options/plugin tables. No proof for coupled resources that are not directly mutated. | Yes |
| R4 conflict stop and evidence | Conflicts, blockers, hashes, change kinds, and plugin-owned conflict classes are represented. Several tests assert that raw fixture values are not leaked into conflict and journal output. | No durable production conflict artifact, operator workflow, resolution path, complete redaction schema, or production audit report. | Yes |
| R5 immediate preconditions | `applyPlan()` validates preconditions before model apply. Playground smokes verify stale dry-run/apply refusal and just-in-time pre-write hash rejection for selected fixtures. | The production-shaped write path is still lab-backed. No proof that every production mutation rechecks liveness immediately before its write under real source-site concurrency. | Yes |
| R6 storage-boundary guards | The repository includes guarded DB/file-write smokes and a guarded executor benchmark model. The current test suite also checks the guard behavior on the fixture paths it knows about. | No production MySQL/InnoDB CAS proof, transactions, locks, rollback, filesystem `fsync`, arbitrary file guarding, arbitrary DB insert/delete guarding, schema changes, activation side effects, or production-backed source mutation. | Yes |
| R7 atomic groups | Planner and executor tests cover dependency presence, same-group dependencies, outside-group blocking, dependency hash/version/activation checks, and forged ready-plan rejection. | No general plugin install/update/activation support, no production rollback, no atomic visibility proof across files/DB/plugin activation, and no proof for arbitrary plugin side effects. | Yes |
| R8 plugin-owned data | Unknown plugin-owned rows block. The forms lab allows only exact fixture option/postmeta/custom-table policies with explicit plugin evidence. | No production plugin validator contract, serialized PHP data parser/validator, generic custom-table driver, schema migration driver, or proof that arbitrary plugin-owned data is discovered consistently. | Yes |
| R9 auth and authorization | The repository has authenticated local Playground routes and signed-request evidence for lab flows. | This is still lab auth. No production credentials, scoped push permissions, TLS deployment, replay-store cleanup, session lifecycle, rate limiting, or real exporter credential binding. | Yes |
| R10 honest dry-run | Protocol smokes require receipts, reject missing/tampered receipts, bind receipts to plan/preconditions, and reject stale remote state. | No production UI/operator warning tests. No proof for changes between production chunks or between production writes beyond fixture hooks. | Yes for production UX and source mutation |
| R11 durable recovery | Recovery tests classify old remote, fully updated remote, and blocked recovery states. JSONL journal tests append with monotonic sequences and `fsync` requests, and block missing-target and corrupt/truncated journal cases. | No production DB-table journal, no storage-level crash matrix, no target-write `fsync` proof, no exactly-once production writes, no production leases/fencing/claim expiry, no rollback, and no automatic repair policy. | Yes |
| R12 idempotent resumability | DB journal smokes require an idempotency key, reject same-key/different-body requests, replay committed or rejected results, claim one concurrent same-key executor, finalize missing commits, and handle one all-old stale-claim retry path. | No chunk cursor, production retry contract, production duplicate first-apply test, shared-DB multi-worker proof, stale-plan invalidation across chunks, or production lease/fencing/expiry behavior. | Yes |
| R13 real WordPress shapes | Playground fixtures exercise real WordPress-visible posts, options, files, selected postmeta, one custom table, fixture plugin metadata, and a packaged temporary plugin route. | Coverage is narrow. No production-backed source mutation endpoint, no large live WordPress fixture matrix, no media attachment graph, taxonomy/menu/user/meta coverage, no arbitrary plugin tables, no multisite, and no runtime side-effect proof. | Yes |
| R14 redaction | Several tests assert that raw fixture strings do not appear in conflicts, journals, storage evidence, or recovery reports. | Redaction is checked against selected fixture strings and field names only. No formal allowlist schema for all future plan, journal, conflict, recovery, auth, or benchmark artifacts. | Yes for production |
| R15 speed | `test/performance-model.test.js` proves a deterministic model for large uploads, chunk staging, bounded DB batches, atomic visibility, parallelism limits, and backpressure. | No runtime benchmark, no transfer implementation proof, no memory ceiling, no latency/throughput target, no large-site run, and no proof that the model is wired into the executor. | Yes for any speed claim |
| R16 release suite | `npm test` passed during this audit with 89 tests, 0 failures, and 0 skips. | No CI workflow was found. `npm test` does not run the long Playground smokes that support most of the stronger lab claims. The release gate is still fragmented across manually invoked commands. | Yes |

## Test Audit

### What `npm test` Actually Proves

`npm test` passed during this audit with 89 tests, 0 failures, 0 skips, and 0 todos.

- Planner no-overwrite invariants for simplified JSON snapshots, including deletion preconditions, delete/update conflicts, file topology conflicts, plugin-state coupling, and atomic dependency metadata.
- Plugin-owned resource blocking, stale owner-plugin context blocking, and exact forms-lab custom-table driver checks.
- JSON-model recovery journal classification, append and `fsync` requests, missing-target blocking, and corrupt/truncated journal blocking.
- Guarded executor benchmark assertions for large uploads, chunk staging, bounded DB batches, atomic group visibility, backpressure, and rejection of unsafe fast paths.
- Snapshot-apply gate checks for named lab plugin resources, named lab plugin file paths, and exact forms-lab custom-table rows.

That is useful evidence, but it is still not a production source-site push proof. It does not exercise a production mutation endpoint, real production credentials, real MySQL/InnoDB durability, live concurrent WordPress traffic, or a measured large-site transfer.

### What The Default Suite Does Not Prove

1. It does not prove no data loss on a live source site.
   The planner and executor are good at preserving modeled remote-only changes, but the tests are still fixture graphs and JSON snapshots. They do not cover the full WordPress resource graph.

2. It does not prove reliability at the production boundary.
   Recovery and idempotency are modeled through journals and fixture smokes. There is no production-backed crash matrix across every write boundary.

3. It does not prove speed.
   The benchmark file validates the shape of a speed model and safety gates. It does not move bytes, mutate a source site, measure memory, or report throughput.

4. It does not prove the release suite is complete.
   The strongest evidence is spread across optional scripts. There is no single release gate that automatically runs the safety, auth, storage, recovery, and performance checks together.

5. It does not prove production auth.
   The authenticated evidence is lab-auth evidence, not production source-site authorization.

### Release-Blocking Gaps

1. No production-backed source mutation endpoint has been proven.
2. No complete WordPress graph coverage exists for the stated no-data-loss claim.
3. No production storage durability proof exists for every DB and filesystem mutation type.
4. No measured benchmark supports the speed claim.
5. No unified release suite exists that runs the evidence required by the claim.

## Practical Conclusion

The repository is in a better state than a bare research prototype. It now proves several important safety properties in a controlled lab.

It still does not justify a production release claim for pushing local edits back to a live WordPress source site with no data loss, high reliability, and good speed.
