# RPP-0581 production preflight route release verifier, variant 5

Date: 2026-05-31

Status: release-verifier live-endpoint support evidence only. Final release
remains **NO-GO** until equivalent proof is checked against production-owned
URL and credential inputs.

## Claim

The RPP-0561 production preflight route proof is carried through a
release-verifier-shaped envelope and the positive proof exercises a real live
HTTP endpoint. The live endpoint is loopback-only inside the sandbox and is not
production-owned, so it supports route verification but cannot move release
posture.

## Proof Surface

`test/rpp-0581-production-preflight-route-release-verifier-v5.test.js` adds
three focused checks:

- source assertions keep the production preflight route registered as a signed
  authenticated `GET` route and keep the release verifier's explicit preflight
  check before the full push runner;
- a loopback-only HTTP fixture handles
  `GET /wp-json/reprint/v1/push/preflight`, validates Basic auth plus signed
  preflight headers, and returns production-shaped auth/session evidence; and
- missing or malformed preflight route evidence remains blocked before release
  movement.

No public listener, tunnel, remote ingress, package metadata, progress surface,
or shared release gate surface is changed.

## Proven Behavior

- The positive proof makes a real HTTP request to a live loopback endpoint.
- Route evidence records the production-shaped preflight path, signed `GET`
  state, route profile, namespace, route prefix, and live endpoint check as
  hashes, booleans, counts, or lengths.
- Auth evidence binds credential hash, user-login hash, identity hash, session
  hash, session expiry hash, source hash, and source URL hash.
- The preflight request carries no push session header and no idempotency key.
- The fixture records one request, one auth attempt, one session-mint phase,
  one snapshot-hash-read phase, and zero mutation-capable work attempts.
- The release-verifier envelope carries exactly one `productionPreflightRoute`
  summary and exactly one matching route-evidence block.
- Missing route evidence returns `PREFLIGHT_ROUTE_PROOF_REQUIRED`.
- Malformed route evidence returns `PREFLIGHT_ROUTE_PROOF_MALFORMED`.
- Source URL, endpoint URL, credentials, username, session id, signing key, and
  nonce are absent from the public verifier summary.
- Release posture remains `NO-GO`; `releaseMovement.allowed` remains `false`.

## Validation

Commands run for this slice:

```sh
node --check test/rpp-0581-production-preflight-route-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0581 test/rpp-0581-production-preflight-route-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0561 test/rpp-0561-production-preflight-route-v4.test.js
node --test --test-name-pattern RPP-0541 test/rpp-0541-production-preflight-route-v3.test.js
node --test test/production-preflight-route.test.js
node --test test/release-verifier-preflight-route-carry-through-focused-regression.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0581-production-preflight-route-release-verifier-v5.md
git diff --check
```

Observed result: all listed commands exited 0. The focused RPP-0581 test
reported 3 passes / 0 failures. The adjacent RPP-0561 and RPP-0541 tests, the
shared production preflight route regression, and the release-verifier
preflight carry-through regression all passed. The scoped artifact redaction
scan returned `"ok": true`, and whitespace checks returned no findings.

## Boundary

This is support-only release-verifier evidence. The loopback fixture satisfies
the live endpoint test requirement for this slice, but it is not a
production-owned endpoint and it does not prove production credential
reachability. Promotion still requires checked evidence from a production-owned
endpoint with production credential inputs; until then the release posture is
**NO-GO**.
