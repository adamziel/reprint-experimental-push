2026-05-27 11:33:00 CEST (+0200)

Changed files:
- `scripts/playground/production-auth-session-lifecycle.js`
- `test/production-shaped-proof.test.js`

What changed:
- Tightened the checked release auth/session lifecycle summary so a preserved
  `replay` or `journal` read must keep the same `auth.identity.userLogin` as
  the issued preflight session instead of silently accepting a mismatched or
  missing auth identity.
- Preserved `authUser` through `summarizeProductionAuthSessionLifecycleTrace()`,
  included it in lifecycle-summary observation equality, and added fail-closed
  validation for invalid/missing/mismatched preserved-read auth identity on the
  checked release path.
- Added focused release-proof regressions for the two concrete holes: a replay
  read that switches to a different auth user and a journal read that drops the
  auth identity entirely.

Commands run:
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `node --check scripts/playground/production-auth-session-lifecycle.js`
- `node --check test/production-shaped-proof.test.js`
- `timeout 120s node --test --test-name-pattern='checked release auth/session lifecycle summary fails closed when a replay read changes auth identity|checked release auth/session lifecycle summary fails closed when a journal read drops auth identity' test/production-shaped-proof.test.js`
- `git diff --check -- scripts/playground/production-auth-session-lifecycle.js test/production-shaped-proof.test.js`
- `git add scripts/playground/production-auth-session-lifecycle.js test/production-shaped-proof.test.js`
- `git commit -m "Require checked auth identity continuity"`
- `git push origin HEAD:lane/auth-session-code-20260526-1836`
- `git status --short --branch`
- `git rev-parse --short HEAD`

Push result:
- Pushed `d3adbcfc2` (`Require checked auth identity continuity`) to
  `origin/lane/auth-session-code-20260526-1836`.

Worktree status:
- `## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836`

Next supervisor nudge:
- Reliable can now consume a stricter checked release auth boundary: a
  successful `journal` or `replay` read must preserve the issued auth user,
  not just the session id/type/status fields.
- The next auth-adjacent release step belongs on reliable: rerun the checked
  release verifier against this identity continuity requirement and either
  prove real production-backed issued/read auth continuity or expose the next
  concrete blocker in production auth/session or durable-journal consumption.
