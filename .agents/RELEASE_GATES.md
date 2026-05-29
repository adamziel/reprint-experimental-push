# Release Gates

Release objective: prove a production-owned, non-lab-backed Reprint push boundary that can safely mutate a live source site without data loss.

Status values: `unproven`, `support_only`, `partially_proven`, `proven`, `blocked`.

`release_verdict`: `0/4`

Last refreshed: 2026-05-28 02:24 CEST on
`lane/evidence-integration-20260527`.

## GATE-1: Production Executor/Auth Boundary

Status: `support_only`

A real Reprint endpoint, not lab-only route scaffolding, must prove preflight, dry-run, apply, auth/session issuance, auth/session readback, request signing or equivalent integrity, and capability/identity binding on the same live source URL.

## GATE-2: Durable Recovery Journal Boundary

Status: `support_only`

The same release path must prove durable restart-readable journal ownership with lease fencing. It must distinguish old/new/blocked states after restart and must not overwrite preserved remote changes.

## GATE-3: Live Docker/Playground Production Topology

Status: `support_only`

The checked command must run against a real source/local/changed topology that represents the production push boundary. Fallback to packaged fixture source is not acceptable for release movement.

Topology verifier evidence, 2026-05-27:

- Source URL: `REPRINT_PUSH_SOURCE_URL` is required. Current observed value: missing.
- Local edited site: `REPRINT_PUSH_LOCAL_URL` is required before release movement. Current observed value: missing.
- Remote changed/drift source: `REPRINT_PUSH_REMOTE_CHANGED_URL` is required before release movement. Current observed value: missing.
- Runner: `timeout 300s npm run verify:release`, specifically `scripts/playground/production-shaped-live-release-verify.mjs`.
- Exact ports: sandbox ingress is `8080`; source/local/changed ports are `null` until explicit URLs are supplied.
- Service shape: no source/local/changed services were started; no Playground, Docker, real WP, packaged plugin, or live source was accepted.
- Packaged fallback: rejected for release movement; `packagedFallbackAllowed: false`.
- Release movement allowed: no.
- Reason: `REPRINT_PUSH_SOURCE_URL` is missing, so the release verifier fails closed and gates stay `0/4`.

Local candidate evidence, 2026-05-28:

- `npm run verify:release:local-production:complex-site:comment-graph` passed
  in tmux with a 25-mutation local Playground receipt, auth/session continuity,
  durable DB-journal proof, replay/retry proof, and comment graph closure.
- `npm run verify:release:local-production:complex-site:plugin-driver` passed
  in tmux with a 22-mutation local Playground receipt, auth/session continuity,
  durable DB-journal proof, replay/retry proof, and release-state
  plugin-driver ownership boundary.
- This supports candidate review and local safety work only. It does not change
  `release_verdict` because the release objective still requires a
  production-owned, non-lab-backed source boundary.

Final audit evidence, 2026-05-29:

- RPP-0901 audit file: `docs/evidence/rpp-0901-release-gate-1-final-audit.md`.
- Audited head: `93c391cd9913af4019fcf962b60e871982b347ef`.
- Focused executor/auth and route-boundary checks exited `0` with `tests 195`,
  `pass 195`, `fail 0`.
- Final-scope release-gate evaluator exited `1` with
  `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `final=3/20`, and
  `mutationAttempted: false`.
- `timeout 300s npm run verify:release` exited `1` with
  `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`
  and `gates: 0/4`. GATE-1 stays `support_only`; release movement stays held.

Required negative checks now covered by the verifier/test suite:

- Missing source URL: fails closed with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`.
- Packaged fallback source: fails closed with `REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED`.
- Wrong source URL alias: fails closed with `REPRINT_PUSH_SOURCE_URL_MISMATCH` when `REPRINT_PUSH_REMOTE_URL` differs from `REPRINT_PUSH_SOURCE_URL`.
- Source command readback drift: fails closed when `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND` returns a different `sourceUrl`.
- Auth session replay on another source: `resolveAuthenticatedHttpPushSource` rejects an auth/session source URL that differs from the checked source URL.
- Apply without confirmed live source: `production-shaped-apply-revalidation-smoke.mjs` fails before dry-run/apply when production auth is required and no live source is confirmed.

## GATE-4: Plugin-Driver Ownership Boundary

Status: `support_only`

At least one plugin-owned mutation path must prove driver ownership, allowlisted semantics, precondition evidence, rejected remote preservation, apply-time revalidation, and audit evidence on the release boundary.

Support evidence, 2026-05-28:

- Focused tests in `test/production-shaped-proof.test.js` now prove the
  production-shaped summary rejects unknown plugin-owned resources before
  mutation, mismatched owner/driver allowlists, direct `active_plugins`
  mutations, and unowned serialized option mutations.
- Checked command:
  `node --test --test-name-pattern "production plugin-driver boundary" test/production-shaped-proof.test.js`
  passed 5/5.

Local candidate evidence, 2026-05-28:

- `npm run verify:release:local-production:complex-site:plugin-driver` passed
  in tmux window `main:plugin-driver-local-proof` with
  `[PLUGIN_DRIVER_LOCAL_PROOF_STATUS:0]`.
- The checked local release verifier carried
  `row:["wp_reprint_push_release_state","state_id:1"]` with owner
  `reprint-push`, driver `reprint-push-release-state`, exact allowlist entry,
  live-remote precondition, apply-time revalidation, durable DB-journal
  evidence, and rejected remote-drift preservation.
- This is still not final live GATE-4 movement. The gate needs the same
  plugin-owned driver mutation proof on a production-owned, non-lab-backed
  source boundary and broader plugin-driver semantics beyond this release-state
  row.

## Gate Movement Rule

Do not use `partially_proven` or `proven` until `timeout 300s npm run verify:release` exists on the integration branch and proves the claim against a real live `REPRINT_PUSH_SOURCE_URL`.
