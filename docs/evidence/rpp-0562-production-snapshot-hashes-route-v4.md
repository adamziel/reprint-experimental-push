# RPP-0562 production snapshot hashes route, variant 4

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same snapshot-hashes route proof is checked against production-owned
URL and credential inputs.

## Claim

The production snapshot-hashes route rejects negative auth, signature, and
session cases before JSON parsing and before mutation-capable work. Accepted
support evidence remains planning-only, read-only, hash-only, and blocked from
release movement.

## Proof Surface

The focused regression proof adds three local checks:

- source-order assertions keep the production-shaped route behind authenticated
  permission, signed-request verification, and the pre-dispatch auth guard
  before payload parsing;
- malformed-body negative cases cover missing auth, wrong auth, missing signed
  headers, missing session, content-hash mismatch, auth-signature mismatch,
  push-signature mismatch, and invalid session; and
- accepted support evidence for the snapshot-hashes route remains
  planning-only/read-only with release gates closed.

No listener, tunnel, public ingress, live endpoint, production credential, or
network-dependent evidence was used.

## Proven Behavior

- Negative cases return auth, signature, or session failure codes before JSON
  parsing. The malformed payload would fail if parsed, but the proof records
  zero JSON parse attempts.
- Negative cases record zero snapshot-hash work attempts and zero
  mutation-capable work attempts.
- Negative responses emit no snapshot hash, snapshot hash set, coverage,
  resources, page hash, or snapshot-hashes receipt evidence.
- Accepted support evidence is tagged `local-lab-support`, `support_only`, and
  `NO-GO`; `releaseMovement.allowed` remains false.
- Accepted support evidence proves `planningOnly.readOnly` is true and
  `planningOnly.mutates` is false.
- Source, credential, identity, session, signing key, idempotency, route,
  request body, execution phase, snapshot, coverage, page, and receipt evidence
  are represented by hashes or lengths only.
- Raw credential material, user names, source locations, session values,
  signing material, idempotency values, nonces, request bodies, row values,
  journal payloads, and secrets are absent from support summaries.

## Validation

Commands run for this slice were the required local syntax check, the focused
RPP-0562 test run, the adjacent RPP-0542 focused test run, the production
snapshot-hashes route test, the scoped evidence redaction scan, and whitespace
checks for both unstaged and staged diffs.

Observed result: syntax checking exited 0. The focused RPP-0562 test reported
3 passes / 0 failures. The adjacent RPP-0542 test reported 3 passes / 0
failures. The production snapshot-hashes route test reported 7 passes / 0
failures. The scoped artifact redaction scan returned `"ok": true`, and
whitespace checks returned no findings.

## Boundary

This remains support-only regression evidence. It does not claim production
durability, production endpoint reachability, or release readiness. Promotion
requires fresh production-owned endpoint and credential proof; until then the
release posture is **NO-GO**.
