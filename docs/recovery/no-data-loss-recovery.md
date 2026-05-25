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

The production contract should treat any partial mutation without a recovery artifact as a release blocker.
