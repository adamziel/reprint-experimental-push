# RPP-0521 production preflight route proof v2

Date: 2026-05-30

## Scope

RPP-0521 proves the existing production preflight route behavior with a focused
route test and a live sandbox-local endpoint smoke run.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/production-preflight-route.test.js` | Local focused route proof | Source-level assertions pin the registered `GET /wp-json/reprint/v1/push/preflight` route, authenticated permission callback, signed-request ordering, and the live smoke script behavior. |
| `scripts/playground/production-preflight-route-live-smoke.mjs` | Production-shaped live endpoint proof on sandbox-local loopback | Starts WordPress Playground on `127.0.0.1` with an ephemeral port, discovers `/reprint/v1/push/preflight` in the REST index, checks unsigned rejection, then sends a signed production-shaped preflight request through the authenticated client. |
| External production endpoint | Not live production-backed in this worker | The observed route response reported `labBacked: true`; no external production host or remote tunnel was used. |

## Behavior covered

- REST discovery proves the route exists at `/reprint/v1/push/preflight` with `GET`.
- An authenticated but unsigned request returns `401` with `SIGNED_HEADER_REQUIRED` before snapshot evidence is built.
- The signed request uses the production-shaped client route profile and reaches `/wp-json/reprint/v1/push/preflight`.
- The response reports `routeProfile.profile: production-shaped`, namespace `reprint/v1`, prefix `/push`, `production-auth-session`, `sessionStore.type: wp-options`, and hash-length-only session/snapshot evidence.
- The live smoke summary records proof scope as sandbox-local loopback with `tunnel: none`; no remote tunnel or public ingress is involved.

## Validation observed

```sh
php -l scripts/playground/push-remote-rest-plugin.php
node --test test/production-preflight-route.test.js
node scripts/playground/production-preflight-route-live-smoke.mjs
node --test test/production-preflight-route.test.js test/route-proof-matrix.test.js test/authenticated-http-push-client.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0521-production-preflight-route-v2.md docs/reprint-push-completion-checklist.md
```

Observed result: each command exited 0. The focused Node test reported 5 subtests
ok. The route/client regression bundle reported 140 subtests ok. The live smoke
exercised the real production-shaped preflight endpoint on a sandbox-local
WordPress URL and returned `status: 200`, `ok: true`, `routeProfile.profile:
production-shaped`, `session.type: production-auth-session`, and 64-character
hash evidence for the session, signing key, and snapshot. Checklist lint and the
scoped artifact redaction scan both returned `ok: true`.

## Residual risks

- This is production-shaped, sandbox-local live endpoint proof rather than an
  externally reachable production host proof.
- The live route response still reports `labBacked: true`, so packaged-plugin
  and external production-backed verification remain separate checklist work.
