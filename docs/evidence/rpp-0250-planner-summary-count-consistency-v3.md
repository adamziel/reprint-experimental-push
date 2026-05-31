# RPP-0250 planner summary count consistency, variant 3

Date: 2026-05-31
Lane: RPP-0250 planner summary count consistency, variant 3
Checklist item: RPP-0250 - Add generated coverage for planner summary count
consistency, variant 3.

## Invariant

Every deterministic generated planner case must keep `plan.summary` equal to
the emitted planner arrays: mutations, decisions, conflicts, blockers, and
atomic groups. Planner status must also follow the emitted evidence: conflicts
win over blockers, blockers win over ready, and ready plans have neither.

## Focused generated proof

Focused test:
`RPP-0250 generated planner summary counts match emitted evidence deterministically`

Command:

```sh
node --test test/rpp-0250-planner-summary-count-consistency-v3.test.js
```

Caveat: Generated local/model evidence only; release remains gated separately.

The standalone proof imports deterministic generated cases without editing the
shared generated harness. It plans every case twice, compares summary-only
evidence envelopes across runs, and compares aggregate planner totals against
`runGeneratedPushHarness()` report totals for the fields the report exposes.

Local generated aggregate from the focused proof:

```json
{
  "totalCases": 620,
  "statuses": {
    "blocked": 74,
    "conflict": 201,
    "ready": 345
  },
  "totalMutations": 8525,
  "totalDecisions": 1807,
  "totalConflicts": 583,
  "totalBlockers": 605,
  "totalAtomicGroups": 20,
  "totalPreconditions": 8525,
  "casesWithAtomicGroups": 20,
  "maxMutationCount": 47,
  "maxAtomicGroups": 1
}
```

Assertions prove:

- every case summary equals emitted mutation, decision, conflict, blocker, and
  atomic-group counts;
- every case status matches emitted conflicts and blockers;
- every case keeps live-remote preconditions one-for-one with emitted mutations;
- replayed generated snapshots produce identical summary-only evidence;
- generated aggregate totals match the harness report totals for cases,
  statuses, tiers, feature families, mutations, decisions, conflicts, blockers,
  and preconditions; and
- serialized proof evidence contains command, caveat, resource keys, counts,
  statuses, classes, and SHA-256 hashes only.

## Progress log entry

Ready to paste into the progress log:

```md
- RPP-0250: added deterministic generated planner-summary count coverage in
  `test/rpp-0250-planner-summary-count-consistency-v3.test.js`. Command:
  `node --test test/rpp-0250-planner-summary-count-consistency-v3.test.js`.
  Caveat: Generated local/model evidence only; release remains gated separately.
```

## Validation commands

```sh
node --check test/rpp-0250-planner-summary-count-consistency-v3.test.js
node --test test/rpp-0250-planner-summary-count-consistency-v3.test.js
node --test --test-name-pattern='RPP-0210|RPP-0230|RPP-0270|RPP-0290' test/push-planner.test.js test/generated-push-harness.test.js test/rpp-0270-planner-summary-count-consistency-v4.test.js test/rpp-0290-planner-summary-count-consistency-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0250-planner-summary-count-consistency-v3.md
git diff --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0250 test
reported one subtest ok and zero failures. The adjacent planner-summary suite
reported four subtests ok and zero failures. The scoped redaction scan returned
`"ok": true` for this evidence doc.

## Release note

Evidence scope is deterministic local generated-harness coverage. Production
release verification remains gated separately, and shared progress surfaces are
left for the integrator.
