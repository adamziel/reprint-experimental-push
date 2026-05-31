# RPP-0292 RemoteBeforeHash Correctness Release Verifier V5 Evidence

Date: 2026-05-31

Scope: local focused release-verifier support evidence only. The release remains
NO-GO until the broader live production-backed release boundary is satisfied.

## Proof Surface

- Adds `test/rpp-0292-remote-before-hash-correctness-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for the
  `remoteBeforeHash` merge invariant.
- Builds a focused ready fixture with one file mutation, one plugin metadata
  mutation, and one `wp_posts` row mutation. Each mutation must carry a
  `remoteBeforeHash` equal to the live remote resource hash, matched by exactly
  one `live-remote` precondition.
- Applies the focused ready fixture successfully, then proves two refusal paths:
  a forged precondition resource alias fails with `PLAN_INVARIANT_VIOLATION`,
  and a stale later row mutation fails with `PRECONDITION_FAILED` before the
  earlier file or plugin mutations are staged.
- Replays all 620 deterministic generated harness cases. The local generated
  pass covered 345 ready, 201 conflict, and 74 blocked plans with 8,525
  mutations and 8,525 preconditions.
- Samples 23 ready mutation shapes across 12 generated families and proves both
  forged-hash and stale-live-remote replay attempts fail before any
  `target-planned` or mutation durable journal event.
- Keeps support evidence hash-only: resource keys, statuses, counts, error
  codes, journal event types, and sha256 hashes are recorded while raw focused
  fixture payloads and generated stale markers are rejected from serialized
  evidence.

## Focused Verification Observed Locally

```sh
node --check test/rpp-0292-remote-before-hash-correctness-release-verifier-v5.test.js
node --test test/rpp-0292-remote-before-hash-correctness-release-verifier-v5.test.js
node --test test/rpp-0232-remote-before-hash-correctness-v2.test.js test/rpp-0252-remote-before-hash-correctness-v3.test.js test/rpp-0272-remote-before-hash-correctness-v4.test.js
node --test --test-name-pattern=RPP-0212 test/push-planner.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0292-remote-before-hash-correctness-release-verifier-v5.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0292
test reported 1 subtest ok, 0 failed. The adjacent remote-before-hash file slice
reported 9 subtests ok, 0 failed, and the RPP-0212 planner slice reported 2
subtests ok, 0 failed. The scoped artifact redaction scan returned `"ok": true`
for the new evidence doc.

## Release Posture

This is support-only local release-verifier evidence. It does not claim a
production-backed release pass, does not update progress artifacts, and does
not replace the broader release checklist or CI evidence.
