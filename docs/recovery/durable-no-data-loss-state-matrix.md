# Durable No-Data-Loss State Matrix

This lane’s recovery contract has only three acceptable post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Boundary Mapping

| Boundary | Acceptable state | Required artifact shape |
| --- | --- | --- |
| Before mutation | `old-remote` | journal artifact only |
| After staging | `old-remote` | journal artifact only |
| After dependency validation | `old-remote` | journal artifact only |
| Completed plan replay | `fully-updated-remote` | journal artifact only |
| Partial commit or drifted replay | `blocked-recovery` | journal + remote artifacts |

## Non-Negotiable Rule

If the remote changes and the persisted recovery evidence cannot explain that
state after restart, the branch is blocked.

## Retry Constraints

Retries must not:

- duplicate inserts
- resurrect stale local data
- convert a partial write without artifacts into a safe replay

