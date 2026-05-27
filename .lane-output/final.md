Timestamp: `2026-05-27 08:41:42 CEST (+0200)`.

Changed files:
- [scripts/playground/packaged-production-plugin-source-command.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/scripts/playground/packaged-production-plugin-source-command.js)
- [test/production-shaped-proof.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/production-shaped-proof.test.js)

What changed:
- Added a command-only packaged runtime rebinding path so `bindPackagedProductionPluginRuntimeSource()` can rewrite the stale `REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL=...` segment inside an already-packaged auth-session source command, even when the accompanying auth-session metadata object is missing or malformed.
- Kept the existing fail-closed behavior for malformed prior commands and non-local runtime URLs.
- Tightened the packaged proof tests so malformed auth metadata is still preserved while the safe packaged command and runtime-bound `sourceUrl` are kept in sync.

Commands run:
```bash
node --check scripts/playground/packaged-production-plugin-source-command.js
node --check test/production-shaped-proof.test.js
timeout 120s node --test --test-name-pattern='packaged production plugin runtime source binding' test/production-shaped-proof.test.js
git diff --check -- scripts/playground/packaged-production-plugin-source-command.js test/production-shaped-proof.test.js
```

Push result:
- pending

Worktree status:
```bash
## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836
 M .lane-output/final.md
 M scripts/playground/packaged-production-plugin-source-command.js
 M test/production-shaped-proof.test.js
```

Next supervisor nudge:
- Reliable can now rebind a safe packaged auth-session source command to the live runtime URL without depending on a well-formed `authSessionSource` object; the next meaningful auth-session consumer is reliable-owned checked release-path lifecycle work on the real-endpoint boundary.
