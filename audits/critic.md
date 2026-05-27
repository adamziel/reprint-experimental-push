# Critic Verdict

Current reliable head: `fd2028238478d4a1b3c88b1cdbf7ba104c1a9d36`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head tightens checked auth identity handling on the production-session
  path. The diff adds malformed `auth.identity.userLogin` rejection and
  expands checked drift reporting so malformed observed auth-envelope identity
  fields are surfaced as `invalid-*` across preflight, dry-run, apply,
  recovery inspect, replay, and db-journal checks.
- That is still support-side checked-path hardening, not proof of the
  production-owned real Reprint endpoint boundary. The evidence still comes
  from the packaged checked verifier and recovery-journal flows rather than
  live auth/session issuance and readback, durable restart-readable journal
  ownership with lease fencing, preserved rejected-remote evidence, and
  apply-time revalidation before the first mutation on that same boundary.
  Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move off malformed auth identity drift
  hardening and prove the next remaining production boundary on the checked
  release path, using `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`, `src/recovery-journal.js`,
  and `src/authenticated-http-push-client.js` with `timeout 300s npm run
  verify:release`, or return an exact `GATE CODE BLOCKED:` handoff naming the
  missing file/API/command if that boundary is still unavailable.
