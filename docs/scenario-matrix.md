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
| Plugin-owned custom-table rows have no driver | `wp_reprint_push_forms_lab` rows are exported/detected but not ready mutations; unknown plugin-owned rows block as `unsupported-plugin-owned-resource`. | `npm run test:playground` / planner plugin-owned row policy smokes |
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
| Playground DB journal requires idempotency key | `POST /apply` without `X-Reprint-Push-Idempotency-Key` rejects with `400 MISSING_IDEMPOTENCY_KEY` before mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB journal records apply boundaries | `wp_reprint_push_lab_push_journal` records `idempotency-opened`, `apply-started`, per-mutation `mutation-applied`, `apply-committed`, replay, and conflict evidence separately from the legacy `wp_options` `/journal` evidence. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency replay | Same key plus same body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`, no fresh mutation work, no extra mutation events, and an unchanged snapshot. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency conflict | Same key plus a different body rejects with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency concurrent same-body first apply | A unique `claim_key_hash` opens exactly one claim before mutation; concurrent same-key/same-body first applies produce one fresh mutation executor and the duplicate returns safe in-progress/retry/replay behavior without mutation. | `npm run test:playground:db-journal-idempotency` |
| Playground DB idempotency concurrent different-body first apply | Concurrent same-key/different-body requests reject the conflicting request with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation while the original request is the only fresh mutation executor. | `npm run test:playground:db-journal-idempotency` |
| Playground DB process-kill persistence | A real `SIGKILL` during an in-flight DB-journaled REST apply leaves persisted DB `idempotency-opened`/`apply-started` rows after host-mounted Playground restart without a false `apply-committed`. | `npm run test:playground:db-journal-process-kill` |
| Playground DB process-kill recovery block | After hard kill/restart, live target hashes are explainable as old/new, recovery inspection reports `blocked-recovery`, and retry does not overwrite the partial state. | `npm run test:playground:db-journal-process-kill` |
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
- Production auth/session/nonce proof for any source-site REST mutation route.
- File body streaming with large upload chunks.
- Database transaction boundaries on MySQL and SQLite.
- Remote plugin activation/update with dependency and recovery checks.
- Object-cache, cron, generated files, and maintenance-mode interactions.
- Plugin validator and merge-driver contracts with real plugin fixtures; the
  current forms slice is fixture/allowlist-scoped and does not prove arbitrary
  production plugin-owned options, postmeta, custom tables, or activation
  semantics.
- Production DB-table journal and kill-process recovery tests around every
  durable WordPress boundary. The current DB journal/idempotency/process-kill
  slice is fixture-scoped local Playground SQLite/host-mount evidence only,
  not production durability. DB-native per-mutation evidence can be short after
  hard kill because mutation rows append after protocol return; missing-commit
  finalization/replay remains pending. The JSONL journal has per-append `fsync`
  evidence in the JSON-model lab, and the Playground recovery harness is
  injected lab failure inspection only.

## Invariant Policy

The planner policy is documented in
[No Overwrite Invariants](invariants/no-overwrite.md).
