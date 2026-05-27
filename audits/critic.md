# Critic Verdict

Current reliable head: `7c4010cfa42fe5513c1d0942b78a295d7495a76f`
(`Cover checked cleanup evidence continuity`).

Verdict: `0/4`

Reason:

- This head adds more regression coverage for cleanup-evidence continuity in
  `test/authenticated-http-push-client.test.js`. The new cases keep the checked
  client fail-closed when replay, recovery-inspect, or db-journal paths drop
  cleanup evidence, but they still exercise the same production-shaped
  Playground/release-verifier scaffolding rather than a production-owned,
  non-lab-backed mutation boundary on the real Reprint endpoint.
- The diff does not introduce live auth/session issuance and readback on the
  real endpoint, durable restart-readable journal storage with lease fencing,
  or apply-time revalidation before mutation. It only extends the existing
  cleanup-evidence continuity expectations inside the checked client tests.
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
