# Durable Recovery Notes

This lane's test suite proves the recovery boundary in memory and with temporary files.
That is enough to validate the state machine, but it is not enough to claim production
durability.

Production recovery needs:

- a durable journal row or file for each apply boundary
- flush semantics that survive process exit
- claim fencing or leases so a stale writer cannot append after a newer claim
- restart-readable inspection for blocked cases
- an artifact trail for every partial remote mutation

Accepted post-failure states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable artifacts

Release blocker:

- any partial remote mutation that is not paired with inspectable recovery artifacts

Retry rule:

- a retry must not duplicate inserts
- a retry must not resurrect stale local data
- a retry must stay blocked if it cannot prove the remote is either still old or already fully updated
