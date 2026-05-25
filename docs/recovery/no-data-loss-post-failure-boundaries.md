# No Data Loss Post-Failure Boundaries

The durable apply path treats recovery as one of three acceptable end states:

- `old-remote`: the remote stayed untouched, and the journal preserves enough evidence to retry safely.
- `fully-updated-remote`: the apply completed or a completed plan replayed without reapplying mutations.
- `blocked-recovery`: the remote is partially or otherwise suspiciously updated, so recovery must stop and keep artifacts for inspection.

Practical contract:

- A failure before mutation, after staging, or after dependency validation must not leave a partial remote without a recovery artifact.
- A completed replay must stay inert on retries and must not duplicate inserts or revive stale local data.
- Any partial write without artifacts is a release blocker, not a safe retry target.
- A completed replay must be persisted as replay-only evidence; it must not re-open a mutation path or resurrect stale local state on the next retry.

This boundary is intentionally durable, not just JSON-shaped:

- Keep journal records on disk with durable writes.
- Preserve the recovery artifacts needed to inspect the remote and journal after failure.
- Treat blocked recovery as a stopping point until the operator inspects the artifacts and resolves the drift.
