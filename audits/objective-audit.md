# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

- Fresh remote heads at audit time, checked on May 26, 2026:

- `origin/lane/cycle-20260524-auth-graph-hardening/critic` -> `e413f7a8`
- `origin/lane/cycle-20260524-auth-graph-hardening/fast-paths` -> `ad7d82a4`
- `origin/lane/cycle-20260524-auth-graph-hardening/feedback-supervisor` -> `c57f8610`
- `origin/lane/cycle-20260524-auth-graph-hardening/no-data-loss-invariants` -> `1242dacd`
- `origin/lane/cycle-20260524-auth-graph-hardening/no-data-loss-recovery` -> `fac13be4`
- `origin/lane/cycle-20260524-auth-graph-hardening/progress-publisher` -> `e6d254ed`
- `origin/lane/cycle-20260524-fast-supervised-accountability/feedback-supervisor` -> `662b7a2a`
- `origin/lane/cycle-20260524-fast-supervised-accountability/same-plan-graph` -> `0669f87b`
- `origin/lane/cycle-20260524-production-hardening/feedback-supervisor` -> `dd29b572`
- `origin/lane/cycle-20260525-keep-busy-1/feedback-supervisor` -> `b68019cd`
- `origin/lane/cycle-20260525-keep-busy-11/feedback-supervisor` -> `3d16266f`
- `origin/lane/cycle-20260525-keep-busy-13/feedback-supervisor` -> `be89b6ce`
- `origin/lane/cycle-20260525-keep-busy-15/feedback-supervisor` -> `1eed9c27`
- `origin/lane/cycle-20260525-keep-busy-18/feedback-supervisor` -> `031d83e6`
- `origin/lane/cycle-20260525-keep-busy-3/critic` -> `3b5e24cd`
- `origin/lane/cycle-20260525-keep-busy-3/feedback-supervisor` -> `f1dfc82e`
- `origin/lane/cycle-20260525-keep-busy-4/feedback-supervisor` -> `2f445b0b`
- `origin/lane/cycle-20260525-keep-busy-6/feedback-supervisor` -> `8326e456`
- `origin/lane/cycle-20260525-keep-busy-8/feedback-supervisor` -> `2843a33a`
- `origin/lane/cycle-20260525-keep-busy-long-1/critic` -> `ffe646ab`
- `origin/lane/cycle-20260525-keep-busy-long-1/fast-paths` -> `ea464a32`
- `origin/lane/cycle-20260525-keep-busy-long-1/feedback-supervisor` -> `9850e4ad`
- `origin/lane/cycle-20260525-keep-busy-long-1/reliable-executor` -> `9e7847e4`
- `origin/lane/cycle-20260525-keep-busy-long-2/independent-auditor` -> `d803a87d`
- `origin/lane/cycle-20260525-keep-busy-long-2/no-data-loss-recovery` -> `312e727e`
- `origin/lane/cycle-20260525-keep-busy-loop-1/feedback-supervisor` -> `c609be10`
- `origin/lane/cycle-20260525-keep-busy-loop-1/no-data-loss-invariants` -> `55058b6a`
- `origin/lane/cycle-20260525-keep-busy-loop-1/reliable-executor` -> `929598e7`
- `origin/lane/cycle-20260525-keep-busy-loop-2/critic` -> `92422ea0`
- `origin/lane/cycle-20260525-keep-busy-loop-2/independent-auditor` -> `1d6cb6fd`
- `origin/lane/cycle-20260525-keep-busy-loop-2/no-data-loss-recovery` -> `63e01a49`
- `origin/lane/cycle-20260525-mainwindows-2349/critic` -> `fa0dc8a0`
- `origin/lane/cycle-20260525-mainwindows-2349/fast-paths` -> `79aa3e50`
- `origin/lane/cycle-20260525-mainwindows-2349/feedback-supervisor` -> `4e2ecdeb`
- `origin/lane/cycle-20260525-mainwindows-2349/independent-auditor` -> `3c6c8d8b`
- `origin/lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery` -> `b5a70bfa`
- `origin/lane/cycle-20260525-mainwindows-2349/progress-followup` -> `3bb4e35a`
- `origin/lane/cycle-20260525-mainwindows-2349/reliable-followup` -> `9e05da5e`
- `origin/lane/cycle-20260525-mainwindows-2357/no-data-loss-invariants-graph-proof` -> `98c0ce26`
- `origin/lane/cycle-20260525-restart-2340/feedback-supervisor` -> `ef3d911e`
- `origin/lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration` -> `29fff11d`
- `origin/lane/critic` -> `443dacd6`
- `origin/lane/fast-paths` -> `8c5c2ccb`
- `origin/lane/feedback-supervisor` -> `f386dfa6`
- `origin/lane/independent-auditor` -> `6351130f`
- `origin/lane/no-data-loss-invariants` -> `6fe9cbdb`
- `origin/lane/no-data-loss-recovery` -> `9e077c10`
- `origin/lane/progress-publisher` -> `7695e1f9`
- `origin/lane/reliable-executor` -> `9415449e`
- `origin/lane/same-plan-wordpress-graph-create` -> `0d2178e9`
- `origin/main` -> `56063f13`

