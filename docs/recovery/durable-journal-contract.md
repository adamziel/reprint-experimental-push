# Durable Recovery Contract

The no-data-loss lane treats the apply boundary as a durable journal boundary.
An apply attempt must land in one of three acceptable post-failure states:

- `old-remote`: no remote mutation escaped, and recovery artifacts prove the
  plan never crossed the mutation boundary.
- `fully-updated-remote`: the remote already matches the completed plan, and
  replay is inert.
- `blocked-recovery`: the remote may be partially updated, but the recovery
  artifacts make the partial state inspectable and safe to refuse.

Acceptable artifacts:

- `old-remote` and `fully-updated-remote` must carry journal artifacts and must
  not expose remote artifacts.
- `blocked-recovery` must carry both journal and remote artifacts so the caller
  can inspect the partial write before retrying.

Boundary expectations:

- Failure before mutation must keep the remote unchanged and leave the journal
  at the opened state.
- Failure after staging must still keep the remote unchanged and leave the
  journal at the staged state.
- Failure after dependency validation must keep the remote unchanged and leave
  the journal at the dependencies-validated state.
- Replaying a completed plan must not duplicate inserts, resurrect stale local
  data, or append fresh mutation work.

If a partial remote mutation exists without recovery artifacts, that is a
release blocker.
