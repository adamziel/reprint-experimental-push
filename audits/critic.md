# Critic Verdict

Current reliable head: `4fec89c9d6f853bd066f0b3a58cd22a738c1c747`
(`Fail closed on malformed auth lifecycle fields`).

Verdict: `0/4`

Reason:

- This head makes the production auth/session lifecycle checks fail closed on
  malformed string identity fields. In
  `scripts/playground/production-auth-session-lifecycle.js` and
  `src/authenticated-http-push-client.js`, it now rejects malformed `id`,
  `type`, `status`, and `expiresAt` values before treating them as lifecycle
  evidence. The added tests in
  `test/authenticated-http-push-client.test.js` and
  `test/production-shaped-proof.test.js` prove that array-valued or
  whitespace-padded lifecycle fields now produce
  `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` with
  `required: 'string lifecycle fields'` and observations such as
  `invalid-status` or `invalid-id`.
- It also improves failure reporting on the packaged verifier path only.
  `scripts/playground/production-shaped-release-verify.mjs` now serializes the
  plugin-driver spawn status, signal, error, stdout, and stderr through
  `describeSpawnProof()`, which is diagnostic hardening rather than a new
  release-boundary proof.
- That still does not close any supervised release gate. The checked path
  remains the packaged Playground verifier scaffolding, and this head still
  does not prove a production-owned, non-lab-backed source mutation boundary on
  the real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond malformed
  auth lifecycle validation: a production-owned, non-lab-backed source
  mutation/auth-session boundary on the real Reprint endpoint that issues a
  live session on the endpoint, reads it back after restart from durable
  journal storage, enforces lease-fenced ownership of those journal rows, and
  revalidates the session at apply time before mutation without falling back to
  Playground package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
