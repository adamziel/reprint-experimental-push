# Critic Verdict

Current reliable head: `8e7fa53d19ebde044d20c7fd9baa50cf78c9bb29`
(`Reuse live topology for apply revalidation`).

Verdict: `0/4`

Reason:

- This head reuses the live wrapper-owned remote/local topology for the
  inlined apply-revalidation proof. In
  `scripts/playground/production-shaped-apply-revalidation-smoke.mjs`, the
  smoke can now accept explicit `REPRINT_PUSH_SOURCE_URL` /
  `REPRINT_PUSH_REMOTE_URL` and `REPRINT_PUSH_LOCAL_URL` inputs, and
  `scripts/playground/production-shaped-live-release-verify.mjs` starts both
  `remote-base` and `local-edited` Playground servers and threads their URLs
  and credentials into the proof.
- That is still topology plumbing inside Playground/package-mode verifier
  scaffolding. It improves the checked proof setup, but it does not prove a
  production-owned, non-lab-backed source mutation boundary on the real
  Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation.
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