The current remote state still adds no production-backed auth/session
lifecycle or durable journal ownership/lease/fencing/replay path proving a
real source-site mutation boundary. The release gates still stay `0/4`.

Fresh lane proof since the last audit pass improved the local evidence floor,
but it did not change the release conclusion:

- `origin/lane/reliable-executor` now records `9415449e`, tightening release
  verify subprocess handling again, but still not proving production
  auth/session lifecycle or a live-source mutation boundary.
- `origin/lane/no-data-loss-invariants` now records `6fe9cbdb`, adding a
  comment-post graph blocker proof to the unsupported-surface boundary set.
- `origin/lane/progress-publisher` now records `7695e1f9`, refreshing public
  progress freshness only.
- `origin/lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration`
  now records `29fff11d`, adding featured-image attachment drift proof only.
- `origin/lane/independent-auditor` now records `6351130f`. This refreshes the
  audit snapshot only and does not change the
  release boundary.
- `origin/lane/fast-paths` now records `8c5c2ccb`, tightening success-claim
  proof only.
- `origin/lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery` now
  records `b5a70bfa`, tightening remote recovery URL suffix fencing. It still
  does not add production-backed journal ownership or replay proof.
- `origin/lane/feedback-supervisor` now records `f386dfa6`, refreshing the
  supervisor progress surface only.
- `origin/lane/cycle-20260525-mainwindows-2349/reliable-followup` now records
  `9e05da5e`, hardening live proof cleanup and timeouts only.
- `origin/lane/no-data-loss-recovery` now records `9e077c10`, tightening
  durable recovery remote-ownership fencing only.
- `origin/lane/same-plan-wordpress-graph-create` now records `0d2178e9`,
  hardening revision graph references only.

Those changes strengthen the lab evidence for protocol safety and no-loss
planning, but they still do not prove the production-backed push path.

### Gate Movement Trigger

One gate would move if there were a production-backed test that starts with a
real pull base, authenticates against the source site, mutates live source
state through the production Reprint path, survives a killed executor, and
replays from a durable journal with ownership, lease, fencing, and before/after
hash evidence proving no data loss on recovery.

That makes the honest claim narrower: this repository is a strong lab and
release-surface safety model for push invariants. It does **not** yet prove
production-safe live WordPress push without data loss, with production
reliability, and with measured speed.

## Explicit Requirements

The objective is to push local changes back to the original WordPress source
site after a pull, while that source may still be live and may have changed.
The release requirements implied by that objective are:

