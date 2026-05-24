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
| Atomic plugin install is missing dependency | Plan is `blocked`; apply refuses. | `blocks an atomic plugin install when dependencies are absent` |
| Plugin install and dependency are included together | All files, plugin metadata, and options apply as one atomic group. | `applies an atomic plugin install when dependencies are included in the same plan` |
| Plugin dependency mutation is outside the atomic group | Plan is `blocked`; apply refuses. | `blocks an atomic plugin bundle when its dependency mutation is outside the group` |
| Remote dependency changed since base | Plan is `blocked`; stale local dependency assumptions cannot make the bundle ready. | `blocks a dependent atomic bundle when a remote dependency changed since base` |
| Plugin dependency version range is incompatible | Plan is `blocked`; apply refuses. | `blocks an atomic bundle with an incompatible plugin dependency version range` |
| Plugin dependency hash metadata does not match remote | Plan is `blocked`; apply refuses. | `blocks an atomic bundle when dependency hash metadata does not match remote` |
| Remote changes after dry-run | Apply rejects with `PRECONDITION_FAILED`. | `rejects apply when the remote changed after dry-run planning` |
| Playground fixture protocol dry-run | Dry-run verifies ready-plan preconditions, applies nothing, and same-process WordPress readback stays unchanged. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol ready apply | Apply with a supplied dry-run receipt writes the five expected fixture mutations and verifies hashes/readback. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol stale apply | Stale apply rejects with `PRECONDITION_FAILED` and preserves the changed remote fixture. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Playground fixture protocol non-ready plan | Conflict dry-run and apply reject with `PLAN_NOT_READY` and report row, file, and plugin-data conflict classes. | `npm run test:playground` / `scripts/playground/push-protocol-smoke.mjs` |
| Failure happens while staging mutations | No partially mutated remote state is returned or committed. | `injected failure before commit returns no partially mutated remote state` |

## Remaining Missing Scenarios

- Production Reprint HTTP source mutation endpoint for live source sites.
- Reprint exporter protocol extension for authenticated push preflight,
  sessions, production receipt enforcement, and mutation batches.
- File body streaming with large upload chunks.
- Database transaction boundaries on MySQL and SQLite.
- Remote plugin activation/update with dependency and recovery checks.
- Object-cache, cron, generated files, and maintenance-mode interactions.
- Plugin validator and merge-driver contracts with real plugin fixtures.
- Kill-process recovery tests around every durable boundary.

## Invariant Policy

The planner policy is documented in
[No Overwrite Invariants](invariants/no-overwrite.md).
