# RPP-0527 production recovery mutate route proof v2

Date: 2026-05-30

## Scope

RPP-0527 proves the existing production recovery mutate route auth boundary with
focused source assertions and a sandbox-local live endpoint smoke. No production
route mutation executor is added in this slice.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/production-recovery-mutate-route.test.js` | Local focused route/auth proof | Pins `POST /wp-json/reprint/v1/push/recovery/mutate`, the authenticated permission callback, signed-request ordering, negative signature codes before nonce/session mutation, and the smoke script contract. |
| `scripts/playground/production-recovery-mutate-auth-smoke.mjs` | Production-shaped live endpoint proof on sandbox-local loopback | Starts WordPress Playground on `127.0.0.1`, discovers `/reprint/v1/push/recovery/mutate`, sends malformed JSON-shaped raw bodies through negative auth paths, and compares target-surface/journal state before and after. |
| External production endpoint | Not live production-backed in this worker | The proof is production-shaped and sandbox-local; no external host or remote tunnel was used. |

## Behavior covered

- REST discovery proves the route exists at `/reprint/v1/push/recovery/mutate` with `POST`.
- Missing Application Password auth fails in `permission_callback` with `401 reprint_push_lab_auth_required` before the route callback can parse JSON.
- Authenticated requests with missing signed headers fail with `401 SIGNED_HEADER_REQUIRED` before `reprint_push_lab_rest_recovery_mutate()` can call `reprint_push_lab_rest_json_payload($request)`.
- Bad signed content and bad auth signature paths fail with `SIGNED_CONTENT_HASH_MISMATCH` and `SIGNED_AUTH_SIGNATURE_MISMATCH` before nonce/session mutation or recovery mutation can run.
- The live smoke uses a malformed JSON-shaped raw body with `text/plain`; this intentionally avoids WordPress core's pre-dispatch invalid-JSON rejection so the route auth floor itself is exercised. Source-level assertions pin the route JSON parser behind the signed guard.
- The live smoke reports `targetSurfaceStable: true`, unchanged target-surface hashes, unchanged DB journal row count, and `mutationAttempted: false`.
- The smoke binds the server to sandbox-local loopback and reports `tunnel: none`.

## Validation observed

```sh
node --check test/production-recovery-mutate-route.test.js && node --check scripts/playground/production-recovery-mutate-auth-smoke.mjs
php -l scripts/playground/push-remote-rest-plugin.php
node --test --test-name-pattern=RPP-0527 test/production-recovery-mutate-route.test.js
node scripts/playground/production-recovery-mutate-auth-smoke.mjs
node --test test/production-recovery-mutate-route.test.js test/production-snapshot-hashes-route.test.js
node --test test/production-preflight-route.test.js test/production-snapshot-hashes-route.test.js test/production-dry-run-route.test.js test/production-apply-route.test.js test/production-recovery-mutate-route.test.js
node --test --test-name-pattern='^authenticated push client (requires an explicit session and idempotency key for mutating requests|signs mutating requests when session and idempotency are present|retries idempotent signed posts after a transient (transport failure|timeout))$' test/authenticated-http-push-client.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0527-production-recovery-mutate-route-v2.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: each command exited 0. The focused RPP-0527 Node test reported
2 subtests ok; the recovery mutate + snapshot route bundle reported 9 subtests
ok; the production route auth bundle reported 21 subtests ok; and the focused
mutating authenticated client bundle reported 4 subtests ok. The live smoke
returned `ok: true`; negative cases returned `401` with
`reprint_push_lab_auth_required`, `SIGNED_HEADER_REQUIRED`,
`SIGNED_CONTENT_HASH_MISMATCH`, and `SIGNED_AUTH_SIGNATURE_MISMATCH`; the target
surface hash and DB journal row count were unchanged. Checklist lint and the
scoped artifact redaction scan both returned `ok: true`.

## Residual risks

- This remains production-shaped sandbox-local WordPress Playground proof, not an
  externally reachable production host proof.
- The route remains fail-closed with `RECOVERY_MUTATE_NOT_IMPLEMENTED` after
  successful auth and inspect-first classification; implementing a mutating
  recovery repair executor remains separate future work.
