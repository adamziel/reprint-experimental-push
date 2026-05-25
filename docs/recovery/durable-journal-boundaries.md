# Durable Journal Boundaries

This lane treats recovery as a hard contract: after any apply failure, the remote
state must end up in exactly one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

## Failure Boundaries

The apply path must classify failures by the last durable boundary that was
successfully recorded.

- Before mutation:
  - remote remains `old-remote`
  - journal artifact is present and marked `opened`
- After staging:
  - remote remains `old-remote`
  - journal artifact is present and marked `staged`
- After dependency validation:
  - remote remains `old-remote`
  - journal artifact is present and marked `dependencies-validated`
- Mid-apply partial commit:
  - remote is `blocked-recovery`
  - both remote and journal artifacts are preserved

## Replay Rules

- A completed journal may be replayed only when the current remote already
  matches the completed outcome.
- Completed replay must be inert:
  - no duplicate inserts
  - no resurrection of stale local data
  - no mutation of the remote snapshot
- If the current remote drifts from the completed journal, replay must block and
  preserve inspectable artifacts.

## Release Bar

A partial remote mutation without a recovery artifact is a release blocker.
The durable journal must always leave behind enough evidence to classify the
state as:

- safe old remote
- safe fully updated remote
- blocked recovery with artifacts
