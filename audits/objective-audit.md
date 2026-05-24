# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The repository now has meaningful lab evidence: three-way JSON snapshot
planning, fixture-scoped Playground apply paths, authenticated local Playground
routes, DB journal/idempotency slices, process-kill and stale-claim smokes,
narrow storage-boundary guards for selected fixture DB rows and upload files,
and a production-shaped `/wp-json/reprint/v1/push/*` route mounted through a
temporary plugin package. That route still reports `labBacked: true`. It is not
direct proof for the objective: pushing local edits back to a live source
WordPress site without losing concurrent source changes, while remaining
reliable and fast.

The honest release claim is narrower: this repository is an executable safety
model and local Playground lab for push invariants. It does **not** yet prove
production no-data-loss, production reliability, or measured speed.

## Evidence Standard

Only executable evidence at the boundary being claimed counts as proof.

Design docs, model tests, and fixture smokes are useful, but they are indirect
for production claims unless they exercise the same authentication, storage,
journal, crash, concurrency, and WordPress data semantics that production will
depend on. A test that proves a local Playground fixture row is guarded does
not prove arbitrary MySQL/InnoDB rows are guarded. A test that proves a JSON
object is not mutated does not prove a source site can recover after a process
dies between file and database writes.

For this audit, indirect evidence also includes planner-only coverage,
fixture-scoped Playground smokes, route-shape tests that still run a lab-backed
implementation, benchmark models that do not measure wall-clock throughput or
memory, and README claims that are stronger than the executed proof.

## Follow-up Audit Pass

This pass treats docs and script names as leads, not proof. Fresh local
verification on 2026-05-25:

- `npm test` passed with 89 tests, 0 failures, and 0 skips.
- `npm run test:playground:production-shaped-push` passed against
  `/wp-json/reprint/v1/push/*`, applied 8 fixture mutations, replayed with zero
  fresh mutation work, rejected cross-route receipts before mutation, and
  classified recovery as `fully-updated-remote`.
- `npm run test:playground:production-plugin-package` passed with the temporary
  `reprint-push` plugin mounted as a normal plugin, the public lab namespace
  disabled, 8 fixture mutations applied, and the final visible fixture surface
  matching local.

A release claim still needs retained run artifacts for the full long smoke set
and, more importantly, proof at the production-backed Reprint source-mutation
boundary.

The default suite passed locally on 2026-05-25, but it is still mostly model
proof plus fixture-scoped lab evidence. Passing it does not close the
production release gap.

