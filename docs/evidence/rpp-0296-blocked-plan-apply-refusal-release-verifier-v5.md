# RPP-0296 blocked plan apply refusal release verifier v5 evidence

Date: 2026-05-31

Scope: local focused release-verifier support evidence only. The release remains
NO-GO until the broader live production-backed release boundary is satisfied.

## Proof surface

- Adds `test/rpp-0296-blocked-plan-apply-refusal-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for blocked plan apply
  refusal.
- Covers three focused blocked fixtures: direct `active_plugins` mutation beside
  a safe file mutation, unsupported plugin-owned data beside a safe file
  mutation, and atomic blocker propagation beside safe file/row mutations.
- For each focused fixture, verifies the planner is `blocked`, carries no
  conflicts, preserves one live-remote precondition per safe planned mutation,
  and emits deterministic hash-only planner evidence across replayed planning
  runs.
- Applies each focused blocked plan against a cloned remote with a trapped
  durable journal and mutation callback. Every attempt fails with
  `PLAN_NOT_READY` before mutation callbacks, durable journal writes, reported
  applied mutations, or remote snapshot changes.
- Replays all deterministic generated harness cases and applies the same
  pre-mutation refusal invariant to every generated `blocked` plan.
- Keeps support evidence hash-only: statuses, counts, resource keys, blocker
  classes, refusal codes, and SHA-256 hashes are recorded while raw fixture
  payloads and raw row fields are rejected from serialized evidence.

## Observed coverage

Focused release-verifier aggregate:

```json
{
  "totalCases": 3,
  "statuses": {
    "blocked": 3
  },
  "totalMutations": 4,
  "totalPreconditions": 4,
  "totalBlockers": 5,
  "totalAtomicGroups": 1,
  "totalAppliedMutations": 0,
  "totalDurableJournalEvents": 0,
  "totalBeforeMutationCalls": 0,
  "preMutationRefusals": 3,
  "remotePreserved": 3
}
```

Generated-harness aggregate:

```json
{
  "totalHarnessCases": 620,
  "totalBlockedCases": 74,
  "blockedCasesWithMutations": 64,
  "totalPlannedMutations": 715,
  "totalPlannedPreconditions": 715,
  "totalBlockers": 115,
  "totalAtomicGroups": 2,
  "totalAppliedMutations": 0,
  "totalDurableJournalEvents": 0,
  "totalBeforeMutationCalls": 0,
  "preMutationRefusals": 74,
  "remotePreserved": 74
}
```

The generated sweep covered blocked cases in tiers 0 through 9 and included
`unsupported-plugin-owned-resource`, `stale-wordpress-graph-identity`, and
`atomic-group-blocker-propagation` blocker classes.

## Focused verification observed locally

```sh
node --check test/rpp-0296-blocked-plan-apply-refusal-release-verifier-v5.test.js
node --check test/rpp-0236-blocked-plan-apply-refusal-v2.test.js
node --check test/rpp-0256-blocked-plan-apply-refusal-v3.test.js
node --check test/rpp-0276-blocked-plan-apply-refusal-v4.test.js
node --test test/rpp-0296-blocked-plan-apply-refusal-release-verifier-v5.test.js
node --test test/rpp-0236-blocked-plan-apply-refusal-v2.test.js test/rpp-0256-blocked-plan-apply-refusal-v3.test.js test/rpp-0276-blocked-plan-apply-refusal-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0296-blocked-plan-apply-refusal-release-verifier-v5.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0296
test reported 1 subtest ok, 0 failed. The adjacent blocked-plan refusal suites
reported 6 subtests ok, 0 failed. The scoped artifact redaction scan returned
`"ok": true` for this evidence doc.

## Release posture

This is support-only local release-verifier evidence. It does not claim a
production-backed release pass, does not update progress artifacts, and does
not replace the broader release checklist or CI evidence.
