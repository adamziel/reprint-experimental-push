# Critic Verdict

Current reliable head: `e9a7b19ac4ac3dad32c1672712f6825946632818`
(`Fence inherited durable claim markers`).

Verdict: `0/4`

Reason:

- This head hardens the checked durable-journal contract by rejecting inherited
  claim-marker fields, including inherited active claim markers on the
  boundary input. That is useful fail-closed support for the release verifier
  and recovery surface.
- The new tests prove the boundary closes when those markers come from
  prototype inheritance, but they still run inside the checked recovery/journal
  proof surface rather than a production-owned real Reprint endpoint.
- This head therefore does not close any supervised release gate. The missing
  primitive remains a real endpoint proof that issues and reads back a live
  auth session, persists it in restart-readable durable journal storage with
  lease fencing, preserves rejected-remote evidence, and revalidates at apply
  time before mutation.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond inherited
  claim-marker fencing: a production-owned, non-lab-backed
  source-mutation/auth-session boundary on the real Reprint endpoint that
  issues a live session, reads it back after restart from durable journal
  storage, enforces lease-fenced ownership of those journal rows, and
  revalidates the session at apply time before mutation without falling back
  to Playground package-mode scaffolding. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
