# Critic Verdict

Current reliable head: `3161b049e885694f8fbd5127050a8c45330ad50d`
(`Accept matching runtime auth session sources`).

Verdict: `0/4`

Reason:

- This head widens accepted explicit runtime auth-session source URLs in
  `scripts/playground/auth-session-source.js` and adds a focused regression in
  `test/production-shaped-proof.test.js`.
- The diff is still support-side release-verifier plumbing: it keeps the
  checked path accepting matching runtime sources, but it does not prove a
  production-owned, non-lab-backed mutation boundary on the real Reprint
  endpoint, live auth/session issuance and readback, durable restart-readable
  journal storage with lease fencing, or apply-time revalidation before the
  first mutation.
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
