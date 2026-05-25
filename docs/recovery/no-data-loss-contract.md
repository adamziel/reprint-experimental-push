# No Data Loss Recovery Contract

This lane treats recovery as a strict boundary:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything else is a release blocker.

## Acceptable outcomes

- A failure before mutation, after staging, or after dependency validation must leave the remote in `old-remote`.
- A completed replay must leave the remote in `fully-updated-remote`.
- A stale completed replay or mid-apply failure must leave `blocked-recovery` with inspectable artifacts.

## Artifact rules

- `old-remote` must carry the journal artifact, but not a remote artifact.
- `fully-updated-remote` must carry the completed journal artifact, but not a remote artifact.
- `blocked-recovery` must carry both journal and remote artifacts.

## Retry rules

- Replaying a completed plan must be inert.
- Retry must not duplicate inserts.
- Retry must not resurrect stale local data.
- Retry must not treat a partial write as safe unless it is blocked and inspectable.
