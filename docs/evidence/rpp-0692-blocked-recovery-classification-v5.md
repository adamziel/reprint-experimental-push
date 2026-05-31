# RPP-0692 blocked recovery classification release verifier v5 evidence

Date: 2026-05-31
Issue: RPP-0692
Lane: journal-recovery
Checklist item: RPP-0692 - Carry through the release verifier for blocked recovery classification, variant 5.

## Scope

This is focused local release-verifier carry-through evidence for blocked
recovery classification. It proves that hash-only recovery journal rows written
before a process restart remain readable and preserved when the same checked
journal path is carried through the release-verifier-shaped durable recovery
proof. The proof remains sandbox file-backed support evidence; it does not
claim production-owned durable storage or final release readiness.

## Proof added

- Added standalone coverage in
  `test/rpp-0692-blocked-recovery-classification-v5.test.js`.
- A child process opens a claim-fenced JSONL recovery journal, writes the claim
  row, open row, four target rows, staged/dependency/committing rows, two
  `mutation-observed` rows, and a `blocked-recovery` recovery-state row, then
  exits after an injected partial commit failure.
- Parent restart readback verifies monotonic sequences, row-level fsync
  markers, restart-readable open/staged/committed state, two durable mutation
  rows, zero completed rows, and a committed target envelope of two of four
  targets.
- A production-style retry advances the expired writer claim on the same
  journal path and appends retry/ownership rows without altering any rows
  written before the process restart.
- Restart inspection classifies the partial remote as `blocked-recovery` with
  `{ old: 2, new: 2, blockedUnknown: 0 }` and reason code
  `BLOCKED_PARTIAL_REMOTE`. A drifted restart readback classifies as
  `blocked-recovery` with `{ old: 1, new: 2, blockedUnknown: 1 }` and reason
  code `BLOCKED_TARGET_UNKNOWN`.
- The release-verifier-shaped summary carries a hash-only
  `restartDurability` envelope containing the checked journal path, durable row
  counts, row hashes, committed-state counters, and the blocked classification
  row count. The durable recovery journal proof asserts `GATE-2`,
  `durableRecoveryJournalBoundary: release-verifier`, `gateStatus: proven`,
  restart readability, lease identity, stale-owner fencing, claim expiry,
  old/new/blocked states, same-key rejected replay, preserved rejected remote
  evidence, and manual recovery audit export.
- A negative proof flips retry preservation to mutating replay and verifies the
  release proof fails closed.

## Hash-only fixture notes

- Persisted rows and release-shaped evidence contain target hashes, claim
  hashes, deterministic request hashes, row hashes, and local `artifact://`
  references only.
- The test scans the JSONL file, parsed journal, production retry inspection,
  restart inspections, release summary, release proof, and negative proof for
  fixture payload sentinels and asserts none are present.
- No live endpoints, remote tunnel services, bearer tokens, or external network
  dependencies are used.

## Validation run

```bash
node --check test/rpp-0692-blocked-recovery-classification-v5.test.js
node --test --test-name-pattern RPP-0692 test/rpp-0692-blocked-recovery-classification-v5.test.js
node --test --test-name-pattern RPP-0672 test/rpp-0672-blocked-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0652 test/rpp-0652-blocked-recovery-classification-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0692-blocked-recovery-classification-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0692 test passed 1 subtest, 0 failures.
- RPP-0672 blocked recovery predecessor passed 1 subtest, 0 failures.
- RPP-0652 blocked recovery predecessor passed 2 subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence carries blocked recovery restart readback through the
release-verifier-shaped durable recovery proof. Final release remains NO-GO
until equivalent production-owned durable storage and live release-boundary
evidence are checked.
