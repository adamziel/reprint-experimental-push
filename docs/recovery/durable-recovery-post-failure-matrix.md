# Durable Recovery Post-Failure Matrix

The atomic apply lane accepts only three outcomes after a failure boundary:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

The acceptable post-failure states are strict:

- Failure before mutation stays `old-remote`.
- Failure after staging stays `old-remote`.
- Failure after dependency validation stays `old-remote`.
- Replaying a completed plan stays `fully-updated-remote` and must not reapply mutations.
- A stale or partial replay stays `blocked-recovery` and must carry journal plus remote artifacts.

The release blocker is simple: a partial remote mutation without a durable recovery artifact is unsafe.
Retry logic must not treat that case as safe input, and it must not duplicate inserts or resurrect stale local data.

This document is intentionally narrow. The tests in `test/push-planner.test.js` use in-memory JSON and ephemeral files to prove the model, but production recovery still needs durable journal storage, flush semantics, claim fencing or lease ownership, and restart-readable inspection metadata.
