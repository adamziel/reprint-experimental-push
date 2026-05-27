# Release Gates

Release objective: prove a production-owned, non-lab-backed Reprint push boundary that can safely mutate a live source site without data loss.

Status values: `unproven`, `support_only`, `partially_proven`, `proven`, `blocked`.

`release_verdict`: `0/4`

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

## Gate Movement Rule

Do not use `partially_proven` or `proven` until `timeout 300s npm run verify:release` exists on the integration branch and proves the claim against a real live `REPRINT_PUSH_SOURCE_URL`.
