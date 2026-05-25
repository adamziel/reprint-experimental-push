# No Data Loss Recovery

This lane treats recovery as a strict state machine:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Acceptable failure outcomes are limited to:

1. The remote is still old and untouched.
2. The remote is fully updated and replay is inert.
3. Recovery is blocked, but the journal and remote artifacts are durable enough to inspect.

Rules:

- Failure before mutation must leave the remote old.
- Failure after staging must still leave the remote old, with journal evidence for the staged boundary.
- Failure after dependency validation must still leave the remote old, with journal evidence for the validated boundary.
- A completed plan replay must not reapply mutations or resurrect stale local data.
- A blocked partial recovery must preserve artifacts so a retry can classify the live remote without guessing.

Durable artifact contract:

- JSON test fixtures may prove the state machine in memory, but production recovery needs durable journal records on disk or in the backing store.
- Recovery journals need to survive process death before the remote mutation boundary is crossed.
- A successful replay should leave inspectable journal evidence, but it should not need a remote artifact because the remote itself is already fully updated.
- A blocked recovery must keep both journal and remote artifacts so operators can inspect the partial state and retry safely.

Release-blocker rule:

- Any partial mutation without a recovery artifact is a release blocker.
- Retrying must not duplicate inserts, resurrect stale local data, or classify an incomplete write as safe.
