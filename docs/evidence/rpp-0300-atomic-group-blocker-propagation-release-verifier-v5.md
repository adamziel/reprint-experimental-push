# RPP-0300 atomic group blocker propagation release verifier v5 evidence

Date: 2026-05-31

Scope: local release-verifier support evidence only. Final release remains
NO-GO until the broader integration and production-backed release gates pass.

## Proof surface

- Adds
  `test/rpp-0300-atomic-group-blocker-propagation-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for atomic group blocker
  propagation.
- Builds one focused atomic plugin-install fixture with both a resource-level
  unsupported plugin-owned row blocker and a group-level missing plugin
  dependency blocker.
- Reuses the existing generated harness target
  `atomic-plugin-install-stack-release-verifier-v5` without editing generated
  harness files. The selected proof covers the ten generated missing-dependency
  v5 cases, one per tier.
- Verifies every source blocker is propagated to every grouped mutation through
  `atomic-group-blocker-propagation`, and each propagated blocker remains bound
  to the matching mutation and source blocker set.
- Verifies every planned grouped mutation keeps one live-remote precondition
  whose expected hash matches the mutation `remoteBeforeHash` and the current
  remote resource hash.
- Applies each non-ready plan to a cloned remote with a trapped durable journal
  and mutation callback. Every attempt fails with `PLAN_NOT_READY` before
  mutation callbacks, durable journal writes, reported applied mutations, or
  remote snapshot changes.
- Keeps support evidence hash-only: statuses, counts, resource keys, blocker
  classes, refusal codes, and SHA-256 hashes are recorded while raw site values
  and credential-like dependency fields are rejected from serialized evidence.

## Observed focused aggregate

```json
{
  "totalCases": 1,
  "statuses": {
    "blocked": 1
  },
  "totalBlockedGroups": 1,
  "totalGroupMutations": 4,
  "totalGroupedPreconditions": 4,
  "totalDirectBlockers": 2,
  "totalPropagatedBlockers": 4,
  "totalAppliedMutations": 0,
  "totalDurableJournalEvents": 0,
  "totalBeforeMutationCalls": 0,
  "preMutationRefusals": 1,
  "remotePreserved": 1,
  "sourceBlockerClasses": {
    "missing-plugin-dependency": 1,
    "unsupported-plugin-owned-resource": 1
  },
  "refusalCodes": {
    "PLAN_NOT_READY": 1
  }
}
```

## Observed generated aggregate

```json
{
  "targetCoverage": {
    "key": "atomicPluginInstallStackReleaseVerifierVariant5",
    "tag": "atomic-plugin-install-stack-release-verifier-v5",
    "total": 20,
    "statuses": {
      "blocked": 2,
      "conflict": 8,
      "ready": 10
    }
  },
  "selectedCases": 10,
  "statuses": {
    "blocked": 2,
    "conflict": 8
  },
  "totalBlockedGroups": 10,
  "totalGroupMutations": 20,
  "totalGroupedPreconditions": 20,
  "totalDirectBlockers": 10,
  "totalPropagatedBlockers": 20,
  "totalAppliedMutations": 0,
  "totalDurableJournalEvents": 0,
  "totalBeforeMutationCalls": 0,
  "preMutationRefusals": 10,
  "remotePreserved": 10,
  "sourceBlockerClasses": {
    "missing-plugin-dependency": 10
  },
  "refusalCodes": {
    "PLAN_NOT_READY": 10
  }
}
```

The generated target spans tiers 0 through 9 with two v5 atomic plugin-install
cases per tier. The selected missing-dependency proof spans tiers 0 through 9
with one non-ready case per tier.

## Validation commands

```sh
node --check test/rpp-0300-atomic-group-blocker-propagation-release-verifier-v5.test.js
node --check test/rpp-0260-atomic-group-blocker-propagation-v3.test.js
node --check test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
node --test test/rpp-0300-atomic-group-blocker-propagation-release-verifier-v5.test.js
node --test test/rpp-0260-atomic-group-blocker-propagation-v3.test.js test/rpp-0280-atomic-group-blocker-propagation-v4.test.js
node --test --test-name-pattern='RPP-0220|RPP-0240|RPP-0280|RPP-0300|atomic group' test/push-planner.test.js test/generated-push-harness.test.js test/rpp-0280-atomic-group-blocker-propagation-v4.test.js test/rpp-0300-atomic-group-blocker-propagation-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0300-atomic-group-blocker-propagation-release-verifier-v5.md
git diff --check
```

Observed local result after validation: all commands exited 0. The focused
RPP-0300 test reported 1 subtest ok, 0 failed. The adjacent dedicated
RPP-0260/RPP-0280 atomic blocker tests reported 2 subtests ok, 0 failed. The
planner/generated atomic blocker lineage slice reported 5 subtests ok, 0
failed. The scoped artifact redaction scan returned `"ok": true` for this
evidence doc.

## Release posture

This is support-only local release-verifier evidence. It does not update
progress artifacts, does not claim production-backed release readiness, and
does not change the final release posture from NO-GO.
