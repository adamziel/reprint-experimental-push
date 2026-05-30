# RPP-0483 custom-table allowlist release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0483 custom table allowlist exact match, variant 5
Checklist item: RPP-0483 — Carry through the release verifier for custom table allowlist exact match, variant 5.

## Scope

This is local release-verifier carry-through evidence for the production-shaped
plugin-driver boundary. It keeps the release posture at NO-GO because it is not
live production-owned external evidence.

## Proof surface

`test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js` proves:

- the release verifier summary carries the exact custom-table tuple for
  `row:["wp_reprint_push_release_state","state_id:1"]`, owner `reprint-push`,
  driver `reprint-push-release-state`, table
  `wp_reprint_push_release_state`, and `supportsDelete: false`;
- the verifier summary now exposes `applyCarryThrough` and requires an apply
  status `200`, DB-journal commit, at least one mutation-applied row, and
  before-first-mutation revalidation for the plugin-driver resource;
- explicit final-state mismatch evidence fails the release-verifier
  plugin-driver boundary even when the allowlist and mutation tuple are exact;
- wrong owner, wrong driver, wrong table, and extra custom-table mutation
  near misses stay blocked; and
- the focused proof envelope and summary stay hash-only for the RPP-0483 private
  sentinels.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
node --test --test-name-pattern 'RPP-0463|RPP-0443|fixture forms lab table|allows plugin-owned custom table rows' test/push-planner.test.js
node --test --test-name-pattern 'production plugin-driver boundary' test/production-shaped-proof.test.js
npm run verify:release:local-production:complex-site:plugin-driver
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0483-custom-table-allowlist-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: the focused RPP-0483 test exited 0 with 7 subtests ok. The
adjacent custom-table and release-verifier slices exited 0. The local production
release verifier command reached the apply leg and carried the
`wp_reprint_push_release_state` custom-table mutation through apply:
`apply.status` was `200`, `apply.applied` was `22`, `applyCarryThrough.accepted`
was `true`, `applyCarryThrough.dbJournalMutationApplied` was `22`, and the
plugin-driver resource key was included in before-first-mutation revalidation.
That command then exited 1 at the separate preserved-remote retry gate
(`PRESERVED_REMOTE_RETRY_REQUIRED`), so it is proof of local apply
carry-through only, not full release movement. Checklist lint, the scoped
redaction scan, and whitespace checks exited 0.

## Release posture

NO-GO for final release movement from this slice alone. The proof is local and
production-shaped; a live production-owned source boundary is still required for
release promotion.
