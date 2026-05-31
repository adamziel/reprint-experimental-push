# RPP-0541 production preflight route, variant 3

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO** until
the same preflight route proof is checked against production-owned URL and
credential inputs.

## Claim

The production-shaped preflight route can be represented by local proof shaped
like the real endpoint while remaining support-only. The proof must not expose
raw source, credential, session, or preflight values, and missing or stale
preflight proof must fail closed before any follow-up route work.

## Proof Surface

`test/rpp-0541-production-preflight-route-v3.test.js` adds three generated
checks:

- accepted signed `GET /wp-json/reprint/v1/push/preflight` evidence is wrapped
  as `real-endpoint-shaped-local-route` support evidence with `status:
  support_only`;
- missing session proof and expired preflight session proof stop before snapshot
  or dry-run requests; and
- auth failure evidence remains hash-only and keeps release movement blocked.

The test uses mocked fetch responses and the existing authenticated client /
executor paths. No listener, tunnel, public ingress, or remote network exposure
is started.

## Proven Behavior

- The accepted local proof reaches the production-shaped path
  `/wp-json/reprint/v1/push/preflight` using the `production-shaped` route
  profile, namespace `reprint/v1`, prefix `/push`, and signed request headers.
- Source URL, credential, user login, session id, session expiry, route proof,
  and preflight proof values are represented by SHA-256 hashes or lengths.
- Raw source, credential, idempotency, session, and signing-key values are
  absent from the support summary.
- Missing preflight session proof returns `PREFLIGHT_SESSION_MISSING` before
  snapshot or dry-run work.
- Expired preflight session proof returns
  `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` before snapshot or dry-run work.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0541-production-preflight-route-v3.test.js
node --test --test-name-pattern RPP-0541 test/rpp-0541-production-preflight-route-v3.test.js
node --test test/production-preflight-route.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0541-production-preflight-route-v3.md
git diff --check
```

Observed result: all commands exited 0. The focused RPP-0541 test reported
3 passes / 0 failures. The adjacent production preflight route test reported
5 passes / 0 failures. The scoped artifact redaction scan returned
`"ok": true`, and whitespace checks returned no findings. The evidence itself
remains local-lab support evidence and cannot move release gates.

## Boundary

This proof does not claim production durability or release readiness. Promotion
requires the same route evidence from a checked production-owned endpoint with
valid production credentials; until then the release posture is **NO-GO**.
