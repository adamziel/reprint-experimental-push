# Objective Audit

## Verdict

The repository is **not releasable as a production WordPress push path**.

The codebase has credible lab evidence for planner behavior, recovery
classification, redaction, and several fixture-scoped WordPress smokes. It does
**not** yet prove the objective claim: safely pushing local edits back to a live
source WordPress site without losing concurrent source changes, while also being
reliable and fast.

The current strongest proof is still mostly indirect:

- unit tests over JSON models and fixture policies
- benchmark models that describe throughput and buffering rules
- disposable Playground smokes that exercise narrow fixture slices

That is useful, but not enough for a production release claim.

## Objective Requirements

The objective implies the following explicit requirements:

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
| R1 | Fixture snapshots and planners carry stable resource keys and hashes for files, posts, options, plugins, and selected custom-table rows. | No production pull-base manifest contract. No proof for complete WordPress identity mapping, object-cache state, media metadata, taxonomies, users, multisite, or arbitrary plugin ownership. | Yes |
| R2 | `createPushPlan()` compares base/local/remote hashes. `npm test` covers local-only changes, remote-only changes, matching independent edits, conflicts, deletes, topology conflicts, plugin metadata dependencies, and redacted conflict output. | No proof that the live remote listing and the production push path are the same boundary. No test starts from a real pull and returns through production-backed mutation internals. | Yes |
| R3 | Unit tests preserve remote-only file, row, and plugin changes, block local deletion when remote changed, and stop topology changes that would hide remote-only descendants. Playground stale-apply smokes also preserve concurrent drift. | No proof for semantic WordPress graph preservation across posts/postmeta/attachments/terms/menus/options/plugin tables, or for coupled resources not directly mutated by the local change. | Yes |
| R4 | Conflicts and blockers are represented, and selected tests assert that raw fixture values do not leak into conflict or journal artifacts. | No durable production conflict artifact, no operator workflow, no reviewed resolution path, and no formal redaction schema for all future artifacts. | Yes |
| R5 | Model and Playground smokes verify stale refusal and just-in-time pre-write rejection for selected fixtures. | The production mutation path is still lab-backed. No proof every production mutation rechecks liveness immediately before write under real source-site concurrency. | Yes |
| R6 | `test:playground:storage-guarded-db-write` and `test:playground:storage-guarded-file-write` prove selected fixture row and file updates reject drift after a live hash check. | No production MySQL/InnoDB CAS proof, no arbitrary insert/delete proof, no schema-change proof, no activation-sensitive write proof, and no filesystem crash durability proof. | Yes |
| R7 | Planner tests cover dependency metadata, same-group dependencies, outside-group blocking, and forged ready-plan rejection. Atomic install smokes verify one hard-coded fixture plugin bundle. | No general plugin install/update/activation support, no production rollback proof, and no atomic visibility proof across real WordPress file/DB/plugin boundaries. | Yes |
| R8 | The code blocks unknown plugin-owned data and only allows explicit fixture policy for the forms lab table, selected postmeta, and selected option rows. | No production plugin validator contract, no generic custom-table driver, no serialized PHP data validator, and no proof that arbitrary plugin-owned data is discovered consistently. | Yes |
| R9 | Authenticated Playground routes prove a lab auth/signature floor, nonce replay rejection, auth-bound receipts, idempotency keys, and replay semantics. Production-shaped route/package smokes prove route shape and cross-route receipt rejection. | Still lab-backed implementation, lab signing derivation, and a Playground fallback verifier. No production credentials, scoped push auth, TLS deployment, replay cleanup, or real exporter credential binding. | Yes |
| R10 | Protocol and authenticated smokes reject missing, tampered, or stale receipts. | No production UI/operator warning tests. No proof for remote changes between production chunks or between individual writes beyond fixture hooks. | Yes for production claims |
| R11 | JSONL journal tests prove append ordering, `fsync` requests, missing target blocking, corrupt/truncated journal blocking, and replay classification. Playground DB journal and process-kill smokes add useful fixture evidence. | No production DB-table journal, no storage-level crash matrix, no target write `fsync` proof, no durable lease/fencing proof, and no rollback proof. | Yes |
| R12 | DB journal smokes prove idempotency keys, same-key replay, same-key/different-body rejection, one claim winner, missing-commit finalization, and one stale-claim retry path. | No chunk cursor contract, no production retry contract, no multi-worker proof, no stale-plan invalidation across chunks, and no production stale-claim expiry proof. | Yes |
| R13 | Playground fixtures exercise posts, options, files, selected postmeta, one custom table, fixture plugin metadata, and a packaged temporary plugin route. | Coverage is narrow. No production-backed source mutation endpoint, no large WordPress fixture matrix, no media attachment graph, no taxonomy/menu/user coverage, no multisite, and no object-cache/runtime side-effect proof. | Yes |
| R14 | Selected tests assert no raw fixture strings in conflict, journal, storage, and recovery evidence. Hash-only evidence is used in selected storage guard paths. | Redaction is still checked through selected fixture strings and narrow assertions. No formal allowlist schema for all future plan, journal, conflict, recovery, auth, or benchmark artifacts. | Yes for production |
| R15 | `test/performance-model.test.js` proves a deterministic model for large uploads, chunk staging, bounded DB batches, atomic group visibility, parallelism limits, and backpressure rules. | No runtime benchmark, no live transfer, no memory ceiling, no latency/throughput target, no large-site run, and no proof the model is wired into the executor. | Yes |
| R16 | `npm test` passed 89 tests during this audit. The suite covers planner, recovery, redaction, atomic dependency, and benchmark-model logic. | No CI workflow in the repository. `npm test` does not run the longer Playground smokes. The safety-critical scripts are optional and manually invoked, so they are not yet a release gate. | Yes |

