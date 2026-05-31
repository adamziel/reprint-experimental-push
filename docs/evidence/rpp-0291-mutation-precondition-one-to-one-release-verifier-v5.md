# RPP-0291 Mutation/Precondition One-To-One Release Verifier V5 Evidence

Date: 2026-05-31

Scope: local focused release-verifier support evidence only. The release remains
NO-GO until the broader live production-backed release boundary is satisfied.

## Proof Surface

- Adds `test/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for the
  mutation/precondition one-to-one merge invariant.
- Covers five focused fixtures: ready mixed file/row/plugin-owned row changes
  with a keep-remote decision, conflict with an independent safe mutation,
  blocked unsupported plugin-owned data beside a safe mutation, ready atomic
  grouping, and blocked atomic-group propagation.
- Replays every deterministic generated harness case and asserts each emitted
  mutation id has exactly one `live-remote` precondition with the same resource
  key, resource object, and remote-before hash.
- Verifies every precondition maps back to an emitted mutation, non-ready safe
  mutations keep their preconditions, and blocked/conflict resources do not
  create extra preconditions.
- Exercises the focused ready fixture through apply, stale replay, and forged
  ready-plan mapping variants so missing, duplicate, orphaned, mismatched, or
  non-live-remote preconditions fail before mutation.
- Keeps support evidence hash-only: resource keys, counts, statuses, and sha256
  hashes are recorded while raw fixture payloads and raw row fields are rejected
  from the proof envelope.

## Focused Verification Observed Locally

```sh
node --check test/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.test.js
node --test test/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.test.js
node --test test/rpp-0271-mutation-precondition-one-to-one-v4.test.js test/rpp-0290-planner-summary-count-consistency-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0291-mutation-precondition-one-to-one-release-verifier-v5.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0291
test reported 1 subtest ok, 0 failed. The adjacent invariant/release-verifier
suite reported 3 subtests ok, 0 failed. The scoped artifact redaction scan
returned `"ok": true` for the new evidence doc.

## Release Posture

This is support-only local release-verifier evidence. It does not claim a
production-backed release pass, does not update progress artifacts, and does
not replace the broader release checklist or CI evidence.
