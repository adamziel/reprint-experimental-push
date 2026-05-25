# Durable Apply Journal Replay

This lane treats atomic apply as safe only when the observable outcome is one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The durable journal must explain which of those states applies after each boundary:

- failure before mutation stays `old-remote`
- failure after staging stays `old-remote`
- failure after dependency validation stays `old-remote`
- replaying a completed plan stays `fully-updated-remote`
- stale or partial replay stays `blocked-recovery`

The retry rule is strict:

- a completed replay must not duplicate inserts
- a completed replay must not resurrect stale local data
- a partial remote mutation without a durable recovery artifact is a release blocker

This document is intentionally narrower than the production problem. The tests in `test/push-planner.test.js` prove the model with ephemeral journals and local fixtures; production recovery still needs durable storage, flush semantics, claim fencing or lease ownership, and restart-readable inspection artifacts.
