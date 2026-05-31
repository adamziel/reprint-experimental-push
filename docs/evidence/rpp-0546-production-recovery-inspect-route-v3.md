# RPP-0546 production recovery inspect route, variant 3

Date: 2026-05-31

Status: local executor/auth support evidence only. Final release remains
**NO-GO** until the same recovery-inspect route proof is checked against
production-owned URL and credential inputs.

## Claim

The generated production recovery-inspect proof must model a real endpoint
shape without claiming production proof. The route evidence must remain
read-only, session-bound, idempotency-free, hash-only, and blocked from release
movement until checked production evidence exists.

## Proof Surface

`test/rpp-0546-production-recovery-inspect-route-v3.test.js` adds three
generated checks:

- an accepted signed `POST /wp-json/reprint/v1/push/recovery/inspect` request
  is wrapped as local executor/auth support evidence with `status:
  support_only` and `releaseStatus: NO-GO`;
- malformed-body negative auth cases fail before JSON parsing, recovery-inspect
  read work, recovery write paths, or mutation side effects; and
- missing, stale, expired-session, or legacy idempotency-bound route evidence is
  blocked before release movement.

No listener, tunnel, public ingress, live endpoint, production credential, or
remote network-only evidence is used. The fixture records only route metadata,
booleans, counts, lengths, and SHA-256 hashes.

## Proven Behavior

- The accepted local proof reaches
  `/wp-json/reprint/v1/push/recovery/inspect` with method `POST`, route profile
  `production-shaped`, namespace `reprint/v1`, and route prefix `/push`.
- The accepted request is signed and session-bound while carrying no mutating
  idempotency key.
- Recovery rows and recovery classification state stay stable across the read.
- Negative auth cases cover missing Basic auth, wrong Basic auth, missing
  signed headers, missing push session, legacy idempotency key, content-hash
  mismatch, auth-signature mismatch, invalid push session, and push-signature
  mismatch.
- Negative malformed-body cases record zero JSON parse attempts, zero
  recovery-inspect read attempts, zero recovery write path attempts, and zero
  mutation side effects.
- Source, credential, user login, user id, session id, session expiry, signing
  material, idempotency value, request body, plan data, receipt data, journal
  claim, storage guard, ownership, writer lease, and lease-fence values are
  excluded from support summaries or represented as SHA-256 hashes.
- The support summary carries an explicit no-production-proof caveat.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0546-production-recovery-inspect-route-v3.test.js
node --test --test-name-pattern RPP-0546 test/rpp-0546-production-recovery-inspect-route-v3.test.js
node --test --test-name-pattern '^authenticated push (client (signs recovery inspect as a read-only|rejects mutating idempotency keys on read-only inspect requests|retries read-only signed recovery inspect)|executor can run recovery and journal inspect as idempotency-free signed reads)' test/authenticated-http-push-client.test.js
node --test --test-name-pattern RPP-0547 test/rpp-0547-production-recovery-mutate-route-v3.test.js
node --test test/release-gate-recovery-inspect-read-only-generated.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0546-production-recovery-inspect-route-v3.md
git diff --check
git diff --cached --check
```

Observed result: the RPP-0546 syntax check and focused generated test exited
0. The focused authenticated-client read-only inspect coverage exited 0. The
adjacent RPP-0547 recovery-mutate generated route coverage exited 0. The
adjacent generated recovery-inspect release-gate test required approved
execution because its nested node checker is blocked by the default sandbox,
then exited 0 with 2 passes / 0 failures. The scoped artifact redaction scan
returned `"ok": true`, and whitespace checks returned no findings.

## Boundary

This proof is intentionally generated support evidence. It does not prove a
production endpoint, production durability, live credentials, external network
behavior, or release readiness. Promotion requires the same read-only
recovery-inspect route evidence from a checked production-owned endpoint with
valid production credentials; until then the recommendation is **NO-GO**.
