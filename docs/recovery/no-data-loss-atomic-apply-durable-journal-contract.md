# No-Data-Loss Atomic Apply Durable Journal Contract

Atomic apply is only acceptable when it leaves the remote in one of three states:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery` with inspectable `journal` and `remote` artifacts

The apply path must preserve these post-failure boundaries across the durable
journal lifecycle:

- failure before mutation: remote stays `old-remote`
- failure after staging: remote stays `old-remote`
- failure after dependency validation: remote stays `old-remote`
- partial commit: remote becomes `blocked-recovery` and must retain artifacts
- completed replay: remote becomes `fully-updated-remote` and must not mutate
  again when replayed from the persisted completed journal

Recovery retries must not duplicate inserts, resurrect stale local data, or
collapse a partial remote mutation into a safe-looking state without artifacts.
If the journal cannot explain the remote state, the result must remain blocked.
