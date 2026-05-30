# RPP-0256 blocked plan apply refusal, variant 3

Date: 2026-05-30
Lane: RPP-0256 blocked plan apply refusal, variant 3
Checklist item: RPP-0256 — Add generated coverage for blocked plan apply refusal, variant 3.
Release status: NO-GO until integration accepts this local model evidence with the broader gate set.

## Invariant

A blocked plan must be refused before any apply-side mutation boundary, even
when the plan also carries otherwise valid independent mutations. The executor
must return stable `PLAN_NOT_READY` evidence, write no durable journal events,
and leave the remote snapshot unchanged.

## Focused proof

Focused test: `RPP-0256 focused blocked active_plugins plan refuses apply before
independent mutation` in
`test/rpp-0256-blocked-plan-apply-refusal-v3.test.js`.

The fixture updates an independent file while also changing the
`wp_options.active_plugins` row directly. The planner keeps the file mutation
and its live-remote precondition, but emits an
`unsupported-active-plugins-direct-mutation` blocker for the direct activation
row change. Assertions verify:

- plan status is `blocked` with one planned independent mutation and one
  blocker;
- the blocked row emits no mutation and no precondition;
- `applyPlan()` throws `PLAN_NOT_READY` with `{ status: "blocked" }` before
  durable journal events;
- the remote digest is identical before and after apply refusal; and
- the serialized proof envelope contains resource keys, counts, classes, and
  hashes only, omitting raw fixture content.

## Generated proof

Focused test: `RPP-0256 generated blocked plans refuse apply before mutation
with variant 3 coverage`.

The test iterates the deterministic generated push harness, filters every plan
with `status === "blocked"`, revalidates each generated fixture, and applies the
blocked plan against a cloned remote with a trapped durable journal. Every
selected fixture rejects with `PLAN_NOT_READY`, reports zero applied mutations,
writes zero durable journal events, and preserves the remote digest.

Observed generated aggregate:

```json
{
  "totalBlockedCases": 74,
  "blockedCasesWithMutations": 64,
  "totalPlannedMutations": 715,
  "totalPlannedPreconditions": 715,
  "variant3BlockedCases": 27,
  "variant3BlockedCasesWithMutations": 23,
  "perTier": {
    "0": 13,
    "1": 12,
    "2": 11,
    "3": 9,
    "4": 8,
    "5": 4,
    "6": 4,
    "7": 5,
    "8": 4,
    "9": 4
  },
  "variant3PerTier": {
    "0": 5,
    "1": 6,
    "2": 3,
    "3": 2,
    "4": 3,
    "5": 2,
    "6": 1,
    "7": 2,
    "8": 1,
    "9": 2
  },
  "blockerClasses": {
    "atomic-group-blocker-propagation": 4,
    "missing-plugin-dependency": 2,
    "stale-plugin-owner-context": 13,
    "stale-wordpress-graph-identity": 59,
    "unsupported-plugin-owned-resource": 27
  }
}
```

Additional assertions prove that all generated planned mutations have exactly
one live-remote precondition, variant 3 blocked coverage spans all tiers 0-9,
selected variant 3 cases preserve the remote, and replayed proof evidence is
deterministic.

## Validation

Commands run from the assigned worktree:

```sh
node --check test/rpp-0256-blocked-plan-apply-refusal-v3.test.js
node --test test/rpp-0256-blocked-plan-apply-refusal-v3.test.js
node --test test/rpp-0236-blocked-plan-apply-refusal-v2.test.js
node --test --test-name-pattern='RPP-0216|RPP-0236|RPP-0240' test/push-planner.test.js test/generated-push-harness.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0256-blocked-plan-apply-refusal-v3.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed results:

- syntax check: exit 0;
- focused RPP-0256 test: 2 subtests, 0 failures;
- adjacent RPP-0236 test: 2 subtests, 0 failures;
- adjacent planner/generated pattern test: 4 subtests, 0 failures;
- checklist lint: `ok: true`;
- artifact redaction scan: `ok: true`; and
- whitespace checks: exit 0.

Caveat: this is deterministic local generated-harness and focused-fixture
evidence. It does not replace integration-lane, release-gate, or
production-backed validation.