1. Persist a complete pull-base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, and protocol metadata.
2. Read the current live remote state before planning and compare base, local, and remote in a three-way plan.
3. Preserve remote-only changes by default, including deletes, plugin state, files, rows, related resources, and now special-file descendants blocked by fail-closed guards.
4. Stop on local/remote conflicts with durable, redacted evidence that an operator can inspect.
5. Apply every mutation only behind a live precondition that is rechecked immediately before the write.
6. Enforce storage-boundary guarded writes, or an equivalent compare-and-swap primitive, for every production DB and filesystem mutation.
7. Treat coupled file, DB, plugin, option, activation, and schema changes as atomic groups. Never report success for a split plugin/application state.
8. Reject plugin-owned, serialized, custom-table, or schema-sensitive data unless an explicit validator or semantic driver proves the mutation.
9. Authenticate and authorize source-site mutation with production credentials, scoped push permissions, replay protection, and TLS outside local-only tests.
10. Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed remote state.
11. Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery.
12. Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, and operator retries.
13. Prove behavior against real WordPress data shapes: uploads, posts, postmeta, terms, users, options, plugin tables, plugin activation, schemas, and multisite if in scope.
14. Redact raw private data from plans, journals, conflict reports, recovery reports, and test artifacts.
15. Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard.
16. Provide a release test suite that actually runs the safety, recovery, auth, storage, plugin, and performance gates intended to support public claims.

