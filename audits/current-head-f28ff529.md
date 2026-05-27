Audited `f28ff529e542875510e9343f0314366f5526cd8d` (`Fail closed on malformed recovery auth identities`).

Verdict: `0/4`

What changed:
- `src/authenticated-http-push-client.js` now rejects malformed observed recovery auth identity `userId` values in addition to malformed `userLogin` values, and it preserves the exact `required` field description instead of collapsing every identity error to `string auth identity fields`.
- The stricter required-field reporting is threaded through preflight, dry-run, apply, recovery-inspect, replay, DB-journal, and auth-drift summary paths, so malformed observed identity evidence is more precise when the client fails closed.
- `test/authenticated-http-push-client.test.js` adds regression coverage showing that malformed recovery-inspect `userLogin` and `userId` payloads produce `AUTH_SESSION_LIFECYCLE_DRIFT` even when the stronger production-session gate is not the first failure, and that the flow stops before durable journal readback.

Why it does not move the gate:
- This is client-side auth/session drift hardening and evidence precision, not new production-owned endpoint behavior. The diff does not add a real Reprint endpoint, a production auth/session issuer, or live session readback from the release boundary itself.
- The new tests prove the client refuses malformed recovery auth identity payloads in the harness, but they do not prove durable restart-readable journal ownership with lease fencing on the real endpoint.
- The diff does not add plugin-driver ownership, preserved rejected-remote evidence on the production boundary, or apply-time revalidation before the first mutation on that same boundary.

Evidence reviewed:
- `f28ff529e542875510e9343f0314366f5526cd8d:src/authenticated-http-push-client.js`
- `f28ff529e542875510e9343f0314366f5526cd8d:test/authenticated-http-push-client.test.js`
- `02890172771c3effe2c44494eeef00c12f719b8e` (`Classify reliable head 401ee0b3`)

Critic status:
- `origin/lane/critic` is still at `02890172771c3effe2c44494eeef00c12f719b8e`, which classifies the previous reliable head `401ee0b3` at `0/4`. No current critic verdict was available for `f28ff529` during this audit.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership on the release boundary, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
