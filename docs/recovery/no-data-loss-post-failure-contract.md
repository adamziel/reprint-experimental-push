# No Data Loss Post-Failure Contract

`src/apply.js` only treats three post-failure outcomes as acceptable:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with artifacts

The release blocker is strict: a partial remote mutation without a recovery artifact is unsafe.
That means retry logic must not treat a partial write as safe input unless the blocked recovery artifacts are present and inspectable.

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

Recovery retries must preserve these invariants:

- do not duplicate inserts
- do not resurrect stale local data
- do not downgrade a blocked partial write to a safe replay

## Durable journal note

The lab JSON and in-memory replay fixtures are useful for proving the model, but they are not the end state for production recovery.

Production recovery still needs:

- durable journal storage with restart-readable DB rows or files
- fsync or equivalent persistence guarantees on the journal path
- plugin activation and other source-side state tracked in the durable journal
- claim fencing or lease ownership for the recovery writer
- inspectable blocked-recovery artifacts
- recovery inspection that can distinguish old remote, fully updated remote, and blocked partial recovery

If the durable path cannot preserve those artifacts, the failure must remain blocked rather than being treated as safe to retry.
