# Recovery Contract

The apply path only accepts three post-failure outcomes after any crash,
injected failure, or retry:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

## Required artifact shape

- `old-remote`
  - Must include a journal artifact.
  - Must not include a remote artifact.
- `fully-updated-remote`
  - Must include a journal artifact.
  - Must not include a remote artifact.
- `blocked-recovery`
  - Must include both journal and remote artifacts.
  - Must preserve enough state to inspect the failure boundary and retry safely.
  - Covers partial mutation, stale completed replay, and any drifted retry.

## Safety rule

A partial remote mutation without a recovery artifact is a release blocker.
If a retry cannot prove the remote is still in the old state or fully updated,
the retry must stop in `blocked-recovery` and expose artifacts for inspection.

## Replay rule

Replaying a completed plan is only safe when the remote already matches the
completed journal. In that case the replay stays inert, does not duplicate
inserts, does not resurrect stale local data, and returns `fully-updated-remote`.