## Evidence Table

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 base manifest | The JSON model carries base/local/remote snapshots with stable resource keys and hashes. Playground exporters produce fixture snapshots for posts, options, files, postmeta, a forms lab table, and narrow plugin metadata. | No production Reprint pull-base manifest contract. No proof for complete WordPress identity mapping, table schemas, generated data, object cache state, media metadata, taxonomies, users, multisite, or arbitrary plugin ownership. | Yes |
| R2 three-way planning | `createPushPlan()` compares base/local/remote hashes. `npm test` covers local-only changes, remote-only changes, matching independent edits, direct conflicts, deletes, file topology conflicts, graph-identity blockers, plugin state, and atomic dependency metadata. The production-shaped CLI smoke plans from exported fixture snapshots and targets `/wp-json/reprint/v1/push/*`. `origin/lane/no-data-loss-invariants` now blocks unsupported special file entries at `0253c05d`. A separate cycle-branch proof at `63ebcc84` extends that fail-closed coverage to socket-like and hard-link special files, but it is not the primary lane head. | No production remote hash listing contract. No test starts from a real Reprint pull and then pushes back through production-backed source mutation internals. | Yes |
| R3 preserve remote changes | Unit tests keep remote-only row and plugin changes, block local deletion versus remote update, stop local directory deletion that would hide a remote-only descendant, and stop file type swaps that would hide remote-only descendants. Playground stale apply smokes preserve fixture drift. `origin/lane/no-data-loss-invariants` now blocks unsupported special file entries at `0253c05d`. A separate cycle-branch proof at `63ebcc84` extends that fail-closed coverage to socket-like and hard-link special files, but it is not the primary lane head. | No proof for semantic graph preservation across posts/postmeta/attachments/terms/menus/options/plugin tables. No proof for remote changes to resources that are not directly mutated but are semantically coupled to local changes. | Yes |
| R4 conflict stop and evidence | Conflicts, blockers, hashes, change kinds, and plugin-owned conflict classes are represented. Raw fixture values are checked out of selected conflict/journal/recovery paths. | No durable production conflict artifact, operator workflow, reviewed resolution path, complete redaction schema, or production audit report. | Yes |
| R5 immediate preconditions | `applyPlan()` validates preconditions before model apply. Playground smokes verify stale dry-run/apply refusal and just-in-time pre-write hash rejection for selected fixtures. Production-shaped route smoke applies the same ready fixture plan through `/wp-json/reprint/v1/push/*`. | The production-shaped write path is still lab-backed. No proof that every production mutation rechecks liveness immediately before its write under real source-site concurrency. | Yes |
| R6 storage-boundary guards | `test:playground:storage-guarded-db-write` proves guarded single-statement `UPDATE` behavior for existing fixture `wp_posts`, allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact forms lab rows. `test:playground:storage-guarded-file-write` proves guarded update/create/delete for accepted fixture upload files. Production-shaped route smoke carries those fixture internals behind the `/reprint/v1` route shape. | No production MySQL/InnoDB CAS proof, transactions, locks, rollback, filesystem `fsync`, filesystem lock/CAS proof, arbitrary file guarding, arbitrary create/delete DB guarding, schema changes, plugin activation guarding, or production-backed Reprint HTTP mutation. | Yes |
| R7 atomic groups | Planner tests cover dependency presence, same-group dependencies, outside-group blocking, dependency hash/version/activation checks, and forged ready-plan rejection. `test:playground:plugin-atomic-install` adds a hard-coded fixture plugin install path and failure classification. | No general plugin install/update/activation support, no production rollback, no production atomic visibility boundary across files/DB/plugin activation, and no proof for arbitrary plugin side effects. | Yes |
| R8 plugin-owned data | Unknown plugin-owned rows block. The forms fixture allows only explicit `wp-option`, `wp-postmeta`, and exact `fixture-forms-lab-table` policies with active unchanged fixture plugin evidence. Unit tests also block plugin-owned data when the owner plugin files changed only on remote, while allowing it when the owner plugin context independently matches remote. Unsupported custom tables and direct `active_plugins` mutation remain blocked. | No production plugin validator contract, serialized PHP data parser/validator, generic custom-table driver, schema migration driver, or proof that arbitrary plugin-owned data is discovered consistently. | Yes |
| R9 auth and authorization | `test:playground:authenticated-http-push` and `test:playground:authenticated-cli-push` prove authenticated local Playground aliases, Basic-auth-shaped Application Password credentials, `manage_options`, signed lab requests, nonce replay rejection, auth-bound receipts, idempotency keys, stale refusal, and replay with zero fresh mutation work. `test:playground:production-shaped-push` proves the same route binding shape under `/wp-json/reprint/v1/push/*`, including cross-route receipt rejection before mutation. `test:playground:production-plugin-package` proves the public lab namespace is disabled when the temporary plugin package is activated. Fresh reliable-lane edits at `0c4fd10f` now retry the release-proof port handling, but still do not prove a production auth/session lifecycle. | It still uses lab-backed implementation, lab signing key derivation, and a Playground fallback verifier. No production Reprint auth integration, TLS deployment, push credential scoping, nonce/replay store cleanup, session lifecycle, rate limiting, or real exporter credential binding. | Yes |
| R10 honest dry-run | Protocol smokes require receipts, reject missing/tampered receipts, bind receipts to plan/preconditions, and reject stale remote state. Authenticated lab routes bind receipts to auth/session/request data. | No production UI/operator warning tests. No proof for remote changes between production chunks or between individual production writes beyond fixture hooks. | Yes for production UX and source mutation |
| R11 durable recovery | Model recovery tests classify old/updated/blocked states. JSONL journal tests append with monotonic sequences and `fsync` calls, and now block missing target records plus corrupt/truncated journals. Playground recovery, DB journal, process-kill, missing-commit finalization, stale-claim, and production-shaped route recovery-inspect smokes add useful fixture evidence. `origin/lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery` now tightens the inspect gate at `37d1cd8d`, but the evidence is still fixture-bound. | No production DB-table journal, no storage-level crash matrix, no target write `fsync` proof, no exactly-once production writes, no production leases/fencing/claim expiry, no rollback, and no automatic repair policy. | Yes |
| R12 idempotent resumability | DB journal smokes require `X-Reprint-Push-Idempotency-Key`, reject same-key/different-body requests, replay committed or rejected results, claim one concurrent same-key executor, finalize missing commits, and handle one all-old stale-claim retry path. Production-shaped route smoke also proves same-key replay and same-key/different-body conflict under `/wp-json/reprint/v1`. | No chunk cursor, production retry contract, production duplicate first-apply test, shared-DB multi-worker proof, stale-plan invalidation across chunks, or production stale-claim lease/fencing/expiry behavior. | Yes |
| R13 real WordPress shapes | Playground fixtures exercise real WordPress-visible posts, options, files, selected postmeta, one custom table, fixture plugin metadata, attachment graph handling, and a packaged temporary plugin route under `/wp-json/reprint/v1/push/*`. Local REST smokes mutate disposable Playground source sites. `test/push-planner.test.js` also proves unsupported plugin-owned resources stay blocked unless an explicit fixture driver policy is present. | Coverage is narrow. No production-backed Reprint source mutation endpoint, no large live WordPress fixture matrix, no taxonomy/menu/user/meta coverage, no serialized block-reference proof, no comments/users proof, no arbitrary plugin tables, no multisite, and no object cache/runtime side effects. The existing planner and smoke coverage refuses unsupported plugin-owned data, but it does not prove the boundary for `menu/navigation`, serialized block references, or comments/users on a live source site. | Yes |
| R14 redaction | Several unit and smoke tests assert no raw fixture strings in conflicts, journals, storage evidence, and recovery reports. DB/file storage guard evidence is hash-only. | Redaction is checked through selected fixture strings, forbidden field names, and scoped assertions. No formal allowlist schema for all future plan, journal, conflict, recovery, auth, or benchmark artifacts. | Yes for production |
| R15 speed | `test/performance-model.test.js` proves a deterministic model for large uploads, chunk staging, bounded DB batches, atomic visibility, parallelism limits, remote indexes as planning-only, and backpressure triggers. | No runtime benchmark, no transfer implementation proof, no memory ceiling, no latency/throughput target, no large-site run, and no proof that the model is wired into the executor. | Yes for any speed claim |
| R16 release suite | `npm test` passed 89 tests during this audit. `npm run test:playground:production-shaped-push` and `npm run test:playground:production-plugin-package` also passed when run explicitly. `package.json` exposes only `test`, `test:playground`, the fixture smokes, `plan`, and `apply`; there is still no checked-in `verify`, `verify:release`, or `release` command in the release script surface. | No CI workflow was found. `npm test` does not run the strongest Playground smokes. `npm run test:playground` only chains plan/apply/protocol and excludes auth, HTTP, DB journal, storage guards, process kill, stale claim, plugin atomic, forms lab, authenticated CLI, production-shaped route/package, and recovery smokes unless invoked separately. The exact blocker is still the same: there is no enforced checked-in command that fails closed on the live-source boundary, so the release verdict cannot be owned by a single entrypoint. | Yes |

