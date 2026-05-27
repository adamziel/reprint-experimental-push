# Critic Verdict

Current reliable head: `fd2028238478d4a1b3c88b1cdbf7ba104c1a9d36`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head hardens the checked production auth/session lifecycle path against
  malformed identity drift. In `src/authenticated-http-push-client.js` it now
  fails closed when observed production auth identity fields such as
  `auth.identity.userLogin` are malformed, and it extends the same rejection to
  preflight, dry-run, apply, recovery inspect, replay, and DB-journal
  observations. The added tests prove array-valued and whitespace-padded
  identity/session fields now return
  `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` with explicit field-level drift
  details.
- That is still support-side hardening, not a supervised gate move. The checked
  path remains the verifier-side packaged release boundary, and this head still
  does not prove a production-owned, non-lab-backed source mutation boundary on
  the real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond malformed
  auth identity drift: a production-owned, non-lab-backed source mutation /
  auth-session boundary on the real Reprint endpoint that issues a live
  session, reads it back after restart from durable journal storage, enforces
  lease-fenced ownership of those journal rows, and revalidates the session at
  apply time before mutation without falling back to Playground package-mode
  scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
