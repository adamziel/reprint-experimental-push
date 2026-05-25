# Durable Journal Acceptable Post-Failure States

The atomic apply path can fail in three acceptable ways:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery`

The recovery contract is:

- `old-remote` keeps the remote unchanged and preserves the journal artifact.
- `fully-updated-remote` means the remote already matches the completed plan and replay is inert.
- `blocked-recovery` is only acceptable when both journal and remote artifacts are present for recovery inspection.

Anything else is a release blocker because it creates a partial mutation without a recovery artifact or an ambiguous retry boundary.
