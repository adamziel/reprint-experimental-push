# Recovery states

The atomic apply path is only allowed to end in one of three states after a failure or replay:

- `old-remote`: no remote mutation was committed.
- `fully-updated-remote`: every planned mutation was committed and the journal reflects completion.
- `blocked-recovery`: the remote may be partially updated, but the journal and remote artifacts must remain inspectable so recovery can be audited.

Release-blocking rule:

- A partial remote mutation without a recovery artifact is not acceptable.
- `old-remote` and `fully-updated-remote` carry journal evidence only.
- `blocked-recovery` must carry both journal evidence and inspectable remote artifacts.

Retry rule:

- Replaying a completed plan must stay inert.
- Retry must not duplicate inserts.
- Retry must not resurrect stale local data after the remote is already fully updated.

Durable journal rule:

- JSON lab output is not enough on its own.
- Production recovery needs durable journal records that survive failure boundaries and can be inspected after the process exits.
