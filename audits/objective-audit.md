# Objective Audit

## Verdict

- Audited commit: `4c4e769f903e6b00cbf6a0ddf50a0a993302d741` (`Fail closed on unchecked auth metadata drift`)
- Previous audited reliable head: `e9c9e36980b738f584eadf113ff5599ce885cd39`
- Latest reliable diff reviewed: `e9c9e36980b738f584eadf113ff5599ce885cd39..4c4e769f903e6b00cbf6a0ddf50a0a993302d741`
- Current critic head: `b65ef92b468745ef9baba7c12b5bc65938b2a977`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:56:03 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `4c4e769f903e6b00cbf6a0ddf50a0a993302d741` (`Fail closed on unchecked auth metadata drift`)
  - `origin/lane/critic` -> `b65ef92b468745ef9baba7c12b5bc65938b2a977` (`Classify reliable head e9c9e369`)
  - `origin/lane/independent-auditor` -> `315376ddf584975b3cb4cad26d114839ac5dcf84` (`Audit reliable head e9c9e369`)
  - `origin/lane/progress-publisher` -> `55003d435bb6982cdbfa8887c9ed54a521fc443e` (`Refresh public progress for e9c9e369`)
  - `origin/main` -> `65ba906400b7ecc7028bbb8f77297ca6b3341898` (`Refresh live progress page`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Unchecked auth metadata drift refusal | `4c4e769f` adds `resolveUncheckedObservedAuthSessionMetadataDrift()` and calls it after dry-run, apply, recovery inspect, replay, and journal readback so malformed auth identity/session metadata now fails closed with `AUTH_SESSION_LIFECYCLE_DRIFT` even when the stricter production-session gate is not what fires first (`src/authenticated-http-push-client.js`). | One production-owned real Reprint endpoint proving the same malformed auth metadata is rejected on the checked release path instead of within mocked production-shaped responses. | Support-only |
| Lifecycle helper normalization | `4c4e769f` extends lifecycle helper validation to include `warning` string fields plus `playgroundFallback` boolean flags, so malformed lifecycle metadata in the production-shaped helper is surfaced rather than ignored (`scripts/playground/production-auth-session-lifecycle.js`, `src/authenticated-http-push-client.js`). | Live endpoint evidence that the production-owned auth/session boundary issues and reads back these fields under real lifecycle ownership, not just helper-side shape checks. | Support-only |
| Checked auth metadata regression coverage | `4c4e769f` adds production-shaped mocked fetch tests where `/recovery/inspect` returns an invalid `auth.session.warning` array and `/db-journal` returns an invalid `auth.session.preserved` array; the client still fails closed before later evidence can count (`test/authenticated-http-push-client.test.js`). | Live endpoint evidence, not mocked fetch fixtures, showing the real boundary rejects the same malformed auth metadata before mutation or before counting journal ownership. | Support-only |
| Live auth/session issuance and readback | The new commit only validates more auth/session metadata shape in production-shaped evidence. It does not mint or read back a live auth/session from a production-owned Reprint endpoint. | A checked real-endpoint run proving live auth/session issuance, preserved readback, and lifecycle ownership on that same boundary. | Blocked |
| Durable restart-readable journal ownership | The new commit adds extra metadata refusal around journal readback, but it still relies on packaged production-shaped/lab-scoped journal evidence. | Durable restart-readable journal ownership with lease fencing on the production-owned boundary. | Blocked |
| Preserved rejected-remote evidence | The new tests exercise malformed auth metadata drift only. They do not prove rejected-remote evidence preservation on the real endpoint. | Real boundary evidence that rejected remote state is preserved and auditable end to end. | Blocked |
| Apply-time revalidation before first mutation | The client now refuses more malformed metadata around apply, recovery, replay, and journal phases, but this commit does not add production proof that the same boundary revalidates before the first mutation. | Real-endpoint apply-time revalidation before first mutation on the same production-owned boundary. | Blocked |
| Evidence quality | The commit is fail-closed proof-shape hardening in helper/client/tests. Because the executable evidence remains production-shaped/lab-scoped or mocked, it does not move the release gate. | Production ownership of the source route, auth/session lifecycle, journal storage, rejected-remote evidence, and first-mutation revalidation. | Support-only |

## Release Blockers

1. `4c4e769f` is useful fail-closed hardening, but it is still proof-shape hardening around production-shaped helper/client behavior and mocked responses.
2. The checked path remains production-shaped/lab-scoped scaffolding rather than a proven production-owned Reprint endpoint boundary.
3. There is still no checked live run proving auth/session issuance and later readback on that same boundary.
4. There is still no checked live run proving durable restart-readable journal ownership with lease fencing on that same boundary.
5. There is still no checked live run proving preserved rejected-remote evidence plus apply-time revalidation before the first mutation on that same boundary.

## Critic Alignment

The current critic verdict at `b65ef92b468745ef9baba7c12b5bc65938b2a977` remains aligned with this audit. `4c4e769f` improves fail-closed unchecked auth metadata accounting, but it still does not move the release gates because the proof stops at production-shaped verifier/helper scaffolding instead of a production-owned endpoint.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. preserved rejected-remote evidence
4. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
