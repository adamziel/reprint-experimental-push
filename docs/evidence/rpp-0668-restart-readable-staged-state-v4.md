# RPP-0668 restart-readable staged state variant 4 evidence

Date: 2026-05-31
Issue: RPP-0668
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage. It proves a
restart-readable staged journal can be retried without overwriting remote-only
changes that existed before planning or appeared after the simulated crash.
Final release status remains NO-GO until equivalent production-owned durable
storage and live release-boundary evidence are checked.

## Proof added

- Added standalone coverage in
  `test/rpp-0668-restart-readable-staged-state-v4.test.js`.
- The proof adapts the RPP-0648 file-backed staged-state process-boundary
  pattern: a child process opens a claim-fenced production-shaped journal,
  stages four planned targets through `applyPlan()`, stops at the injected
  post-staging failure boundary, and exits without an explicit close.
- Parent readback verifies integrity `ok`, restart-readable staged state,
  one durable `apply-staged` row, the target envelope, monotonic sequences,
  row-level fsync markers, the active claim row, and hash-only persisted rows.
- A same-claim production retry reopens the journal against a remote snapshot
  that includes a remote-only change created after the simulated crash. The
  retry appends only `journal-retry-opened`, leaves the staged row identity
  intact, and does not mutate the retry snapshot.
- Recovery repair replay logs every resource write and requires the write set
  to match only the planned target resource keys. The full retry snapshot is
  compared against an expected copy with only planned mutations applied, proving
  the preserved remote-only files remain unchanged.
- Persisted rows, production inspection surfaces, repair inspection surfaces,
  replay evidence, and the raw journal file are checked for hash-only evidence
  and no deterministic fixture payload leaks.

## Validation run

```bash
node --check test/rpp-0668-restart-readable-staged-state-v4.test.js
node --test --test-name-pattern RPP-0668 test/rpp-0668-restart-readable-staged-state-v4.test.js
node --test --test-name-pattern RPP-0648 test/rpp-0648-restart-readable-staged-state-v3.test.js
node --test --test-name-pattern 'staged state survives|RPP-0628' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0668-restart-readable-staged-state-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0668 test passed 1 subtest, 0 failures.
- RPP-0648 staged-state precedent passed 3 subtests, 0 failures.
- Adjacent recovery-journal staged-state run passed 2 subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local recovery support. Final release remains NO-GO until live
production-backed durable journal staged-state evidence is checked at the
release boundary.
