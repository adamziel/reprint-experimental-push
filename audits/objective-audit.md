# Objective Audit

## Verdict

The repository currently proves an early JSON-snapshot safety model plus
lab-only, fixture-scoped Playground push endpoints, including a local-only REST
slice over real HTTP, lab recovery inspection after an injected partial apply,
file-backed JSONL recovery journal evidence in the JSON model, a fixture-scoped
DB journal/idempotency slice, an authenticated local Playground source-site
mutation slice under `/authenticated/*`, a narrow allowlisted plugin-owned
forms data slice, and hard-coded fixture plugin install atomicity evidence, not
a production-safe WordPress push transport. That
distinction matters: most of the strongest
no-data-loss, reliability, and speed claims still depend on design intent, not
direct executable evidence at the production boundary.

Release status: **not releasable as a production push path**. It is acceptable
as a lab harness for planner invariants, fixture-scoped Playground protocol
evidence, local-only HTTP-style REST evidence, injected-failure recovery
inspection, JSON-model file-backed journal evidence, fixture-scoped DB
journal/idempotency evidence, and authenticated local Playground source-site
mutation evidence if all public status and docs keep that scope explicit.

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
| R1 three-way planning | `createPushPlan()` enumerates file, plugin, and row resources from base/local/remote and compares stable hashes. Tests cover unchanged remote, remote-only changes, non-overlapping changes, direct conflicts, and Playground fixture snapshots from real WordPress rows, options, files, fixture-marked `_reprint_push_forms_schema` postmeta, `wp_reprint_push_forms_lab` custom-table rows, and `reprint-push-forms-fixture` plugin metadata. | No real Reprint exporter/importer snapshots. No coverage for WordPress IDs, postmeta relationships, taxonomies, plugin tables, serialized options, or multisite resources beyond narrow Playground fixture uploads/options/posts and the allowlisted plugin-owned forms fixture. | Yes. A production claim needs broader fixture-backed WordPress snapshots and resource identity rules. |
| R2 preserve remote changes | `keep-remote` decisions are produced when local equals base and remote differs. Tests assert a remote-only post title survives. | Only same-resource hash cases are tested. Cross-resource semantic loss is untested, such as remote changing a post while local changes dependent postmeta, attachments, menus, or plugin options. | Yes. Remote preservation is not proven for WordPress data graphs. |
| R3 preconditioned apply | `applyPlan()` validates mutation preconditions before applying to a staged clone. Tests reject drift on a planned file mutation. The Playground protocol smokes reject stale apply with `PRECONDITION_FAILED`; the local REST lab returns `412 PRECONDITION_FAILED` while preserving the drifted remote fixture. | Preconditions are lab hash checks, not production compare-and-swap writes on files, MySQL, SQLite, or authenticated Reprint HTTP endpoints. No test covers remote drift during a multi-resource production apply. | Yes. This is the central no-data-loss gate and currently has no production-boundary proof. |
| R4 conflict stop and evidence | Direct same-resource conflicts become `conflict`, and `applyPlan()` refuses non-ready plans. Plugin-owned row conflicts get a separate class. Unknown plugin-owned custom-table rows block as `unsupported-plugin-owned-resource`, and conflict evidence exposes hashes/evidence rather than raw plugin values. Playground conflict dry-run/apply return `PLAN_NOT_READY`; the local REST lab returns `409 PLAN_NOT_READY` with row, file, and plugin-data audit classes. | No reviewed resolution workflow, persisted conflict record, operator audit trail, or fixtures for realistic plugin-owned data. | Yes. Conflict detection without durable evidence is insufficient for release. |
| R5 atomic coupled changes | Push intents can group resources; tests cover missing dependencies, same-group dependencies, outside-group blocking, remote dependency drift, incompatible version ranges, and dependency hash mismatches. `applyPlan()` stages a clone before returning. `npm run test:playground:plugin-atomic-install` adds hard-coded Playground fixture plugin install evidence: base/remote lack fixture plugins, local includes dependency and dependent fixture plugins in one atomic group, apply activates both and writes exact fixture plugin files/resources plus allowlisted option data, replay does zero fresh mutation work, forged ready plans and row-only bypass attempts reject before mutation, JavaScript and PHP validation both run, and before-commit/during-publish/activation failures preserve or classify safely. | No production transaction boundary exists for actual file/database/plugin writes. The fixture plugin smoke is exact-allowlist Playground evidence only, not arbitrary production plugin installation/update/activation support, production rollback, plugin semantic drivers, custom-table drivers, arbitrary plugin-owned data safety, or production durability/auth proof. | Yes. Partial plugin/application state is explicitly rejected by project docs. |
| R6 plugin/serialized data safety | Rows with `__pluginOwner` are classified as `plugin-data-conflict` on direct conflicts. The forms fixture adds allowlisted safe apply for `reprint_push_forms_fixture` and fixture-marked `_reprint_push_forms_schema` postmeta, while `wp_reprint_push_forms_lab` rows and `reprint-push-forms-fixture` metadata are export/detect only. The fixture plugin install smoke blocks arbitrary plugin files, direct `active_plugins` row mutation, custom-table apply, arbitrary plugin-owned data, and row-only plugin-owned data bypass attempts outside declared atomic dependency requirements. Docs reject generic serialized-data merges. | No production plugin validator contract, no arbitrary plugin activation/update fixture, no serialized PHP option parser, no custom-table apply driver, and no proof that arbitrary production plugin-owned tables/options are discovered consistently. | Yes. This is a direct data-loss risk. |
| R7 crash recovery | One injected failure before staged clone return proves the original input object is not mutated in that narrow path. The Playground recovery harness verifies `LAB_INJECTED_APPLY_FAILURE` after two successful whole-resource mutations, hash-only bounded option-journal evidence, CLI/REST inspection of `blocked-recovery`, `2 new` and `6 old` targets, and retry refusal with `PRECONDITION_FAILED`. The JSON-model file journal writes append-only JSONL records with monotonic sequences and per-append `fsync` evidence, and restart-style inspection verifies old-remote before mutation, fail-after-2 `blocked-recovery` with `2 new`/`6 old`/`0` unknown, retry refusal with no remote change, completed replay with `0` additional mutations, drift as `blockedUnknown > 0`, and no raw fixture fields/data in journal files. The local REST DB journal slice records `mutation-prepared` before each write, `mutation-applied` after observed hash calculation, apply/replay/conflict events, and compact hash/metadata-only evidence in `wp_reprint_push_lab_push_journal`. The process-kill smoke sends real `SIGKILL` during an in-flight DB-journaled REST apply on a host-mounted localhost Playground server, restarts against the same mount, verifies opened/started DB rows persist without false `apply-committed`, classifies mixed live target hashes from DB planned evidence plus live hashes, returns non-mutating `RECOVERY_BLOCKED`, and blocks retry without overwriting partial state. The missing-commit finalization smoke proves `BATCH_RECOVERY_FINALIZED` when the same key/body finds all live target hashes already at planned after hashes with `apply-committed` missing, while same key/different body still conflicts before finalization. | No production DB table journal durability, no storage-level `fsync` proof, no rollback, no exactly-once production writes, no full MySQL/InnoDB behavior, no after-commit production WordPress failure tests, no all-old stale-claim safe retry proof, and no automatic repair policy. The DB journal/process-kill/finalization evidence is fixture-scoped local Playground SQLite/host-mount evidence only, and tests mostly count mutation evidence rows rather than deeply asserting every observed hash. The JSONL journal is JSON-model lab evidence; journal paths must be unique or intentionally reset because plan journal open defaults to `truncate`, and raw-value prevention is forbidden-key/fixture-string based rather than a full allowlist schema. | Yes. Current recovery proof is not production crash-recovery proof. |
| R8 resumable chunks | The DB idempotency slice requires `X-Reprint-Push-Idempotency-Key`; missing keys return `400 MISSING_IDEMPOTENCY_KEY`, same key/body replays as `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`, same key/different body rejects with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation, and same key/body can finalize a missing `apply-committed` row as `BATCH_RECOVERY_FINALIZED` with zero fresh mutation work when all live hashes match planned after hashes. A unique `claim_key_hash` column provides DB-native first-apply claiming; concurrent same-key/same-body first applies produce exactly one opened claim and one fresh mutation executor, while duplicate/different-body requests reject before mutation. Source notes cite resumable pull and recommend chunked push. | No chunk journal, cursor, resume tests, stale-plan invalidation tests, production retry contract, all-old stale-claim safe retry proof, or production finalization path. | Yes. A live push cannot rely on one in-memory apply call. |
| R9 real WordPress execution | Playground base/local/remote fixtures export real WordPress posts/options/files plus the fixture-scoped plugin-owned forms option/postmeta/custom-table/plugin metadata slice. Guarded apply writes a fresh source fixture with WordPress-visible readback for eight exact ready mutations, a fixture-scoped PHP endpoint smoke covers dry-run/apply/stale/conflict paths, the standalone local REST lab verifies `reprint-push-lab/v1` routes over real HTTP on `127.0.0.1`, and `npm run test:playground:authenticated-http-push` verifies authenticated local source-site mutation under `/wp-json/reprint-push-lab/v1/authenticated/*` with Basic-auth-shaped Application Password credentials, `manage_options`, signed lab requests for preflight/dry-run/apply, raw-body SHA-256 `X-Auth-Content-Hash`, nonce/timestamp/content-hash auth signatures, method/path/canonical-query/content-hash/session/idempotency push signatures, nonce replay before idempotency replay, auth-bound receipts, stale no-data-loss, idempotency, replay with fresh nonce/signature and zero fresh mutation work, and fresh authenticated snapshot readback. `npm run test:playground:plugin-atomic-install` adds local REST evidence for exact allowlisted fixture plugin file writes, plugin resource activation, allowlisted plugin-owned option data, dependency/dependent atomic grouping, and failure classification. | No production Reprint HTTP source mutation endpoint, no production Reprint auth/TLS/session/nonce/replay-store cleanup proof, no production Application Password integration, no real exporter credential binding, no Docker/live-source executor, no database transaction tests, no filesystem permission tests, and no arbitrary production plugin activation/custom-table apply semantics. Public legacy lab routes remain public/mutable, and stable credential/signing-key hash evidence in responses is lab proof rather than a production contract. | Yes. The current project is a lab model only. |
| R10 speed | The model mutates only changed resources instead of replacing the whole site. Progress page marks fast path at 12 percent and lists chunking/streaming as open. | No benchmarks, complexity budget, large-file streaming, parallel upload tests, memory ceiling, or latency targets. | Yes for any speed claim beyond "not whole-site replacement in the model." |
| R11 honest dry run | README states apply can refuse if the live remote changes after dry run. Drift tests cover file mutation drift and Playground fixture stale apply. The protocol smokes verify ready apply with a supplied dry-run receipt, reject missing receipts with `MISSING_DRY_RUN_RECEIPT`, and reject tampered receipts with `RECEIPT_MISMATCH`. The local REST lab verifies the corresponding HTTP statuses: `428`, `409`, and `412`. Lab receipts bind to the plan fingerprint/hash, mutation and precondition sets, ordered resource keys, and dry-run actual hashes. The authenticated Playground slice mints auth-bound receipts and rejects tampered/wrong-identity receipts with `AUTH_RECEIPT_MISMATCH`, expired receipts with `AUTH_RECEIPT_EXPIRED`, and stale remote apply before idempotency claim. | No production signing/auth binding, UI/operator warning tests, or concurrency test for remote changes between individual production writes. Auth-bound receipt evidence is local Playground lab evidence, not production Reprint auth. | Blocking for UX/reliability release, not for the current lab scope. |
| R12 audit records | Plans include mutations, preconditions, decisions, conflicts, blockers, and atomic groups. The lab PHP endpoint records bounded fixture-scoped lab journal/audit option events for dry-run, apply, stale, non-ready, missing-receipt, mismatch, and injected recovery outcomes; the local REST lab reads the legacy option journal over `GET /journal`, and recovery inspect reports hash-only current state. The JSON-model file journal persists hash/metadata-only JSONL records with sequence and `fsync` evidence. The DB idempotency slice records `idempotency-opened`, `apply-started`, per-mutation `mutation-prepared`, per-mutation `mutation-applied`, `apply-committed`, `apply-replayed`, and conflict evidence in `wp_reprint_push_lab_push_journal`; compact DB mutation evidence stores hashes and metadata only. | Records are still fixture-scoped lab option events, JSON-model files, or local Playground DB table rows. There is no durable production audit log, no production recovery artifact schema, no complete redaction/allowlist policy, and no operator-facing report. | Yes for production. |

