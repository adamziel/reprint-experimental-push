2026-05-26 22:54:29 CEST (+0200)

Changed files: [scripts/playground/push-db-journal-lib.php](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/scripts/playground/push-db-journal-lib.php), [scripts/playground/push-remote-rest-plugin.php](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/scripts/playground/push-remote-rest-plugin.php), [test/push-remote-rest-plugin.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/test/push-remote-rest-plugin.test.js).

I fixed a checked-path durable-journal scope leak. DB-journal rows now persist a scope key from the request route profile instead of always stamping `local-playground-fixture`, and per-event REST evidence now renders checked live and packaged journal labels instead of collapsing checked production-shaped events back to fixture-only wording. This keeps restart-readable DB-journal evidence aligned with the checked durable-journal contract that reliable is already consuming.

Commands run: `php -l scripts/playground/push-db-journal-lib.php`, `php -l scripts/playground/push-remote-rest-plugin.php`, `node --test test/push-remote-rest-plugin.test.js`, `git diff --check`.

Push result: pending in this handoff update.

Worktree status: lane-owned code/tests are updated; only this handoff file and the touched lane files are dirty before commit.

Next supervisor nudge: reliable should consume checked/package DB-journal row evidence without fixture-only scope drift; the next gate-moving step is still production auth/session lifecycle or deeper durable-journal consumption on `verify:release`, not another verifier proof-field surfacing pass.
