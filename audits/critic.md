# Critic Verdict

Current reliable head: `fd2028238478d4a1b3c88b1cdbf7ba104c1a9d36`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head tightens the checked production-session client path so malformed
  `auth.identity.userLogin` values are rejected before they can be treated as
  lifecycle evidence. It also extends the checked-path failure reporting for
  malformed observed auth envelope identity/session fields.
- The new tests prove the release-verifier/client path now fails closed with
  `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` on malformed auth identity
  input, but they still only exercise the packaged checked path. That is
  support-side hardening, not a production-owned, non-lab-backed source
  mutation boundary on the real Reprint endpoint.
- This head therefore does not close any supervised release gate. The missing
  primitive remains a real endpoint proof that issues and reads back a live
  auth session, persists it in restart-readable durable journal storage with
  lease fencing, and revalidates at apply time before mutation.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond malformed
  auth identity drift hardening: a production-owned, non-lab-backed
  source-mutation/auth-session boundary on the real Reprint endpoint that
  issues a live session, reads it back after restart from durable journal
  storage, enforces lease-fenced ownership of those journal rows, and
  revalidates the session at apply time before mutation without falling back
  to Playground package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
