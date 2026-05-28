# AO rollback-repair evidence

Date: 2026-05-28
Lane: rollback-repair
Primary checklist range: RPP-0613, RPP-0618, RPP-0619, RPP-0620, RPP-0673, RPP-0678, RPP-0679, RPP-0680

## Recovery repair contracts added

- **Exact repair classification:** `inspectRecoveryRepair()` wraps the durable journal inspection with explicit `old`, `new`, and `unknown` target buckets. Every target report carries `mutationId`, `resourceKey`, `beforeHash`, `afterHash`, and `observedHash` when the journal can prove them.
- **Fail-closed repaired marker:** `markRecoveryJournalRepaired()` appends `journal-repaired` only after the journal integrity is OK, every planned target has persisted target evidence, and every current target matches the journaled after hash. Missing target envelopes stay blocked even if the current site happens to look updated.
- **Drift needs an operator decision:** `replayRecoveryRepair()` refuses to mutate targets whose observed hash is outside the before/after envelope unless an operator decision names the exact target hashes. Stale or mismatched operator evidence is rejected.
- **Idempotent roll-forward repair:** replay writes only `old` targets. Targets already at the after hash are returned as `skippedTargets` and are not passed to the writer hook.
- **Rollback boundary made explicit:** automatic rollback remains unsupported because durable repair journals intentionally carry hashes, not raw before values. The report names the rollback candidates while keeping `canRollback: false`.

## Focused verification

```sh
node --test test/recovery-repair.test.js
```

Observed status: pass, 5 tests.

Key assertions:

- Partial state with file 1 updated, file 3 drifted, and files 2/4 old reports exactly 1 `new`, 2 `old`, and 1 `unknown` target.
- Drifted replay throws `RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED`; stale observed-hash evidence throws `RECOVERY_REPAIR_OPERATOR_DECISION_INVALID`.
- A journal missing `target-planned` records throws `RECOVERY_REPAIR_INCOMPLETE_JOURNAL` and does not append `journal-repaired`.
- Roll-forward replay on a 2-new/2-old remote writes only files 3 and 4; files 1 and 2 are skipped.
- A converged repair appends one `journal-repaired` record with counts `{ old: 0, new: 4, unknown: 0, total: 4 }` and the artifact reference.

## Files carrying evidence

- `src/recovery-repair.js`
- `test/recovery-repair.test.js`
- `docs/evidence/ao-rollback-repair.md`
