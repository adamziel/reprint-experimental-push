# RPP-0688 restart-readable staged state release verifier v5 evidence

Date: 2026-05-31
Issue: RPP-0688
Lane: journal-recovery
Checklist item: RPP-0688 - Carry through the release verifier for restart-readable staged state, variant 5.

## Scope

This is focused local release-verifier carry-through evidence for the
restart-readable staged-state recovery path. It proves the staged retry path can
be represented in the existing durable recovery journal release proof and that
retry/replay does not overwrite preserved remote-only changes. The proof remains
local and sandbox file-backed; it does not mark the final release gate as
production-owned.

## Proof added

- Added standalone coverage in
  `test/rpp-0688-restart-readable-staged-state-v5.test.js`.
- The test adapts the RPP-0668 staged crash/retry proof: a child process opens
  a claim-fenced production-shaped journal, stages five planned targets through
  `applyPlan()`, stops at the injected post-staging boundary, and exits without
  an explicit close.
- Parent readback verifies integrity `ok`, a durable restart-readable
  `apply-staged` row, target-envelope hashes, monotonic sequences, row-level
  fsync markers, claim identity, and hash-only persisted rows.
- A same-claim retry reopens the staged journal against a retry snapshot that
  includes a remote-only change created after the simulated crash. The retry
  appends only `journal-retry-opened`, leaves the staged row identity intact,
  and does not mutate the retry snapshot.
- A release-verifier-shaped retry advances an expired claim on the same journal
  path, preserving staged-state readback while adding the lease/claim evidence
  required by `buildDurableRecoveryJournalReleaseProof()`.
- Recovery repair replay records every write and requires the write set to match
  only the planned target resource keys. The preserved before-plan and
  after-crash remote-only files are checked after replay to prove retry does not
  overwrite them.
- The staged retry-preservation summary is carried through the release proof
  envelope under the checked journal path. The proof asserts GATE-2 ownership,
  restart readability, lease identity, stale-owner fencing, claim expiry,
  old/new/blocked recovery states, same-key rejected replay, preserved remote
  retry evidence, and manual recovery audit export.
- A negative release proof flips retry preservation to a mutating replay and
  verifies the release proof fails closed.

## Validation run

```bash
node --check test/rpp-0688-restart-readable-staged-state-v5.test.js
node --test --test-name-pattern RPP-0688 test/rpp-0688-restart-readable-staged-state-v5.test.js
node --test --test-name-pattern RPP-0668 test/rpp-0668-restart-readable-staged-state-v4.test.js
node --test --test-name-pattern RPP-0648 test/rpp-0648-restart-readable-staged-state-v3.test.js
node --test --test-name-pattern RPP-0628 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0688-restart-readable-staged-state-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0688 test passed 1 subtest, 0 failures.
- RPP-0668 staged-state precedent passed 1 subtest, 0 failures.
- RPP-0648 staged-state precedent passed 3 subtests, 0 failures.
- RPP-0628 recovery-journal staged-state check passed 1 subtest, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence carries restart-readable staged-state retry preservation through
the release-verifier-shaped durable recovery proof. Final release remains NO-GO
until equivalent production-owned durable storage and live release-boundary
evidence are checked.
