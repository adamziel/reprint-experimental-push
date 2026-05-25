# Recovery State Matrix

This lane treats recovery as a durability contract, not just a test fixture outcome.

## Allowed outcomes

Every apply attempt must end in one of these states:

| State | Meaning | Required artifacts |
| --- | --- | --- |
| `old-remote` | No remote mutation has been committed. | Journal artifact required. Remote artifact optional. |
| `fully-updated-remote` | All planned mutations are present. | Journal artifact required. Remote artifact optional. |
| `blocked-recovery` | A partial, drifted, or otherwise unsafe state was observed. | Both journal and remote artifacts required. |

Anything outside that matrix is a release blocker.

## Failure boundaries

The apply model currently exercises these explicit boundaries:

| Boundary | Expected classification |
| --- | --- |
| Before mutation | `old-remote` |
| After staging | `old-remote` |
| After dependency validation | `old-remote` |
| Completed replay | `fully-updated-remote` |

The key rule is that a partial remote mutation is never treated as safe unless the recovery state is explicitly blocked and carries inspectable artifacts.

## Durable journal expectations

The JSON journal used in tests is evidence for the model only. Production recovery still needs:

- durable journal rows
- flush or fsync-equivalent persistence
- recovery fencing so stale workers cannot continue
- inspectable artifacts for blocked recovery

If a retry can mutate the remote without a matching durable artifact trail, the system has lost the no-data-loss guarantee.