## Test Audit

### What The Default Tests Prove

`npm test` passed during this audit:

- 89 passing tests.
- No new test run was performed this pass; the audit change was limited to
  refreshing the remote-head snapshot and re-checking the current evidence
  surface.
- Planner no-overwrite invariants for simplified JSON snapshots, including deletion preconditions, delete/update conflicts, directory-descendant topology conflicts, and file type swap conflicts.
- Plugin-owned resource blocking, stale owner-plugin context blocking, and the exact forms lab driver checks in the JavaScript model.
- Atomic dependency metadata and forged-plan rejection in the model executor.
- JSON-model recovery journal classification, append/`fsync` calls, missing target blocking, and corrupt/truncated journal blocking.
- Snapshot apply gates for named lab plugin resources, named lab plugin file paths, and exact forms lab custom-table rows when PHP is available.
- A deterministic performance model, not measured performance.

This is useful evidence. It does not exercise a production source site, a production push endpoint, real production credentials, production DB/file durability, real concurrent WordPress traffic, or arbitrary plugin data.

### What The Standalone Smokes Prove

- Local REST protocol routes prove dry-run/apply receipt behavior, stale refusal, and journal readback for fixture resources.
- Authenticated local Playground routes prove a lab auth/signature floor, nonce replay rejection, auth-bound receipts, capability checks, idempotency, and replay semantics.
- There is still no checked-in `verify:release` entrypoint in this checkout, so the release verdict cannot be owned by a single mandatory command. The nearby smokes remain useful refusal and fixture evidence, but they do not become production auth/session proof without a live-source gate.
- DB journal smokes prove fixture-scoped idempotency, DB-native claiming, rejected replay, one process-kill blocked recovery path, missing-commit finalization, and an all-old stale-claim retry path.
- Storage guard smokes prove selected fixture DB row updates and accepted fixture upload file update/create/delete paths reject drift after the JIT hash check and before the storage write.
- Plugin atomic smokes prove one hard-coded fixture plugin dependency/install shape, selected forged-plan negatives, replay behavior, and failure classification.
- Forms lab smokes prove one exact fixture custom-table semantic driver.
- Production-shaped route/package smokes prove that the fixture implementation can be reached through `/wp-json/reprint/v1/push/*`, that cross-route receipts are rejected before mutation, that same-key replay does no fresh mutation work, and that a temporary plugin package disables the public lab namespace.

