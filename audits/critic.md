# Critic Verdict

Current reliable head: `d64eda1d4da2531f6c8f3049edbaa1459140765b`
(`Fence reopened recovery plan ids`).

Verdict: `0/4`

Reason:

- This head tightens the recovery-journal reopen path so a reopened
  claim-fenced journal must match the persisted active-claim `plan.id` and the
  persisted artifact evidence before the wrapper will accept it.
- In `src/recovery-journal.js` the production recovery wrapper now rejects a
  reopened claim when the active claim evidence drifts, and the focused tests
  add coverage for plan-id drift and missing persisted plan IDs on restart.
- That is still release-path support evidence, not a supervised gate closure.
  The checked path remains verifier/scaffold-driven, and this head still does
  not prove a production-owned, non-lab-backed source mutation boundary on the
  real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond recovery
  plan-id fencing: a production-owned, non-lab-backed source-mutation/auth-
  session boundary on the real Reprint endpoint that issues a live session on
  the endpoint, reads it back after restart from durable journal storage,
  enforces lease-fenced ownership of those journal rows, and revalidates the
  session at apply time before mutation without falling back to Playground
  package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`, `src/recovery-journal.js`,
  and `src/authenticated-http-push-client.js` with `timeout 300s npm run
  verify:release`.
