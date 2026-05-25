# No Data Loss Production Durable Journal Note

The recovery model in this lane is already proven in tests, but the production
contract is stricter than an in-memory JSON fixture.

## Acceptable outcomes

After any interrupted or retried apply, the system must land in exactly one of
these states:

1. `old-remote`
   - Nothing visible was committed to the remote.
   - The durable journal explains where the interruption happened.

2. `fully-updated-remote`
   - Every planned mutation is already present.
   - Replay must stay read-only and must not duplicate inserts or resurrect
     stale local data.

3. `blocked-recovery`
   - The remote is partially advanced, drifted, or otherwise ambiguous.
   - The recovery artifact must include enough journal and remote evidence for
     inspection and fencing.

## Lab evidence versus production evidence

The test suite can model these states with JSON fixtures, synthetic failures,
and replay assertions. That is useful, but it is not sufficient on its own.

Production recovery still needs:

- durable journal rows or files that survive process failure
- flush or fsync semantics appropriate to the storage backend
- writer ownership, fencing, or lease protection
- restart-readable recovery inspection data

If the durable journal cannot prove `old-remote` or `fully-updated-remote`, the
retry must remain `blocked-recovery` with artifacts rather than treating the
mutation as safe.
