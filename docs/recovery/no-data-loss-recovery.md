# No Data Loss Recovery

This lane treats recovery as a strict state machine:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Acceptable failure outcomes are limited to:

1. The remote is still old and untouched.
2. The remote is fully updated and replay is inert.
3. Recovery is blocked, but the journal and remote artifacts are durable enough to inspect.

Rules:

- Failure before mutation must leave the remote old.
- Failure after staging must still leave the remote old, with journal evidence for the staged boundary.
- Failure after dependency validation must still leave the remote old, with journal evidence for the validated boundary.
- A mid-apply partial commit must be `blocked-recovery` and keep both the remote and journal artifacts inspectable.
- A completed plan replay must not reapply mutations or resurrect stale local data.
- A blocked partial recovery must preserve artifacts so a retry can classify the live remote without guessing.

Durable artifact contract:

- JSON test fixtures may prove the state machine in memory, but production recovery needs durable journal records on disk or in the backing store.
- Recovery journals need to survive process death before the remote mutation boundary is crossed.
- A successful replay should leave inspectable journal evidence, but it should not need a remote artifact because the remote itself is already fully updated.
- A blocked recovery must keep both journal and remote artifacts so operators can inspect the partial state and retry safely.
- The durable journal is the recovery source of truth; in-memory snapshots are only lab evidence.
- A completed replay must stay read-only when the remote still matches the completed journal, and it must become blocked when the remote drifts.
- Production durability means more than a JSON fixture:
  - journal rows or files must be restart-readable
  - journal appends need flush or `fsync`-equivalent persistence
  - a single writer needs a lease, fence, or equivalent claim ownership
  - recovery inspect must be able to classify the persisted artifacts after a crash
- The recovery journal must make the boundary legible enough to classify retries without guessing:
  - `old-remote` means no target mutation escaped staging.
  - `fully-updated-remote` means every planned mutation is already present and replay is read-only.
- `blocked-recovery` means a partial mutation was observed and the journal must carry the artifacts needed to inspect or fence it.
- A blocked recovery is only acceptable when the journal and remote artifacts survive the failure boundary.

Release-blocker rule:

- Any partial mutation without a recovery artifact is a release blocker.
- Retrying must not duplicate inserts, resurrect stale local data, or classify an incomplete write as safe.
