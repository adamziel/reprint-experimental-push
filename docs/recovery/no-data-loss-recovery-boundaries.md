# No Data Loss Recovery Boundaries

The atomic apply flow accepts only three post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The boundary matters more than the failure label:

- Failure before mutation must leave the remote untouched and may only produce `old-remote`.
- Failure after staging or after dependency validation still must not mutate the remote and may only produce `old-remote` with inspectable journal artifacts.
- A completed replay must stay inert and may only produce `fully-updated-remote`.
- Any partial remote mutation without durable recovery artifacts is a release blocker.

Durable recovery artifacts are required for recovery inspection. JSON or lab-only evidence is useful for tests, but it is not a substitute for a persisted journal that can be reopened after a crash or retry.

Artifact expectations by state:

- `old-remote`: journal artifacts only; remote artifacts must stay absent.
- `fully-updated-remote`: journal artifacts only; remote artifacts must stay absent.
- `blocked-recovery`: both journal and remote artifacts must be preserved for inspection.

Retry rules:

- Retrying an `old-remote` recovery must not duplicate inserts or resurrect stale local data.
- Retrying a completed replay must remain inert.
- If the current remote no longer matches the journal envelope, inspection must stay `blocked-recovery` with both journal and remote artifacts preserved.
