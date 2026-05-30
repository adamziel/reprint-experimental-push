# RPP-0524 production apply route proof v2

Date: 2026-05-30

## Scope

RPP-0524 proves the existing production-shaped apply route with focused source
assertions and a live sandbox-local endpoint smoke run.

## Proof classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `test/production-apply-route.test.js` | Local focused route proof | Source-level assertions pin the registered `POST /wp-json/reprint/v1/push/apply` route, authenticated permission callback, signed-request ordering, apply-time live-source revalidation, and the live smoke behavior. |
| `scripts/playground/production-apply-route-live-smoke.mjs` | Production-shaped live endpoint proof on sandbox-local loopback | Starts WordPress Playground on `127.0.0.1` with an ephemeral local port, discovers `/reprint/v1/push/apply` in the REST index, checks unauthenticated and unsigned apply requests fail closed without mutation, then sends a signed production-shaped dry-run/apply sequence through the authenticated client. |
| External production endpoint | Not live production-backed in this worker | The observed route response reported `labBacked: true`; no external production host or remote tunnel was used. |

## Behavior covered

- REST discovery proves `/reprint/v1/push/apply` exists with `POST`.
- An unauthenticated apply returns `401` with `reprint_push_lab_auth_required` and leaves the snapshot unchanged.
- An Application Password-authenticated but unsigned apply returns `401` with `SIGNED_HEADER_REQUIRED`, reports `mode: apply`, and leaves the snapshot unchanged.
- The pre-apply DB journal has zero `mutation-applied` rows, proving the unauthorized requests did not enter the mutation path.
- The authenticated client uses route profile `production-shaped` and reaches `/wp-json/reprint/v1/push/apply` for the signed apply request.
- The signed apply response reports `production-auth-session`, `freshMutationWork: true`, `applied: 7`, and apply revalidation at `phase: before-first-mutation` checked against `live-remote` with 64-character hash evidence.
- The final snapshot matches the planned local surface, and DB journal evidence contains `apply-started`, `apply-committed`, and seven `mutation-applied` rows.
- The live smoke summary records proof scope as sandbox-local loopback with `tunnel: none`; no remote tunnel or public ingress is involved.

## Validation observed

```sh
node --check scripts/playground/production-apply-route-live-smoke.mjs
node --check test/production-apply-route.test.js
node --test test/production-apply-route.test.js
node scripts/playground/production-apply-route-live-smoke.mjs
node --test test/production-apply-route.test.js test/production-dry-run-route.test.js test/production-preflight-route.test.js test/authenticated-http-push-client.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0524-production-apply-route-v2.md docs/reprint-push-completion-checklist.md
```

Observed result: each command exited 0. The focused Node test reported 5 subtests
ok. The live smoke exercised the real production-shaped apply endpoint on a
sandbox-local WordPress URL and returned `ok: true`, unauthenticated and unsigned
apply statuses `401`, `mutationEventsBeforeApply: 0`, `apply.status: 200`,
`requestPath: /wp-json/reprint/v1/push/apply`, `authSessionType:
production-auth-session`, `freshMutationWork: true`, `applyRevalidation.phase:
before-first-mutation`, `checkedAgainst: live-remote`, and `finalMatchesLocal:
true`. The adjacent route/auth bundle reported 145 subtests ok. Checklist lint
returned `ok: true`, and the scoped artifact redaction scan returned `ok: true`.

## Residual risks

- This is production-shaped, sandbox-local live endpoint proof rather than an
  externally reachable production host proof.
- The live route response still reports `labBacked: true`, so packaged-plugin
  and external production-backed verification remain separate checklist work.
