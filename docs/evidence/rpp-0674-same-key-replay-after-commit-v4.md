# RPP-0674 same-key replay after commit, variant 4

Date: 2026-05-31
Issue: RPP-0674
Lane: recovery

## Proof added

- Added focused local coverage in
  `test/rpp-0674-same-key-replay-after-commit-v4.test.js`.
- The test opens a claim-fenced production-shaped recovery journal, advances an
  expired prior claim, commits four planned targets under the active claim, then
  reopens the same claim key and replays the already committed plan.
- Same-key replay after commit returns `appliedMutations: 0`, leaves the target
  snapshot unchanged, appends replay/open audit rows only, and does not add
  duplicate `mutation-observed`, `journal-completed`, or `target-planned` rows.
- Restart readback keeps `committedState.status: "completed"`,
  `targetEnvelope.allTargetsCommitted: true`, and a visible
  `committedState.leaseOwner` identity for the active claim.
- Variant 4 adds explicit audit evidence for the lease owner identity. The
  generated proof requires the committed lease owner and the manual recovery
  audit lease owner to expose the same active claim id, claim key hash, writer
  lease claim, and lease-fence claim before proof movement is accepted.
- A local negative fixture clears the visible lease-owner flags and confirms the
  evidence predicate fails closed.

## Hash-only fixture notes

- Persisted target, mutation, claim, replay, journal, and release-proof evidence
  is asserted with row-level redaction checks and deterministic fixture scans.
- The proof uses target hashes, claim hashes, journal row hashes, release proof
  hashes, and fixture claim labels. It does not include raw site values, bearer
  tokens, credentials, or live endpoint output.
- The source URL in the release-shaped fixture remains the sandbox-provided
  local ingress shape. No external network dependency, live endpoint, or remote
  tunnel is used.

## Validation run

```bash
node --check test/rpp-0674-same-key-replay-after-commit-v4.test.js
node --test --test-name-pattern RPP-0674 test/rpp-0674-same-key-replay-after-commit-v4.test.js
node --test --test-name-pattern RPP-0654 test/rpp-0654-same-key-replay-after-commit-v3.test.js
node --test --test-name-pattern 'committed state survives|lease owner|same-key replay' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0674-same-key-replay-after-commit-v4.md
git diff --check
git diff --cached --check
```

Observed local result before commit: all listed commands exited 0.

## Residual scope

This is local recovery support evidence for focused generated same-key replay
after commit coverage. It does not claim final release readiness and does not
replace live production-backed durable journal evidence at the release boundary.
