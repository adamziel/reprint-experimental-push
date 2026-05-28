# AO Critic Evidence - 2026-05-28

Branch under audit: `lane/evidence-integration-20260527` at `d071e4e35`.

## Checked commands

- `timeout 300s npm run verify:release` -> expected failure, status `1`:
  `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`,
  `gates: "0/4"`.
- `node --test test/graph-mapping-inventory.test.js test/guarded-executor-benchmark.test.js test/performance-model.test.js` -> status `0`, 15/15 pass.
- Focused release/auth/journal/plugin boundary pattern across
  `test/production-shaped-proof.test.js`, `test/recovery-journal.test.js`, and
  `test/protocol-fixtures.test.js` -> status `1`, 43 pass, 6 fail, 3 skipped.
- Exact auth lifecycle regression:
  `node --test --test-name-pattern '^production auth/session lifecycle summary helper requires a preserved active read$' test/production-shaped-proof.test.js`
  -> status `1`, observed `stale-issued-summary` before expected preserved-read
  failure.
- Focused planner graph/plugin/recovery pattern -> status `0`, 34/34 pass.
- `npm run test:generated-push-harness` -> status `0`, 1/1 pass.
- `node scripts/bench/graph-mapping-inventory.js` -> status `0`, deterministic
  inventory with 7 benchmark families, 6 mapped, 0 blocked, 1 guarded.
- `timeout 180s npm test` -> status `1`, 389 pass, 23 fail, 11 skipped before rebasing onto the release-gates evaluator.
- `node --test test/release-gates.test.js` -> status `0`, 8/8 pass after rebase.
- `node --test test/authenticated-http-push-client.test.js` -> status `1`, 112
  pass, 10 fail.
- `node --test test/playground-snapshot-lib.test.js` -> status `1`, 2 pass, 1
  fail.

## Most important blockers

1. Full suite was observed red and the unchanged failing files still block release; release status must stay `0/4`.
2. Auth/session lifecycle summaries misclassify compact summaries as stale
   trace evidence before checking the intended preserved-read and identity
   failure modes.
3. Auth client preserved-remote retry, durable-journal, production auth/session,
   and consumed-claim identity precedence is inconsistent across tests.
4. Plugin package driver-guard-only coverage has a stale source-shape assertion.
5. Standalone snapshot-lib custom-table guard fails on missing `apply_filters()`.
6. Graph and chunking evidence is useful support evidence but not a production
   identity-mapping or throughput proof.

## Claimed RPP evidence

- RPP-0926: critic audit update with exact command evidence.
- RPP-0932: CI required-check evidence showing `npm test` was observed red, with unchanged failing files after the release-gates/progress rebase.
- RPP-0921-RPP-0924: release gate audit evidence showing `verify:release` fails
  closed and local candidates do not move final gates.
- RPP-0933: progress-publish critique warning against stale percentages without
  the release hold and red-test status.
