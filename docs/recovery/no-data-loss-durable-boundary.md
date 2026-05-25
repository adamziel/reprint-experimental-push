# No Data Loss Durable Boundary

This lane treats `src/apply.js` and `test/push-planner.test.js` as the
executable recovery boundary for no-data-loss apply behavior.

The approved post-failure states are:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with both journal and remote artifacts

The durable replay contract is:

- failure before mutation leaves the remote unchanged and records an
  `old-remote` recovery envelope
- failure after staging or after dependency validation still leaves the remote
  unchanged and keeps the recovery envelope on the old remote side
- replaying a completed plan stays inert, does not duplicate inserts, and does
  not resurrect stale local data
- any partial remote mutation without recovery artifacts remains a release
  blocker

Executable check:

```bash
node --test test/push-planner.test.js
```

