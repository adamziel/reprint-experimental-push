# Critic Verdict

Current reliable head: `fd2028238478d4a1b3c88b1cdbf7ba104c1a9d36`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head hardens malformed auth/session identity handling in
  `src/authenticated-http-push-client.js`. It now fails closed when
  `auth.identity.userLogin` is malformed on the checked production-session
  path and adds drift reporting for malformed observed auth envelope
  `userLogin`/session id fields.
- That is useful checked-path hardening, but it still runs inside the
  production-shaped Playground/package harness. It does not yet prove the
  missing production-owned source mutation boundary on the real Reprint
  endpoint with live auth/session issuance and readback, restart-readable
  durable journal storage with lease fencing, preserved rejected-remote
  evidence, and apply-time revalidation before mutation. Verdict therefore
  remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond malformed
  auth identity drift hardening: a production-owned, non-lab-backed source
  mutation/auth-session boundary on the real Reprint endpoint that issues a
  live session on the endpoint, reads it back after restart from durable
  journal storage, enforces lease-fenced ownership of those journal rows, and
  revalidates the session at apply time before mutation without falling back to
  Playground package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
