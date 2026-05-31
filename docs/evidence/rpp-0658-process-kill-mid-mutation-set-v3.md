# RPP-0658 process kill mid mutation set variant 3 evidence

Date: 2026-05-31
Issue: RPP-0658
Lane: recovery

## Scope

This is generated local recovery-journal coverage for the process-kill
mid-mutation-set retry path. It uses sandbox JSONL journals and synthetic site
fixtures only. It does not claim live production-backed durable journal release
readiness.

## Proof added

- Added standalone generated coverage in
  `test/rpp-0658-process-kill-mid-mutation-set-v3.test.js`.
- The test builds deterministic four-target and six-target file plans with two
  remote-only preserved resources outside the mutation and precondition sets.
- A child Node process opens a claim-fenced production-shaped JSONL recovery
  journal, runs `applyPlan()`, fsyncs a remote snapshot after the configured
  `mutation-observed` row, and then sends itself `SIGKILL` before
  `journal-completed` can be written.
- Parent readback verifies the partial journal is integrity `ok`,
  restart-readable, has only the expected committed mutation rows, has no
  completion row, and carries hash-only target evidence.
- A same-claim production retry appends only a retry-open row. Recovery
  inspection classifies the remote as partial and repair inspection reports
  `partial-remote-replayable`.
- Replay writes only the old planned targets, skips the already-applied planned
  targets, and asserts before and after every write that both preserved remote
  resources keep their retry values.
- Journal rows, retry inspection, repair rows, and the local evidence summary
  are checked for raw fixture payload leaks.

## Validation run

```bash
node --check test/rpp-0658-process-kill-mid-mutation-set-v3.test.js
node --test --test-name-pattern RPP-0658 test/rpp-0658-process-kill-mid-mutation-set-v3.test.js
node --test --test-name-pattern RPP-0648 test/rpp-0648-restart-readable-staged-state-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0658-process-kill-mid-mutation-set-v3.md
git diff --check
git diff --cached --check
```

Observed local result before commit: all commands exited 0.

## Residual scope

This evidence is limited to generated local process-kill recovery coverage and
retry preservation for remote-only resources. It does not cover live endpoints,
remote tunnel access, plugin-driver release verification, executor-auth replay,
storage benchmarks, progress publishing, or supervisor reports.
