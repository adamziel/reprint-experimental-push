# No Data Loss Recovery Contract

This lane treats apply as safe only when failure lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The blocked state is acceptable only when it carries inspectable artifacts:

- the persisted journal
- the remote snapshot or redacted remote evidence needed to classify drift

Recovery boundaries are intentionally narrow:

1. Before mutation, the remote must remain unchanged and the journal may only record pre-commit evidence.
2. After staging and after dependency validation, a failure must still resolve to `old-remote` for retry.
3. A completed plan may replay idempotently from the persisted completed journal.
4. A stale completed replay must not silently succeed; it must become `blocked-recovery` with artifacts.

Release is blocked if any partial remote mutation lacks a recovery artifact or if retry can duplicate inserts or revive stale local data.
