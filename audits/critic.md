# Critic Verdict

Current reliable head: `3e9eef4166dc2c5a603b48e269af3f16320c85ee`
(`Preserve source-owned recovery journal proof`).

Verdict: `0/4`

Reason:

- This head moves the checked durable-journal proof toward source-owned
  recovery evidence. The release verifier now prefers accepted recovery-inspect
  journal evidence before `/db-journal` evidence, the authenticated client
  preserves recovery journal claim and storage-guard fields, and the proof tests
  assert the recovery journal scope plus `wpdb-single-statement-cas` storage
  guard on the packaged and explicit checked-live paths.
- That is material durable-journal proof hardening, but it still runs inside
  the production-shaped Playground/package harness. It does not yet prove the
  same source-owned recovery journal on a real Reprint endpoint with live
  auth/session issuance and readback, preserved rejected-remote evidence, and
  apply-time revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should turn this source-owned recovery-journal proof
  into the next exact production primitive: a non-lab-backed source mutation /
  auth-session boundary on the real Reprint endpoint that issues a live
  session, reads it back from restart-readable durable journal storage,
  enforces lease-fenced ownership of those journal rows, preserves
  rejected-remote evidence, and revalidates the session at apply time before
  mutation without falling back to Playground package-mode scaffolding. The
  proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
