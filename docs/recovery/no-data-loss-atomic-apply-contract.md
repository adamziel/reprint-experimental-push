# No-Data-Loss Atomic Apply Contract

This lane's durable apply boundary is the executable contract in
`node --test test/push-planner.test.js`.

The atomic apply model is only acceptable when recovery lands in one of these
post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

The blocked case must carry both:

- the persisted journal artifact
- the current remote artifact needed for recovery inspection

The following failure cuts must remain covered by executable assertions:

- failure before any mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

Release rule:

- a partial remote mutation without a recovery artifact is a blocker
- retries must not duplicate inserts
- retries must not resurrect stale local data

This doc is a recovery boundary note only. The source of truth for the
behavior is still the planner test suite and the apply implementation.
