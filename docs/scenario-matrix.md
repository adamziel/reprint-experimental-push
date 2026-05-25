# Scenario Matrix

The first executable matrix lives in `test/push-planner.test.js`.

| Scenario | Expected behavior | Current evidence |
| --- | --- | --- |
| Remote site is unchanged since pull | Local file and row changes are planned and applied. | `plans and applies local changes when remote still matches the pull base` |
| Remote changed, local did not | Remote change is kept; no mutation is produced. | `keeps remote-only changes and does not overwrite them` |
| Remote and local changed different resources | Local mutations apply while remote-only changes are preserved. | `combines non-overlapping local and remote changes` |
| Local deleted a file or row, remote still matches pull base | Delete mutations are planned only with matching live remote preconditions. | `plans local deletions only behind live remote preconditions` |
| Local deleted a row, remote edited the same row | Plan is `conflict`; conflict evidence reports delete-vs-update without row contents; apply refuses. | `stops a local deletion when the remote edited the same resource` |
| Local deleted a directory, remote added a descendant under it | Plan is `conflict`; no mutation is emitted for the unsafe directory deletion; the remote-only descendant is preserved; conflict evidence names both paths without file contents. | `stops a local directory deletion that would remove a remote-only descendant` |
| Local file type swap would hide a remote-only descendant | Plan is `conflict`; no mutation is emitted for the unsafe type swap; remote descendant is preserved; conflict evidence names both paths without file contents. | `stops file type swaps that would hide remote-only descendants` |
| Local ordinary file edit plus unsafe directory deletion | Plan is `conflict`; the unsafe topology mutation is suppressed, the independent mutation remains hash-preconditioned for audit, and apply refuses the whole non-ready plan. | `keeps independent mutation evidence while suppressing unsafe topology mutations` |
| Remote and local independently changed a resource to identical content | No mutation is produced; plan records `already-in-sync`. | `recognizes matching independent edits as already in sync` |
| Local revision post changes | Plan is `blocked`; revision rows stay outside the supported release-candidate slice and do not become ready mutations. | `blocks revision post graph surfaces in the release-candidate slice` |
| Remote-only plugin metadata or file changed | Remote plugin state is kept; no local mutation is produced. | `preserves remote-only plugin changes` |
| Remote-only plugin metadata or file changed while local edits an ordinary resource | The ordinary local mutation can be planned with a live remote precondition while remote plugin metadata/files are kept as `keep-remote` decisions. | `combines local ordinary changes while preserving remote-only plugin changes` |
| Local plugin metadata changed while remote plugin files changed | Plan is `blocked`; the local metadata mutation is not emitted; evidence names the stale remote plugin file context without file contents. | `blocks local plugin metadata changes when remote plugin files changed` |
| Local plugin files changed while remote plugin metadata changed | Plan is `blocked`; the local file mutation is not emitted; evidence names the stale remote plugin metadata context without plugin payload values. | `blocks local plugin file changes when remote plugin metadata changed` |
| Local plugin files changed while local and remote independently reached the same plugin metadata | File mutation may proceed with live remote preconditions because the plugin metadata context matches the live remote context. | `allows plugin file changes when plugin metadata independently matches remote` |
| Local plugin-owned data changed while the owner plugin file changed only on remote | Plan is `blocked`; the row mutation is not emitted; evidence names the owner plugin context resource and hashes without file contents. | `blocks plugin-owned data when owner plugin files changed only on remote` |
| Local plugin-owned data changed while local and remote independently reached the same owner plugin file | Row mutation may proceed with live remote preconditions because the local owner plugin context matches the live remote context. | `allows plugin-owned data when owner plugin context independently matches remote` |
| Remote-only plugin removal invalidates a stale local dependency | Plan is `blocked`; stale local plugin state cannot satisfy the dependency. | `remote-only plugin removal blocks stale local dependency assumptions` |
| Remote and local changed the same row differently | Plan is `conflict`; apply refuses; remote remains unchanged. | `refuses direct conflicts and preserves the remote snapshot` |
| Conflict is in plugin-owned data | Conflict is classified as `plugin-data-conflict`. | `classifies plugin-owned data conflicts separately from generic rows` |
| Plugin-owned forms option is allowlisted fixture data | Nested `reprint_push_forms_fixture` data can be planned and applied only through the explicit fixture allowlist. | `npm run test:playground` / Playground plugin-owned forms fixture smokes |
| Plugin-owned forms postmeta is allowlisted fixture data | `_reprint_push_forms_schema` postmeta can be applied only when attached to fixture-marked parent posts. | `npm run test:playground` / Playground plugin-owned forms fixture smokes |
| Plugin-owned row declares the wrong driver for its table | Plan is `blocked` before mutation; evidence includes the resource key, declared driver, hashes, and change kind without row payload values. | `blocks plugin-owned resources when the declared driver does not match the table` |
| Fixture forms lab custom-table driver | Exact `wp_reprint_push_forms_lab` positive `id:N` rows can become ready only with owner `forms`, explicit `fixture-forms-lab-table` policy, unchanged active `reprint-push-forms-fixture` evidence, and matching precondition hashes. Delete remains blocked. | `fixture forms lab table requires exact driver and active fixture plugin evidence` / `npm run test:playground:forms-lab-table` |
| Unknown plugin-owned custom-table rows block | Custom tables outside the exact forms lab fixture driver, missing driver policy, forged driver evidence, or forged generic drivers such as `wp-option` on the custom table reject before mutation as unsupported plugin-owned resources. | `blocks unknown plugin-owned custom table rows without leaking values` / `npm run test:playground:forms-lab-table` |
| Fixture forms lab row conflict/stale safety | Divergent local/remote forms lab rows stay `plugin-data-conflict`; stale preconditions reject with `PRECONDITION_FAILED` and preserve the target. Journal/recovery evidence is hash-only/redacted for raw row payload values. | `fixture forms lab table conflicts and stale preconditions preserve remote` / `fixture forms lab table blocked recovery redacts raw remote payload values` |
| Plugin metadata is detection-only | `reprint-push-forms-fixture` metadata is exported/detected but not applied as a ready mutation. | `npm run test:playground` / Playground plugin-owned forms fixture smokes |
| Local WordPress graph row references a stale remote-created post identity | Plan is `blocked`; the local `wp_postmeta` mutation is not emitted; the remote-created `wp_posts` row is kept; blocker evidence records relationship key, target resource key, hashes, and change kinds without raw post or meta payload values. | `blocks local postmeta references to stale remote-created post identity` |
| Atomic plugin install is missing dependency | Plan is `blocked`; apply refuses. | `blocks an atomic plugin install when dependencies are absent` |
| Atomic plugin dependency metadata includes private fields | Plan evidence records only normalized plugin dependency audit fields and omits raw dependency payloads from blockers and atomic-group dependencies. | `redacts raw plugin dependency metadata from blocker evidence` |
| Plugin install and dependency are included together | All files, plugin metadata, and options apply as one atomic group. | `applies an atomic plugin install when dependencies are included in the same plan` |
| Plugin dependency mutation is outside the atomic group | Plan is `blocked`; apply refuses. | `blocks an atomic plugin bundle when its dependency mutation is outside the group` |
| Remote dependency changed since base | Plan is `blocked`; stale local dependency assumptions cannot make the bundle ready. | `blocks a dependent atomic bundle when a remote dependency changed since base` |
| Plugin dependency version range is incompatible | Plan is `blocked`; apply refuses. | `blocks an atomic bundle with an incompatible plugin dependency version range` |
| Plugin dependency hash metadata does not match remote | Plan is `blocked`; apply refuses. | `blocks an atomic bundle when dependency hash metadata does not match remote` |
| Remote changes after dry-run | Apply rejects with `PRECONDITION_FAILED`. | `rejects apply when the remote changed after dry-run planning` |
| Playground fixture protocol dry-run | Dry-run verifies ready-plan preconditions, applies nothing, and same-process WordPress readback stays unchanged. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol ready apply | Apply with a supplied dry-run receipt writes the eight expected fixture mutations and verifies hashes/readback. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol missing receipt | Apply without a supplied dry-run receipt rejects with `MISSING_DRY_RUN_RECEIPT` before mutation. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol tampered receipt | Apply with a mismatched receipt rejects with `RECEIPT_MISMATCH` before mutation. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol stale apply | Stale apply rejects with `PRECONDITION_FAILED` and preserves the changed remote fixture. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol non-ready plan | Conflict dry-run and apply reject with `PLAN_NOT_READY` and report row, file, and plugin-data conflict classes. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground local REST namespace | Disposable Playground servers expose `reprint-push-lab/v1` with `GET /snapshot`, `GET /journal`, `POST /dry-run`, and `POST /apply` over real local HTTP. | `npm run test:playground:http-push` |
| Playground local REST ready apply | Dry-run is read-only, returns a receipt, and receipt-backed apply writes the eight expected fixture mutations. | `npm run test:playground:http-push` |
| Playground local REST receipt/stale/conflict refusals | Missing receipt rejects with `428 MISSING_DRY_RUN_RECEIPT`, tampered receipt with `409 RECEIPT_MISMATCH`, stale remote with `412 PRECONDITION_FAILED`, and conflict plans with `409 PLAN_NOT_READY` for row, file, and plugin-data classes. | `npm run test:playground:http-push` |
| Playground authenticated REST namespace | Authenticated local routes live under `/wp-json/reprint-push-lab/v1/authenticated/*`; public legacy lab routes remain intentionally public for older smokes. | `npm run test:playground:authenticated-http-push` |
| Playground authenticated preflight | Basic-auth-shaped WordPress Application Password credentials for bootstrapped users establish identity, require `manage_options`, and return identity/capability/scope/session/expiry/journal evidence. Playground fallback caveat: local Playground core did not establish `/wp-json/wp/v2/users/me`, so the lab route validates stored hashed app-password entries and sets the current user before capability checks. | `npm run test:playground:authenticated-http-push` |
| Playground signed request integrity | `/authenticated/preflight`, `/authenticated/dry-run`, and `/authenticated/apply` require signed lab requests. Signature verification happens before JSON parsing, receipt validation, idempotency lookup/claim, journal writes, or mutation. `X-Auth-Content-Hash` is SHA-256 over raw request body bytes. | `npm run test:playground:authenticated-http-push` |
| Playground push signature binding | Auth signatures cover nonce, timestamp, and content hash. Push signatures bind method, actual path, canonical query, content hash, server-minted lab session, and idempotency key; dry-run/apply require the session and idempotency key. | `npm run test:playground:authenticated-http-push` |
| Playground authenticated dry-run receipt | Authenticated dry-run is read-only by authenticated snapshot comparison and mints a receipt bound to auth scope, identity, session, request route, plan, and body. | `npm run test:playground:authenticated-http-push` |
| Playground authenticated apply | Authenticated apply requires `X-Reprint-Push-Idempotency-Key`, validates receipt scope/expiry/identity/session/request binding before DB idempotency claim and mutation, applies over real local HTTP, and verifies source changes through a fresh authenticated snapshot. | `npm run test:playground:authenticated-http-push` |
| Playground authenticated negative auth cases | Missing, bad, and malformed auth reject; insufficient capability rejects or remains auth-required if the limited Playground identity cannot be established; forged `reprint_push_lab_auth` query/body/header values do not bypass auth. | `npm run test:playground:authenticated-http-push` |
| Playground authenticated signature negative cases | Unsigned, malformed, bad hash, body changed after signing, stale/future timestamp, wrong method/path/query, wrong session, idempotency mismatch, public-route signature attempts, and nonce replay reject before mutation. Nonce replay rejects before idempotency replay. | `npm run test:playground:authenticated-http-push` |
| Playground authenticated receipt/stale/replay cases | Tampered or wrong-identity receipts reject with `AUTH_RECEIPT_MISMATCH`, expired receipts reject with `AUTH_RECEIPT_EXPIRED`, missing idempotency key rejects before mutation, stale remote state preserves target data and creates no idempotency claim, and replay with a fresh nonce/signature performs zero fresh mutation work. | `npm run test:playground:authenticated-http-push` |
| Authenticated CLI dry-run | `reprint-push-lab push-authenticated --dry-run-only` fetches the live source snapshot, builds a three-way plan, signs preflight/dry-run, returns an auth-bound receipt hash, and leaves the source unchanged. | `npm run test:playground:authenticated-cli-push` |
| Authenticated CLI apply | `reprint-push-lab push-authenticated` performs the same authenticated plan/dry-run path, applies with an idempotency key, records DB journal commit evidence, and verifies the final source snapshot against the local fixture surface. | `npm run test:playground:authenticated-cli-push` |
| Authenticated CLI changed-source refusal | When the source changed since the pull base, the CLI reports `PLAN_NOT_READY_LOCALLY` with conflict evidence and does not call dry-run or apply. | `npm run test:playground:authenticated-cli-push` |
| Authenticated CLI post-snapshot drift refusal | When the source changes after the CLI fetched its live snapshot but before dry-run, the locally ready plan is refused by authenticated dry-run with `PRECONDITION_FAILED`; apply is not called and the concurrent source change is preserved. | `npm run test:playground:authenticated-cli-push` |
| Playground DB journal requires idempotency key | `POST /apply` without `X-Reprint-Push-Idempotency-Key` rejects with `400 MISSING_IDEMPOTENCY_KEY` before mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB journal records apply boundaries | `wp_reprint_push_lab_push_journal` records `idempotency-opened`, `apply-started`, per-mutation `mutation-prepared`, per-mutation `mutation-applied`, `apply-committed`, replay, and conflict evidence separately from the legacy `wp_options` `/journal` evidence; compact mutation evidence stores hashes/metadata only. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency replay | Same key plus same body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`, no fresh mutation work, no extra mutation events, and an unchanged snapshot. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency conflict | Same key plus a different body rejects with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB stale rejection replay | A stale precondition failure is journaled as a rejected terminal result; same key/body replay returns `PRECONDITION_FAILED` with `idempotency.replayed: true` and no fresh mutation work, while a different body with the same key conflicts. | `npm run test:playground:db-journal-idempotency` |
| Playground mid-apply JIT drift | A lab drift after dry-run and initial apply validation but before mutation `N` writes returns `412 PRECONDITION_FAILED`, preserves the drifted target, records hash-only `mutation-precondition-failed` evidence, writes no `mutation-applied` for `N`, writes no later mutations, and writes no `apply-committed`. | `npm run test:playground:mid-apply-drift` |
| Playground mid-apply rejected replay | Same key/body after the mid-apply JIT rejection replays the rejected result with `idempotency.replayed: true` and no fresh mutation work; same key/different body returns `409 IDEMPOTENCY_KEY_CONFLICT`; recovery inspect is non-mutating. | `npm run test:playground:mid-apply-drift` |
| Playground storage-boundary guarded DB updates | After the JIT pre-write hash passes, existing fixture row updates for `wp_posts`, allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact positive-id `wp_reprint_push_forms_lab` rows use a single guarded `wpdb` update comparing expected stored columns at the SQL write boundary. Evidence is hash-only `storageGuard` with boundary, driver, logical/physical table, operation, compared columns, expected resource/storage hashes, rows affected, outcome, and SQL shape hash. | `npm run test:playground:storage-guarded-db-write` |
| Playground storage-boundary drift failures | Value drift on each supported table, marker-empty ownership drift for posts and postmeta parents, and absent/delete drift fail closed with rows affected `0`, outcome `stale-at-write`, `PRECONDITION_FAILED`, drift preserved, no `mutation-applied` for the failed target, no later mutations, and no `apply-committed`. | `npm run test:playground:storage-guarded-db-write` |
| Playground storage-boundary guarded fixture file writes | After the JIT pre-write hash passes, fixture upload file update/create mutations compare live file bytes/hash against the storage value observed after JIT, write planned content to a same-directory temp file, and rename after the comparison; fixture upload file deletes compare the same storage value before unlinking. Evidence is hash-only `storageGuard` with boundary `filesystem-compare-rename` for update/create or `filesystem-compare-unlink` for delete, driver, operation, logical fixture path, compared fields, expected resource/storage hashes, actual/planned storage hashes, physical path hash, and outcome `applied`. | `npm run test:playground:storage-guarded-file-write` |
| Playground storage-boundary file drift failures | Post-JIT/pre-write file drift on update, create, or delete returns `PRECONDITION_FAILED`, preserves the drifted file state, records no `mutation-applied` for the failed file, runs no later mutations, writes no `apply-committed`, replays same key/body with no fresh mutation work, and conflicts on same key/different body. | `npm run test:playground:storage-guarded-file-write` |
| Playground DB idempotency concurrent same-body first apply | A unique `claim_key_hash` opens exactly one claim before mutation; concurrent same-key/same-body first applies produce one fresh mutation executor and the duplicate returns safe in-progress/retry/replay behavior without mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency concurrent different-body first apply | Concurrent same-key/different-body requests reject the conflicting request with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation while the original request is the only fresh mutation executor. | `npm run test:playground:db-journal-idempotency` |
| Playground DB process-kill persistence | A real `SIGKILL` during an in-flight DB-journaled REST apply leaves persisted DB `idempotency-opened`/`apply-started` rows after host-mounted Playground restart without a false `apply-committed`. | `npm run test:playground:db-journal-process-kill` |
| Playground DB process-kill recovery block | After hard kill/restart, DB planned evidence plus live target hashes classify mixed old/new state, recovery inspection returns non-mutating `RECOVERY_BLOCKED`, and retry does not overwrite the partial state without relying on the legacy option journal. | `npm run test:playground:db-journal-process-kill` |
| Playground DB missing-commit finalization | A lab hook leaves all live target hashes at planned after hashes with DB mutation evidence but no `apply-committed`; same key/body returns `BATCH_RECOVERY_FINALIZED` with zero fresh mutation work, while same key/different body conflicts before finalization. | `npm run test:playground:db-journal-missing-commit-finalization` |
| Playground DB all-old stale-claim retry | A lab hook writes `idempotency-opened`, `apply-started`, and `stale-claim-abandoned` with no mutation or terminal rows; same key/different body conflicts, while exact same key/body retry requires matching abandonment evidence, validated started targets, zero mutation evidence, and all live target hashes at old values before appending derived `stale-claim-retry-started`, performing one fresh mutation set, committing, and replaying later as `BATCH_ALREADY_COMMITTED`. | `npm run test:playground:db-journal-stale-claim-all-old` |
| Playground DB stale retry guard and retry-start negative | If the derived stale retry claim already exists before retry `apply-started`/mutation, a later exact retry returns `IDEMPOTENCY_KEY_IN_PROGRESS` and does not mutate; if a retry `apply-started` exists without matching abandonment evidence, later retry blocks with `RECOVERY_BLOCKED` instead of reusing older abandonment evidence. | `npm run test:playground:db-journal-stale-claim-all-old` |
| Fixture plugin install atomic positive path | Base/remote lack fixture plugins; local includes dependency and dependent fixture plugins in one atomic group; apply activates both, writes exact fixture plugin files/resources and allowlisted option data, and replay does zero fresh mutation work. | `npm run test:playground:plugin-atomic-install` |
| Fixture plugin install dependency negatives | Missing dependency, dependency outside group, incompatible version, hash mismatch, activation requirement mismatch, remote dependency drift, and stale precondition reject before mutation or preserve the target. | `npm run test:playground:plugin-atomic-install` |
| Fixture plugin install forged ready plans | Forged ready plans omitting the dependency mutation, `atomicGroups`, dependency requirements, or live dependency evidence reject with executor-side validation before mutation. | `npm run test:playground:plugin-atomic-install` |
| Fixture plugin same-apply staged proof | Activation-style fixture plugin mutations may accept an inactive staged plugin hash only when `preWriteStagingProof` shows an earlier same-apply plugin file mutation covered by the declared ready atomic group. | `npm run test:playground:plugin-atomic-install` |
| Fixture plugin staged proof negatives | External staged plugin files without prior same-apply proof, forged mutation-local group ids without declared atomic-group coverage, and planned inactive plugin mutations all reject with `PRECONDITION_FAILED` before activation/commit. | `npm run test:playground:plugin-atomic-install` |
| Fixture plugin row-only plugin-owned data bypass | A row-only dependent plugin-owned option plan cannot bypass the atomic dependency requirement and rejects with `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`. | `npm run test:playground:plugin-atomic-install` |
| Exact fixture plugin allowlist | The lab accepts only named fixture plugin files/resources, allowlisted plugin-owned options, and the exact forms lab custom-table driver; arbitrary plugin files, direct `active_plugins` row mutation, other custom-table apply, and arbitrary plugin-owned data remain blocked. | `npm run test:playground:plugin-atomic-install` / `npm run test:playground:forms-lab-table` / `scripts/playground/snapshot-lib.php` |
| Fixture plugin install failure injection | Before-commit failure preserves the old remote; during-publish and activation failures classify blocked recovery/no fresh retry mutation work instead of proving rollback. | `npm run test:playground:plugin-atomic-install` |
| Playground lab injected recovery failure | Fail-after-2 returns `LAB_INJECTED_APPLY_FAILURE` after two successful whole-resource mutations, records planned recovery entries and hash-only current state, and inspection reports `blocked-recovery` with `2 new` and `6 old` targets. | `npm run test:playground:recovery` |
| Playground lab retry after partial apply | Retry over the partial lab state refuses with `PRECONDITION_FAILED` instead of applying over the blocked recovery state. | `npm run test:playground:recovery` |
| File-backed JSONL recovery journal opens and restarts | Append-only JSONL records use monotonic sequences, include `fsync` evidence after each append, and can be read after restart-style inspection. | `npm run test:recovery:file-journal` |
| File-backed JSONL old remote before mutation | A journal opened before any mutation inspects as `old-remote` instead of pretending success. | `npm run test:recovery:file-journal` |
| File-backed JSONL partial apply recovery | Fail-after-2 inspects as `blocked-recovery` with `2 new`, `6 old`, and `0` unknown targets; retry refuses with `PRECONDITION_FAILED` and leaves the remote unchanged. | `npm run test:recovery:file-journal` |
| File-backed JSONL completed replay | A completed replay applies `0` additional mutations and inspects as fully updated or already committed. | `npm run test:recovery:file-journal` |
| File-backed JSONL drift outside recovery envelope | Current state outside journaled before/after hashes reports `blockedUnknown > 0` instead of reusing stale local data. | `npm run test:recovery:file-journal` |
| File-backed JSONL raw-value guard | Journal files contain no raw fixture fields/data; prevention is forbidden-key/fixture-string based, not a full production allowlist schema. | `npm run test:recovery:file-journal` |
| Failure happens while staging mutations | No partially mutated remote state is returned or committed. | `injected failure before commit returns no partially mutated remote state` |

## Remaining Missing Scenarios

- Production Reprint HTTP source mutation endpoint for live source sites.
- Reprint exporter protocol extension for authenticated push preflight,
  sessions, signed/expiring production receipts, and mutation batches.
- Production auth/session/nonce proof for any source-site REST mutation route;
  the authenticated Playground slice is local lab HMAC evidence only and does
  not prove production Reprint auth, TLS deployment, nonce/replay store cleanup,
  production session handling, production Application Password integration,
  real exporter credential binding, durable production audit records, or full
  production push.
- File body streaming with large upload chunks.
- Database transaction boundaries on MySQL and SQLite.
- Production storage-level compare-and-swap or locking around final target
  writes. The current JIT pre-write hash check plus
  `npm run test:playground:storage-guarded-db-write` and
  `npm run test:playground:storage-guarded-file-write` proves only local
  Playground fixture slices: update-only guarded SQL for existing `wp_posts`,
  allowlisted `wp_options`, single-row `wp_postmeta`, exact
  `wp_reprint_push_forms_lab` rows, and guarded compare/rename/unlink for
  fixture upload file update/create/delete. The file code path supports named
  fixture plugin file update paths, but the standalone smoke does not exercise
  fixture plugin-file writes. These are not generic MySQL/InnoDB or filesystem
  CAS, transactions/locking, rollback, storage `fsync`, arbitrary file
  guarding, plugin activation guarding, or production Reprint HTTP mutation.
- Production plugin activation/update with dependency and recovery checks.
- Object-cache, cron, generated files, and maintenance-mode interactions.
- Plugin validator and merge-driver contracts with real plugin fixtures; the
  current forms slice, exact forms lab custom-table driver, and fixture plugin install atomicity slice are
  fixture/allowlist-scoped and do not prove arbitrary production plugin-owned
  options, postmeta, custom tables, production plugin installation/update,
  production activation semantics, or production rollback.
- General WordPress graph identity mapping and reference rewriting. The current
  planner proof blocks a local `wp_postmeta.post_id` reference when the target
  `wp_posts` identity changed on the remote since the pull base, and it records
  hash-only relationship evidence. The planner also refuses reference-bearing
  rows whose targets are absent from the live remote, and it blocks post GUIDs
  alongside revisions, menu/navigation posts, and serialized blocks, so
  same-plan graph identity creates stay blocked. It does not prove safe
  automatic rewriting for attachments, nav menus, term splitting,
  `_thumbnail_id`, `post_parent`, `wp_term_relationships`,
  `wp_term_taxonomy`, `wp_termmeta`, cross-table create batches, or production
  importer/exporter identity maps.
- Production DB-table journal and kill-process recovery tests around every
  durable WordPress boundary. The current DB journal/idempotency/process-kill
  plus missing-commit finalization and all-old stale-claim retry slices are
  fixture-scoped local Playground SQLite/host-mount evidence only, not
  production durability, storage `fsync`, rollback, exactly-once production
  writes, arbitrary plugin data safety, or full MySQL/InnoDB behavior. The
  stale-claim slice does not solve production stale-claim leases, fencing,
  claim expiry, cross-process/shared-DB lock proof, arbitrary production
  repair, or production retry policy; observed-hash assertions are still
  shallow in places, and production auth/live source mutation/full push remains
  pending. The JSONL journal has per-append `fsync` evidence in the JSON-model
  lab, and the Playground recovery harness is injected lab failure inspection
  only.

## Invariant Policy

The planner policy is documented in
[No Overwrite Invariants](invariants/no-overwrite.md).
