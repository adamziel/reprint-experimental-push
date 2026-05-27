# Critic Verdict

Current reliable head: `c40affc90c17853bc61a213e6e32fa6ffdfb510c`
(`Require journal auth continuity`).

Verdict: `0/4`

Reason:

- This head extends the checked release-path client so journal-auth continuity
  is preserved across the production-auth-session path. In
  `src/authenticated-http-push-client.js`, the release-path checks now carry the
  journal auth identity through the lifecycle gates, and
  `test/authenticated-http-push-client.test.js` adds focused coverage for the
  continuity cases.
- The diff is still support-side hardening on the checked verifier path: it
  does not prove a production-owned, non-lab-backed mutation boundary on the
  real Reprint endpoint, live auth/session issuance and readback, durable
  restart-readable journal storage with lease fencing, or apply-time
  revalidation before the first mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should keep this as support evidence and move the proof
  boundary to the real endpoint: a production-owned, non-lab-backed
  `verify:release` path that, on the same live `REPRINT_PUSH_SOURCE_URL`,
  mints and rereads a live auth session, persists it in a durable
  restart-readable lease-fenced journal under plugin-driver ownership,
  preserves rejected remote evidence, and performs apply-time revalidation
  before the first mutation on `/wp-json/reprint/v1/push/*`. The relevant
  proof path remains `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js`
  under `timeout 300s npm run verify:release`.
