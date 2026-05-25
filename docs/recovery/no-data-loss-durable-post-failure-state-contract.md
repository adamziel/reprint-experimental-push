# No Data Loss Durable Post-Failure State Contract

The durable atomic apply flow only permits three post-failure outcomes:

- `old-remote`: nothing mutated yet, so the live remote stays untouched.
- `fully-updated-remote`: the plan was already completed and replay is safe.
- `blocked-recovery`: the live remote changed during apply and the failure must
  carry inspectable journal and remote artifacts.

Release gate:

- A partial remote mutation without a recovery artifact is a blocker.
- Retry must not duplicate inserts or revive stale local data.
- A replay of a completed plan must remain inert and return
  `fully-updated-remote`.
