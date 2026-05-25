# Durable Journal vs Lab Evidence

This repository uses two different recovery evidence models:

- Lab or test fixtures may keep recovery state entirely in JSON objects.
- Production recovery must use a durable journal that survives process exit.

## What the tests can prove

The test suite can prove that an apply attempt ends in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

It can also prove that:

- completed replays are inert
- stale completed replays are blocked
- partial remote mutation never looks safe without artifacts

## What the durable journal must provide

The durable journal is the release-critical artifact. It needs:

- append-only records for the opening, staging, validation, commit, and replay boundaries
- persisted recovery state for old-remote, fully-updated-remote, or blocked-recovery outcomes
- enough metadata to inspect the failure boundary after a restart
- fencing or claim checks so an old worker cannot keep appending after it has been superseded

## Recovery rule

If the remote may have changed but there is no durable artifact to prove whether the state is old, fully updated, or blocked, the retry must stop and surface `blocked-recovery`.
