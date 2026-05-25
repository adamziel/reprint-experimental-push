# No Data Loss Production Journal Notes

The recovery model in `test/push-planner.test.js` proves the acceptable post-failure states for the planner:

- `old-remote` after failure before mutation, after staging, or after dependency validation
- `fully-updated-remote` after a completed replay that stays inert
- `blocked-recovery` when the remote has partially advanced or drifted outside the completed journal envelope

These states are valid only when the restart path can inspect durable artifacts.
The model tests use JSONL fixtures and in-memory fixtures to prove the state machine,
but the production path still needs:

- durable journal rows or files that survive restart
- flush or fsync semantics before a recovery boundary is considered safe
- claim fencing or lease ownership so stale retries cannot overwrite newer recovery work
- restart-readable artifacts for the remote snapshot and the recovery journal

The runtime contract is stricter than the lab harness:

- a transient JSON journal in the test process is proof of behavior, not proof of durability
- a partial remote mutation without a durable recovery artifact is a release blocker
- replay must not duplicate inserts or resurrect stale local data when the journal already proves completion

Release blocker rule:

- Any partial remote mutation without a corresponding recovery artifact is unacceptable.
- A retry must not duplicate inserts, resurrect stale local data, or silently treat a blocked partial write as safe.
