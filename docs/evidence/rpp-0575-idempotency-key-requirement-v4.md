# RPP-0575 idempotency key requirement, variant 4

Date: 2026-05-31

Status: local executor-auth support evidence only. Final release remains
**NO-GO** until the same mutation-capable idempotency proof is checked against
production-owned inputs.

## Claim

Mutation-capable apply and recovery route evidence must prove an idempotency
key was required and present before any JSON parsing or mutation-capable work
can start. The `verify:release`-shaped support summary must carry exactly one
route-evidence summary for this proof, and malformed or missing idempotency
evidence must keep release movement blocked.

## Proof Surface

The focused regression uses a deterministic local harness for the
production-shaped mutation-capable route pair. The accepted path is
authorization-only: it validates signed request evidence and idempotency
binding, then stops before JSON parsing, apply work, recovery mutation work,
journal mutation, or side effects.

The negative matrix sends malformed payload material with missing or malformed
idempotency evidence. Every negative case fails before parsing the payload and
before mutation-capable work counters can advance.

## Proven Behavior

- Accepted mutation-capable route evidence records two signed route checks,
  both session-bound and idempotency-bound, with route aliases, method,
  route-location, session, idempotency, request, canonical request, and
  signature evidence stored as hashes.
- The generated `verify:release`-shaped support summary contains exactly one
  production idempotency-key route-evidence summary and remains `NO-GO`.
- Missing idempotency evidence and malformed idempotency evidence both fail
  closed with zero JSON parse attempts, zero apply work attempts, zero recovery
  mutation work attempts, and zero mutation side effects.
- Spoofed route evidence that claims success while omitting the idempotency
  hash, or carrying a malformed idempotency hash, is blocked with
  `IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE`.
- Raw credentials, usernames, source locations, sessions, signing keys,
  idempotency keys, nonces, request bodies, tokens, file locations, row values,
  journal payloads, and secrets are absent from the generated evidence.

## Validation

Commands run for this slice:

```sh
node --check [focused-test]
node --test --test-name-pattern RPP-0575 [focused-test]
node --test --test-name-pattern RPP-0555 [adjacent-idempotency-v3-test]
node --test --test-name-pattern RPP-0557 [adjacent-conflict-v3-test]
node --test --test-name-pattern RPP-0537 [adjacent-conflict-v2-test]
node [artifact-redaction-scan] [this-evidence-artifact]
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0575 run
reported 3 passes / 0 failures. The adjacent RPP-0555 run reported
3 passes / 0 failures, the adjacent RPP-0557 run reported 3 passes /
0 failures, and the adjacent RPP-0537 run reported 2 passes / 0 failures.
The scoped artifact redaction scan returned `"ok": true`; both whitespace
checks returned no findings.

## Boundary

This proof is intentionally local and support-only. It does not use live
endpoints, production credentials, public ingress, remote tunnels, or
network-dependent evidence. Integration should remain blocked until a checked
production-owned release verifier supplies the same single-summary,
mutation-capable idempotency-key evidence.
