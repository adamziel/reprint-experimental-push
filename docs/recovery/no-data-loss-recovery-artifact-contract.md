## No Data Loss Recovery Artifact Contract

The apply path only allows three post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Acceptable outcomes are strict:

- `old-remote` means the remote did not receive a committed mutation and the journal explains where execution stopped.
- `fully-updated-remote` means replay is inert because every planned mutation is already present.
- `blocked-recovery` means the remote may be partially or ambiguously updated and recovery must keep both journal and remote artifacts.

Any partial remote mutation without a durable recovery artifact is a release blocker.

The production implementation still needs durable storage for the journal, restart-readable recovery metadata, and fencing or lease ownership so a stale writer cannot advance recovery state.
