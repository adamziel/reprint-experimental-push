# RPP-0670 old remote recovery classification variant 4 evidence

Date: 2026-05-31
Issue: RPP-0670
Lane: recovery

## Scope

This is focused local recovery-journal regression coverage. It proves the
file-backed claim-fenced journal can be reopened on the same JSONL path,
classified as `old-remote`, and carried into the release-verifier recovery gate
helper as a proven `GATE-2` old-state proof. Final release status remains
NO-GO until equivalent production-owned durable storage and release-boundary
evidence are checked at the live release boundary.

## Proof added

- Added standalone coverage in
  `test/rpp-0670-old-remote-recovery-classification-v4.test.js`.
- The proof builds a four-target push plan, opens a production recovery journal
  claim, closes before mutation work, then advances an expired retry claim on
  the same persisted recovery path.
- Restart/readback verifies the JSONL journal is integrity-clean,
  restart-readable, sequential, fsynced, and contains no mutation-preparation,
  mutation-observed, journal-completed, or apply-committed rows.
- Restart inspection reports `old-remote`, `reasonCode: OLD_REMOTE`, counts
  `{ old: 4, new: 0, blockedUnknown: 0 }`, and hash-only target evidence where
  every observed target hash matches the journaled before hash and differs from
  the planned after hash.
- The old-remote classification is attached to the same checked recovery path
  in the release summary. `buildDurableRecoveryJournalReleaseProof()` reports
  `gate: GATE-2`, `durableRecoveryJournalBoundary: release-verifier`,
  `gateStatus: proven`, `sameReleaseBoundary: true`, `checks.oldState: true`,
  `checks.recoveryInspectAfterRestart: true`, and
  `partialStates.old.proved: true`.
- The negative regression rejects missing, malformed, stale, and drifted
  old-remote classification evidence before the release proof can become
  `ok: true`.
- Persisted rows, restart inspection summaries, release proof evidence, and
  the raw journal file are scanned for deterministic fixture payloads. Every
  persisted row also satisfies `assertJournalRecordHasNoRawValues()`.

## Validation run

```bash
node --check test/rpp-0670-old-remote-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0670 test/rpp-0670-old-remote-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0650 test/rpp-0650-old-remote-recovery-classification-v3.test.js
node --test --test-name-pattern 'old-remote|RPP-0630' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0670-old-remote-recovery-classification-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0670 test passed 2 subtests, 0 failures.
- Adjacent RPP-0650 variant-3 proof passed 2 subtests, 0 failures.
- Adjacent old-remote and RPP-0630 recovery-journal run passed all selected
  subtests.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local recovery support evidence only. It does not change release status,
does not claim production-backed release readiness, and keeps final release
NO-GO.
