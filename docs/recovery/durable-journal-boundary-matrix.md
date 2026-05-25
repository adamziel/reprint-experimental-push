# Durable Journal Boundary Matrix

The recovery journal is only acceptable when it can classify the remote into
one of these states after a failure or replay:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

That matrix is strict:

- failure before mutation, after staging, and after dependency validation must
  remain `old-remote`
- replay of a completed plan must return `fully-updated-remote` and stay
  inert
- stale, partial, or otherwise ambiguous replay must become
  `blocked-recovery` with artifacts

The durable journal is the production artifact that has to survive process
exit. JSON fixtures can prove the model, but they do not replace:

- durable append/write semantics
- flush or fsync-equivalent persistence
- restart-readable recovery metadata
- fencing or claim ownership to keep stale writers from replaying old work

If a remote mutation is visible and the durable recovery artifact cannot
explain it, treat that as a release blocker.
