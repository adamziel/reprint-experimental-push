# Durable Recovery Release Boundary

The current release gate on `origin/lane/reliable-executor` exposes `verify:release`, but the durable recovery proof remains split from the release path.

What is proven:

- file-backed recovery journal restart and replay remain executable in this repo via `test:recovery:file-journal`
- `applyPlan()` classifies failure-before-mutation, after-staging, after-dependency-validation, completed replay, and blocked drift into the approved recovery states

What is not yet proven at the release command:

- durable journal storage is not wired through the release command path
- lease or fence ownership is not proven as part of the release gate
- recovery inspect is not yet wired into the release path that would make a completed replay a production boundary

Acceptable failure outcomes remain:

- old remote
- fully updated remote
- blocked recovery with both journal and remote artifacts

Any partial remote mutation without a recovery artifact remains a release blocker.