## Test Audit

### What `npm test` Actually Proves

`npm test` passed with 89 tests, 0 failures, 0 skips, and 0 todos.

What that proves:

- the planner model prefers remote preservation over blind overwrite
- local deletions are only planned behind preconditions in the model
- conflict objects are redacted in the tested fixture paths
- plugin-owned data is conservatively blocked unless an explicit driver exists
- the recovery journal model classifies old, updated, and blocked states
- the benchmark model enforces guardrails around chunking, batching, atomic groups, and backpressure

What it does **not** prove:

- that the production WordPress push path exists
- that live remote state is always rechecked immediately before every production write
- that arbitrary DB rows, filesystem paths, plugin installs, or schema changes are guarded
- that the default suite measures speed rather than just modeling it

### What The Standalone Smokes Prove

The manually invoked Playground smokes are the best direct evidence in the repo:

- local REST smokes prove dry-run/apply receipt behavior and stale refusal for fixtures
- authenticated Playground smokes prove a lab auth/signature floor, idempotency, and replay semantics
- DB journal smokes prove fixture-scoped claiming, replay, stale-claim retry, and process-kill recovery
- storage guard smokes prove selected fixture DB rows and files are rejected when the JIT hash no longer matches
- plugin atomic smokes prove one hard-coded fixture install shape and failure classification
- production-shaped route/package smokes prove route wiring and cross-route receipt rejection, but still through lab-backed code

These tests are still lab-bound. They do not prove production durability, arbitrary WordPress graphs, production auth, or measured speed.

### Why The Tests Do Not Prove The Claims

1. The default suite is heavy on models and light on live mutation.
2. The best Playground evidence is opt-in, not part of the default release gate.
3. Most coverage is fixture-narrow and does not generalize to arbitrary WordPress data shapes.
4. Recovery evidence shows classification, not a full crash matrix at every write boundary.
5. Speed evidence is descriptive, not measured throughput under load.

## Release Blockers

The current blockers are direct:

1. No production-backed push endpoint has been proven safe under concurrent live-site edits.
2. No production auth, replay, and TLS story has been proven against the real mutation boundary.
3. No broad storage CAS/guard proof exists for arbitrary WordPress DB and filesystem writes.
4. No durable production journal and crash matrix cover every guarded boundary.
5. No release suite or CI gate forces the strongest safety and recovery smokes to run.
6. No measured performance evidence supports the "fast" claim.

## Bottom Line

Keep the claim scoped to this:

**the repository provides lab evidence for push-safety invariants, not production-safe live WordPress push.**
