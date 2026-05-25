# No Data Loss Acceptance

This lane treats the recovery boundary as valid only when one of these states is observable:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

## Required interpretation

- `old-remote` means nothing visible was committed to the remote.
- `fully-updated-remote` means the completed plan is already reflected in the remote and replay must stay inert.
- `blocked-recovery` means the remote drifted, the recovery claim was superseded, or the journal evidence is incomplete.

## What counts as acceptable evidence

- Lab tests may use in-memory JSON journals and temporary files to prove the state machine.
- Production recovery still needs durable journal storage, claim fencing, restart-readable inspection, and flush semantics appropriate to the storage backend.
- A partial remote mutation without inspectable recovery artifacts is a release blocker.

## Retry rule

If a retry cannot prove `old-remote` or `fully-updated-remote`, it must remain blocked with artifacts rather than treating the mutation as safe.
