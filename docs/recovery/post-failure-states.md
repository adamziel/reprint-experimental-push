# Post-Failure Recovery States

The apply model only allows three post-failure outcomes:

| State | Meaning | Required artifacts |
| --- | --- | --- |
| `old-remote` | No remote mutation became durable. Retry can safely re-evaluate the plan. | Recovery journal for the failed attempt |
| `fully-updated-remote` | Every planned mutation already reached the remote. Replay is a no-op. | Recovery journal for the completed plan |
| `blocked-recovery` | The remote and journal disagree or the write path lost recovery confidence. Retry must stop until the partial state is inspected. | Recovery journal and a sanitized remote snapshot |

Rules:

- A partial remote mutation without a recovery artifact is a release blocker.
- A retry must not duplicate inserts.
- A retry must not resurrect stale local data.
- A completed replay must be classified as `fully-updated-remote` and must not reapply mutations.
- A blocked recovery state must remain blocked until an operator resolves the artifact set.
