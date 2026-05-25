# No Data Loss Recovery Contract

This lane models recovery around three acceptable post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

The model tests in `test/push-planner.test.js` prove those states for:

- failure before mutation
- failure after staging
- failure after dependency validation
- mid-apply failure
- completed replay
- stale completed replay

What the model does not prove by itself:

- durable on-disk journal writes
- `fsync`/flush behavior
- lease or fencing correctness across writers
- production plugin activation or process restarts

The release bar for this lane is simple:

- a partial remote mutation without a recovery artifact is not acceptable
- retry must not duplicate inserts
- retry must not resurrect stale local data
- replay of a completed plan must either stay inert or block with artifacts

Use the model results as the shape of the contract, then back them with a durable journal implementation and inspectable recovery evidence in production paths.
