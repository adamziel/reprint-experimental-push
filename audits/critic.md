# Critic Verdict

Current reliable head: `3c946a8646c776535acb70e88d24df579568ff63`
(`Unfilter mapped graph postmeta in push smokes`).

Verdict: `0/4`

Reason:

- This commit only changes the push-smoke fixtures so the ready-plan path
  keeps the mapped `wp_postmeta` row for `post_id:2001:meta_key:_reprint_push_forms_schema`
  instead of filtering it out before plan construction. The affected files are
  `scripts/playground/apply-ready-plan.mjs`,
  `scripts/playground/http-push-smoke.mjs`, and
  `scripts/playground/push-protocol-smoke.mjs`.
- That is useful release-surface coverage for graph/postmeta handling, but it
  remains a smoke-fixture change. It does not prove a production-owned,
  non-lab-backed checked release command on the real Reprint endpoint.
- The diff does not show live auth/session issuance and readback on the live
  source URL, restart-readable durable journal ownership under lease fencing,
  or apply-time revalidation before the first mutation on that same boundary.
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
