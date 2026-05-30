# RPP-0398 GUID and slug collision release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0398 GUID and slug collision release-verifier carry-through, variant 5
Checklist item: RPP-0398 — Carry through the release verifier for GUID and slug collision handling, variant 5.

## Scope

This adds local generated release-verifier carry-through for WordPress post
natural identity collision handling. The generated harness now carries a
`postGuidSlugCollision` target with one ready unique-post case and one stale
collision case per tier.

The proof is local/support-only. It does not broaden the checked live production
boundary, and release posture remains NO-GO until separate production-backed
release evidence satisfies the broader release gate.

## Proof surface

`test/rpp-0398-guid-slug-collision-release-verifier-v5.test.js` proves that the
release verifier:

- observes 20 generated GUID/slug collision cases across tiers 0 through 9;
- applies the 10 ready unique-post cases and verifies their live-remote
  preconditions reject stale replay with `PRECONDITION_FAILED` before mutation;
- blocks the 10 stale collision cases with `stale-wordpress-graph-identity` and
  `post-natural-identity-collision` references for both `guid` and
  `post_type+post_name` identity kinds;
- preserves the colliding remote row as a `keep-remote` decision with no remote
  row mutation or precondition; and
- keeps release-verifier evidence hash-only, excluding raw generated titles,
  GUIDs, slugs, and stale replay sentinels.

## Focused verification observed locally

```sh
node --check scripts/harness/generated-push-cases.js
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/generated-push-harness.test.js
node --check test/rpp-0398-guid-slug-collision-release-verifier-v5.test.js
node --test --test-name-pattern=RPP-0398 test/generated-push-harness.test.js
node --test test/rpp-0398-guid-slug-collision-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0303|RPP-0342|RPP-0347|RPP-0398' test/generated-push-harness.test.js test/rpp-0398-guid-slug-collision-release-verifier-v5.test.js
node --test test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js test/rpp-0282-independent-local-row-remote-file-release-verifier-v5.test.js test/rpp-0286-remote-only-plugin-metadata-release-verifier-v5.test.js test/rpp-0398-guid-slug-collision-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0398-guid-slug-collision-release-verifier-v5.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0398
release-verifier test reported 2 subtests ok, 0 failed. The generated harness
RPP-0398 slice reported 1 subtest ok, 0 failed. Checklist lint returned
`"ok": true`; the scoped artifact redaction scan returned `"ok": true` for
the touched docs.

## Release posture

This is local generated release-verifier carry-through evidence only. The
emitted `postGuidSlugCollision` proof is support-only and productionBacked
`false`; final release remains NO-GO until live production proof satisfies the
broader release boundary.
