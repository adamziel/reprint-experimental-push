# RPP-0297 Conflict Plan Apply Refusal Release Verifier V5 Evidence

Date: 2026-05-31

Scope: local focused release-verifier support evidence only. The release remains
NO-GO until the broader live production-backed release boundary is satisfied.

## Proof Surface

- Adds `test/rpp-0297-conflict-plan-apply-refusal-release-verifier-v5.test.js`
  as the variant 5 release-verifier carry-through for conflict-plan apply
  refusal.
- Builds a focused conflict fixture with one independent file mutation, one
  remote-only keep-remote decision, and one divergent `wp_posts` row conflict.
- Proves the original conflict plan is refused with `PLAN_NOT_READY`, before
  durable journal writes or mutation staging.
- Proves two forged ready-plan paths fail before mutation: retaining conflict
  evidence returns `PLAN_INVARIANT_VIOLATION` with
  `READY_PLAN_HAS_CONFLICTS`, and forging the conflicted row into a mutation
  returns `MUTATION_REMOTE_CHANGE_NOT_UNCHANGED`.
- Proves a stale replay of the independent mutation fails with
  `PRECONDITION_FAILED`, preserving the live remote and writing no durable
  journal events.
- Replays all 620 deterministic generated harness cases. The local generated
  pass observed 201 conflict plans, 182 conflict plans with safe mutations, 44
  stale mutation attempts, 1,567 planned mutations, 1,567 live-remote
  preconditions, 583 conflicts, and 490 blockers.
- Generated conflict coverage includes `row-conflict`,
  `file-topology-conflict`, `file-conflict`, and `plugin-data-conflict`.
- Keeps support evidence hash-only: resource keys, statuses, counts, refusal
  codes, issue codes, durable journal counts, and sha256 hashes are recorded
  while raw fixture payloads and raw row fields are rejected from the proof
  envelope.

## Focused Verification Observed Locally

```sh
node --check test/rpp-0297-conflict-plan-apply-refusal-release-verifier-v5.test.js
node --check test/rpp-0257-conflict-plan-apply-refusal-v3.test.js
node --check test/rpp-0277-conflict-plan-apply-refusal-v4.test.js
node --test test/rpp-0297-conflict-plan-apply-refusal-release-verifier-v5.test.js
node --test test/rpp-0257-conflict-plan-apply-refusal-v3.test.js test/rpp-0277-conflict-plan-apply-refusal-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0297-conflict-plan-apply-refusal-release-verifier-v5.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0297
test reported 1 subtest ok, 0 failed. The adjacent conflict-plan apply refusal
suite reported 2 subtests ok, 0 failed. The scoped artifact redaction scan
returned `"ok": true` for the new evidence doc.

## Release Posture

This is support-only local release-verifier evidence. It does not claim a
production-backed release pass, does not update progress artifacts, and does
not replace the broader release checklist or CI evidence.