## Test Audit

The current tests are useful, but they prove only narrow planner branches and
pure in-memory apply behavior.

| Test area | What it proves | What it does not prove |
| --- | --- | --- |
| Local changes on unchanged remote | Planner creates mutations and staged apply returns local file/row values. | That WordPress writes are safe, transactional, ordered correctly, or reversible. |
| Remote-only changes | A direct remote-only row change is not overwritten. | Preservation of related data graphs, generated data, remote uploads, postmeta, menus, taxonomies, plugin tables, or object-cache state. |
| Non-overlapping changes | A local file addition and remote post change can coexist in the returned snapshot. | That "non-overlapping" is semantically true in WordPress. A file and database row can be coupled even when their resource keys differ. |
| Direct conflicts | Same-row divergent edits block apply and leave the input object untouched. | Delete/edit conflicts, rename/move conflicts, binary file conflicts, row identity collisions, foreign-key-like relationships, or reviewed conflict resolution. |
| Plugin-owned data conflict class | A manually annotated row gets `plugin-data-conflict`; the forms fixture also proves allowlisted fixture option/postmeta apply and detection-only custom-table/plugin metadata export. | Discovery of arbitrary production plugin ownership, real activation semantics, custom-table apply drivers, or safe handling of serialized plugin data. |
| Atomic plugin install dependency | Missing dependencies, same-group dependencies, outside-group dependency mutations, remote dependency drift, incompatible version ranges, and dependency hash mismatches are covered. | Active/inactive state, activation hooks, mixed filesystem/database failure, or rollback. |
| Playground fixture plugin install atomicity | `npm run test:playground:plugin-atomic-install` verifies fixture-only plugin install through local Playground REST: base/remote lack the fixture plugins; local includes dependency and dependent plugins in the same atomic group; apply activates both, writes exact fixture plugin files/resources and allowlisted option data, and replay does zero fresh mutation work. It rejects missing dependency, dependency outside group, incompatible version, hash mismatch, activation requirement mismatch, remote dependency drift, stale preconditions, stale live dependency evidence, forged ready plans missing dependency mutation/`atomicGroups`/dependency requirements, and row-only plugin-owned data bypass attempts including `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`. It also confirms arbitrary plugin files, direct `active_plugins` row mutation, custom-table apply, and arbitrary plugin-owned data remain blocked. | Arbitrary production plugin installation/update/activation support, production rollback, plugin semantic drivers, custom-table drivers, arbitrary plugin-owned data safety, production durability/auth proof, or a general plugin dependency solver. During-publish and activation failures classify blocked recovery; they do not prove rollback. |
| Atomic group success | A grouped plugin stack applies to the staged object. | Production atomicity. The code returns a complete cloned site; it does not perform partially observable remote writes. |
| Remote drift after dry run | A changed planned file hash causes `PRECONDITION_FAILED`. | Drift on non-mutated dependencies, drift during an apply batch, stale plan expiry, or compare-and-swap at the storage layer. |
| Injected failure before commit | Throwing during staged mutation leaves the original object unchanged. | Crash consistency. There is no committed partial state, journal, recovery scan, or kill-process boundary in this test. |
| Playground lab recovery inspection | Fail-after-2 applies two whole-resource mutations, returns `LAB_INJECTED_APPLY_FAILURE`, records hash-only journal evidence, classifies `blocked-recovery` with `2 new` and `6 old` targets through CLI and REST inspect, and refuses retry with `PRECONDITION_FAILED`. | Production durable recovery. This injected failure path is not a hard-kill test, `fsync` proof, production journal, or automatic repair. |
| File-backed JSONL recovery journal | `npm run test:recovery:file-journal` writes append-only JSONL with monotonic sequences and per-append `fsync` evidence, then restart-style inspection verifies old-remote before mutation, fail-after-2 `blocked-recovery` with `2 new`/`6 old`/`0` unknown, retry refusal with `PRECONDITION_FAILED` and no remote change, completed replay with `0` additional mutations, drift as `blockedUnknown > 0`, and no raw fixture fields/data. | Production durable recovery. It is a JSON-model lab slice, not a WordPress DB table journal or process-kill test. Journal paths need unique/reset handling because plan open defaults to `truncate`, and raw-value prevention is not a full allowlist schema. |
| Authenticated local Playground HTTP push | `npm run test:playground:authenticated-http-push` verifies `/wp-json/reprint-push-lab/v1/authenticated/*` routes over real local HTTP. It covers Basic-auth-shaped Application Password credentials for bootstrapped users, `manage_options`, signed preflight/dry-run/apply, `X-Auth-Content-Hash` over raw request body bytes, auth signatures over nonce/timestamp/content hash, push signatures over method/path/canonical query/content hash/session/idempotency key, preflight-minted short-lived sessions, dry-run/apply session and idempotency requirements, signature verification before JSON parsing/receipt/idempotency/journal/mutation, preflight identity/capability/scope/session/expiry/journal evidence, read-only authenticated dry-run, auth-bound receipts, receipt validation before DB idempotency claim/mutation, `X-Reprint-Push-Idempotency-Key`, fresh authenticated snapshot verification, missing/bad/malformed auth, insufficient capability, forged `reprint_push_lab_auth`, unsigned/malformed/bad hash/body changed/stale/future timestamp/wrong method/path/query/wrong session/idempotency mismatch/public-route signature/nonce replay cases, nonce replay before idempotency replay, `AUTH_RECEIPT_MISMATCH`, `AUTH_RECEIPT_EXPIRED`, stale remote no-data-loss, and replay with fresh nonce/signature and zero fresh mutation work. | Production Reprint auth. This is lab HMAC and authenticated local Playground source-site mutation evidence only. The fallback verifier exists because Playground core did not establish `/wp-json/wp/v2/users/me`; it is not production Application Password integration and does not prove production TLS deployment, nonce/replay store cleanup, production session handling, real exporter credential binding, durable production audit records, or full production push. Public legacy lab routes remain public/mutable, and stable credential/signing-key hash evidence in responses is lab proof rather than a production response contract. |
| DB journal idempotency, process kill, and missing-commit finalization | `npm run test:playground:db-journal-idempotency` requires `X-Reprint-Push-Idempotency-Key`, rejects missing keys with `400 MISSING_IDEMPOTENCY_KEY`, records `mutation-prepared`/`mutation-applied` plus apply/replay/conflict events in `wp_reprint_push_lab_push_journal`, replays same key/body as `BATCH_ALREADY_COMMITTED` with no fresh mutation work or extra mutation events, rejects same key/different body with `409 IDEMPOTENCY_KEY_CONFLICT`, and proves DB-native concurrent first-apply claiming with one opened claim and one fresh mutation executor. `npm run test:playground:db-journal-process-kill` sends real `SIGKILL` during an in-flight DB-journaled REST apply, restarts a host-mounted localhost Playground site, verifies opened/started DB rows persist with no false commit, returns non-mutating `RECOVERY_BLOCKED` from DB planned evidence plus live hashes, and blocks retry without overwriting partial state. `npm run test:playground:db-journal-missing-commit-finalization` proves same key/body returns `BATCH_RECOVERY_FINALIZED` with zero fresh mutation work when all live target hashes already match planned after hashes and `apply-committed` is missing, while same key/different body still conflicts before finalization. | Production durable recovery or resumability. It is fixture-scoped local Playground SQLite/host-mount evidence, not production durability, storage `fsync`, rollback, exactly-once production writes, arbitrary plugin data safety, or full MySQL/InnoDB behavior. All-old stale-claim safe retry remains conservative/not fully solved, and tests mostly count mutation evidence rows rather than deeply asserting every observed hash. Redaction checks are key-based plus fixture-value smoke checks, not a formal sanitizer for arbitrary future messages. |

