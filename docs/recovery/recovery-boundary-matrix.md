# Recovery Boundary Matrix

This lane treats the recovery journal as the source of truth for interrupted applies.
The acceptable post-failure states are limited to:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Failure boundaries

The executor must classify these interruption points without leaving a partial remote mutation unaccounted for:

- before mutation
- after staging
- after dependency validation
- during replay of a completed plan

## Expected state by scenario

| Scenario | Acceptable result |
| --- | --- |
| Failure before mutation | `old-remote` with journal artifacts |
| Failure after staging | `old-remote` with journal artifacts |
| Failure after dependency validation | `old-remote` with journal artifacts |
| Completed plan replay on matching remote | `fully-updated-remote` with journal artifacts |
| Completed plan replay on drifted remote | `blocked-recovery` with journal and remote artifacts |
| Partial commit on retry | `blocked-recovery` with journal and remote artifacts |

## Production requirement

JSON fixtures and lab-only helpers can prove the model, but they do not satisfy durability by themselves.
Production recovery needs durable journal records, persistence guarantees such as fsync or equivalent, claim fencing or leases, and inspectable artifacts for blocked recovery.

If a partial remote mutation can happen without a durable recovery artifact, that is a release blocker.
