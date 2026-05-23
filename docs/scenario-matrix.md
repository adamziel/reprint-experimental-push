# Scenario Matrix

The first executable matrix lives in `test/push-planner.test.js`.

| Scenario | Expected behavior | Current evidence |
| --- | --- | --- |
| Remote site is unchanged since pull | Local file and row changes are planned and applied. | `plans and applies local changes when remote still matches the pull base` |
| Remote changed, local did not | Remote change is kept; no mutation is produced. | `keeps remote-only changes and does not overwrite them` |
| Remote and local changed different resources | Local mutations apply while remote-only changes are preserved. | `combines non-overlapping local and remote changes` |
| Remote and local changed the same row differently | Plan is `conflict`; apply refuses; remote remains unchanged. | `refuses direct conflicts and preserves the remote snapshot` |
| Conflict is in plugin-owned data | Conflict is classified as `plugin-data-conflict`. | `classifies plugin-owned data conflicts separately from generic rows` |
| Atomic plugin install is missing dependency | Plan is `blocked`; apply refuses. | `blocks an atomic plugin install when dependencies are absent` |
| Plugin install and dependency are included together | All files, plugin metadata, and options apply as one atomic group. | `applies an atomic plugin install when dependencies are included in the same plan` |
| Remote changes after dry-run | Apply rejects with `PRECONDITION_FAILED`. | `rejects apply when the remote changed after dry-run planning` |
| Failure happens while staging mutations | No partially mutated remote state is returned or committed. | `injected failure before commit returns no partially mutated remote state` |

## Missing Scenarios

- Real WordPress remote/local Docker or Playground sites.
- Reprint exporter protocol extension for push preflight and mutation batches.
- File body streaming with large upload chunks.
- Database transaction boundaries on MySQL and SQLite.
- Remote plugin activation/update with dependency and recovery checks.
- Object-cache, cron, generated files, and maintenance-mode interactions.
- Plugin validator and merge-driver contracts with real plugin fixtures.
- Kill-process recovery tests around every durable boundary.

