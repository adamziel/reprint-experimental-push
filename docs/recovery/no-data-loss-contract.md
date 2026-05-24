# No Data Loss Recovery Contract

This lane treats the atomic apply step as a durable recovery boundary.

Acceptable outcomes after an apply attempt are limited to:

- `old-remote`: no remote mutation became durable
- `fully-updated-remote`: every planned mutation was already applied or replayed safely
- `blocked-recovery`: the remote may be partially applied, but recovery artifacts are present

Recovery artifacts must preserve enough evidence to inspect or resume safely:

- the recovery journal
- the remote snapshot or recovery envelope when the state is blocked

The contract used by the tests is:

1. failure before mutation returns `old-remote`
2. failure after staging returns `old-remote`
3. failure after dependency validation returns `old-remote`
4. completed replay returns `fully-updated-remote`
5. stale completed replay blocks with `blocked-recovery` and artifacts

Any partial remote mutation without recovery artifacts is considered unsafe.
