# Post-Failure Recovery States

`src/apply.js` only accepts three recovery outcomes after an atomic apply
failure:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

These are the only acceptable post-failure states for this lane. A retry must
never duplicate inserts or resurrect stale local data.

The recovery boundary is intentionally narrow:

- pre-commit failures stay `old-remote`
- completed-plan replay stays `fully-updated-remote`
- any partial or drifted replay becomes `blocked-recovery` with artifacts

## Required artifacts

- `old-remote`: the journal must explain why no remote mutation is committed.
- `fully-updated-remote`: the replay journal must prove the completed plan stays inert.
- `blocked-recovery`: the recovery result must include both journal and remote artifacts.

## Failure boundaries

The following boundaries must remain `old-remote`:

- failure before mutation
- failure after staging
- failure after dependency validation

Completed-plan replay must remain `fully-updated-remote`, and stale replay must
block if the current remote no longer matches the completed journal envelope.

`blocked-recovery` is only acceptable when the journal and remote artifacts are
both preserved for inspection. That is what distinguishes a safe retry from a
release blocker.

Any partial remote mutation without recovery artifacts is a blocker, not a
safe retry target.
