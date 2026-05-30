# RPP-0288 unknown plugin-owned resource refusal release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0288 unknown plugin-owned resource refusal release verifier carry-through, variant 5
Checklist item: RPP-0288 - Carry through the release verifier for unknown plugin-owned resource refusal, variant 5.

## Scope

This adds focused release-verifier support evidence for the fail-closed path
where a plugin-owned custom-table row is changed locally but has no explicit
supported driver policy. The planner must refuse the row as
`unsupported-plugin-owned-resource` with `UNKNOWN_PLUGIN_OWNED_RESOURCE` before
emitting any mutation or live-remote precondition.

The proof is local support evidence only. It is productionBacked `false`,
releaseEligible `false`, and keeps final release posture at NO-GO pending
separate production-backed release evidence.

## Proof surface

`test/rpp-0288-unknown-plugin-owned-resource-refusal-release-verifier-v5.test.js`
verifies that the release-verifier support proof:

- builds a focused unknown plugin-owned `forms` custom-table row with no
  allowlisted driver policy;
- observes a blocked planner result with zero mutations and zero preconditions;
- carries hash-only blocker and `unknownPluginOwnedResourceRefusalEvidence`
  fields, including base/local/remote hashes and update/unchanged change
  classification;
- rejects the blocked plan before mutation with `PLAN_NOT_READY`;
- rejects a forged ready plan with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE` before
  mutation;
- proves the remote snapshot hash is unchanged after both rejected attempts;
- confirms the production-shaped plugin-driver summary still carries
  `failureClosedUnknownPluginData`; and
- keeps raw row payloads, raw owner marker fields, and private fixture values
  out of the evidence envelope.

## Focused verification observed locally

```sh
node --check test/rpp-0288-unknown-plugin-owned-resource-refusal-release-verifier-v5.test.js
node --test test/rpp-0288-unknown-plugin-owned-resource-refusal-release-verifier-v5.test.js
node --test --test-name-pattern=RPP-0268 test/rpp-0268-unknown-plugin-owned-resource-refusal-v4.test.js
node --test --test-name-pattern=RPP-0248 test/rpp-0248-unknown-plugin-owned-resource-refusal-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0288-unknown-plugin-owned-resource-refusal-release-verifier-v5.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0288
test reported 2 subtests ok, 0 failed. The adjacent RPP-0268 variant 4 suite
reported 1 subtest ok, 0 failed. The adjacent RPP-0248 variant 3 suite reported
1 subtest ok, 0 failed. The scoped artifact redaction scan returned `"ok": true`
for the new evidence doc.

## Release posture

This is hash-only local release-verifier support evidence. It does not broaden
the release boundary and is not sufficient for final release movement without
separate live production-backed evidence.
