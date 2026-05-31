# RPP-0698 process kill mid mutation set release verifier v5 evidence

Date: 2026-05-31
Issue: RPP-0698
Lane: recovery release-verifier carry-through

## Scope

This is local support-only recovery evidence for the process-kill
mid-mutation-set retry path. It uses deterministic sandbox fixtures and a local
JSONL recovery journal shaped like the release verifier recovery gate. It does
not prove production-owned durable storage or final release readiness.

## Proof added

- Added standalone coverage in
  `test/rpp-0698-process-kill-mid-mutation-set-v5.test.js`.
- The test builds deterministic six-target and eight-target plans with two
  remote-only preserved files outside the mutation and precondition sets.
- A child Node process opens a claim-fenced production-shaped JSONL journal,
  runs `applyPlan()`, fsyncs a remote snapshot after the configured
  `mutation-observed` row, and then sends itself `SIGKILL` before
  `journal-completed` can be written.
- Parent restart readback verifies integrity `ok`, restart-readable committed
  state, only the expected committed mutation rows, zero completion rows,
  monotonic sequences, fsync markers, and hash-only target evidence.
- A release-verifier retry advances the expired writer claim on the same
  checked journal path and appends only retry ownership rows. The rows written
  before the process kill are preserved byte-for-byte.
- Recovery inspection classifies the killed snapshot as `blocked-recovery`
  with partial old/new counts, and repair inspection reports
  `partial-remote-replayable`.
- Replay writes only the old planned targets, skips already-applied planned
  targets, and asserts before and after every write that the preserved
  remote-only files keep their retry values.
- The release-verifier-shaped proof carries the restarted journal rows,
  preserved remote evidence, old/new/blocked classifications, stale-owner
  fencing, same-key replay, different-body conflict evidence, rejected replay,
  and manual recovery audit export through `GATE-2`.
- A negative proof flips rejected replay preservation to mutating replay and
  verifies the durable recovery journal proof fails closed.

## Hash-only fixture notes

- Persisted rows, restart inspections, repair summaries, preserved remote
  evidence, and release-verifier proof objects contain hashes, counts,
  resource keys, state names, checked-path hashes, and local `artifact://`
  references only.
- The test scans the JSONL file, parsed journal rows, restart inspections,
  repair rows, release summary, release proof, negative proof, and support
  evidence for deterministic fixture payloads.
- No live endpoint, remote tunnel, bearer credential, external URL, or raw
  private value is used.

## Validation run

```bash
node --check test/rpp-0698-process-kill-mid-mutation-set-v5.test.js
node --test --test-name-pattern RPP-0698 test/rpp-0698-process-kill-mid-mutation-set-v5.test.js
node --test --test-name-pattern RPP-0678 test/rpp-0678-process-kill-mid-mutation-set-v4.test.js
node --test --test-name-pattern RPP-0658 test/rpp-0658-process-kill-mid-mutation-set-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0698-process-kill-mid-mutation-set-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0698 release-verifier process-kill proof passed locally.
- RPP-0678 process-kill predecessor passed locally.
- RPP-0658 process-kill predecessor passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local support-only release-verifier carry-through for process
kill retry preservation. Final release remains NO-GO until equivalent
production-backed durable journal and live release-boundary evidence are
checked.

Integration recommendation: keep this as support-only recovery evidence and
require production-backed durable journal evidence before release movement.
