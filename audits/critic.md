# Critic Verdict

Current reliable head: `f89370f41d4cc0519c980f89e038c9fff6dbcbb1`
(`Keep packaged release boundary support-only`).

Verdict: `0/4`

Reason:

- This head deliberately keeps the packaged boundary in support-only mode. The
  live wrapper now rewrites the packaged release boundary verdicts so the
  packaged path reports `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, marks the
  boundary as `support-only`, and downgrades packaged auth/session, durable
  journal, and replay-and-retry verdicts to `PACKAGED_RELEASE_BOUNDARY_OK`
  rather than a live release boundary.
- The test diff confirms that the packaged path still exercises the same
  Playground/package-mode verifier scaffold: the assertions now expect the
  explicit live-source requirement and the support-only boundary shape, not a
  production-owned live boundary on the real Reprint endpoint.
- That is useful to prevent the packaged verifier from overstating readiness,
  but it does not prove the missing production-owned source mutation boundary.
  The supervised release gate remains closed at `0/4` because there is still no
  checked real-endpoint proof with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before the first mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should keep this as support evidence and move toward the
  real checked release boundary: a production-owned, non-lab-backed
  `verify:release` path that, on the same live `REPRINT_PUSH_SOURCE_URL`,
  mints and rereads a live auth session, persists it in durable
  restart-readable lease-fenced journal storage, preserves rejected remote
  evidence, and performs apply-time revalidation before the first mutation.
  The relevant proof path remains
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and
  `src/authenticated-http-push-client.js` under `timeout 300s npm run
  verify:release`.
