# RPP-0392 termmeta term reference release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0392 — termmeta term reference release-verifier carry-through, variant 5

## Scope

This is a focused local release-verifier regression slice for the
`wp_termmeta.term_id` graph reference. It proves that a local `wp_termmeta`
create whose `term_id` target is not present in base, local, or remote is not
eligible for release movement: the planner emits a
`stale-wordpress-graph-identity` blocker, produces no mutation or precondition
for the orphan termmeta row, and `applyPlan` refuses with `PLAN_NOT_READY`
before any mutation callback.

This is support-only local model evidence. It does not claim a live production
release run and keeps the release gate `NO-GO`.

## Proof surface

`test/rpp-0392-termmeta-term-reference-release-verifier-v5.test.js` adds one
focused test:

- builds a deterministic base/local/remote fixture with one local-only
  `wp_termmeta` row referencing absent `row:["wp_terms","term_id:9392"]`;
- asserts the plan is `blocked` with zero mutations, zero preconditions, and a
  single `stale-wordpress-graph-identity` blocker on
  `row:["wp_termmeta","meta_id:392"]`;
- verifies the blocker carries the `wp_termmeta.term_id` / `termmeta-term`
  reference to the absent target and marks the target as unsupported for this
  release slice;
- applies the blocked plan against a cloned remote and proves refusal occurs
  before mutation while remote, termmeta, and term target hashes remain
  unchanged; and
- serializes a release-verifier proof that includes only resource keys, states,
  counts, transition labels, and SHA-256 hashes.

Raw `meta_key` / `meta_value` fixture strings and raw meta field names are
explicitly checked absent from the plan, blocker, reference, and full proof.
`assertEvidenceHasNoRawValues()` also accepts the emitted proof.

## Focused evidence summary

```json
{
  "rpp": "RPP-0392",
  "evidenceSource": "termmeta-term-reference-release-verifier-v5",
  "verdict": "TERMMETA_TERM_REFERENCE_UNSUPPORTED_TARGET_HASH_ONLY_FAIL_CLOSED",
  "status": "support_only",
  "releaseGate": "NO-GO",
  "evidenceScope": "local-release-verifier-model",
  "relationshipKey": "wp_termmeta.term_id",
  "relationshipType": "termmeta-term",
  "termmetaResourceKey": "row:[\"wp_termmeta\",\"meta_id:392\"]",
  "targetResourceKey": "row:[\"wp_terms\",\"term_id:9392\"]",
  "planSummary": {
    "mutations": 0,
    "decisions": 0,
    "conflicts": 0,
    "blockers": 1,
    "atomicGroups": 0
  },
  "applyRefusal": {
    "code": "PLAN_NOT_READY",
    "beforeMutationCalls": 0,
    "remoteDataPreserved": true
  },
  "redaction": "hash-only"
}
```

## Validation commands

```sh
node --check test/rpp-0392-termmeta-term-reference-release-verifier-v5.test.js
node --test test/rpp-0392-termmeta-term-reference-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0151|RPP-0171' test/generated-push-harness.test.js
node --test --test-name-pattern='plans a safe same-plan taxonomy closure|blocks a taxonomy relationship when its same-plan term_taxonomy target is itself blocked|RPP-0331' test/push-planner.test.js
node --test test/rpp-0316-wp-navigation-fail-closed-reference.test.js test/rpp-0317-serialized-block-reference-detection.test.js
node --test test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node --test test/rpp-0283-local-delete-remote-edit-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0392-termmeta-term-reference-release-verifier-v5.md docs/reprint-push-completion-checklist.md

git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused
RPP-0392 test reported 1 subtest, 0 failures. The adjacent generated
terms/termmeta graph slice reported 2 subtests, 0 failures; the adjacent
planner taxonomy/fail-closed slice reported 3 subtests, 0 failures; the
unsupported-target fail-closed graph slice reported 5 subtests, 0 failures;
the adjacent wp_termmeta release-verifier slice reported 4 subtests, 0
failures; and the adjacent hash-only release-verifier slice reported 4
subtests, 0 failures. Checklist lint, artifact redaction scan, and diff
whitespace checks also exited 0.

## Release posture

The new evidence proves the assigned checklist success text — unsupported
target fails closed with hash-only evidence — on a deterministic local
release-verifier model. Final release remains gated on broader release-verifier
and production-backed validation.
