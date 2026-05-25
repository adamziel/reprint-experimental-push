# Durable Journal Executable Boundary

The recovery lane now has regression coverage for the four critical apply outcomes:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

That coverage is necessary, but it is not yet a full durability proof. The release gate still depends on an executable boundary where the durable journal is written to real storage and can be inspected after a crash or replay.

The next production-safe hook must answer all of the following:

- Where does the journal land durably?
- What makes the journal replayable after process death?
- What recovery artifact is available when apply stops in `blocked-recovery`?
- How does the inspect command distinguish `old-remote`, `fully-updated-remote`, and `blocked-recovery` without reapplying mutations?

Until that hook exists, a partial remote mutation without a durable recovery artifact remains a release blocker.
