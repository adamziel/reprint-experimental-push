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
- That evidence is model-only. It does not prove crash safety until the same boundary is backed by a durable journal.
- Production recovery still needs durable journal storage, claim fencing, restart-readable inspection, and flush semantics appropriate to the storage backend.
- A partial remote mutation without inspectable recovery artifacts is a release blocker.

## Acceptable post-failure states

The apply boundary only accepts these recovery results:

- `old-remote`: nothing visible has committed, and the journal explains where the attempt stopped.
- `fully-updated-remote`: the plan already landed, replay is inert, and the completed journal is enough to classify the site.
- `blocked-recovery`: the remote drifted, the journal is incomplete, or the retry cannot prove safety; both journal and remote artifacts must remain inspectable.

## Retry rule

If a retry cannot prove `old-remote` or `fully-updated-remote`, it must remain blocked with artifacts rather than treating the mutation as safe.