These tests are still lab-bound. They mostly prove carefully controlled fixtures, deterministic failure hooks, and production-shaped routing. They do not prove production durability, arbitrary WordPress resources, arbitrary plugins, real MySQL/InnoDB behavior, real filesystem crash semantics, production auth, or measured speed.

### Test Gaps That Block Release Claims

1. The strongest evidence is not wired into a release suite. There is no CI workflow in the repository. The default `npm test` command still does not run the long Playground smokes that support most README claims.
2. No test exercises the complete production-backed path. The production-shaped smoke proves route shape and packaging, but the route is still lab-backed.
3. No-data-loss proof is resource-narrow. The tests are strongest for simplified resources and named fixtures, not full WordPress graphs.
4. Storage safety is partial. The DB guard smoke covers existing fixture row updates only. The file guard smoke covers accepted fixture upload update/create/delete paths only.
5. Crash recovery coverage is sparse relative to the claim. The process kill smoke is valuable but covers one local Playground path.
6. Reliability assertions often count events rather than prove every hash transition.
7. Auth is lab-auth, not production-auth.
8. Plugin safety is intentionally hard-coded.
9. The strongest unsupported production-slice gap is still the boundary coverage for menu/navigation, serialized block references, comments/users, and plugin-owned custom tables. The current proof in [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor/test/push-planner.test.js) is refusal-backed for plugin-owned resources, not live-boundary proof for those graph surfaces. The newer same-plan graph proof at `a719e09c` strengthens the fail-closed side for revision posts, menu/navigation posts, serialized blocks, and thumbnail parent references, and the newer same-plan post-parent/post proof at `22ac71bb` narrows unsupported graph edges, but none produce live source mutation evidence.
10. The repository script surface still lacks a checked-in `verify`, `verify:release`, or `release` command in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor/package.json:10), even though it does expose a broad `test:playground` family for lab smokes. There is still no enforced live-source gate that could own the verdict even if the missing proof appeared. The planner tests in [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor/test/push-planner.test.js:131) remain strong fixture evidence, but they still stop at local/remote simulation rather than the live release boundary. The exact missing command is a checked entrypoint that runs the live-source preflight, aborts on stale or unsupported boundaries, and exits non-zero before any apply step when the unsupported surface set is hit.
11. Speed has no measured evidence.

## Required Release Gates

Before any production no-data-loss push claim, the project needs these direct proof gates:

1. A production Reprint push endpoint with production authentication, scoped push credentials, TLS assumptions, nonce/replay/session storage, and source mutation authorization.
2. A complete pull-base manifest and live remote hash listing contract covering the WordPress data shapes in scope.
3. Storage-boundary guarded writes, or equivalent CAS, for every production DB and filesystem mutation type, including inserts, deletes, schema changes, plugin files, and activation-sensitive changes.
4. A durable production journal with kill-at-every-boundary tests across journal writes, DB writes, file writes, plugin activation, commit finalization, replay, and stale-claim paths.
5. A broader WordPress fixture suite covering posts, postmeta, attachments, terms, menus, users, options, serialized data, uploads, plugin tables, plugin activation, schema changes, and multisite if in scope.
6. A plugin validator/semantic-driver contract with at least one real plugin fixture and a conservative fallback that preserves remote state and blocks.
7. A dedicated failing gate for at least one unsupported supported-slice boundary, with menu/navigation, serialized block references, comments/users, plugin-owned custom tables, or revision posts made to fail before release claims can expand.
8. A release test aggregator and CI workflow that run the safety, recovery, auth, storage, plugin, and performance gates or explicitly label excluded tests as non-release proof. The repository still needs a single checked-in gate command such as `verify:release` or `release` that fails closed on the live-source boundary set; the existing `test:playground` scripts are useful lab evidence, but they do not substitute for that release gate. Without that command, the verdict stays manually held.
9. Runtime benchmarks for large uploads and large DB changes with concrete throughput, memory, retry, and recovery measurements.

Until these gates exist, public documentation should keep the claim scoped to:
**lab evidence for push safety invariants, not production-safe live WordPress push.**
