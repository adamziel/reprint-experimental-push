2026-05-26 23:14:08 CEST (+0200)

Changed files: [scripts/playground/push-remote-rest-plugin.php](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/scripts/playground/push-remote-rest-plugin.php), [test/push-remote-rest-plugin.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/test/push-remote-rest-plugin.test.js).

Pushed `4587df59` to `origin/lane/durable-journal-code-20260526-1859` (`Preserve checked recovery integrity scope drift`). The checked recovery-journal merge now uses the same negation-aware fixture-scope upgrade rule as the checked DB-journal contract, so an already-strong recovery integrity scope like `...; not local Playground fixture only` is no longer misclassified as stale fixture evidence and overwritten by the generic checked label. I added a regression proving stronger checked recovery integrity wording survives while the authoritative checked durable-journal contract still attaches underneath it.

Commands run: `php -l scripts/playground/push-remote-rest-plugin.php`, `node --check test/push-remote-rest-plugin.test.js`, `timeout 120s node --test test/push-remote-rest-plugin.test.js`, `git diff --check`, `git commit -m "Preserve checked recovery integrity scope drift"`, `git push origin HEAD:lane/durable-journal-code-20260526-1859`.

Push result: `839cd709..4587df59`. Worktree status: dirty only in [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/.lane-output/final.md) for the handoff.

Next supervisor nudge: reliable and recovery can now keep stronger checked recovery integrity wording that already rejects local-fixture scope without having it cosmetically collapsed back to the generic checked label; the next gate-moving work still belongs on production auth/session lifecycle, preserved-remote retry, or deeper release-path consumption of durable-journal semantics.
