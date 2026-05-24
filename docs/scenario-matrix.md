# Scenario Matrix

The first executable matrix lives in `test/push-planner.test.js`.

| Scenario | Expected behavior | Current evidence |
| --- | --- | --- |
| Remote site is unchanged since pull | Local file and row changes are planned and applied. | `plans and applies local changes when remote still matches the pull base` |
| Remote changed, local did not | Remote change is kept; no mutation is produced. | `keeps remote-only changes and does not overwrite them` |
| Remote and local changed different resources | Local mutations apply while remote-only changes are preserved. | `combines non-overlapping local and remote changes` |
| Local deleted a file or row, remote still matches pull base | Delete mutations are planned only with matching live remote preconditions. | `plans local deletions only behind live remote preconditions` |
| Local deleted a row, remote edited the same row | Plan is `conflict`; conflict evidence reports delete-vs-update without row contents; apply refuses. | `stops a local deletion when the remote edited the same resource` |
| Local file type swap would hide a remote-only descendant | Plan is `conflict`; remote descendant is preserved; conflict evidence names both paths without file contents. | `stops file type swaps that would hide remote-only descendants` |
| Remote and local independently changed a resource to identical content | No mutation is produced; plan records `already-in-sync`. | `recognizes matching independent edits as already in sync` |
| Remote-only plugin metadata or file changed | Remote plugin state is kept; no local mutation is produced. | `preserves remote-only plugin changes` |
| Remote-only plugin removal invalidates a stale local dependency | Plan is `blocked`; stale local plugin state cannot satisfy the dependency. | `remote-only plugin removal blocks stale local dependency assumptions` |
| Remote and local changed the same row differently | Plan is `conflict`; apply refuses; remote remains unchanged. | `refuses direct conflicts and preserves the remote snapshot` |
| Conflict is in plugin-owned data | Conflict is classified as `plugin-data-conflict`. | `classifies plugin-owned data conflicts separately from generic rows` |
| Plugin-owned forms option is allowlisted fixture data | Nested `reprint_push_forms_fixture` data can be planned and applied only through the explicit fixture allowlist. | `npm run test:playground` / Playground plugin-owned forms fixture smokes |
| Plugin-owned forms postmeta is allowlisted fixture data | `_reprint_push_forms_schema` postmeta can be applied only when attached to fixture-marked parent posts. | `npm run test:playground` / Playground plugin-owned forms fixture smokes |
| Fixture forms lab custom-table driver | Exact `wp_reprint_push_forms_lab` positive `id:N` rows can become ready only with owner `forms`, explicit `fixture-forms-lab-table` policy, unchanged active `reprint-push-forms-fixture` evidence, and matching precondition hashes. Delete remains blocked. | `fixture forms lab table requires exact driver and active fixture plugin evidence` / `npm run test:playground:forms-lab-table` |
| Unknown plugin-owned custom-table rows block | Custom tables outside the exact forms lab fixture driver, missing driver policy, forged driver evidence, or forged generic drivers such as `wp-option` on the custom table reject before mutation as unsupported plugin-owned resources. | `blocks unknown plugin-owned custom table rows without leaking values` / `npm run test:playground:forms-lab-table` |
| Fixture forms lab row conflict/stale safety | Divergent local/remote forms lab rows stay `plugin-data-conflict`; stale preconditions reject with `PRECONDITION_FAILED` and preserve the target. Journal/recovery evidence is hash-only/redacted for raw row payload values. | `fixture forms lab table conflicts and stale preconditions preserve remote` / `fixture forms lab table blocked recovery redacts raw remote payload values` |
| Plugin metadata is detection-only | `reprint-push-forms-fixture` metadata is exported/detected but not applied as a ready mutation. | `npm run test:playground` / Playground plugin-owned forms fixture smokes |
| Atomic plugin install is missing dependency | Plan is `blocked`; apply refuses. | `blocks an atomic plugin install when dependencies are absent` |
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
| Playground DB journal requires idempotency key | `POST /apply` without `X-Reprint-Push-Idempotency-Key` rejects with `400 MISSING_IDEMPOTENCY_KEY` before mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB journal records apply boundaries | `wp_reprint_push_lab_push_journal` records `idempotency-opened`, `apply-started`, per-mutation `mutation-prepared`, per-mutation `mutation-applied`, `apply-committed`, replay, and conflict evidence separately from the legacy `wp_options` `/journal` evidence; compact mutation evidence stores hashes/metadata only. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency replay | Same key plus same body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`, no fresh mutation work, no extra mutation events, and an unchanged snapshot. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency conflict | Same key plus a different body rejects with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB stale rejection replay | A stale precondition failure is journaled as a rejected terminal result; same key/body replay returns `PRECONDITION_FAILED` with `idempotency.replayed: true` and no fresh mutation work, while a different body with the same key conflicts. | `npm run test:playground:db-journal-idempotency` |
| Playground mid-apply JIT drift | A lab drift after dry-run and initial apply validation but before mutation `N` writes returns `412 PRECONDITION_FAILED`, preserves the drifted target, records hash-only `mutation-precondition-failed` evidence, writes no `mutation-applied` for `N`, writes no later mutations, and writes no `apply-committed`. | `npm run test:playground:mid-apply-drift` |
| Playground mid-apply rejected replay | Same key/body after the mid-apply JIT rejection replays the rejected result with `idempotency.replayed: true` and no fresh mutation work; same key/different body returns `409 IDEMPOTENCY_KEY_CONFLICT`; recovery inspect is non-mutating. | `npm run test:playground:mid-apply-drift` |
| Playground DB idempotency concurrent same-body first apply | A unique `claim_key_hash` opens exactly one claim before mutation; concurrent same-key/same-body first applies produce one fresh mutation executor and the duplicate returns safe in-progress/retry/replay behavior without mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency concurrent different-body first apply | Concurrent same-key/different-body requests reject the conflicting request with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation while the original request is the only fresh mutation executor. | `npm run test:playground:db-journal-idempotency` |
| Playground DB process-kill persistence | A real `SIGKILL` during an in-flight DB-journaled REST apply leaves persisted DB `idempotency-opened`/`apply-started` rows after host-mounted Playground restart without a false `apply-committed`. | `npm run test:playground:db-journal-process-kill` |
| Playground DB process-kill recovery block | After hard kill/restart, DB planned evidence plus live target hashes classify mixed old/new state, recovery inspection returns non-mutating `RECOVERY_BLOCKED`, and retry does not overwrite the partial state without relying on the legacy option journal. | `npm run test:playground:db-journal-process-kill` |
| Playground DB missing-commit finalization | A lab hook leaves all live target hashes at planned after hashes with DB mutation evidence but no `apply-committed`; same key/body returns `BATCH_RECOVERY_FINALIZED` with zero fresh mutation work, while same key/different body conflicts before finalization. | `npm run test:playground:db-journal-missing-commit-finalization` |
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
- Storage-level compare-and-swap or locking around the final target write; the
  current JIT pre-write hash check is lab evidence, not a storage primitive.
- Production plugin activation/update with dependency and recovery checks.
- Object-cache, cron, generated files, and maintenance-mode interactions.
- Plugin validator and merge-driver contracts with real plugin fixtures; the
  current forms slice, exact forms lab custom-table driver, and fixture plugin install atomicity slice are
  fixture/allowlist-scoped and do not prove arbitrary production plugin-owned
  options, postmeta, custom tables, production plugin installation/update,
  production activation semantics, or production rollback.
- Production DB-table journal and kill-process recovery tests around every
  durable WordPress boundary. The current DB journal/idempotency/process-kill
  plus missing-commit finalization slice is fixture-scoped local Playground
  SQLite/host-mount evidence only, not production durability, storage `fsync`,
  rollback, exactly-once production writes, arbitrary plugin data safety, or
  full MySQL/InnoDB behavior. All-old stale-claim safe retry remains
  conservative/not fully solved, observed-hash assertions are still shallow in
  places, production auth/live source mutation/full push remains pending. The
  JSONL journal has per-append `fsync` evidence in the JSON-model lab, and the
  Playground recovery harness is injected lab failure inspection only.

## Invariant Policy

The planner policy is documented in
[No Overwrite Invariants](invariants/no-overwrite.md).
