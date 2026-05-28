# AO generated harness evidence for RPP-0102

Date: 2026-05-28
Lane: RPP-0102 generated harness
Checklist item: RPP-0102 — Implement directory descendant conflict, variant 1.

## What changed

- Added deterministic scenario family `directory-descendant-conflict` to `scripts/harness/generated-push-cases.js`.
- Each case starts with a tracked upload directory, deletes that directory locally, and adds a remote-only descendant file under that directory.
- The planner must classify the case as `conflict`; `applyPlan()` remains blocked for the non-ready plan and leaves remote state unchanged.
- The generated summary now exposes `summary.targetCoverage.directoryDescendantConflict` with total, per-tier counts, and status counts for this target.

## Focused proof

`test/generated-push-harness.test.js` asserts:

- the `directory-descendant-conflict` family and descendant-conflict tags are present;
- target coverage has per-tier keys for tiers 0 through 9;
- target coverage totals equal the generated family count;
- all target cases are conflicts;
- a sampled generated case validates as `conflict`, records at least one conflict, and does not apply mutations.

Focused command:

```sh
node --test test/generated-push-harness.test.js
```

Observed target coverage from `node scripts/harness/generated-push-cases.js`:

```json
{
  "directoryDescendantConflict": {
    "family": "directory-descendant-conflict",
    "total": 13,
    "perTier": {
      "0": 1,
      "1": 2,
      "2": 1,
      "3": 1,
      "4": 2,
      "5": 1,
      "6": 1,
      "7": 2,
      "8": 1,
      "9": 1
    },
    "statuses": {
      "conflict": 13
    }
  }
}
```
