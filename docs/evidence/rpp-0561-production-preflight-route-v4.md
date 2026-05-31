# RPP-0561 production preflight route, variant 4

Date: 2026-05-31

Status: local-lab support evidence only. Final release remains **NO-GO**
until the same preflight proof is checked against a production-owned live URL
and production credential inputs.

## Claim

The production preflight route must remain a signed `GET` route with exact
production-shaped route evidence. Local proof can support regression coverage,
but it cannot move release gates unless a production-owned live endpoint is
available and bound to the same credential, identity, session, and source
hashes.

## Proof Surface

`test/rpp-0561-production-preflight-route-v4.test.js` adds four focused checks:

- source assertions pin the production preflight registration to the
  production-shaped namespace, signed preflight verifier, authenticated
  permission callback, and read-only callback path;
- accepted deterministic local preflight proof is wrapped as
  `real-endpoint-shaped-local-route` support evidence with an exact
  `routeEvidence` shape;
- identity, auth-session, and source-hash drift are blocked before release
  movement; and
- an unavailable required live preflight endpoint fails closed without snapshot,
  dry-run, apply, or mutation-capable follow-up work.

No listener, tunnel, public ingress, live endpoint, production credential, or
remote network proof is used.

## Proven Behavior

- Route evidence records method `GET`, path
  `/wp-json/reprint/v1/push/preflight`, route name `/push/preflight`, namespace
  `reprint/v1`, route prefix `/push`, profile `production-shaped`, signed
  request state, and a route proof hash.
- Support evidence keeps `releaseStatus: NO-GO`,
  `releaseMovement.allowed: false`, and `mutationAttempted: false`.
- Local support proof records that a live production URL is required and not
  supplied for accepted local-lab evidence.
- Auth evidence binds credential hash, user-login hash, identity hash, session
  hash, session expiry hash, source hash, and source URL hash.
- Preflight requests do not carry a push session header or idempotency key; the
  preflight route mints the short-lived session and records zero
  mutation-capable work attempts.
- Auth-session, identity, and source drift return
  `PREFLIGHT_AUTH_SESSION_SOURCE_BINDING_REQUIRED`.
- Unavailable live endpoint handling returns
  `LIVE_PREFLIGHT_ENDPOINT_UNAVAILABLE`, keeps the run at preflight, and does
  not attempt snapshot, dry-run, apply, or release-state mutation work.
- Source, credential, username, session, signing-key, idempotency, nonce, live
  endpoint, route proof, preflight proof, and execution phase values are stored
  as hashes, booleans, counts, status values, or lengths only.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0561-production-preflight-route-v4.test.js
node --test --test-name-pattern RPP-0561 test/rpp-0561-production-preflight-route-v4.test.js
node --test --test-name-pattern RPP-0541 test/rpp-0541-production-preflight-route-v3.test.js
node --test test/production-preflight-route.test.js
node --test --test-name-pattern RPP-0562 test/rpp-0562-production-snapshot-hashes-route-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0561-production-preflight-route-v4.md
git diff --check
```

Observed result: all listed commands exited 0. The focused RPP-0561 test run,
adjacent preflight v3 route proof, production preflight route regression, and
nearest v4 route regression all passed. The scoped artifact redaction scan
returned `"ok": true`, and whitespace checks returned no findings.

## Boundary

This proof is support-only regression coverage. It does not claim production
durability, production endpoint reachability, or release readiness. Promotion
requires equivalent preflight evidence from a checked production-owned endpoint
with valid production credentials; until then the release posture is **NO-GO**.
