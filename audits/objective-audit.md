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

### Evidence Classes

The audit below distinguishes four evidence classes:

| Class | Meaning | Release weight |
| --- | --- | --- |
| Executable proof | Runs code against the boundary being claimed and asserts the property directly. | Strongest. This is the minimum for any release gate claim. |
| Fixture/lab proof | Runs code, but only against curated fixtures, local Playground, or other controlled lab scaffolding. | Useful only for a narrower claim. It does not prove production behavior unless the production boundary is the same boundary. |
| Docs-only proof | Describes the intended behavior without executing it. | Not proof. |
| Missing proof | The repository does not currently exercise the required boundary. | Release blocker until implemented and verified. |

### What The Current Test Surface Proves

The current automated surface splits into three tiers:

| Suite | What it directly proves | What it does not prove |
| --- | --- | --- |
| `npm test` / `test/*.test.js` | Deterministic planner invariants, recovery journal modeling, benchmark guardrails, and selected fixture driver redaction/shape checks. | It does not prove a production WordPress push path, production auth, production DB/file durability, or measured runtime speed. |
| Standalone Playground smokes | Local HTTP, DB journal, storage guard, process-kill, and plugin packaging behavior against disposable fixtures. | They remain lab-scoped and do not prove the production Reprint executor or arbitrary live site behavior. |
| Docs and progress pages | They summarize the intended objective and current gaps. | They are not evidence. |

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

| Area | Directly observed proof | Still insufficient | Next proof required |
| --- | --- | --- | --- |
| No-overwrite planner | Unit tests cover unchanged remote mutations, remote-only preservation, deletion behind preconditions, delete/update conflict, directory deletion that would hide a remote-only descendant, file type swap that would hide a remote-only descendant, matching independent edits, plugin dependency drift, stale precondition refusal, and redacted plugin-data conflict evidence. | These are JSON-model resources plus fixture policy, not WordPress graph semantics. The tests cannot prove post/postmeta/attachment/taxonomy/menu/plugin relationships are complete or safe. | Add one real WordPress graph fixture where local and remote edit different related resources, then prove the planner blocks or preserves every relationship explicitly. |
| Recovery and idempotency | Unit tests cover JSONL journal creation, monotonic sequences, per-record `fsync` evidence, old/new/blocked classification, corrupt/truncated journal blocking, missing-target blocking, completed replay, journal envelope mismatch, and partial remote mutation as blocked recovery. Playground smoke source covers DB journal, same-key replay, conflict refusal, process kill, missing-commit finalization, and all-old stale-claim retry. The production-shaped route smoke proves committed replay and recovery inspect for the fixture route profile. | JSONL recovery is still a model. Playground DB recovery is fixture-scoped local storage evidence. The production-shaped route is still lab-backed. None of this proves production MySQL/InnoDB, filesystem durability, leases/fencing, rollback, or every WordPress write boundary. | Kill the production-backed executor at every guarded DB/file/plugin boundary and retain DB journal plus live hash evidence for old/new/blocked classification. |
| Speed | `test/performance-model.test.js` proves a deterministic model for chunk staging, bounded DB batches, preconditions, atomic group visibility, backpressure, and rejected unsafe fast paths. | No bytes move. No large table mutates. No memory ceiling, throughput target, retry cursor, or live benchmark exists. | Run a large-file and large-table benchmark through the executor with receipts, preconditions, journal cursors, retries, and memory/runtime measurements. |

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source
site after a pull, while that source may still be live and may have changed.
The priorities are no data loss, reliable, and fast, with speed last. The
operational setup also requires a supervised lane workflow and a visible
progress page so humans can inspect status. That implies these release
requirements:

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
| R17 | Keep a progress page current enough to expose the current proof state, current blockers, and current lane status. |
| R18 | Preserve supervised lanes as the operating model: no silent autonomous merge path, no hidden manual conflict resolution path, and no claim of completion without lane evidence. |

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
| R15 speed | `test/performance-model.test.js` proves a deterministic model for large uploads, chunk staging, bounded DB batches, atomic visibility, parallelism limits, remote indexes as planning-only, and backpressure triggers. | No runtime benchmark, no transfer implementation proof, no memory ceiling, no latency/throughput target, no large-site run, and no proof that the model is wired into the executor. | Yes for any speed claim |
| R16 release suite | `npm test` passed 89 tests during this audit. `npm run test:playground:production-shaped-push` and `npm run test:playground:production-plugin-package` also passed when run explicitly. | No CI workflow was found. `npm test` does not run the strongest Playground smokes. `npm run test:playground` only chains plan/apply/protocol and excludes auth, HTTP, DB journal, storage guards, process kill, stale claim, plugin atomic, forms lab, authenticated CLI, production-shaped route/package, and recovery smokes unless invoked separately. | Yes |
| R17 progress page | `progress.html` summarizes the current proof state, blockers, and lane status. | It is documentation, not a gate, and it is not enforced by the test suite. | Docs-only proof |
| R18 supervised lanes | The repo history and progress page describe supervised lane work and the current audit process. | No code-level enforcement exists for “supervised lanes,” “no silent merge path,” or “no manual conflict resolution as required path.” | Docs-only proof |

