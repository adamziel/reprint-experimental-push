# RPP-0283 local delete versus remote edit release verifier variant 5 evidence

Date: 2026-05-30
Lane: RPP-0283 local delete versus remote edit release verifier carry-through, variant 5
Checklist item: RPP-0283 — Carry through the release verifier for local delete versus remote edit, variant 5.

## Invariant

The release verifier must carry the local-delete versus remote-edit invariant as hash-only evidence. A local row delete that races a remote row edit remains a fail-closed `row-conflict`, the conflicted row has no mutation or live-remote precondition, unrelated local mutations keep their own live-remote preconditions, and apply refuses the non-ready plan before any durable journal event or remote mutation. Serialized plan evidence must omit the raw row and file fixture payloads.

## Evidence added

- Focused release-verifier proof: `test/rpp-0283-local-delete-remote-edit-release-verifier-v5.test.js`.
- Release-verifier helper: `summarizeLocalDeleteRemoteEditReleaseVerifierProof()` in `scripts/playground/production-shaped-release-verify.mjs`.
- The production-shaped verifier now emits the proof under `pluginDriver.mergeInvariants.localDeleteRemoteEdit` beside the existing support-proof bundle.
- Checklist line `RPP-0283` is marked checked after the focused proof and adjacent coverage pass locally.

## Redaction and refusal proof

The helper builds a production-shaped local fixture with a target `wp_posts` row and an independent file mutation. The local snapshot deletes the target row, the remote snapshot edits that same row, and the local snapshot also edits the independent file. The emitted `planEvidence` keeps only status, counts, resource keys, actions, conflict classes, state transitions, and hashes.

The focused test asserts the target row has no mutation and no precondition, the independent file mutation has a live-remote precondition, `applyPlan` raises `PLAN_NOT_READY`, no durable journal events are written, and remote hashes are unchanged. It serializes both the plan evidence and full release-verifier proof and checks that none of the raw base row, remote row, or local file payloads appear.

The proof is support-only local-production-shaped evidence and keeps the release gate `NO-GO`; it does not claim production-backed release readiness.

## Commands

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0283-local-delete-remote-edit-release-verifier-v5.test.js
node --test test/rpp-0283-local-delete-remote-edit-release-verifier-v5.test.js
node --test test/rpp-0243-local-delete-remote-edit-v3.test.js
node --test --test-name-pattern='RPP-0203|RPP-0223|local deletion' test/push-planner.test.js test/generated-push-harness.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node --test test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0283-local-delete-remote-edit-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Caveat: this is focused release-verifier carry-through for the local delete versus remote edit merge invariant. It adds hash-only support evidence and does not change planner/apply semantics or the overall release verdict.
