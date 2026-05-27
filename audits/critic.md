# Critic Verdict

Current reliable head: `f28ff529e542875510e9343f0314366f5526cd8d`
(`Fail closed on malformed recovery auth identities`).

Verdict: `0/4`

Reason:

- This head tightens malformed recovery auth identity handling in the checked
  auth/session client path, including malformed `userId` and `userLogin`
  surfaces. That is useful fail-closed hardening because it makes bad identity
  shapes explicit instead of silently accepted.
- It still only hardens the checked client-side/release-verifier path. The
  proof does not establish the missing production-owned real Reprint boundary
  with live auth/session issuance and readback, restart-readable durable
  journal ownership with lease fencing, preserved rejected-remote evidence,
  and apply-time revalidation before the first mutation. Verdict therefore
  remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move off malformed identity surfacing and prove
  the next remaining production boundary on the checked release path, using
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`, `src/recovery-journal.js`,
  and `src/authenticated-http-push-client.js` with `timeout 300s npm run
  verify:release`, or return an exact `GATE CODE BLOCKED:` handoff naming the
  missing file/API/command if that boundary is still unavailable.
