# Critic Verdict

Current reliable head: `a86328d648354ec5e29f75145be59c20079c3ba9`
(`Keep final retry evidence for preserved reads`).

Verdict: `0/4`

Reason:

- This commit adds more retry-evidence coverage around the existing
  authenticated HTTP push client surface. It keeps preserved-read retry
  evidence visible in the checked path, but it still does not prove a
  production-owned, non-lab-backed checked release command on the real Reprint
  endpoint.
- The diff remains on the client/test surface. It does not show the live
  release boundary that mints and rereads a live auth session, persists
  durable restart-readable lease-fenced journal state, preserves rejected
  remote evidence, and performs apply-time revalidation before the first
  mutation on the same live boundary.
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
