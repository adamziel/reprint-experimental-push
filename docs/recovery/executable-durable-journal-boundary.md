# Executable Durable Journal Boundary

This lane has already established the model-level recovery contract:

- interrupted applies must resolve to `old-remote`, `fully-updated-remote`, or `blocked-recovery`
- partial remote mutation without inspectable recovery artifacts is a release blocker
- completed replay must be inert and must not duplicate inserts or resurrect stale local data

The next executable boundary is the first place where recovery stops being a lab
fixture and becomes restart-readable production state.

## Required storage boundary

The durable journal must cross a real persistence boundary before the apply path
can be considered release-safe:

- DB row or file-backed journal storage
- restart-readable recovery artifacts
- fsync or an equivalent flush guarantee on the journal path
- lease or claim fencing for the recovery writer
- recovery inspection that can distinguish old remote, fully updated remote,
  and blocked partial recovery

The current executable regression harness for this contract is:

```bash
node --test test/push-planner.test.js
```

That suite must keep proving:

- failure before mutation, after staging, and after dependency validation land in `old-remote`
- completed replay stays `fully-updated-remote` and remains inert on retry
- mid-apply partial writes stay `blocked-recovery` with inspectable artifacts

## Why this boundary matters

Model-only replay proves the state machine, but it does not protect against a
process crash between staging and commit.

The first executable storage boundary must therefore make two things true:

1. a partially written recovery journal remains inspectable after restart
2. a completed replay can be recognized without reapplying the mutation set

If either property is missing, the apply path must stay in `blocked-recovery`
instead of pretending the remote is safe to reuse.

## Release rule

Any partial remote mutation without durable recovery artifacts remains a
release blocker until the journal is backed by real storage and the recovery
inspect path can read it back after restart.
