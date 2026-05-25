# Durable Journal Notes

The recovery tests in this lane use JSON fixtures and in-memory helpers to
describe the boundary, but production safety depends on a stronger contract:

- journal rows must be durably written before any remote mutation is treated as
  safe
- recovery artifacts must survive interruption boundaries so a retry can
  distinguish `old-remote`, `fully-updated-remote`, and `blocked-recovery`
- a partial remote mutation without a recovery artifact is a release blocker
- completed replay must stay inert and must not duplicate inserts or resurrect
  stale local data

## What the tests prove

The current model covers these interruption points:

- failure before mutation
- failure after staging
- failure after dependency validation
- replaying a completed plan

That gives the expected state envelope, but it does not by itself prove
production durability. The durable path still needs real fsync-backed journal
storage, fencing against stale claims, and inspectable recovery artifacts on the
remote side.

## Operational expectation

When recovery cannot prove the remote is still old or fully updated, the safe
result is `blocked-recovery` with both journal and remote artifacts attached.
When the plan is already complete and the remote still matches the journal, the
retry should return `fully-updated-remote` without reapplying mutations.
