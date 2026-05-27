# Objective Audit

## Verdict

- Audited commit: `97790e454633adf887e04db408d8fa0fd59d4346` (`Fail closed on explicit live source fallback`)
- Previous audited reliable head: `13367763db66c5b145d507c5cf91c476b4b72efc`
- Latest reliable diff reviewed: `13367763db66c5b145d507c5cf91c476b4b72efc..97790e454633adf887e04db408d8fa0fd59d4346`
- Reliable advanced since the supervisor baseline: `no`
- Current critic head: `2cbb9a3e95c623bfccb9144764e36c4c4edd8515`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 07:36:16 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `97790e454633adf887e04db408d8fa0fd59d4346` (`Fail closed on explicit live source fallback`)
  - `origin/lane/critic` -> `2cbb9a3e95c623bfccb9144764e36c4c4edd8515` (`Classify reliable head 97790e45`)
  - `origin/lane/independent-auditor` -> `650cce30dbc46ff0cb75fe40252aa9a951df60f3`
  - `origin/main` -> `1c7ccf9e8d5f6b6974f6ee4ceb92840d34391565`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Explicit live credential fail-closed behavior | `scripts/playground/production-shaped-live-release-verify.mjs` now exits before verification when an explicit live source URL is present without either an explicit auth-session source command or an explicit username plus application password. `resolveCheckedLiveBoundaryEnv()` and `resolveLiveApplyRevalidationEnv()` only synthesize fallback fixture credentials when `allowCredentialFallback` is explicitly enabled, which the explicit live path does not do. | A production-owned real Reprint endpoint that proves the same refusal at the actual live mutation boundary, not only in the Playground wrapper. | Support-only |
| Silent fallback prevention on explicit live boundaries | The explicit checked-boundary and apply-revalidation env builders now clear `REPRINT_PUSH_USERNAME` and `REPRINT_PUSH_APPLICATION_PASSWORD` instead of silently inheriting lab credentials whenever the operator points at an explicit live source. The new test coverage locks that behavior in for both verify and apply-revalidation env construction. | End-to-end proof that the release boundary preserves rejected-remote evidence and refuses any hidden credential substitution while talking to a production-owned endpoint. | Support-only |
| Failure-proof surfacing | `runCheckedReleaseVerify()` now preserves parsed JSON failure proof from `production-shaped-release-verify.mjs` and emits it on non-zero exit instead of asserting immediately. The explicit missing-credential gate also emits structured JSON with `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` and `REPRINT_PUSH_SECRET_REQUIRED`. | A checked live run on the real endpoint that issues, reads back, and preserves those failure semantics across production auth/session lifecycle and journal ownership. | Support-only |
| Playground/package behavior | The packaged boundary still runs on mounted Playground fixtures, with the wrapper only reorganizing verify/apply sequencing and failure handling around those local servers. | Playground/package behavior is not proof of a production-owned Reprint endpoint, plugin-driver ownership, or durable production storage semantics. | Support-only |
| Production-owned auth/session lifecycle | No part of `97790e45` adds a production auth/session issuer, scoped production credential store, or live session readback from a real Reprint endpoint. | One checked live run on the real endpoint proving auth/session issuance, readback, rotation or expiry handling, and rejection of stale or lab-backed credentials on the same boundary. | Blocked |
| Durable journal ownership with lease fencing and restart-readable replay | No part of `97790e45` adds new real-boundary journal ownership, lease fencing, or restart-readable replay proof. | Real endpoint proof that the durable journal is production-owned, lease-fenced, crash-readable after restart, and tied to the same live boundary being audited. | Blocked |
| Plugin-driver ownership | No plugin-driver or plugin-owned resource semantics change appears in `97790e45`. | Real boundary proof for plugin-driver ownership and conservative blocking or validation of plugin-owned state on the release path. | Blocked |
| Preserved rejected-remote evidence and first-mutation revalidation | The wrapper keeps apply-time revalidation on an independently preserved base when an explicit wrapper provides one, but there is still no production-owned proof that rejected remote evidence is durably preserved or that the same boundary revalidates immediately before first mutation. | One checked live run on the real endpoint proving preserved rejected-remote evidence plus apply-time revalidation before first mutation on that same production boundary. | Blocked |

## Release Blockers

1. `97790e45` usefully hardens the Playground release wrapper by refusing explicit live-source runs that would otherwise fall back to fixture credentials, but it does not add production-owned endpoint behavior.
2. The core evidence remains `scripts/playground/production-shaped-live-release-verify.mjs`, `scripts/playground/production-shaped-live-release-verify-lib.js`, and `test/production-shaped-proof.test.js`, so this is still wrapper logic plus regression coverage.
3. There is still no checked live run proving auth/session issuance and later readback on the same production-owned boundary.
4. There is still no checked live run proving durable restart-readable journal ownership with lease fencing, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same production-owned boundary.

## Critic Alignment

The current critic verdict at `2cbb9a3e95c623bfccb9144764e36c4c4edd8515` remains aligned with this audit. Both lanes treat `97790e45` as useful fail-closed hardening for explicit live credential handling while keeping the overall release-gate verdict at `0/4`.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. plugin-driver ownership on the release boundary
4. preserved rejected-remote evidence
5. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
