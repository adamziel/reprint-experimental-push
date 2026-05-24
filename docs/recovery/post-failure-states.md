# Post-Failure Recovery States

`src/apply.js` only accepts three recovery outcomes after an atomic apply
failure:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

These are the only acceptable post-failure states for this lane.

## Required artifacts

- `old-remote`: the journal must explain why no remote mutation is committed.
- `fully-updated-remote`: the replay journal must prove the completed plan stays inert.
- `blocked-recovery`: the recovery result must include both journal and remote artifacts.

## Failure boundaries

The following boundaries must remain `old-remote`:

- failure before mutation
- failure after staging
- failure after dependency validation

Completed-plan replay must remain `fully-updated-remote`.

Any partial remote mutation without recovery artifacts is a blocker, not a
safe retry target.
