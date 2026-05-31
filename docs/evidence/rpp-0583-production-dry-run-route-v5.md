# RPP-0583 production dry-run route, variant 5

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the release verifier carries equivalent dry-run route receipt binding
evidence from checked production-owned URL and credential inputs.

## Claim

The release verifier must carry production dry-run route evidence through a
single summary, and any dry-run receipt used before apply-capable work must bind
the current subject/session, authenticated identity, requested scope, and
canonical plan hash.

## Proof Surface

`test/rpp-0583-production-dry-run-route-v5.test.js` adds three focused checks:

- production route source ordering keeps signed dry-run receipt binding and
  apply receipt validation before apply-capable work;
- a deterministic production-shaped dry-run route run is carried through one
  release-verifier support summary with route, request, receipt, subject,
  identity, session, scope, and plan-hash bindings; and
- missing or malformed receipt binding fields fail closed before trusted
  receipt, apply-capable, or mutation-capable counters advance.

The local run uses mocked fetch responses and the existing authenticated push
runner. It does not start a listener, use live endpoints, expose a tunnel, or
depend on external network state.

## Hash-Only Evidence Boundary

The support summary records SHA-256 hashes, hash lengths, booleans, counts,
status values, and deterministic result codes. It excludes raw source URLs,
credential material, user names, push sessions, idempotency keys, nonce values,
route paths, request bodies, fixture paths, and plan bodies.

## Proven Behavior

- The release-verifier summary count is one, mode is dry-run, and the carried
  route profile is production-shaped.
- The dry-run receipt hash matches the verifier dry-run summary receipt hash.
- The receipt plan hash matches the canonical plan hash.
- The subject binding matches scope hash, identity hash, auth-session hash,
  push-session hash, plan hash, and binding hash.
- Request evidence binds dry-run content hash, raw-body hash, canonical hash,
  idempotency-key hash, and plan-payload hash.
- Missing or malformed subject, scope, identity, session, plan-hash, route, and
  receipt-hash binding fields are blocked before apply-capable work.
- Release movement remains disabled with `NO-GO` posture.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0583-production-dry-run-route-v5.test.js
node --test --test-name-pattern RPP-0583 test/rpp-0583-production-dry-run-route-v5.test.js
node --test --test-name-pattern RPP-0563 test/rpp-0563-production-dry-run-route-v4.test.js
node --test --test-name-pattern RPP-0543 test/rpp-0543-production-dry-run-route-v3.test.js
node --test test/production-dry-run-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0583-production-dry-run-route-v5.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0583 test reported
3 passes / 0 failures. The adjacent RPP-0563 and RPP-0543 regression runs each
reported 3 passes / 0 failures. The production dry-run route regression
reported 6 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`, and both whitespace checks returned no findings.

## Boundary

This proof is support-only and does not claim production durability or release
readiness. Promotion requires equivalent release-verifier receipt binding proof
from checked production-owned dry-run route inputs; until then the release
posture is **NO-GO**.
