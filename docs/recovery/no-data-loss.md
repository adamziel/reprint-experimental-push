# No Data Loss Recovery

This lane treats recovery as a bounded state machine around durable journal artifacts.

## Acceptable post-failure states

- `old-remote`
  - Nothing has mutated the remote site.
  - The recovery result must carry a journal artifact.
  - The recovery result must not expose a remote artifact.
- `fully-updated-remote`
  - The remote already matches the completed plan.
  - The recovery result must carry a journal artifact.
  - The recovery result must not expose a remote artifact.
- `blocked-recovery`
  - A partial remote mutation exists or recovery cannot be trusted.
  - The recovery result must carry both journal and remote artifacts.

## Recovery contract

- A partial remote mutation without a recovery artifact is a release blocker.
- Retrying a completed plan must be inert.
- Retrying must not duplicate inserts.
- Retrying must not resurrect stale local data over the completed remote state.
- Durable journal replay should end in the same bounded states above, never an unclassified partial state.

## Evidence expected by tests

- Failure before mutation should remain `old-remote`.
- Failure after staging should remain `old-remote`.
- Failure after dependency validation should remain `old-remote`.
- Completed replay should stay `fully-updated-remote`.
- Stale completed replay with drift should be classified as `blocked-recovery` with artifacts.
