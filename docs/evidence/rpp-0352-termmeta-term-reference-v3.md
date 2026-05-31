# RPP-0352 termmeta term reference v3 evidence

Date: 2026-05-31
Lane: RPP-0352 termmeta term reference generated coverage, variant 3

## Scope

This is a support-only local proof for `wp_termmeta.term_id` references to
`wp_terms` targets. It adds one focused test and this evidence note only.
Final release posture: `NO-GO`.

## Proof surface

`test/rpp-0352-termmeta-term-reference-v3.test.js` builds deterministic local
variant-3 fixtures for six termmeta term-reference cases:

- ready same-plan term plus termmeta create;
- ready stable term target already identical in base, local, and remote;
- ready identity-map rewrite from a local term ID to a proven remote term ID;
- missing term target fail-closed;
- stale remote term target fail-closed; and
- remote-only unmapped term target fail-closed.

The support proof serializes resource keys, relationship labels, state labels,
counts, refusal codes, and SHA-256 hashes only. Raw term names, slugs,
termmeta keys, and termmeta values are asserted absent from the generated proof.

Unsupported target cases emit no mutations or preconditions, carry a
`stale-wordpress-graph-identity` blocker on the `wp_termmeta` row, and
`applyPlan()` refuses with `PLAN_NOT_READY` before the first mutation callback.
Remote, termmeta, and target term hashes remain unchanged after refusal.

## Focused evidence summary

```json
{
  "rpp": "RPP-0352",
  "evidenceSource": "termmeta-term-reference-v3",
  "status": "support_only",
  "releaseGate": "NO-GO",
  "productionBacked": false,
  "relationshipKey": "wp_termmeta.term_id",
  "relationshipType": "termmeta-term",
  "coverage": {
    "ready": 3,
    "blocked": 3
  },
  "unsupportedTargetRemoteChanges": [
    "unchanged",
    "update",
    "create"
  ],
  "unsupportedTargetRefusal": {
    "code": "PLAN_NOT_READY",
    "beforeMutationCalls": 0,
    "remoteDataPreserved": true
  },
  "redaction": "hash-only"
}
```

## Validation commands

```sh
node --check test/rpp-0352-termmeta-term-reference-v3.test.js
node --test --test-name-pattern RPP-0352 test/rpp-0352-termmeta-term-reference-v3.test.js
node --test --test-name-pattern RPP-0372 test/rpp-0372-termmeta-term-reference-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0352-termmeta-term-reference-v3.md
git diff --check
```

Observed local result during implementation: all commands exited 0. The focused
RPP-0352 test reported three subtests with zero failures. The adjacent RPP-0372
termmeta term reference test reported two subtests with zero failures. The
artifact redaction scan returned `"ok": true`, and the diff whitespace check
reported no issues.

## Release posture

This is local generated support evidence only. It does not claim a production
run or release-verifier approval. Final release remains `NO-GO`.
