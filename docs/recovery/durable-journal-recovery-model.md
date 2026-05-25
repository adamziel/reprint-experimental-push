# Durable Recovery Model

This project treats recovery evidence as a durable journal, not just a JSON
snapshot captured by a test.

The acceptable post-failure states are:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Rules:

- A failure before mutation, after staging, or after dependency validation must
  leave the remote in `old-remote` and carry journal artifacts.
- A completed replay must be inert. Re-running the same completed journal must
  return `fully-updated-remote` without reapplying mutations.
- Any partial remote mutation without recovery artifacts is a release blocker.
- If the remote cannot be classified safely, the system must surface
  `blocked-recovery` with both journal and remote artifacts so inspection can
  continue.

The durable journal needs to survive process interruption. That means the
implementation should prefer real journal writes with persistence semantics over
test-only JSON evidence when the code path crosses a recovery boundary.