| Area | Directly observed proof | Still insufficient | Next proof required |
| --- | --- | --- | --- |
| No-overwrite planner | Unit tests cover unchanged remote mutations, remote-only preservation, deletion behind preconditions, delete/update conflict, directory deletion that would hide a remote-only descendant, file type swap that would hide a remote-only descendant, matching independent edits, plugin dependency drift, stale precondition refusal, and redacted plugin-data conflict evidence. | These are JSON-model resources plus fixture policy, not WordPress graph semantics. The tests cannot prove post/postmeta/attachment/taxonomy/menu/plugin relationships are complete or safe. | Add one real WordPress graph fixture where local and remote edit different related resources, then prove the planner blocks or preserves every relationship explicitly. |
| Recovery and idempotency | Unit tests cover JSONL journal creation, monotonic sequences, per-record `fsync` evidence, old/new/blocked classification, corrupt/truncated journal blocking, missing-target blocking, completed replay, journal envelope mismatch, and partial remote mutation as blocked recovery. Playground smoke source covers DB journal, same-key replay, conflict refusal, process kill, missing-commit finalization, and all-old stale-claim retry. The production-shaped route smoke proves committed replay and recovery inspect for the fixture route profile. | JSONL recovery is still a model. Playground DB recovery is fixture-scoped local storage evidence. The production-shaped route is still lab-backed. None of this proves production MySQL/InnoDB, filesystem durability, leases/fencing, rollback, or every WordPress write boundary. | Kill the production-backed executor at every guarded DB/file/plugin boundary and retain DB journal plus live hash evidence for old/new/blocked classification. |
| Speed | `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove a deterministic model for chunk staging, bounded DB batches, preconditions, atomic group visibility, backpressure, and benchmark evidence gates. | No bytes move in a production executor, no live source site is mutated, and no memory ceiling or throughput target is measured against a real push path. | Run a large-file and large-table benchmark through the executor with receipts, preconditions, journal cursors, retries, and memory/runtime measurements. |

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source
site after a pull, while that source may still be live and may have changed.
The priorities are no data loss, no data loss, reliable, and fast. That implies
these release requirements:

| ID | Requirement |
| --- | --- |
| R1 | Persist a complete pull-base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, and protocol metadata. |
| R2 | Read the current live remote state before planning and compare base, local, and remote in a three-way plan. |
| R3 | Preserve remote-only changes by default, including deletes, plugin state, files, rows, and related resources. |
| R4 | Stop on local/remote conflicts with durable, redacted evidence that an operator can inspect. |
| R5 | Apply every mutation only behind a live precondition that is rechecked immediately before the write. |
| R6 | Enforce storage-boundary guarded writes, or an equivalent compare-and-swap primitive, for every production DB and filesystem mutation. |
| R7 | Treat coupled file, DB, plugin, option, activation, and schema changes as atomic groups. Never report success for a split plugin/application state. |
| R8 | Reject plugin-owned, serialized, custom-table, or schema-sensitive data unless an explicit validator or semantic driver proves the mutation. |
| R9 | Authenticate and authorize source-site mutation with production credentials, scoped push permissions, replay protection, and TLS outside local-only tests. |
| R10 | Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed remote state. |
| R11 | Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery. |
| R12 | Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, and operator retries. |
| R13 | Prove behavior against real WordPress data shapes: uploads, posts, postmeta, terms, users, options, plugin tables, plugin activation, schemas, and multisite if in scope. |
| R14 | Redact raw private data from plans, journals, conflict reports, recovery reports, and test artifacts. |
| R15 | Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard. |
| R16 | Provide a release test suite that actually runs the safety, recovery, auth, storage, plugin, and performance gates intended to support public claims. |

## Evidence Table

| Req | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 base manifest | The JSON model carries base/local/remote snapshots with stable resource keys and hashes. Playground exporters produce fixture snapshots for posts, options, files, postmeta, a forms lab table, and narrow plugin metadata. | No production Reprint pull-base manifest contract. No proof for complete WordPress identity mapping, table schemas, generated data, object cache state, media metadata, taxonomies, users, multisite, or arbitrary plugin ownership. | Yes |
| R2 three-way planning | `createPushPlan()` compares base/local/remote hashes. `npm test` covers local-only changes, remote-only changes, matching independent edits, direct conflicts, deletes, file topology conflicts, plugin state, and atomic dependency metadata. The production-shaped CLI smoke plans from exported fixture snapshots and targets `/wp-json/reprint/v1/push/*`. | No production remote hash listing contract. No test starts from a real Reprint pull and then pushes back through production-backed source mutation internals. | Yes |
| R3 preserve remote changes | Unit tests keep remote-only row and plugin changes, block local deletion versus remote update, stop local directory deletion that would hide a remote-only descendant, and stop file type swaps that would hide remote-only descendants. Playground stale apply smokes preserve fixture drift. | No proof for semantic graph preservation across posts/postmeta/attachments/terms/menus/options/plugin tables. No proof for remote changes to resources that are not directly mutated but are semantically coupled to local changes. | Yes |
| R4 conflict stop and evidence | Conflicts, blockers, hashes, change kinds, and plugin-owned conflict classes are represented. Raw fixture values are checked out of selected conflict/journal/recovery paths. | No durable production conflict artifact, operator workflow, reviewed resolution path, complete redaction schema, or production audit report. | Yes |
| R5 immediate preconditions | `applyPlan()` validates preconditions before model apply. Playground smokes verify stale dry-run/apply refusal and just-in-time pre-write hash rejection for selected fixtures. Production-shaped route smoke applies the same ready fixture plan through `/wp-json/reprint/v1/push/*`. | The production-shaped write path is still lab-backed. No proof that every production mutation rechecks liveness immediately before its write under real source-site concurrency. | Yes |
| R6 storage-boundary guards | `test:playground:storage-guarded-db-write` proves guarded single-statement `UPDATE` behavior for existing fixture `wp_posts`, allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact forms lab rows. `test:playground:storage-guarded-file-write` proves guarded update/create/delete for accepted fixture upload files. Production-shaped route smoke carries those fixture internals behind the `/reprint/v1` route shape. | No production MySQL/InnoDB CAS proof, transactions, locks, rollback, filesystem `fsync`, filesystem lock/CAS proof, arbitrary file guarding, arbitrary create/delete DB guarding, schema changes, plugin activation guarding, or production-backed Reprint HTTP mutation. | Yes |
| R7 atomic groups | Planner tests cover dependency presence, same-group dependencies, outside-group blocking, dependency hash/version/activation checks, and forged ready-plan rejection. `test:playground:plugin-atomic-install` adds a hard-coded fixture plugin install path and failure classification. | No general plugin install/update/activation support, no production rollback, no production atomic visibility boundary across files/DB/plugin activation, and no proof for arbitrary plugin side effects. | Yes |
| R8 plugin-owned data | Unknown plugin-owned rows block. The forms fixture allows only explicit `wp-option`, `wp-postmeta`, and exact `fixture-forms-lab-table` policies with active unchanged fixture plugin evidence. Unit tests now also block plugin-owned data when the owner plugin files changed only on remote, while allowing it when the owner plugin context independently matches remote. Unsupported custom tables and direct `active_plugins` mutation remain blocked. | No production plugin validator contract, serialized PHP data parser/validator, generic custom-table driver, schema migration driver, or proof that arbitrary plugin-owned data is discovered consistently. | Yes |
| R9 auth and authorization | `test:playground:authenticated-http-push` and `test:playground:authenticated-cli-push` prove authenticated local Playground aliases, Basic-auth-shaped Application Password credentials, `manage_options`, signed lab requests, nonce replay rejection, auth-bound receipts, idempotency keys, stale refusal, and replay with zero fresh mutation work. `test:playground:production-shaped-push` proves the same route binding shape under `/wp-json/reprint/v1/push/*`, including cross-route receipt rejection before mutation. `test:playground:production-plugin-package` proves the public lab namespace is disabled when the temporary plugin package is activated. | It still uses lab-backed implementation, lab signing key derivation, and a Playground fallback verifier. No production Reprint auth integration, TLS deployment, push credential scoping, nonce/replay store cleanup, session lifecycle, rate limiting, or real exporter credential binding. | Yes |
| R10 honest dry-run | Protocol smokes require receipts, reject missing/tampered receipts, bind receipts to plan/preconditions, and reject stale remote state. Authenticated lab routes bind receipts to auth/session/request data. | No production UI/operator warning tests. No proof for remote changes between production chunks or between individual production writes beyond fixture hooks. | Yes for production UX and source mutation |
| R11 durable recovery | Model recovery tests classify old/updated/blocked states. JSONL journal tests append with monotonic sequences and `fsync` calls, and now block missing target records plus corrupt/truncated journals. Playground recovery, DB journal, process-kill, missing-commit finalization, stale-claim, and production-shaped route recovery-inspect smokes add useful fixture evidence. | No production DB-table journal, no storage-level crash matrix, no target write `fsync` proof, no exactly-once production writes, no production leases/fencing/claim expiry, no rollback, and no automatic repair policy. | Yes |
| R12 idempotent resumability | DB journal smokes require `X-Reprint-Push-Idempotency-Key`, reject same-key/different-body requests, replay committed or rejected results, claim one concurrent same-key executor, finalize missing commits, and handle one all-old stale-claim retry path. Production-shaped route smoke also proves same-key replay and same-key/different-body conflict under `/reprint/v1`. | No chunk cursor, production retry contract, production duplicate first-apply test, shared-DB multi-worker proof, stale-plan invalidation across chunks, or production stale-claim lease/fencing/expiry behavior. | Yes |
| R13 real WordPress shapes | Playground fixtures exercise real WordPress-visible posts, options, files, selected postmeta, one custom table, fixture plugin metadata, and a packaged temporary plugin route under `/wp-json/reprint/v1/push/*`. Local REST smokes mutate disposable Playground source sites. | Coverage is narrow. No production-backed Reprint source mutation endpoint, no large live WordPress fixture matrix, no media attachment graph, taxonomy/menu/user/meta coverage, no arbitrary plugin tables, no multisite, no object cache/runtime side effects. | Yes |
| R14 redaction | Several unit and smoke tests assert no raw fixture strings in conflicts, journals, storage evidence, and recovery reports. DB/file storage guard evidence is hash-only. | Redaction is checked through selected fixture strings, forbidden field names, and scoped assertions. No formal allowlist schema for all future plan, journal, conflict, recovery, auth, or benchmark artifacts. | Yes for production |
| R15 speed | `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove a deterministic model for large uploads, chunk staging, bounded DB batches, atomic visibility, parallelism limits, backpressure triggers, and benchmark evidence gates. | No bytes move in a production executor, no live source site is mutated, and no memory ceiling or throughput target is measured against a real push path. | Yes for any speed claim |
| R16 release suite | `npm test` passed with 89 tests, 0 failures, and 0 skips. `npm run test:playground:production-shaped-push` and `npm run test:playground:production-plugin-package` also passed when run explicitly. | No CI workflow or release aggregator was found. `npm test` does not run the strongest Playground smokes. `npm run test:playground` only chains plan/apply/protocol. That means auth, HTTP, DB journal, storage guards, process kill, stale claim, plugin atomic, forms lab, authenticated CLI, production-shaped route/package, and recovery smokes all remain opt-in rather than release-gated. | Yes |

## Test Audit

### What The Default Tests Prove

`npm test` passed during this audit:

- 89 passing tests.
- Planner no-overwrite invariants for simplified JSON snapshots, including
  deletion preconditions, delete/update conflicts, directory-descendant
  topology conflicts, and file type swap conflicts.
- Plugin-owned resource blocking, stale owner-plugin context blocking, and the
  exact forms lab driver checks in the JavaScript model.
- Atomic dependency metadata and forged-plan rejection in the model executor.
- JSON-model recovery journal classification, append/`fsync` calls, missing
  target blocking, and corrupt/truncated journal blocking.
- Snapshot apply gates for named lab plugin resources, named lab plugin file paths, and exact forms lab custom-table rows when PHP is available.
- A deterministic performance model, not measured performance.

This is useful evidence. It does not exercise a production source site, a
production push endpoint, real production credentials, production DB/file
durability, real concurrent WordPress traffic, or arbitrary plugin data.

### What The Standalone Smokes Prove

The standalone Playground smokes materially improve the lab story:

- Local REST protocol routes prove dry-run/apply receipt behavior, stale
  refusal, and journal readback for fixture resources.
- Authenticated local Playground routes prove a lab auth/signature floor,
  nonce replay rejection, auth-bound receipts, capability checks, idempotency,
  and replay semantics.
- DB journal smokes prove fixture-scoped idempotency, DB-native claiming,
  rejected replay, one process-kill blocked recovery path, missing-commit
  finalization, and an all-old stale-claim retry path.
- Storage guard smokes prove selected fixture DB row updates and accepted
  fixture upload file update/create/delete paths reject drift after the JIT
  hash check and before the storage write.
- Plugin atomic smokes prove one hard-coded fixture plugin dependency/install
  shape, selected forged-plan negatives, replay behavior, and failure
  classification.
- Forms lab smokes prove one exact fixture custom-table semantic driver.
- Production-shaped route/package smokes prove that the fixture implementation
  can be reached through `/wp-json/reprint/v1/push/*`, that cross-route receipts
  are rejected before mutation, that same-key replay does no fresh mutation
  work, and that a temporary plugin package disables the public lab namespace.

These tests are still lab-bound. They mostly prove carefully controlled
fixtures, deterministic failure hooks, and production-shaped routing. They do
not prove production durability, arbitrary WordPress resources, arbitrary
plugins, real MySQL/InnoDB behavior, real filesystem crash semantics,
production auth, or measured speed.

### Test Gaps That Block Release Claims

1. **The strongest evidence is not wired into a release suite.** There is no
   CI workflow or release wrapper in the repository. The default `npm test`
   command does not run any Playground smoke, and the shorter
   `npm run test:playground` path stops at plan/apply/protocol even though the
   repo already exposes separate commands for auth, HTTP, DB journal, storage
   guards, process kill, stale claim, plugin atomic, forms lab, authenticated
   CLI, production-shaped route/package, mid-apply drift, and recovery. That
   means the strongest proof is still manual opt-in, not release-gated. A
   release claim cannot rely on tests that only pass when somebody remembers
   to run the right scripts.

2. **No test exercises the complete production-backed path.** The
   production-shaped smoke proves route shape and packaging, but the route is
   still lab-backed. There is no single test that starts with a Reprint pull
   base, edits a local WordPress site, fetches a live source snapshot through
   production Reprint internals, performs authenticated production dry-run,
   applies production mutations, and then verifies the live source site.

3. **No-data-loss proof is resource-narrow.** The tests are strongest for
   simplified resources and named fixtures. They do not prove semantic
   no-loss behavior for WordPress data graphs such as posts plus postmeta plus
   attachments plus taxonomy relationships, or for arbitrary plugin tables and
   serialized options.

4. **Storage safety is partial.** The DB guard smoke covers existing fixture
   row updates only. The file guard smoke covers accepted fixture upload
   update/create/delete paths. There is no production storage proof for
   arbitrary files, plugin file publish, DB inserts/deletes, schema changes,
   activation side effects, transactions, locks, rollback, or target `fsync`.

5. **Crash recovery coverage is sparse relative to the claim.** The process
   kill smoke is valuable but covers one local Playground path. There is no
   kill-at-every-boundary matrix across DB writes, file writes, plugin
   activation, journal writes, finalization, stale claims, and replay.

6. **Reliability assertions often count events rather than prove every hash
   transition.** Several smokes verify expected event names, counts, and coarse
   replay behavior. Release-grade recovery needs deeper assertions that each
   journaled before/after/observed hash corresponds to the live storage state
   at every recovery boundary.

7. **Auth is lab-auth, not production-auth.** The authenticated and
   production-shaped Playground tests are good protocol-shape evidence, but the
   fallback Application Password verifier and lab HMAC/session store do not
   prove production credentials, TLS, secret scoping, nonce cleanup, replay
   retention, or source-site authorization.

8. **Plugin safety is intentionally hard-coded.** The tests prove that the lab
   blocks arbitrary plugin data and allows exact fixtures. That is the right
   conservative behavior, but it means production plugin-owned data remains a
   release blocker until validator contracts and real plugin fixtures exist.

9. **Speed has no measured evidence.** The performance tests prove a model and
   guardrails. They do not move bytes, mutate a source site, measure memory,
   measure throughput, or verify that safety checks remain enabled under load.

10. **The highest-value missing edge case is a real crash matrix on the live
    write boundaries.** The current smoke suite can show one process-kill path
    and one stale-claim path, but it does not kill the executor at each
    production-grade boundary for DB writes, filesystem writes, plugin
    activation, finalization, and replay. Without that matrix, the "no data
    loss" claim still rests on selective fixtures and model state, not on the
    exact places the source site can lose or duplicate work.

11. **The release suite is fragmented and unenforced.** The highest-value
   evidence is split across manually invoked scripts. A green default test run
   still leaves the strongest claims unproven unless the full matrix is run
   deliberately, and nothing in the repository currently enforces that matrix
   before release. There is also no checked-in CI workflow or release wrapper
   that fails the build when the strongest auth, storage, recovery, plugin,
   and performance smokes are skipped.

## Required Release Gates

Before any production no-data-loss push claim, the project needs these direct
proof gates:

1. A production Reprint push endpoint with production authentication, scoped
   push credentials, TLS assumptions, nonce/replay/session storage, and source
   mutation authorization.
2. A complete pull-base manifest and live remote hash listing contract covering
   the WordPress data shapes in scope.
3. Storage-boundary guarded writes, or equivalent CAS, for every production DB
   and filesystem mutation type, including inserts, deletes, schema changes,
   plugin files, and activation-sensitive changes.
4. A durable production journal with kill-at-every-boundary tests across
   journal writes, DB writes, file writes, plugin activation, commit
   finalization, replay, and stale-claim paths.
5. A broader WordPress fixture suite covering posts, postmeta, attachments,
   terms, menus, users, options, serialized data, uploads, plugin tables,
   plugin activation, schema changes, and multisite if in scope.
6. A plugin validator/semantic-driver contract with at least one real plugin
   fixture and a conservative fallback that preserves remote state and blocks.
7. A release test aggregator and CI workflow that run the safety-critical
   unit, Playground, auth, storage, recovery, idempotency, plugin, and
   performance gates or explicitly label excluded tests as non-release proof.
   Right now `npm test` plus `npm run test:playground` still stop at the
   lighter plan/apply/protocol path, while the stronger auth, storage,
   recovery, production-shaped route, and plugin-package smokes remain manual
   opt-ins. The repository cannot yet claim that release evidence is actually
   enforced. Release readiness remains a manual judgment call until that
   aggregator exists.
8. Runtime benchmarks for large uploads and large DB changes with concrete
   throughput, memory, retry, and recovery measurements.

Until these gates exist, public documentation should keep the claim scoped to:
**lab evidence for push safety invariants, not production-safe live WordPress
push.**