## Additional Findings

1. **Atomic group membership is caller-trusted.** If a push intent omits a
   coupled resource, the planner has no independent way to discover that the
   group is incomplete. Production needs validators that can reject incomplete
   file/database/plugin sets before any write.

2. **The failure test is weaker than the reliability claim.** It proves that a
   JavaScript object is not mutated when a throw happens before a returned
   clone. It does not prove recovery after an interrupted process, failed file
   write, committed DB transaction, HTTP timeout, plugin activation fatal, or
   operator retry. The file-backed JSONL journal adds restart-style
   classification and per-append `fsync` evidence in the JSON model, but it is
   still not production WordPress crash-boundary proof. The DB process-kill
   smoke adds local Playground `SIGKILL`/restart evidence for opened/started DB
   rows, no false commit, DB-only `RECOVERY_BLOCKED`, and retry refusal. The
   missing-commit finalization smoke adds `BATCH_RECOVERY_FINALIZED` when the
   same key/body sees all live target hashes at planned after hashes and the
   `apply-committed` row is missing. These are still not production durability,
   storage `fsync`, rollback, exactly-once production writes, full MySQL/InnoDB
   behavior, or all-old stale-claim retry proof.

3. **Speed has almost no proof.** The only positive evidence is resource-level
   diffing in a small object model. There are no large-site benchmarks, memory
   ceilings, streaming assertions, or chunk scheduling tests. Speed claims
   should stay explicitly provisional.

