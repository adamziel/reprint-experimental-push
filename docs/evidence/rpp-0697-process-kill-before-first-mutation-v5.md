# RPP-0697 process kill before first mutation release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0697
Lane: journal-recovery release-verifier carry-through

## Scope

This is local support-only recovery-journal coverage. It proves that hash-only
JSONL journal rows written before the first mutation survive a writer
`SIGKILL`, remain durable after a separate Node process restart, and can be
carried through the local release-verifier-shaped durable recovery proof. It
does not prove live production-backed durable journal storage or final release
readiness.

## Proof added

- Added `test/rpp-0697-process-kill-before-first-mutation-v5.test.js`.
- The test generates deterministic five-target and seven-target file mutation
  plans, opens a claim-fenced production-shaped recovery journal in a child
  process, and runs `applyPlan()` with an old-remote previous journal.
- The child blocks in the first `beforeMutation` callback only after durable
  `journal-opened`, `journal-ownership-recorded`, `target-planned`,
  `recovery-claim-opened`, `journal-retry-opened`, `apply-staged`,
  `dependencies-validated`, and `apply-committing` rows have been written.
- The parent reads the pre-kill journal, kills the writer with `SIGKILL`,
  rereads the journal locally, then starts a separate Node reader process and
  verifies the exact pre-kill rows are preserved with monotonic sequences,
  fsync markers, restart-readable open/staged state, and missing committed
  state.
- Restart inspection against the unchanged remote classifies every planned
  target as `old-remote`; no `mutation-observed`, `journal-completed`, or
  `recovery-state` rows are present before the kill boundary.
- A release-verifier retry advances the expired claim on the same checked
  journal path and appends only retry/ownership rows. The test verifies all
  pre-kill rows remain byte-for-byte preserved before carrying the hash-only
  durability summary into `buildDurableRecoveryJournalReleaseProof()`.
- The release-shaped evidence is marked `support_only`, `productionBacked:
  false`, `releaseEligible: false`, and `releasePosture: NO-GO`.

## Redaction

The fixtures contain deterministic private-looking file payloads, but persisted
rows, crash-boundary markers, restart inspections, release summaries, release
proofs, and evidence summaries expose only hashes, counts, event names,
resource keys, local checked-path hashes, and support scope. The test checks
`assertJournalRecordHasNoRawValues()`, `assertEvidenceHasNoRawValues()`, and
fixture payload absence across journal files and proof objects.

No bearer tokens, secrets, remote tunnel services, external endpoints, or raw
private values are included.

## Validation run

```bash
node --check test/rpp-0697-process-kill-before-first-mutation-v5.test.js
node --test --test-name-pattern RPP-0697 test/rpp-0697-process-kill-before-first-mutation-v5.test.js
node --test --test-name-pattern RPP-0677 test/rpp-0677-process-kill-before-first-mutation-v4.test.js
node --test --test-name-pattern RPP-0657 test/rpp-0657-process-kill-before-first-mutation-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0697-process-kill-before-first-mutation-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- RPP-0697 syntax check exited 0.
- Focused RPP-0697 release-verifier process-kill proof passed 1 subtest, 0
  failures.
- Adjacent RPP-0677 process-kill predecessor passed locally.
- Adjacent RPP-0657 process-kill predecessor passed locally.
- Scoped artifact redaction scan exited 0.
- Unstaged and staged whitespace diff checks exited 0.

## Release posture

This proof is support-only local recovery evidence. Integration should remain
NO-GO for final release movement until equivalent production-backed durable
journal evidence is checked at the release boundary.
