# RPP-0550 session user identity binding, variant 3

Date: 2026-05-31

Status: local/generated support evidence only. Final release remains **NO-GO**
until the same route-evidence summary is checked against production-owned auth
inputs.

## Claim

`verify:release` carries exactly one `authSessionUserIdentity` summary with one
`routeEvidence` block for the same authenticated user identity bound to the push
session and dry-run receipt. The generated support proof stays hash-only and
does not expose raw user identity, session, endpoint, or plan-body material.

## Proof Surface

`test/rpp-0550-session-user-identity-binding-v3.test.js` adds three focused
checks:

- source-level release-summary coverage proves `buildReleaseTopologyEvidence()`
  emits one `authSessionUserIdentity` summary and
  `buildReleaseAuthSessionUserIdentityEvidence()` emits one `routeEvidence`
  block;
- deterministic generated support cases prove the positive summary is complete
  only when issued/readback `sessionHash` and `userIdentityHash` values are all
  present and match the generated dry-run receipt binding; and
- generated missing-hash and receipt-drift cases remain support-only blocked
  with `releaseGate: NO-GO` and `releaseMovement.allowed: false`.

## Proven Behavior

- The release topology carries one session-user-identity summary, and the
  summary carries one route-evidence block.
- The required route evidence remains exactly
  `issued.sessionHash`, `issued.userIdentityHash`, `readback.sessionHash`, and
  `readback.userIdentityHash`.
- The positive generated envelope binds the issued/readback session hash and
  user-identity hash to the dry-run receipt's session-user binding.
- The generated envelope records source, route profile, receipt, plan,
  session, and identity material as SHA-256 hashes only.
- Raw user login, raw user ID, raw session identifier, raw endpoint, and raw
  plan body are absent from the generated support envelope.
- Missing readback identity-hash evidence and drifted dry-run receipt binding
  evidence remain blocked before release movement.
- The proof is local/generated support evidence only; production-backed release
  readiness remains out of scope for this slice.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0550-session-user-identity-binding-v3.test.js
node --test --test-name-pattern RPP-0550 test/rpp-0550-session-user-identity-binding-v3.test.js
node --test --test-name-pattern RPP-0530 test/rpp-0530-session-user-identity-release-summary.test.js
node --test test/session-user-identity-binding.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0550-session-user-identity-binding-v3.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0550 test
reported 3 passes / 0 failures, the adjacent RPP-0530 route-summary test
reported 4 passes / 0 failures, and the session-user-identity binding test
reported 3 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is support-only and NO-GO scoped. It does not use live production
endpoints, production credentials, network-only evidence, remote tunnels, or
checklist/progress surfaces. Integration should treat it as generated route
evidence for the executor-auth lane until a separate checked production-owned
release proof exists.
