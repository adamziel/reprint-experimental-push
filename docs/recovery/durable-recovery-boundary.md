# Durable Recovery Boundary

The atomic apply path accepts only three post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with durable artifacts

The current executable coverage in `test/push-planner.test.js` proves that:

- failures before mutation, after staging, and after dependency validation stay in `old-remote`
- replaying a completed plan stays inert and reports `fully-updated-remote`
- drift after replay is blocked and carries inspectable recovery artifacts

What is still not proven at the release surface:

- durable journal storage at the release command boundary
- inspect-first recovery wiring at the release command boundary
- lease ownership and fencing proof at the release command boundary

The release gate in `origin/lane/reliable-executor` already exists upstream, but the boundary above remains unproven there.
