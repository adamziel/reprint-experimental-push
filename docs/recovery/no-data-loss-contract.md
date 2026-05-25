# No Data Loss Recovery Contract

The recovery boundary for atomic apply is intentionally narrow:

- `old-remote` for failures before mutation, after staging, and after dependency validation.
- `fully-updated-remote` for a completed plan replay when the remote already matches the completed journal.
- `blocked-recovery` only when the journal and current remote drift outside the before/after recovery envelope, and the error carries artifacts.

Operationally, a recovery artifact is required for any partial commit. A partial remote mutation without a durable recovery artifact is a release blocker.

Retry must not:

- duplicate inserts,
- resurrect stale local data,
- or treat a partially written remote as safe unless the recovery journal proves it is either old remote or fully updated remote.
