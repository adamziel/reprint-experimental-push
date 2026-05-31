# RPP-0595 idempotency key requirement, variant 5

Date: 2026-05-31

Status: local executor-auth support evidence only. Final release remains
**NO-GO** until the same mutation-capable idempotency proof is checked against
production-owned inputs.

## Claim

The release verifier shape must carry exactly one hash-only idempotency
route-evidence summary. Mutation-capable apply and recovery evidence must prove
the idempotency key is present, fresh, single-valued, and bound to the signed
request before JSON parsing, receipt work, mutation-capable work, or release
movement can start.

## Proof Surface

`test/rpp-0595-idempotency-key-requirement-v5.test.js` adds a deterministic
local verifier harness for the production-shaped mutation-capable route pair.
The accepted path is authorization-only: it validates signed request evidence,
session binding, idempotency binding, freshness, and signature continuity, then
stops before parser, receipt, mutation, or release-movement counters can
advance.

The negative matrix sends malformed payload material with missing, malformed,
stale, duplicated, and drifted idempotency evidence across the route pair. Each
case fails before JSON parsing, receipt work, mutation-capable work, mutation
side effects, or release movement.

## Proven Behavior

- Accepted mutation-capable route evidence records two signed route checks,
  both session-bound and idempotency-bound, with route aliases, method,
  route-location, session, idempotency, request, canonical request, timestamp,
  nonce, and signature evidence stored as hashes.
- The generated `verify:release`-shaped support summary contains exactly one
  production idempotency-key route-evidence summary and remains `NO-GO`.
- Missing, malformed, stale, duplicated, and drifted idempotency evidence fails
  closed with zero JSON parse attempts, zero receipt work attempts, zero apply
  work attempts, zero recovery mutation work attempts, zero mutation side
  effects, and zero release movement attempts.
- Spoofed route evidence that claims success while omitting the idempotency
  hash, carrying a malformed idempotency hash, marking stale or duplicated
  evidence as accepted, or breaking idempotency signature binding is blocked
  with `IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE`.
- Raw credentials, usernames, source locations, sessions, signing keys,
  idempotency keys, nonces, request bodies, bearer tokens, file locations,
  row values, journal payloads, and secrets are absent from the generated
  evidence.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0595-idempotency-key-requirement-v5.test.js
node --test --test-name-pattern RPP-0595 test/rpp-0595-idempotency-key-requirement-v5.test.js
node --test --test-name-pattern RPP-0575 test/rpp-0575-idempotency-key-requirement-v4.test.js
node --test --test-name-pattern RPP-0555 test/rpp-0555-idempotency-key-requirement-v3.test.js
node --test --test-name-pattern RPP-0616 test/rpp-0616-different-body-idempotency-conflict.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0595-idempotency-key-requirement-v5.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0595 run
reported 3 passes / 0 failures. The adjacent RPP-0575 run reported
3 passes / 0 failures, the adjacent RPP-0555 run reported 3 passes /
0 failures, and the adjacent RPP-0616 run reported 1 pass / 0 failures.
The scoped artifact redaction scan returned `"ok": true`; both whitespace
checks returned no findings.

## Boundary

This proof is intentionally local and support-only. It does not use live
endpoints, production credentials, public ingress, remote tunnels, or
network-dependent evidence. Integration should remain blocked until a checked
production-owned release verifier supplies the same single-summary,
mutation-capable idempotency-key evidence on the release path.
