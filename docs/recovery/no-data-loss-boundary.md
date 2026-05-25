# No Data Loss Recovery Boundary

`src/apply.js` currently accepts only three post-failure recovery states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The durable journal tests in `test/push-planner.test.js` prove that:

- failures before mutation stay `old-remote`
- failures after staging stay `old-remote`
- failures after dependency validation stay `old-remote`
- replaying a completed plan stays `fully-updated-remote`
- drifted completed replay closes into `blocked-recovery` with both remote and journal artifacts

What remains unproven at the release gate is the production path that wires durable journal storage, replay, recovery inspect, lease ownership, and fencing into the release command itself.

This note is intentionally narrow: it records the recovery envelope that is executable in the planner today, and the exact boundary that still needs release-surface proof.
