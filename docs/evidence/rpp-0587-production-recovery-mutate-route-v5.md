# RPP-0587 production recovery mutate route, variant 5

Date: 2026-05-31

Status: local executor-auth support evidence only. Final release remains
**NO-GO** until production-owned recovery mutate authorization and executor
behavior are checked with production inputs.

## Claim

The production recovery mutate route verifier can carry exactly one
support-only route evidence summary while proving negative auth cases fail
before JSON parsing, recovery mutation planning, journal mutation, or
mutation-capable work.

## Proof Surface

The variant-5 regression uses a deterministic local route harness. It does not
use live endpoints, public ingress, production credentials, remote tunnels, or
network-dependent proof material.

The accepted path is authorization-only: it validates signed recovery-mutate
request material, records hash-only evidence, and stops before JSON parsing or
any recovery mutation executor setup. The verifier-shaped release summary
carries that proof under one `productionRecoveryMutateRoute` summary block and
keeps release movement blocked.

## Proven Behavior

- Accepted signed recovery-mutate authorization is classified as
  `support_only`, keeps `releaseStatus` at `NO-GO`, and leaves release movement
  blocked at `0/4` gates.
- The verifier-style summary carries exactly one recovery mutate route evidence
  block and does not duplicate that block in topology evidence.
- Negative cases include missing auth material, missing signed headers, missing
  session, missing idempotency, malformed content hash, mismatched content hash,
  stale timestamp, malformed nonce, bad auth signature, invalid session, expired
  session, session binding mismatch, and bad push signature.
- Each negative case carries malformed body material that would fail if parsed,
  but records zero JSON parse attempts, zero recovery mutation planning
  attempts, zero recovery mutation setup attempts, zero journal mutation
  attempts, zero apply-capable work attempts, zero mutation-capable work
  attempts, and zero mutation side effects.
- Missing route proof, malformed route proof, and incomplete negative-auth
  evidence all fail closed before release movement.
- Source, route, credential, user, session, nonce, idempotency, signing,
  canonical request, body, and proof material are represented by SHA-256 hashes.
- Raw endpoint values, credentials, usernames, session ids, signing material,
  idempotency keys, nonces, request bodies, tokens, file locations, row values,
  journal payloads, and secrets are absent from the evidence.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0587-production-recovery-mutate-route-v5.test.js
node --test --test-name-pattern RPP-0587 test/rpp-0587-production-recovery-mutate-route-v5.test.js
node --test --test-name-pattern RPP-0567 test/rpp-0567-production-recovery-mutate-route-v4.test.js
node --test --test-name-pattern RPP-0547 test/rpp-0547-production-recovery-mutate-route-v3.test.js
node --test test/production-recovery-mutate-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0587-production-recovery-mutate-route-v5.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0587 test reported
4 passes / 0 failures. The adjacent RPP-0567 test reported 2 passes /
0 failures, the adjacent RPP-0547 test reported 3 passes / 0 failures, and the
base recovery mutate route test reported 5 passes / 0 failures. The scoped
artifact redaction scan returned `"ok": true`; both whitespace checks returned
no findings.

## Boundary

This proof is support-only NO-GO evidence. It does not claim production
durability, production endpoint reachability, final release readiness, or a
recovery repair executor. Integration should remain blocked until
production-owned authorization and recovery mutation executor evidence are
checked on the release path.
