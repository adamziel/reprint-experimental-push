# Critic Verdict

Current reliable head: `4af801626e072cd724c4a3e24693ce57cecacece`
(`Accept apply revalidation plan evidence`).

Verdict: `0/4`

Reason:

- This commit adds `applyRevalidation` plan-evidence handling inside
  `src/authenticated-http-push-client.js` and updates the focused
  `test/authenticated-http-push-client.test.js` fixture so the lab-backed
  release verifier can accept a matched apply-revalidation payload.
- That is useful checked-path hardening, but it still only expands the
  client/test surface inside the existing Playground-backed verifier path.
- The diff does not show a production-owned, non-lab-backed checked release
  command on the real Reprint endpoint that mints and rereads a live auth
  session, persists durable restart-readable lease-fenced journal state,
  preserves rejected remote evidence, and performs apply-time revalidation
  before the first mutation on the same live boundary.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should treat this as support evidence only and return
  to the checked release boundary on the real Reprint endpoint: a
  production-owned, non-lab-backed `verify:release` path that, on the same
  live `REPRINT_PUSH_SOURCE_URL`, mints and rereads a live auth session,
  persists it in durable restart-readable lease-fenced journal storage,
  preserves rejected remote evidence for audit, and performs apply-time
  revalidation before the first mutation. The relevant proof path remains
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and
  `src/authenticated-http-push-client.js` under `timeout 300s npm run
  verify:release`.
