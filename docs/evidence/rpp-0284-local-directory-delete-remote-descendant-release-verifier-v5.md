# RPP-0284 local directory delete versus remote descendant release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0284 local directory delete versus remote descendant create release-verifier carry-through, variant 5
Checklist item: RPP-0284 — Carry through the release verifier for local directory delete versus remote descendant create, variant 5.

## Scope

This adds local production-shaped release-verifier carry-through for the
merge-invariant where a local directory delete would remove a live remote
descendant created after pull. The release verifier now emits a
`mergeInvariants.localDirectoryDeleteRemoteDescendant` proof alongside its
existing release summaries.

The proof is support-only. It does not broaden the checked live production
boundary, and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5.test.js`
verifies that the release verifier:

- builds a conflict plan for a deleted local directory with a live remote
  descendant create;
- emits no mutation or precondition for the unsafe directory delete;
- records the remote descendant as `keep-remote`, with no mutation or
  precondition;
- keeps an independent local mutation live-preconditioned for audit evidence;
- refuses apply with `PLAN_NOT_READY` before durable journal writes or the
  mutation hook; and
- keeps the release-verifier proof hash-only, with raw file payloads absent
  from the emitted evidence.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5.test.js
node --test test/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0204|RPP-0224' test/push-planner.test.js
node --test test/rpp-0244-local-directory-delete-remote-descendant-v3.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0498-driver-apply-validation-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0284-local-directory-delete-remote-descendant-release-verifier-v5.md docs/reprint-push-completion-checklist.md docs/scenario-matrix.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0284
test reported 2 subtests ok, 0 failed. The adjacent RPP-0204/RPP-0224 planner
slice, RPP-0244 generated directory-descendant proof, and nearby release
verifier slices also exited 0. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This is local production-shaped release-verifier evidence only. The emitted
proof is support-only and productionBacked `false`; release remains NO-GO
until separate live production-backed evidence satisfies the broader release
boundary.
