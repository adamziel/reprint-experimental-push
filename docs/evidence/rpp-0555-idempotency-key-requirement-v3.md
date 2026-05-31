# RPP-0555 idempotency key requirement, variant 3

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same idempotency-key route proof is checked against
production-owned inputs.

## Claim

The generated idempotency-key proof must carry one hash-only route-evidence
block into a `verify:release`-shaped summary. Mutating signed routes must
require an idempotency key, and read-only signed routes must reject any mutating
idempotency key. The proof must not carry raw idempotency keys, sessions,
credential material, full URLs, request bodies, signatures, nonces, or other
private values.

## Proof Surface

`test/rpp-0555-idempotency-key-requirement-v3.test.js` adds three generated
checks:

- a deterministic local client run signs mutating dry-run/apply requests with
  idempotency-key hashes while signing recovery inspect and DB-journal reads
  without mutating idempotency material;
- a generated negative matrix proves dry-run/apply fail closed before transport
  when the mutating idempotency key is missing or invalid, and read-only
  recovery inspect / DB-journal routes fail closed when an idempotency key is
  supplied; and
- a spoofed-success case proves the `verify:release`-shaped summary remains
  `NO-GO` unless the route-evidence block carries both mutating and read-only
  contract evidence.

No listener, tunnel, live endpoint, credential, production URL, or
network-dependent evidence is used. The generated receipt stores route names,
methods, route paths, booleans, counts, and SHA-256 hashes only.

## Proven Behavior

- Mutating signed `POST /push/dry-run` and `POST /push/apply` require a push
  session plus an idempotency key before transport.
- Read-only signed `POST /push/recovery/inspect` and
  `GET /push/db-journal?limit=80` require a push session and reject mutating
  idempotency material before transport.
- The generated route evidence includes session hashes, idempotency-key hashes
  only when a mutating route legitimately carries one, request hashes, and
  hashed signature evidence. It does not include raw header values.
- The `verify:release`-shaped support summary contains exactly one
  `productionIdempotencyKeyRequirement` route-evidence block.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0555-idempotency-key-requirement-v3.test.js
node --test --test-name-pattern RPP-0555 test/rpp-0555-idempotency-key-requirement-v3.test.js
node --test --test-name-pattern 'idempotency|RPP-0515|RPP-0535' test/authenticated-http-push-client.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0555-idempotency-key-requirement-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0555 test reported
3 passes / 0 failures. The adjacent authenticated client idempotency bundle
reported 6 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`; both whitespace checks returned no findings.

## Boundary

This proof is intentionally generated support evidence. It does not claim
production durability, external endpoint coverage, or release readiness.
Promotion requires the same single-summary idempotency-key route evidence from
a checked production-owned endpoint with valid production credentials.
