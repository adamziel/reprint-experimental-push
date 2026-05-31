# RPP-0657 process kill before first mutation variant 3 evidence

Date: 2026-05-31
Issue: RPP-0657
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves that
file-backed, hash-only pre-mutation rows survive a process boundary after a
hard kill before the first target mutation. It does not prove a live
production-backed durable journal boundary and does not change release posture.

## Proof added

- Added `test/rpp-0657-process-kill-before-first-mutation-v3.test.js`.
- The test generates deterministic file mutation plans, opens a claim-fenced
  file-backed recovery journal in a child Node process, writes the durable
  pre-mutation rows, and blocks inside the first `beforeMutation` hook before
  any target write can run.
- The parent waits for a hash-only crash-boundary marker, verifies the journal
  contains only `recovery-claim-opened`, `journal-opened`, `target-planned`,
  `apply-staged`, `dependencies-validated`, and `apply-committing` rows, then
  kills the child with `SIGKILL`.
- Restart-style readback proves the exact pre-kill rows remain durable with
  monotonic sequences, row fsync markers, a restart-readable open state, and a
  restart-readable staged state. No `mutation-observed`, `journal-completed`, or
  `recovery-state` rows are present.
- Recovery inspection against the unchanged remote classifies every planned
  target as `old-remote`: all observed hashes match the journaled before hashes,
  and no target has advanced to its after hash.
- A local crash-boundary proof movement helper accepts only hash-only evidence
  bound to the current plan id, unexpired proof time, journal rows hash, marker
  hash, before-first-mutation boundary, zero mutation rows, and all-old target
  classification.
- Missing, malformed, stale, drifted, and corrupt crash-boundary evidence all
  fail closed before proof movement. Rejected cases also keep mutation
  advancement disallowed.

## Redaction

The fixture payloads use deterministic private-looking raw values, but the
journal rows, crash marker, and proof movement expose only hashes, counts,
resource keys, event names, and local support scope. The test checks
`assertJournalRecordHasNoRawValues()` on durable rows and scans all evidence
objects for raw fixture values.

## Validation run

```bash
node --check test/rpp-0657-process-kill-before-first-mutation-v3.test.js
node --test --test-name-pattern RPP-0657 test/rpp-0657-process-kill-before-first-mutation-v3.test.js
node --test --test-name-pattern RPP-0617 test/rpp-0617-process-kill-before-first-mutation.test.js
node --test --test-name-pattern RPP-0647 test/rpp-0647-restart-readable-open-state-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0657-process-kill-before-first-mutation-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- RPP-0657 syntax check exited 0.
- Focused RPP-0657 test passed 2 subtests, 0 failures.
- Adjacent RPP-0617 process-kill proof passed locally.
- Adjacent RPP-0647 restart-readable open-state proof passed locally.
- Scoped artifact redaction scan was clean.
- Whitespace diff checks were clean.

## Release posture

This evidence is local support for recovery behavior after a before-first-
mutation process kill. Final release remains NO-GO until the release lane checks
the required live production-backed durable journal boundary.
