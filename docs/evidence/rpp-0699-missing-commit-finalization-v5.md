# RPP-0699 missing commit finalization release verifier variant 5

Date: 2026-05-31
Issue: RPP-0699
Lane: recovery release-verifier carry-through

## Scope

This is local support-only recovery evidence for missing commit finalization. It
uses sandbox file-backed production-shaped journals and carries the finalized
restart state through the release-verifier durable recovery proof helper. It
does not use live production-owned storage, remote tunnels, external endpoints,
or bearer credentials. Final release posture remains NO-GO.

## Proof added

- Added `test/rpp-0699-missing-commit-finalization-v5.test.js`.
- The test generates four-target and seven-target plans, opens an initial
  writer claim, then advances an expired release-verifier retry claim on the
  same checked journal path.
- Under the retry claim, a child process injects failure after every planned
  `mutation-observed` row is durably written but before `journal-completed`.
- Parent restart readback proves integrity OK, monotonic rows, fsync markers,
  hash-only mutation evidence, zero completed rows before finalization, and a
  committed target envelope that is fully hash-accounted but not finalized.
- The same retry claim reopens the journal and appends only the missing
  `journal-completed` row. The original mutation row sequence hash is
  preserved and finalized state reports `completedRows: 1`.
- Lease owner identity is visible in audit evidence before and after
  finalization: visible flag, `claimId`, `claimHash`, `claimKeyHash`, sequence,
  event type, and a deterministic lease-owner block hash.
- The release-verifier-shaped proof carries that identity through
  `buildDurableRecoveryJournalReleaseProof()` with `gate: "GATE-2"`,
  `durableRecoveryJournalBoundary: "release-verifier"`,
  `checks.leaseOwnerIdentity: true`, stale-owner fencing, claim expiry,
  old/new/blocked recovery states, same-key replay-after-rejection, and manual
  recovery audit export.
- The support evidence keeps `productionBacked: false`,
  `releaseEligible: false`, `releaseMovement.allowed: false`, and
  `releasePosture: "NO-GO"`.

## Redaction

The test checks persisted JSONL rows, restart inspections, release summaries,
release proof objects, and support evidence for deterministic fixture payloads.
Journal rows are also validated with `assertJournalRecordHasNoRawValues()`.
The evidence carries hashes, counts, claim identities, local checked-path
hashes, and local `artifact://` references only. It excludes raw site payloads,
secrets, bearer tokens, credentials, production-owned values, and external
URLs.

## Validation run

```bash
node --check test/rpp-0699-missing-commit-finalization-v5.test.js
node --test --test-name-pattern RPP-0699 test/rpp-0699-missing-commit-finalization-v5.test.js
node --test --test-name-pattern RPP-0679 test/rpp-0679-missing-commit-finalization-v4.test.js
node --test --test-name-pattern RPP-0659 test/rpp-0659-missing-commit-finalization-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0699-missing-commit-finalization-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0699 release-verifier missing-finalization proof passed 1
  subtest, 0 failures.
- Predecessor RPP-0679 missing-finalization proof passed locally.
- Predecessor RPP-0659 missing-finalization proof passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is support-only generated recovery coverage. It proves lease
owner identity is restart-readable and visible in audit evidence when missing
commit finalization is repaired locally, then carried through the release
verifier helper. It does not replace production-backed durable journal evidence
or live release-boundary verification. Final release remains NO-GO.

Integration recommendation: carry this as local recovery-gate support evidence
only; require production-backed durable journal evidence before release
movement.
