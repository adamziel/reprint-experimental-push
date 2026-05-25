# No Data Loss Post-Failure States

An atomic push apply may end in only three acceptable post-failure states:

- `old-remote`: nothing committed to the remote, but the recovery journal
  carries the failure artifacts needed to retry or inspect the attempt.
- `fully-updated-remote`: every planned mutation is already present and replay
  is read-only, with completed journal artifacts attached.
- `blocked-recovery`: the remote is partially or ambiguously mutated, and the
  recovery artifact bundle must include both journal and remote evidence so the
  failure can be inspected without treating the state as safe.

Release blocker rule:

- Any partial remote mutation without a recovery artifact is a release blocker.
- A retry must not duplicate inserts, resurrect stale local data, or treat a
  partial write without artifacts as safe.

This note is the compact contract for the no-data-loss lane. Production durable
journal storage still needs the deeper DB/file/fsync/fencing requirements
documented elsewhere in `docs/recovery/`.
