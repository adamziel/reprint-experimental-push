# Critic Verdict

Current reliable head: `9333de8c20c82959b0acb1ec0ce3ba3173efad5a`
(`Require auth identity user id continuity`).

Verdict: `0/4`

Reason:

- This head requires authenticated identity `userId` continuity across the
  checked auth/session path, including dry-run, apply, recovery, replay, and
  journal reads. That is useful fail-closed hardening of the verifier/client
  boundary.
- The new tests prove `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` on user-id
  drift or missing user-id evidence, but they still run inside the checked
  harness/client proof surface rather than a production-owned real Reprint
  endpoint.
- This head therefore does not close any supervised release gate. The missing
  primitive remains a real endpoint proof that issues and reads back a live
  auth session, persists it in restart-readable durable journal storage with
  lease fencing, preserves rejected-remote evidence, and revalidates at apply
  time before mutation.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond auth
  identity user-id continuity hardening: a production-owned, non-lab-backed
  source-mutation/auth-session boundary on the real Reprint endpoint that
  issues a live session, reads it back after restart from durable journal
  storage, enforces lease-fenced ownership of those journal rows, and
  revalidates the session at apply time before mutation without falling back
  to Playground package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
