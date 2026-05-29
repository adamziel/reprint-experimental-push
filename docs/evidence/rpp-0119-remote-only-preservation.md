# RPP-0119 remote-only preservation evidence

Date: 2026-05-29
Lane: RPP-0119 remote-only preservation, variant 1
Checklist item: RPP-0119 — Implement remote-only preservation, variant 1.

## Invariant

A generated ready plan may combine a remote-only row update with unrelated local mutations. The remote-only row must remain a hash-only `keep-remote` decision with no row mutation and no row live-remote precondition. If the live remote drifts after dry-run for a planned local mutation, apply must reject with `PRECONDITION_FAILED` before mutating any remote resource.

## Evidence added

- Generated harness target coverage: `remoteOnlyPreservation` records `remote-only-post-update` cases that both preserve unplanned remote state and reject stale replay before mutation.
- Generated harness test: `RPP-0119 remote-only preservation rejects stale replay before mutation with hash-only evidence`.
- The test selects a deterministic generated remote-only preservation case, checks the remote row `keep-remote` decision, proves there is no remote-only row mutation or precondition, applies the ready plan, and verifies the remote-only row title is preserved.

## Redaction and stale replay proof

The stale replay proof drifts a later planned file mutation before apply. The replay rejects with `PRECONDITION_FAILED`, the stale remote digest is unchanged after refusal, and the failure evidence contains only resource keys and hashes (`expectedHash`, `actualHash`, and a details hash). Assertions prove the serialized evidence omits the remote-only row title, the planned local file payload, and the stale replay payload.

The tier-0 `remote-only-post-update` case remains a valid zero-mutation preservation fixture and is intentionally excluded from the stale-replay target coverage because there is no planned mutation to replay. Tiers 1 through 9 carry planned local mutations and are counted in `remoteOnlyPreservation`.

## Commands

```sh
node --test --test-name-pattern='RPP-0119' test/generated-push-harness.test.js
node --check scripts/harness/generated-push-cases.js
node --check test/generated-push-harness.test.js
npm run test:generated-push-harness
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0119-remote-only-preservation.md
git diff --check
```

Caveat: this is local generated-harness planner/apply evidence for the RPP-0119 slice. It does not edit checklist or progress state and does not change the release verdict; release remains gated by the integration/release evidence flow.
