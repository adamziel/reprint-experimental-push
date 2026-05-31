# RPP-0677 process kill before first mutation variant 4 evidence

Date: 2026-05-31
Issue: RPP-0677
Lane: journal-recovery

## Scope

This is focused local regression coverage for process kill before the first
mutation. It uses a sandbox file-backed JSONL journal through the
production-shaped recovery journal wrapper. It proves persisted journal rows are
durable after the writer is killed and a restarted child process reads them
back. It does not prove live production-backed durable journal release
readiness.

## Proof added

- Added `test/rpp-0677-process-kill-before-first-mutation-v4.test.js`.
- The test generates deterministic four-target and six-target file mutation
  plans, opens a claim-fenced production-shaped recovery journal in a child
  process, then runs `applyPlan()` with an old-remote previous journal.
- The child reaches the first `beforeMutation` callback only after durable
  `journal-opened`, `journal-ownership-recorded`, `target-planned`,
  `recovery-claim-opened`, `journal-retry-opened`, `apply-staged`,
  `dependencies-validated`, and `apply-committing` rows are written.
- The parent waits for a hash-only crash-boundary marker, confirms there are no
  `mutation-observed`, `journal-completed`, or `recovery-state` rows, then
  kills the writer with `SIGKILL`.
- Parent readback and separate restarted-child readback both prove the exact
  pre-kill rows are preserved, sequence numbers remain monotonic, every row has
  fsync evidence, open and staged summaries are restart-readable, and committed
  state remains missing.
- Restart inspection against the unchanged remote classifies every planned
  target as `old-remote`, with observed hashes matching before hashes and no
  target advanced to its after hash.

## Redaction

The fixtures include deterministic private-looking raw file values, but the
journal rows, crash marker, restart inspection, and local evidence summary
expose only hashes, counts, resource keys, event names, and local support scope.
The test checks `assertJournalRecordHasNoRawValues()` on every durable row and
scans the raw JSONL journal text plus all evidence objects for fixture payload
values.

## Validation run

```bash
node --check test/rpp-0677-process-kill-before-first-mutation-v4.test.js
node --test --test-name-pattern RPP-0677 test/rpp-0677-process-kill-before-first-mutation-v4.test.js
node --test --test-name-pattern RPP-0657 test/rpp-0657-process-kill-before-first-mutation-v3.test.js
node --test --test-name-pattern RPP-0617 test/rpp-0617-process-kill-before-first-mutation.test.js
node --test --test-name-pattern RPP-0637 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0677-process-kill-before-first-mutation-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- RPP-0677 syntax check exited 0.
- Focused RPP-0677 test passed 1 subtest, 0 failures.
- Adjacent RPP-0657 process-kill proof passed locally.
- Adjacent RPP-0617 process-kill proof passed locally.
- RPP-0637 recovery-journal retry/restart slice passed locally.
- Scoped artifact redaction scan exited 0.
- Unstaged and staged whitespace diff checks exited 0.

## Integration recommendation

Integrate after the focused validation commands stay green on the merge lane.
This proof is intentionally limited to local process-kill journal row durability
before the first mutation and should not be treated as live production-backed
durable journal release evidence.
