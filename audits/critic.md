# Critic Verdict

Current reliable head: `fd2028238478d4a1b3c88b1cdbf7ba104c1a9d36`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head adds more fail-closed auth envelope validation inside
  `src/authenticated-http-push-client.js` and extends
  `test/authenticated-http-push-client.test.js` to cover it. The new checks now
  reject malformed `auth.identity.userLogin` on the production-session path at
  preflight, dry-run, apply, recovery inspect, replay, and db-journal reads,
  and `describeAuthEnvelopeDrift()` now reports malformed observed envelope
  fields with explicit `field` metadata for `auth.identity.userLogin` and
  `auth.session.id/type/status/expiresAt`.
- The added tests prove only that the checked client path fails closed sooner
  when the response envelope is malformed. They cover array-valued
  `auth.identity.userLogin` and whitespace-padded checked-path session ids,
  yielding `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` with observations such
  as `invalid-user-login` and `invalid-id`.
- There is no new production-owned proof artifact beyond that hardening. I did
  not find a reliable final note/log beyond the commit itself and the code
  diff, and neither the diff nor the tests introduce a real Reprint endpoint
  mutation boundary, live auth/session issuance and restart readback, durable
  journal persistence with lease fencing, or apply-time revalidation outside
  the Playground/package-mode scaffolding. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond malformed
  auth identity drift hardening: a production-owned, non-lab-backed source
  mutation boundary on the real Reprint endpoint that mints a live auth
  session on the endpoint, reads the same session back after restart from
  durable journal storage, proves lease-fenced ownership of those persisted
  journal rows, and revalidates that session at apply time before the first
  mutation without falling back to Playground package-mode scaffolding. The
  proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
