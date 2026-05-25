# Durable Journal Boundaries

The atomic apply path is only release-safe when every crash boundary lands in one of these outcomes:

1. `old-remote`
   - The remote stays unchanged.
   - This covers failure before mutation, after staging, and after dependency validation.
   - The journal can be open, staged, or dependency-validated, but it must remain inspectable.

2. `fully-updated-remote`
   - Every planned mutation is committed.
   - Replaying the same completed plan must be inert.
   - Retry must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - A partial remote mutation exists and recovery artifacts must stay available.
   - Both the remote snapshot and the journal are required for inspection.
   - Any partial remote mutation without a recovery artifact is a release blocker.

Apply-path hook points:

- `failBeforeMutation` keeps the remote old and records an `old-remote` recovery state.
- `failAfterStaging` keeps the remote old and records the staged journal state.
- `failAfterDependencyValidation` keeps the remote old and records the dependency-validated journal state.
- A completed replay returns `fully-updated-remote` and must stay inert on retry.