4. **The Playground endpoints are intentionally not production endpoints.** They
   prove a narrow fixture-scoped protocol shape, including read-only dry-run,
   required receipt-backed ready apply, stale rejection, receipt mismatch
   refusal, conflict refusal, journal readback, mandatory apply idempotency
   keys, idempotent replay/conflict evidence in a local DB table, lab recovery
   inspection, local-only REST routes under `reprint-push-lab/v1`, DB-native
   concurrent first-apply claiming, local Playground process-kill/restart
   blocked recovery, DB-only missing-commit finalization, and authenticated
   local Playground aliases under `/authenticated/*` that require
   `manage_options`, reject forged `reprint_push_lab_auth`, bind receipts to
   auth/session/request data, reject `AUTH_RECEIPT_MISMATCH` and
   `AUTH_RECEIPT_EXPIRED`, and verify source changes through a fresh
   authenticated snapshot. Playground fallback caveat: the lab verifier
   validates stored hashed app-password entries and sets the current user
   because local Playground core did not establish `/wp-json/wp/v2/users/me`.
   They do not provide production Reprint auth, protocol HMAC, TLS deployment,
   production nonce/replay/session storage, production Application Password
   integration, real exporter credential binding, durable journals, production
   process-kill safety, or production finalization/replay.

5. **The plugin-owned forms and fixture plugin install slices are
   fixture-scoped.** The allowlisted `reprint_push_forms_fixture` option and
   `_reprint_push_forms_schema` postmeta prove guarded handling for known
   fixture resources only. `wp_reprint_push_forms_lab` custom-table rows and
   `reprint-push-forms-fixture` metadata are detection-only, and unsupported
   plugin-owned rows block instead of applying. The fixture plugin install
   smoke adds exact allowlisted fixture plugin file/resource writes and atomic
   dependency checks, but it is not arbitrary production plugin
   installation/update/activation support or rollback proof.

