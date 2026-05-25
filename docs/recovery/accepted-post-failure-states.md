# Accepted Post-Failure States

The atomic apply model only allows three outcomes after an interrupted or replayed
plan:

1. `old-remote`
   - The remote still matches the pre-apply state.
   - The journal may contain `opened`, `staged`, or `dependencies-validated`
     evidence, but no remote mutation is visible.

2. `fully-updated-remote`
   - The remote already matches the completed plan.
   - A replay must stay read-only and must not duplicate inserts or revive stale
     local data.

3. `blocked-recovery`
   - The remote and journal disagree in a way that cannot be treated as safe.
   - The recovery artifacts must be preserved so inspection can explain the
     partial state.
   - A partial remote mutation without recovery artifacts is a release blocker.

Anything else is a contract violation. In particular, a partial remote mutation
without a durable recovery artifact is a release blocker.

Failure boundaries before mutation, after staging, and after dependency
validation are only acceptable when they still report `old-remote`. A completed
replay is only acceptable when it reports `fully-updated-remote`. If the remote
drifts after completion, retrying must land in `blocked-recovery` rather than
silently reapplying stale local data.

Retrying a completed replay must stay read-only. It must not duplicate inserts
or resurrect stale local data.
