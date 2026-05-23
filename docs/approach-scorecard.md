# Approach Scorecard

Scores are relative: 5 is strongest for this project, 1 is weakest.

| Approach | No data loss | Reliability | Speed | Fit | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Three-way snapshot push with remote compare-and-swap preconditions | 5 | 4 | 3 | 5 | Best baseline. It uses the pull snapshot as merge base, plans against live remote, and revalidates before apply. Needs chunk journals and plugin validators for production. |
| ForkPress-style branch merge then publish | 5 | 5 | 2 | 4 | Strong audit, rollback, plugin-validator, and crash-recovery model. Heavier runtime and may require staging source data into SQLite/branch form before publish. |
| ZS-Sync-style continuous resource scanner plus push applicator | 4 | 3 | 4 | 3 | Good change detection and batching. Does not by itself solve source mutation, atomicity, or semantic conflicts. |
| SQL dump diff and replay | 2 | 2 | 3 | 2 | Fast to prototype, but unsafe for live sites with concurrent edits, auto-increment IDs, serialized references, plugin tables, and file/database coupling. |
| Operation log / write-ahead capture on both sites | 5 | 4 | 5 | 2 | Potentially excellent if installed before edits. Poor fit for sites already pulled without prior instrumentation. |
| Full remote maintenance-window replace | 3 | 4 | 2 | 2 | Can be reliable for small sites, but violates the live-site requirement and risks overwriting source changes unless combined with a merge plan. |
| Plugin-specific export/import APIs only | 4 | 3 | 3 | 2 | Strong when plugins cooperate. Not sufficient as the only path because many plugins have no merge API. |

## Current Recommendation

Use a layered design:

1. Plan with a three-way base/local/live-remote diff.
2. Treat every mutation as compare-and-swap guarded by live remote hashes.
3. Apply independent resources in resumable chunks.
4. Apply coupled file/database/plugin changes as atomic groups.
5. Use ForkPress-style audit and crash-recovery invariants.
6. Use plugin validators and drivers only when they can prove deterministic
   repairs; otherwise preserve remote state and stop with durable evidence.
7. Keep a dry-run preview, but make clear that apply can still differ because
   the remote site remains live until preconditions are rechecked.

## Hard Rejections

- Blind overwrite of the remote source site.
- Replay of local SQL without a current remote precondition check.
- Applying files and database changes for a plugin install as separate
  unrelated steps.
- Treating plugin-owned serialized data as a generic string merge.
- Reporting success after a partially applied push without recovery artifacts.