## Test Audit

### Audit By Requirement

This is the current test-by-test map from objective requirement to proof class.
If a requirement only has fixture/lab proof, it is still a blocker for a
production claim.

| Req | What currently proves it | Coverage class | Notes |
| --- | --- | --- | --- |
| R1 base manifest | Planner tests exercise stable resource identities, hashes, and ownership hints in JSON-model snapshots. Playground snapshot exporters cover selected posts, options, files, postmeta, a forms lab table, and plugin metadata. | Fixture/lab proof | No production pull-base manifest contract exists. |
| R2 three-way planning | `test/push-planner.test.js` exercises base/local/remote comparisons, remote-only preservation, independent edits, direct conflicts, and forged-ready rejection. | Fixture/lab proof | The production-shaped route smoke only proves routing and packaging shape. |
| R3 preserve remote changes | Planner tests cover remote-only changes, delete-vs-update conflicts, directory-descendant protection, file-type swap protection, and plugin ownership preservation. | Fixture/lab proof | Coverage is strong for the model, but not for real WordPress graph semantics. |
| R4 conflict stop and evidence | Planner tests cover conflict classification and redacted conflict evidence for several fixture cases. | Fixture/lab proof | No durable production conflict artifact or operator resolution workflow is proven. |
| R5 immediate preconditions | Planner and protocol tests cover stale refusals and just-in-time precondition checks. Playground smokes cover a local live-hash check before mutation. | Fixture/lab proof | Production liveness recheck at every mutation boundary is still missing. |
| R6 storage-boundary guarded writes | Storage guard smokes cover selected fixture DB rows and accepted fixture upload file paths; planner tests cover guarded model paths. | Fixture/lab proof | No arbitrary production DB/file mutation proof, no transaction/lock/fsync proof. |
| R7 atomic groups | Planner and benchmark tests cover atomic group metadata, dependency preconditions, and hidden staging until commit. | Fixture/lab proof | No general plugin install/update rollback proof. |
| R8 plugin-owned data | Planner tests cover blocked plugin-owned data, explicit driver policy, and exact fixture custom-table rows. | Fixture/lab proof | Still hard-coded and conservative by design; no semantic driver contract for arbitrary plugins. |
| R9 auth and authorization | Authenticated HTTP/CLI Playground tests cover lab credentials, replay rejection, auth-bound receipts, capability checks, and production-shaped route mounting. | Fixture/lab proof | Not production auth, TLS, or credential scoping. |
| R10 honest dry-run | Protocol tests prove receipts bind to plan and stale state is refused. | Fixture/lab proof | No production operator workflow proof. |
| R11 durable recovery | Recovery journal tests cover JSONL append, replay classification, corrupt/truncated blocking, and hash-only journaling. Playground smokes add DB journal and process-kill evidence. | Fixture/lab proof | No production durable journal or fence/lease proof. |
| R12 idempotent resumability | DB journal and protocol smokes cover same-key replay, duplicate request refusal, missing commit finalization, and stale claim retry for lab fixtures. | Fixture/lab proof | Not production multi-worker/shared-DB resumability. |
| R13 real WordPress shapes | Playground fixtures touch posts, options, files, selected postmeta, a custom table, plugin metadata, and packaged route shape. | Fixture/lab proof | The graph is still narrow and mostly fixture-defined. |
| R14 redaction | Unit and smoke tests verify redaction in selected journal, conflict, storage, and recovery paths. | Fixture/lab proof | No full schema for all future artifact types. |
| R15 speed | Performance-model tests define speed guardrails and safety gates. | Docs-only proof for performance claims; fixture/lab proof for guardrails | No measured throughput or latency exists. |
| R16 release suite | `npm test` runs the model and journal/unit tests; standalone scripts exist for Playground and package smokes, but they are manually invoked. | Missing proof | There is no single enforced release gate yet. |

### Current Release Gap Summary

The strongest remaining gap is not planner logic. It is the absence of a
single enforced release path that combines:

1. production authentication and authorization,
2. durable journal writes,
3. leases or fencing for concurrent workers,
4. graph-identity coverage for real WordPress resources,
5. explicit plugin-data drivers or validators,
6. a Docker or full-Playground backing environment, and
7. crash-boundary coverage across the whole write path.

Until those are present together, the honest claim remains lab evidence for
push safety invariants, not production-safe live WordPress push.

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
8. Runtime benchmarks for large uploads and large DB changes with concrete
   throughput, memory, retry, and recovery measurements.

Until these gates exist, public documentation should keep the claim scoped to:
**lab evidence for push safety invariants, not production-safe live WordPress
push.**
