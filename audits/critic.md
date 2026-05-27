# Critic Verdict

Current reliable head: `c208a12d28b3abcef15920c27eef424d68cad996`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head adds fail-closed checks for malformed auth identity fields in the
  checked release-path client. In `src/authenticated-http-push-client.js`, the
  production-auth-session path now rejects malformed `auth.identity.userLogin`
  values at preflight, dry-run, apply, recovery inspect, replay, and db-journal
  inspection time when `requireProductionAuthSession` is enabled.
- The added tests in `test/authenticated-http-push-client.test.js` cover array-
  valued and whitespace-padded auth identity/session fields and prove the
  client returns `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` with invalid
  field diagnostics.
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
