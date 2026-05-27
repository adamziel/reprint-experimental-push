# Critic Verdict

Current reliable head: `7c4010cfa42fe5513c1d0942b78a295d7495a76f`
(`Cover checked cleanup evidence continuity`).

Verdict: `0/4`

Reason:

- This commit is classified as `support-only`. It adds authenticated-client
  tests for checked cleanup evidence continuity, which is useful
  auth/session-lifecycle hardening on the checked path, but it still does not
  establish a production-owned, non-lab proof boundary on the real
  `REPRINT_PUSH_SOURCE_URL` endpoint.
- The diff is test-only: `test/authenticated-http-push-client.test.js` gains
  authenticated client coverage for checked cleanup evidence continuity. That
  strengthens confidence that checked auth/session handling keeps evidence
  intact across the tested flow, but it is still laboratory coverage rather
  than endpoint proof on the real `/wp-json/reprint/v1/push/*` surface.
- The missing proof remains live auth/session issuance plus readback, a
  durable restart-readable lease-fenced journal, plugin-driver ownership,
  preserved rejected remote evidence, and apply-time revalidation before the
  first mutation on the real `/wp-json/reprint/v1/push/*` endpoint.
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
