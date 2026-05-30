# RPP-0269 conflict evidence hash redaction v4

Date: 2026-05-30
Lane: RPP-0269 conflict evidence hash redaction, variant 4
Checklist item: RPP-0269 — Add focused regression coverage for conflict evidence hash redaction, variant 4.

## Scope

This is local focused regression coverage for direct conflict evidence emitted by
`createPushPlan()` and refusal evidence emitted by `applyPlan()`. It validates
existing planner/apply behavior only; no production implementation changes were
needed.

## Proof surface

`test/rpp-0269-conflict-evidence-hash-redaction-v4.test.js` builds one mixed
conflict fixture with private raw values in the source snapshots:

- a file create/create conflict under `file:wp-content/uploads/rpp-0269-private-report.txt`;
- a core `wp_posts` row delete/update conflict; and
- a plugin-owned `wp_options` update/update conflict classified as
  `plugin-data-conflict` for owner `forms`.

For each conflict, the test asserts that planner conflict evidence contains the
resource key, conflict class, resolution policy, change-state labels, file type
where applicable, and SHA-256 hashes derived from the observed base/local/remote
resources. It also asserts that no mutation or live-remote precondition is
emitted for any conflicted resource.

The test replays planning over cloned inputs to prove deterministic hash-only
conflict projection. It then calls `applyPlan()` and verifies `PLAN_NOT_READY`,
no durable journal events, and an unchanged remote snapshot. The proof envelope
retains only resource/class/policy labels, state/hash metadata, refusal code and
status, journal-event count, and SHA-256 proof hashes.

## Focused verification observed locally

```sh
node --check test/rpp-0269-conflict-evidence-hash-redaction-v4.test.js
node --test test/rpp-0269-conflict-evidence-hash-redaction-v4.test.js
node --test --test-name-pattern=RPP-0209 test/push-planner.test.js
node --test --test-name-pattern=RPP-0229 test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0269-conflict-evidence-hash-redaction-v4.md docs/scenario-matrix.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0269
test reported 1 subtest ok and zero failures; adjacent RPP-0209 and RPP-0229
conflict-redaction tests each reported 1 subtest ok. No runnable RPP-0249
focused coverage file exists in this worktree, so no RPP-0249 command was run.
Checklist lint returned `"ok": true`; the scoped artifact redaction scan
returned `"ok": true` for the touched docs.

## Redaction assertions

The focused test scans conflict records, refusal details, and the proof envelope
for the private fixture values and raw row/payload field names, then runs the
shared evidence redaction helper over the same evidence surfaces. `redactEvidence()`
is asserted to leave the conflict/refusal/proof evidence unchanged, proving that
these surfaces are already hash-only metadata.

## Release posture

This remains local focused Node regression evidence. Broader release readiness
continues to depend on the adjacent generated coverage and release-verifier
lanes.
