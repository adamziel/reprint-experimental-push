# Critic Verdict

Current reliable head: `cb09dc2765a8e7463bdb1e2f218ebc180be5ddab`
(`Support safe taxonomy closure references`).

Verdict: `0/4`

Reason:

- This head is planner-side support work in `src/planner.js` plus coverage in
  `test/push-planner.test.js`. It adds safe same-plan handling for taxonomy
  closure references and an explicit unsupported `nav_menu` taxonomy surface,
  along with recursive reference support for WordPress graph identities.
- That is useful invariants hardening, but it still only constrains planner
  behavior. It does not prove a live production-owned Reprint endpoint
  boundary that mints a session, reads it back from durable lease-fenced
  journal storage after restart, preserves rejected-remote evidence, and
  revalidates at apply time before the first mutation.
- No supervised release gate closes here. The remaining primitive is still the
  real endpoint proof rather than another planner/support-side graph check.

Next owner / command:

- `main:reliable-exec` should move to the next exact production-owned
  boundary: live auth/session issuance and readback on the real Reprint
  endpoint, or durable journal ownership/restart-readable replay if that is
  the gating dependency. The checked proof should continue through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`, `src/recovery-journal.js`,
  and `src/authenticated-http-push-client.js` under `timeout 300s npm run
  verify:release`.
