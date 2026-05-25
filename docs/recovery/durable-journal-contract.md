# Durable Recovery Contract

This lane treats recovery as a no-data-loss problem, not just a successful test-model replay.

## Acceptable post-failure states

After any push attempt, the remote must end up in one of these states:

1. `old-remote`
   - No mutation reached the remote.
   - Recovery artifacts may exist, but they must describe the untouched remote.
2. `fully-updated-remote`
   - Every planned mutation is visible on the remote.
   - A completed journal may be replayed inertly.
3. `blocked-recovery`
   - A partial or drifted state exists.
   - Recovery must preserve artifacts for inspection and retry fencing.

Anything else is a data-loss bug.

## What the lab model can prove

The JSON test model is good at proving:

- mutation ordering
- idempotent completed replay
- rejection of stale or drifted replay
- preservation of remote evidence after injected failures

It cannot by itself prove production durability.

## What production still needs

To make the contract real outside the test model, the runtime needs:

- durable journal rows
- fsync or equivalent flush semantics
- explicit plugin activation and ownership tracking
- fencing or leases so stale workers cannot continue
- recovery inspection that can classify `old-remote`, `fully-updated-remote`, and `blocked-recovery`

If a partial remote mutation exists without a durable recovery artifact, the system has already violated the contract.
