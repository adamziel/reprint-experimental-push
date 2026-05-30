# RPP-0523 production dry-run route proof v2

Date: 2026-05-30

## Scope

RPP-0523 proves the existing production dry-run route behavior with a focused
route test and a live sandbox-local endpoint smoke run.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/production-dry-run-route.test.js` | Local focused route proof | Source-level assertions pin the registered `POST /wp-json/reprint/v1/push/dry-run` route, authenticated permission callback, signed-request ordering, receipt subject binding, and live smoke behavior. |
| `scripts/playground/production-dry-run-route-live-smoke.mjs` | Production-shaped live endpoint proof on sandbox-local loopback | Starts WordPress Playground on `127.0.0.1` with an ephemeral port, discovers `/reprint/v1/push/dry-run` in the REST index, checks unsigned rejection, then sends a signed production-shaped dry-run request through the authenticated client. |
| External production endpoint | Not live production-backed in this worker | The observed route response reported `labBacked: true`; no external production host or remote tunnel was used. |

## Behavior covered

- REST discovery proves the route exists at `/reprint/v1/push/dry-run` with `POST`.
- An authenticated but unsigned request returns `401` with `SIGNED_HEADER_REQUIRED` and does not mint a receipt.
- The signed request uses the production-shaped client route profile and reaches `/wp-json/reprint/v1/push/dry-run`.
- The dry-run receipt binds the current scope, authenticated identity, production auth session, push session hash, and canonical plan hash.
- The receipt subject binding reports 64-character hash evidence for scope, identity, auth session, push session, plan, and binding hash values.
- The smoke verifies the dry-run route is non-mutating by comparing the post-dry-run visible source surface to the base snapshot.
- The live smoke summary records proof scope as sandbox-local loopback with `tunnel: none`; no remote tunnel or public ingress is involved.

## Validation observed

```sh
php -l scripts/playground/push-remote-rest-plugin.php
node --check scripts/playground/production-dry-run-route-live-smoke.mjs
node --test test/production-dry-run-route.test.js
node scripts/playground/production-dry-run-route-live-smoke.mjs
node --test test/production-dry-run-route.test.js test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-apply-route.test.js test/authenticated-http-push-client.test.js test/route-proof-matrix.test.js test/short-lived-push-session.test.js test/session-source-url-binding.test.js test/rpp-0510-session-user-identity-binding.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0523-production-dry-run-route-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: each command exited 0. The focused Node test reported 6
subtests ok, and the adjacent route/auth/session regression bundle reported
164 subtests ok. The live smoke exercised the real production-shaped dry-run
endpoint on a sandbox-local WordPress URL and returned `status: 200`, `ok:
true`, `mode: dry-run`, `routeProfile: production-shaped`, session type
`production-auth-session`, 7 ready-plan mutations, a 64-character receipt hash,
matching plan hash evidence, 64-character subject-binding hash lengths, and
`finalMatchesBase: true` after the dry-run. Checklist lint and the scoped
artifact redaction scan both returned `ok: true`.

## Residual risks

- This is production-shaped, sandbox-local live endpoint proof rather than an
  externally reachable production host proof.
- The live route response still reports `labBacked: true`, so packaged-plugin
  and external production-backed verification remain separate checklist work.
