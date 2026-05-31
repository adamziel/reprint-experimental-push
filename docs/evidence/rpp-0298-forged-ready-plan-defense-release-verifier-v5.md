# RPP-0298 forged ready plan defense release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0298 forged ready plan defense release-verifier carry-through, variant 5
Checklist item: RPP-0298 - Carry through the release verifier for forged ready
plan defense, variant 5.
Release status: NO-GO. This is local support evidence only.

## Scope

This slice carries the forged ready-plan defense into a focused
release-verifier-shaped proof without editing generated harness files, shared
release pages, progress surfaces, or the scenario matrix.

## Proof surface

`test/rpp-0298-forged-ready-plan-defense-release-verifier-v5.test.js` builds a
ready local plan with one file mutation and one `wp_posts` row mutation. The
proof asserts each mutation has exactly one matching `live-remote` precondition
bound to the observed remote hash, then serializes only release-verifier support
evidence: status, summary, resource keys, mutation/precondition hashes, refusal
metadata, remote preservation hashes, and aggregate issue codes.

Forged ready-plan attempts cover:

- removing a live precondition while replacing `remoteBeforeHash` with non-hash
  private material;
- duplicating a live-remote precondition;
- replacing a precondition hash with non-hash private material; and
- replacing the planned mutation body while leaving the original local hash.

Every forged attempt is rejected with `PLAN_INVARIANT_VIOLATION` before the
mutation hook runs, before durable journal events are appended, and before the
remote snapshot changes. The invalid-hash issue details are represented by
digest, type, and length metadata instead of raw values.

## Redaction proof

The test serializes the full release-verifier proof and directly checks refusal
details. It asserts that raw fixture strings, file content fields, and
`post_title` fields do not appear, and it also runs
`assertEvidenceHasNoRawValues` over the proof envelope.

## Validation commands

```sh
node --check test/rpp-0298-forged-ready-plan-defense-release-verifier-v5.test.js
node --check test/rpp-0238-forged-ready-plan-defense-v2.test.js
node --check test/rpp-0258-forged-ready-plan-defense-v3.test.js
node --check test/rpp-0278-forged-ready-plan-defense-v4.test.js
node --test test/rpp-0298-forged-ready-plan-defense-release-verifier-v5.test.js
node --test test/rpp-0238-forged-ready-plan-defense-v2.test.js test/rpp-0258-forged-ready-plan-defense-v3.test.js test/rpp-0278-forged-ready-plan-defense-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0298-forged-ready-plan-defense-release-verifier-v5.md
git diff --check
```

Focused local validation observed all listed commands exiting 0. The RPP-0298
test reported 2 subtests ok and 0 failed; the adjacent forged ready-plan lineage
reported 4 subtests ok and 0 failed. Broader final release status remains NO-GO
until integration accepts production-backed release evidence.
