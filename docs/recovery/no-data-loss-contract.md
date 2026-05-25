# No Data Loss Recovery Contract

This lane treats the recovery boundary as valid only when one of these states is observable after a failure or replay:

1. `old-remote`
   - No remote mutation escaped the boundary.
   - Recovery artifacts may show the plan as opened, staged, or dependency-validated.
   - The remote snapshot itself must remain unchanged.

2. `fully-updated-remote`
   - The plan completed successfully.
   - Replaying the same completed plan must stay inert.
   - The replay path must not duplicate inserts or resurrect stale local data.

3. `blocked-recovery`
   - A partial remote mutation was observed or a stale completed replay was rejected.
   - Recovery artifacts must remain inspectable.
   - A blocked state is acceptable only when it carries enough journal and remote evidence to explain the refusal.

Release rule:

- A partial remote mutation without a recovery artifact is a blocker.
- Any retry must either reclassify to `fully-updated-remote` or remain blocked with artifacts.
- Anything else is treated as data-loss risk.
