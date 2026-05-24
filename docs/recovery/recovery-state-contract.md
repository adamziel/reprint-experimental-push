# Recovery State Contract

Atomic apply has three acceptable post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The release-blocker rule is simple: a partial remote mutation without a recovery artifact is not acceptable.

## Failure boundaries

- failure before mutation, after staging, and after dependency validation should leave the remote as `old-remote`
- replaying a completed plan should return `fully-updated-remote` and stay inert
- stale or ambiguous recovery must return `blocked-recovery` and include inspectable artifacts

## Evidence boundary

JSON fixtures and lab-only evidence are useful for proving the model. They are not a substitute for production durable journal storage.

Production recovery still needs:

- durable journal rows or files that survive process exit
- flush or fsync-equivalent persistence for the journal write path
- restart-readable recovery metadata for inspection without replay
- fencing or lease behavior so stale work cannot resurrect old local data

