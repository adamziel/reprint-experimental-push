# No Data Loss Post-Failure Contract

`src/apply.js` only treats three post-failure outcomes as acceptable:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The release blocker is strict: a partial remote mutation without a recovery artifact is unsafe.

## Expected failure boundaries

- failure before mutation stays `old-remote`
- failure after staging stays `old-remote`
- failure after dependency validation stays `old-remote`
- replaying a completed plan stays `fully-updated-remote`
- stale completed replay stays `blocked-recovery` and includes journal plus remote artifacts
- partial commit recovery stays `blocked-recovery` and must not be treated as safe retry input unless the artifacts are present

These are the only acceptable end states after failure:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

## Durable journal note

The lab JSON and in-memory replay fixtures are useful for proving the model, but they are not the end state for production recovery.

Production recovery still needs:

- durable journal storage with restart-readable records
- fsync or equivalent persistence guarantees
- claim fencing or lease ownership for the recovery writer
- inspectable blocked-recovery artifacts

If the durable path cannot preserve those artifacts, the failure must remain blocked rather than being treated as safe to retry.
