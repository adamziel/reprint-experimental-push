# RPP-0260 atomic group blocker propagation, variant 3

Date: 2026-05-31
Lane: RPP-0260 atomic group blocker propagation, variant 3
Checklist item: RPP-0260 - Add generated coverage for atomic group blocker propagation, variant 3.
Release status: NO-GO until integration accepts this local model evidence with the broader release gate set.

## Invariant

Generated atomic plugin-install groups must not allow the dependent plugin file
or plugin metadata mutation to apply when the same group is blocked by a missing
live dependency. The planner must emit an `atomic-group-blocker-propagation`
blocker for every grouped mutation, each propagated blocker must reference the
source `missing-plugin-dependency` blocker, and apply must refuse the non-ready
plan before durable journal writes or mutation callbacks.

## Generated proof

Focused test:
`RPP-0260 generated atomic group blocker propagation variant 3 keeps grouped
mutations blocked` in
`test/rpp-0260-atomic-group-blocker-propagation-v3.test.js`.

The test reuses deterministic generated push-harness cases without changing the
shared harness. It selects the ten
`atomic-plugin-stack-missing-dependency-v3` cases, one per generated tier. Each
case contains the atomic group
`install-generated-dependent-without-dependency` with the dependent plugin file
and plugin metadata resources.

Assertions prove:

- variant 3 stack coverage remains twenty generated cases across tiers 0-9:
  ten ready cases and ten missing-dependency cases;
- the selected missing-dependency cases span tiers 0-9 and validate as
  non-ready, with plan statuses `{ blocked: 2, conflict: 8 }`;
- all ten selected atomic groups are `blocked`;
- each group has one source `missing-plugin-dependency` blocker and two grouped
  mutations;
- all twenty grouped mutations receive
  `atomic-group-blocker-propagation` blockers referencing the source blocker id;
- no dependency plugin mutation is synthesized outside the group;
- every planned mutation still carries one live-remote precondition; and
- apply rejects with `PLAN_NOT_READY` before durable journal events, mutation
  callbacks, or reported applied mutations.

## Evidence discipline

The proof envelope serializes only case ids, tiers, statuses, resource keys,
mutation ids, blocker classes, refusal codes, counts, and SHA-256 hashes. The
test checks `findEvidenceRedactionIssues` on the case proof and aggregate proof,
and asserts the proof text does not contain generated plugin file contents or
serialized mutation payloads.

Expected deterministic aggregate from the focused proof:

```json
{
  "totalCases": 10,
  "totalBlockedGroups": 10,
  "totalGroupMutations": 20,
  "totalSourceBlockers": 10,
  "totalPropagatedBlockers": 20,
  "totalAppliedMutations": 0,
  "totalDurableJournalEvents": 0,
  "totalBeforeMutationCalls": 0,
  "statuses": { "blocked": 2, "conflict": 8 },
  "perTier": {
    "0": 1,
    "1": 1,
    "2": 1,
    "3": 1,
    "4": 1,
    "5": 1,
    "6": 1,
    "7": 1,
    "8": 1,
    "9": 1
  },
  "sourceBlockerClasses": { "missing-plugin-dependency": 10 }
}
```

## Ready-to-paste progress log entry

```md
- RPP-0260 atomic group blocker propagation variant 3: added `test/rpp-0260-atomic-group-blocker-propagation-v3.test.js` and `docs/evidence/rpp-0260-atomic-group-blocker-propagation-v3.md`. The focused generated proof covers ten `atomic-plugin-stack-missing-dependency-v3` cases across tiers 0-9, proves one source missing-dependency blocker propagates to both grouped mutations in every blocked atomic group, and confirms non-ready apply refuses before durable journal writes or mutation callbacks. Command: `node --test test/rpp-0260-atomic-group-blocker-propagation-v3.test.js`. Caveat: deterministic local generated-harness evidence only; release remains gated separately.
```

## Validation commands

```sh
node --check test/rpp-0260-atomic-group-blocker-propagation-v3.test.js
node --test test/rpp-0260-atomic-group-blocker-propagation-v3.test.js
node --test test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
node --test --test-name-pattern='RPP-0220|RPP-0240' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0260-atomic-group-blocker-propagation-v3.md
git diff --check
```

Observed results:

- syntax check: exit 0;
- focused RPP-0260 test: 1 subtest, 0 failures;
- adjacent RPP-0280 atomic blocker test: 1 subtest, 0 failures;
- adjacent RPP-0220/RPP-0240 planner/generated atomic blocker slice: 3
  subtests, 0 failures;
- artifact redaction scan: `ok: true`; and
- whitespace diff check: exit 0.

Caveat: this is deterministic local generated-harness planner/apply evidence.
It does not replace integration-lane, release-gate, or production-backed
validation.
