2026-05-27 11:26:05 CEST (+0200)

Changed files:
- `test/production-shaped-proof.test.js`

What changed:
- Added the missing complementary checked-release terminal-read auth regressions for the stricter release-boundary lifecycle summary:
  `journal` read revoked and `replay` read expired.
- This extends the existing checked-release auth coverage beyond the earlier `cleaned-up` / `rotated` terminal cases, so reliable now has explicit fail-closed release-boundary tests for all four terminal state families most likely to surface after preserved reads.
- Kept the change lane-owned and release-relevant by extending the checked release proof surface rather than adding another request-state or source-metadata symmetry case.

Commands run:
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `node --check test/production-shaped-proof.test.js`
- `timeout 120s node --test --test-name-pattern='checked release auth/session lifecycle summary fails closed when a journal read is revoked|checked release auth/session lifecycle summary fails closed when a replay read is expired' test/production-shaped-proof.test.js`
- `git diff --check -- test/production-shaped-proof.test.js`
- `git add test/production-shaped-proof.test.js`
- `git commit -m "Cover checked auth release revoked expiry reads"`
- `git push origin HEAD:lane/auth-session-code-20260526-1836`
- `git status --short --branch`
- `git rev-parse --short HEAD`

Push result:
- Pushed `f4679dc83` (`Cover checked auth release revoked expiry reads`) to `origin/lane/auth-session-code-20260526-1836`.

Worktree status:
- `## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836`

Next supervisor nudge:
- Reliable can now consume complete checked-release terminal-read auth coverage for revoked, cleaned-up, expired, and rotated states, not only source-warning / fallback drift or partial terminal-state coverage.
- The next auth-owned gap is still real production-backed issuance/readback/lifecycle proof on the checked release path, not more terminal-state symmetry variants.
