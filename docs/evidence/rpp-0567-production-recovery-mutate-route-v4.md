# RPP-0567 production recovery mutate route, variant 4

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until recovery mutate authorization and executor behavior are checked against
production-owned inputs.

## Claim

The production-shaped recovery mutate route rejects negative authentication,
signature, and session cases before malformed request material can reach JSON
parsing, recovery mutation setup, journal mutation, or apply-capable work.

## Proof Surface

The variant-4 regression uses a deterministic local route harness with no live
endpoint, listener, public ingress, production credential, remote tunnel, or
network-dependent evidence. The accepted path is authorization-only: it stops
after signed recovery-mutate authorization and records only hash evidence.

## Proven Behavior

- Accepted signed recovery-mutate authorization is classified as
  `support_only`, keeps `releaseStatus` at `NO-GO`, and leaves release movement
  blocked at `0/4` gates.
- Negative cases cover missing or wrong Basic auth, missing signed headers,
  missing session, missing idempotency, invalid or mismatched content hash,
  stale timestamp, invalid nonce, bad auth signature, invalid session, expired
  session, session binding mismatch, and bad push signature.
- Each negative case carries a malformed text body that would fail if parsed,
  but the route records zero JSON parse attempts, zero recovery mutation setup
  attempts, zero journal mutation attempts, zero apply-capable work attempts,
  and zero mutation side effects.
- Support summaries store source, route, credential, user, session expiry,
  session id, nonce, idempotency, signing, canonical request, body, and proof
  material as SHA-256 hashes only.
- Raw credentials, usernames, source locations, sessions, signing keys,
  idempotency keys, nonces, request bodies, tokens, file locations, row values,
  journal payloads, and secrets are absent from the evidence.

## Validation

Commands run for this slice:

```sh
node --check [focused-test]
node --test --test-name-pattern RPP-0567 [focused-test]
node --test --test-name-pattern RPP-0547 [adjacent-v3-test]
node --test [base-recovery-mutate-route-test]
node [artifact-redaction-scan] [this-evidence-artifact]
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0567 test reported
2 passes / 0 failures. The adjacent RPP-0547 test reported 3 passes /
0 failures. The base recovery mutate route test reported 5 passes /
0 failures. The scoped artifact redaction scan returned `"ok": true`, and both
whitespace checks returned no findings.

## Boundary

This proof is not release-gating and does not claim production durability,
production endpoint reachability, or a recovery repair executor. Integration
should remain support-only until production-owned authorization evidence and the
recovery mutation executor boundary are checked with production inputs.
