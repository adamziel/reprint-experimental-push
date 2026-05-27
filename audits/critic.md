# Critic Verdict

Current reliable head: `37aab99a33dc9a21c78193d9b2d086dfcf1b9368`
(`Use release clock for auth session expiry`).

Verdict: `0/4`

Reason:

- This head makes checked auth/session expiry evaluation use the release
  observation clock consistently through preflight, dry-run, apply, recovery
  inspect, replay, and db-journal readback. The change is in
  `src/authenticated-http-push-client.js`, with focused coverage in
  `test/authenticated-http-push-client.test.js`.
- That is useful fail-closed support evidence, but it is still client/test
  hardening. It does not prove a production-owned, non-lab-backed mutation
  boundary on the real Reprint endpoint, live auth/session issuance and
  readback, durable restart-readable journal storage with lease fencing, or
  apply-time revalidation before the first mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:release-boundary` should keep this as support evidence and move the
  proof boundary to the real endpoint: a production-owned, non-lab-backed
  `verify:release` path that, on the same live `REPRINT_PUSH_SOURCE_URL`,
  mints and rereads a live auth session, persists it in a durable
  restart-readable lease-fenced journal under plugin-driver ownership,
  preserves rejected remote evidence, and performs apply-time revalidation
  before the first mutation on `/wp-json/reprint/v1/push/*`. The relevant
  proof path remains `scripts/playground/production-shaped-live-release-verify.mjs`
  and `timeout 300s npm run verify:release`.
