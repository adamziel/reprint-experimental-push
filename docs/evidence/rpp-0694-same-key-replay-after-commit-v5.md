# RPP-0694 same-key replay after commit release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0694
Lane: recovery release-verifier carry-through

## Scope

This is focused local support evidence for same-key replay after commit. It
proves that the committed journal lease owner remains visible when the replay
proof is carried into the release-verifier-shaped durable recovery gate. It
does not prove production-owned durable storage, live endpoint behavior, or
final release readiness.

## Proof added

- Added standalone coverage in
  `test/rpp-0694-same-key-replay-after-commit-v5.test.js`.
- The test builds a deterministic five-target plan, opens a production-shaped
  JSONL recovery journal, advances an expired previous claim, commits all
  planned targets under the release-verifier claim, and verifies the completed
  target envelope is restart-readable and hash-only.
- Reopening the same claim key after commit and replaying the same body returns
  `appliedMutations: 0`, keeps the committed target snapshot unchanged, and
  appends replay/open audit rows without duplicating `target-planned`,
  `mutation-observed`, or `journal-completed` rows.
- The release-verifier-shaped proof asserts `GATE-2`,
  `durableRecoveryJournalBoundary: "release-verifier"`, same-key body replay,
  same-key rejected replay, old/new/blocked recovery states, and manual recovery
  audit export.
- The support evidence carries the committed lease owner through both
  `auditEvidence.leaseOwnerIdentity` and
  `auditEvidence.manualRecoveryAuditLeaseOwnerIdentity`. The active claim id,
  claim key hash, writer lease claim, and lease-fence claim must match before
  the evidence predicate accepts the proof.
- A negative fixture clears the visible lease-owner markers and flips the
  release-verifier lease-owner check, proving the predicate fails closed.

## Hash-only fixture notes

- Persisted rows and release-shaped support evidence contain target hashes,
  claim hashes, deterministic request hashes, row hashes, checked-path hashes,
  local `artifact://` references, and the sandbox-provided
  `http://127.0.0.1:8080` ingress shape only.
- The test scans journal rows, replay inspection, release summary, release
  proof, support evidence, and negative evidence for deterministic fixture
  payloads and asserts none are present.
- No bearer tokens, credentials, external URLs, raw private values, live
  endpoint output, or remote tunnel services are used.

## Validation run

```bash
node --check test/rpp-0694-same-key-replay-after-commit-v5.test.js
node --test --test-name-pattern RPP-0694 test/rpp-0694-same-key-replay-after-commit-v5.test.js
node --test --test-name-pattern RPP-0674 test/rpp-0674-same-key-replay-after-commit-v4.test.js
node --test --test-name-pattern RPP-0654 test/rpp-0654-same-key-replay-after-commit-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0694-same-key-replay-after-commit-v5.md
git diff --check
git diff --cached --check
```

Observed local result before commit: all listed commands exited 0.

## Release posture

The evidence status is `support_only`, `productionBacked: false`,
`releaseEligible: false`, and `releaseGate: "NO-GO"`. Integration
recommendation: keep this as local release-verifier support evidence and require
production-backed durable journal evidence before any release movement.
