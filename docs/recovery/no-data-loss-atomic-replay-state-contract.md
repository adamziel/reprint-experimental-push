# No Data Loss Atomic Replay State Contract

The durable apply path only accepts three post-failure outcomes:

- `old-remote` when the remote never moved past the original snapshot.
- `fully-updated-remote` when every planned mutation is already committed and replay is inert.
- `blocked-recovery` when replay cannot be trusted and the failure artifact must carry both the journal and the remote snapshot.

Release rule:

- A partial remote mutation without an inspectable recovery artifact is a blocker.
- A retry must not duplicate inserts or resurrect stale local data.
- A completed plan replay must remain inert and must not change the remote snapshot.

This contract matches the durable journal boundaries used by `src/apply.js` and the recovery tests in `test/push-planner.test.js`.
