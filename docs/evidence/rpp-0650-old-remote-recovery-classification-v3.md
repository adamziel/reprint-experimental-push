# RPP-0650 old remote recovery classification, variant 3

Date: 2026-05-31
Issue: RPP-0650
Lane: recovery

## Proof added

- Added generated local coverage for the old-remote recovery classification
  path in `test/rpp-0650-old-remote-recovery-classification-v3.test.js`.
- The regression opens a claim-fenced production recovery journal, advances an
  expired claim, restarts from the same JSONL path, and verifies the current
  remote still matches the journaled before-hash envelope for all planned
  targets.
- Restart inspection reports `old-remote`, `reasonCode: OLD_REMOTE`, and counts
  `{ old: 3, new: 0, blockedUnknown: 0 }` with hash-only target evidence.
- The release-shaped verifier summary carries that same old-remote
  classification into the durable recovery journal `GATE-2` proof. The proof
  reports `ok: true`, `gateStatus: proven`, `sameReleaseBoundary: true`,
  `checks.oldState: true`, and `partialStates.old.proved: true`.
- The same test rejects missing, malformed, stale, and drifted old-remote
  classification evidence before the recovery proof can become `ok: true`.

## Hash-only fixture notes

- Persisted journal rows contain target before/after hashes and claim hashes
  only; no raw fixture values are written to the proof artifacts.
- The release-shaped fixture uses deterministic 64-character request hashes and
  local artifact references such as `artifact://rpp-0650-old-remote-v3-support`.
- The checked path is the sandbox-local JSONL recovery journal path produced by
  the test; no live endpoints or remote tunnel services are used.

## Validation run

```bash
node --check test/rpp-0650-old-remote-recovery-classification-v3.test.js
node --test --test-name-pattern RPP-0650 test/rpp-0650-old-remote-recovery-classification-v3.test.js
node --test --test-name-pattern RPP-0611 test/rpp-0611-new-remote-recovery-classification.test.js
node --test --test-name-pattern RPP-0612 test/rpp-0612-blocked-recovery-classification.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0650-old-remote-recovery-classification-v3.md
git diff --check
git diff --cached --check
```

Observed local result: all commands exited 0 in this worktree.

## Residual scope

This is local support evidence for generated old-remote recovery classification
coverage and release-shaped verifier carry-through. It does not claim final
release readiness and does not cover live endpoints, plugin-driver behavior,
executor-auth replay, storage benchmarks, or progress publishing.