## Required Release Gates

Before this project can claim production-grade no-data-loss push behavior, it
needs direct proof for these gates:

1. Broader real WordPress fixture suite covering files, uploads, posts, postmeta,
   taxonomies, options, plugin tables, serialized PHP data, plugin activation,
   and multisite if in scope. The current forms fixture is not enough to claim
   arbitrary production plugin semantics.
2. Storage-level compare-and-swap or equivalent guarded writes for every file
   and database mutation.
3. Durable production apply journal, likely DB-table backed for WordPress
   source mutation, with recovery tests that kill the process at every write
   boundary and prove old/new/blocked state classification across storage
   boundaries, including stale-claim retry behavior. The current DB
   journal/idempotency/process-kill/finalization slice is fixture-scoped local
   Playground SQLite/host-mount evidence, and the JSONL lab journal has
   per-append `fsync` evidence, but neither is enough for this production gate.
4. Atomic group enforcement for coupled file/database/plugin operations,
   including rollback or blocked recovery artifacts after partial external
   effects.
5. Plugin validator/merge-driver contract with at least one real plugin fixture
   and explicit fallback to preserve remote state.
6. Stale-plan and concurrency tests for remote changes before apply, during
   apply, between chunks, and production duplicate first applies with the same
   idempotency key.
7. Benchmarks with large files and large tables proving speed improvements do
   not skip preconditions, journals, or validators.

Until those gates exist, the honest claim is: **the lab demonstrates planner
invariants for simplified JSON snapshots, fixture-scoped Playground push
protocol smoke, local-only HTTP-style REST behavior, and injected-failure
recovery inspection plus file-backed JSONL journal evidence in the JSON model
and fixture-scoped DB journal/idempotency/process-kill plus missing-commit
finalization evidence, plus hard-coded fixture plugin install atomicity
evidence; it does not yet prove no data loss, reliability, or speed for a live
WordPress push.**
