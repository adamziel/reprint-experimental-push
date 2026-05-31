# RPP-0654 same-key replay after commit, variant 3

Date: 2026-05-31
Issue: RPP-0654
Lane: recovery

## Proof added

- Added generated local coverage in
  `test/rpp-0654-same-key-replay-after-commit-v3.test.js`.
- The test opens a claim-fenced production-shaped recovery journal, advances an
  expired prior claim, commits all planned targets under the active claim, then
  reopens the same claim key and replays the already committed plan.
- Same-key replay after commit returns `appliedMutations: 0`, leaves the target
  snapshot unchanged, appends replay/open audit rows only, and does not add
  duplicate `mutation-observed`, `journal-completed`, or `target-planned` rows.
- Restart readback keeps `committedState.status: "completed"`,
  `targetEnvelope.allTargetsCommitted: true`, and a visible
  `committedState.leaseOwner` identity for the active claim.
- The release-shaped proof keeps `checks.sameKeyBodyReplay: true` and
  `checks.leaseOwnerIdentity: true`; the generated support evidence also
  carries the lease owner identity in an explicit hash-only audit block.
- Missing, malformed, stale, and drifted committed target envelopes are rejected
  before replay/proof movement. The rejected paths do not append retry rows or
  mutation rows and their generated evidence fixtures do not satisfy the local
  proof predicate.

## Hash-only fixture notes

- Persisted target, mutation, claim, replay, journal, and release-proof evidence
  is asserted with row-level redaction checks and deterministic fixture scans.
- The proof uses only target hashes, claim hashes, journal row hashes, release
  proof hashes, and fixture claim labels. It does not include raw site values,
  bearer tokens, credentials, or live endpoint output.
- The source URL in the release-shaped fixture remains the sandbox-provided
  local ingress shape. No external network dependency, live endpoint, or remote
  tunnel is used.

## Validation run

```bash
node --check test/rpp-0654-same-key-replay-after-commit-v3.test.js
node --test --test-name-pattern RPP-0654 test/rpp-0654-same-key-replay-after-commit-v3.test.js
node --test --test-name-pattern RPP-0615 test/rpp-0615-same-key-replay-after-rejection.test.js
node --test --test-name-pattern recovery-journal test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0654-same-key-replay-after-commit-v3.md
git diff --check
git diff --cached --check
```

Observed local result before commit: all listed commands exited 0.

## Residual scope

This is local recovery support evidence for generated same-key replay after
commit coverage. It does not claim final release readiness and does not replace
live production-backed durable journal evidence at the release boundary.
