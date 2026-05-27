Audited `4c4e769f903e6b00cbf6a0ddf50a0a993302d741` (`Fail closed on unchecked auth metadata drift`).

Verdict: `0/4`

What changed:
- `src/authenticated-http-push-client.js` adds `resolveUncheckedObservedAuthSessionMetadataDrift()` and checks it after dry-run, apply, recovery inspect, replay, and journal readback so malformed auth/session or auth/identity metadata now fails closed with `AUTH_SESSION_LIFECYCLE_DRIFT`.
- The same client validation now treats `auth.session.warning` as a required string lifecycle field and `auth.session.playgroundFallback` as a required boolean lifecycle flag instead of leaving those fields unchecked.
- `scripts/playground/production-auth-session-lifecycle.js` mirrors that stricter validation in the production-shaped lifecycle helper by checking `warning` and `playgroundFallback`.
- `test/authenticated-http-push-client.test.js` adds production-shaped mocked fetch cases where `/recovery/inspect` returns `auth.session.warning` as an array and `/db-journal` returns `auth.session.preserved` as an array; both now fail closed before later proof can count.

Why it does not move the gate:
- This is still fail-closed proof-shape hardening. The new executable proof is production-shaped helper/client/test coverage backed by mocked fetch responses, not a production-owned real Reprint endpoint.
- The lifecycle helper changes are still support-only because they remain production-shaped/lab-scoped validation, not live auth/session issuance and readback on the release path.
- The diff does not prove durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, or apply-time revalidation before first mutation on a production-owned boundary.

Critic alignment:
- `origin/lane/critic` at `b65ef92b468745ef9baba7c12b5bc65938b2a977` still keeps the verdict at `0/4`; there is no newer critic verdict for `4c4e769f`, and this audit stays aligned with the standing critic position that proof-shape hardening is not release proof.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.
