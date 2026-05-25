# Durable Journal Recovery Contract

This lane treats recovery as a narrow, inspectable envelope around the atomic
apply path.

Accepted post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Rules:

- A failure before any remote mutation must leave the remote unchanged and
  record an `old-remote` recovery state with journal artifacts.
- A failure after staging or after dependency validation must still leave the
  remote unchanged and remain in the `old-remote` recovery envelope.
- A completed replay must be inert on retry: it may observe the plan as already
  applied, but it must not duplicate inserts or resurrect stale local data.
- A partial commit without inspectable recovery artifacts is not acceptable.
  It must block recovery and carry both journal and remote artifacts.

Boundary expectations:

- `journal-opened` captures the initial recovery claim.
- `apply-staged` captures the staged snapshot boundary.
- `dependencies-validated` captures the dependency gate boundary.
- `journal-completed` captures the durable completion boundary.
- `recovery-state` records the inspectable post-failure envelope when durable
  writes succeed.

This document is intentionally terse. The executable proof remains in
`test/push-planner.test.js`.
