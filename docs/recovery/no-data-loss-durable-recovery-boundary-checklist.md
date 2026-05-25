# No Data Loss Durable Recovery Boundary Checklist

This lane treats atomic apply as safe only when every failure boundary lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable journal plus remote artifacts

Boundary checklist:

- failure before mutation must leave the remote untouched and record `old-remote`
- failure after staging must leave the remote untouched and record `old-remote`
- failure after dependency validation must leave the remote untouched and record `old-remote`
- replay of a completed plan with a matching journal must return `fully-updated-remote`
- replay of a completed plan must stay `fully-updated-remote` even if replay journaling itself fails
- replay of a completed plan with remote drift must return `blocked-recovery` with journal and remote artifacts
- retry after a blocked replay must remain blocked until the remote matches the journaled after state
- replay of a completed plan must not duplicate inserts or resurrect stale local file content
- any partial remote mutation without a durable recovery artifact is a release blocker

Acceptable post-failure states:

- `old-remote` when the apply never mutated remote state
- `fully-updated-remote` when the plan is already fully reflected and replay is inert
- `blocked-recovery` when the remote may have drifted or partially changed and the recovery artifact must be inspected before retry

Test fixture scope:

- JSON state and temporary files are enough to prove the lane-level state machine
- fixture evidence must still prove that retries do not duplicate inserts or revive stale local data
- a completed plan must never be replayed by duplicating inserts

Production scope:

- durable journal storage must survive process exit
- flush or fsync semantics are required
- claim fencing or lease ownership is required so only one writer advances recovery state
- recovery inspection data must be restart-readable without replay
