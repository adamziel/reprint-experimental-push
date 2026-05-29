# RPP-0501 production preflight route evidence

RPP-0501 adds focused evidence toward the executor-auth production preflight route boundary.

## Scope

- Confirmed `GET /wp-json/reprint/v1/push/preflight` is registered under the production-shaped `reprint/v1` namespace with the authenticated Application Password permission callback.
- Confirmed unsigned production preflight requests return before auth/session evidence and live snapshot hash evidence are built.
- Added a live Playground smoke script that starts a sandbox-local loopback WordPress URL, discovers the route in the REST index, sends an unsigned negative request, and then sends a signed preflight request through the production-shaped client.

## Live endpoint proof

- Command: `node scripts/playground/production-preflight-route-live-smoke.mjs`
- Observed result: exit 0; the script exercised the real `GET /wp-json/reprint/v1/push/preflight` endpoint on a live sandbox-local loopback WordPress server.
- The successful response reported `routeProfile.profile: production-shaped`, `restNamespace: reprint/v1`, `routePrefix: /push`, a `production-auth-session`, hash-length-only session evidence, and `sessionStore.type: wp-options`.
- The live URL stayed on local loopback with no remote tunnel. The exact local port is intentionally not published in this evidence artifact; port 8080 was already occupied in the sandbox during validation, so the script used an ephemeral loopback port.

## Focused validation commands

- `php -l scripts/playground/push-remote-rest-plugin.php` — exit 0.
- `node --test test/production-preflight-route.test.js` — exit 0, 3 subtests.
- `node scripts/playground/production-preflight-route-live-smoke.mjs` — exit 0, live loopback endpoint proof.
- `node --test test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js` — exit 0, 14 subtests.
- `node scripts/release/checklist-completion-lint.mjs` — exit 0.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0501-production-preflight-route.md docs/reprint-push-completion-checklist.md` — exit 0.
- `git diff --check` — exit 0.

## Residual risks

- The live proof is sandbox-local loopback WordPress Playground coverage, not an externally reachable production host.
- The route still reports `labBacked: true` under the mounted Playground harness; packaged-plugin production hardening remains outside this slice.
