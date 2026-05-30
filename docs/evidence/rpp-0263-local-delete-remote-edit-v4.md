# RPP-0263 local delete versus remote edit variant 4 evidence

Date: 2026-05-30
Lane: RPP-0263 local delete versus remote edit, variant 4
Checklist item: RPP-0263 — Add focused regression coverage for local delete versus remote edit, variant 4.

## Scope

This is focused local planner/apply regression coverage for the row-level local-delete versus remote-edit conflict. It validates existing behavior only: a locally deleted `wp_posts` row that was edited remotely after the pull base must fail closed while an unrelated local file mutation remains present only as hash-preconditioned audit evidence.

## Proof surface

`test/rpp-0263-local-delete-remote-edit-v4.test.js` builds a deterministic fixture where:

- local deletes `row:["wp_posts","ID:263"]`;
- remote edits the same row; and
- local also adds an independent file mutation so the test proves the non-ready plan refuses before any unrelated mutation or durable journal write.

The test asserts that the delete/edit row produces a `row-conflict` with `preserve-remote-and-stop`, that no mutation or live-remote precondition is emitted for the conflicted row, and that the independent file mutation keeps a matching live-remote precondition.

## Redaction and refusal proof

The serialized plan evidence is a hash-only envelope containing resource keys, status and summary counts, mutation/precondition metadata, conflict metadata, change directions, and SHA-256 hashes only. The test scans that envelope, a redacted plan evidence envelope, refusal details, and a proof envelope with the shared evidence-redaction helper and explicit string checks for the fixture's base, local, and remote raw values.

`applyPlan()` raises `PLAN_NOT_READY`, leaves the remote snapshot byte-for-byte unchanged, appends no durable journal events, preserves the remote-edited row values, and does not create the independent local file.

## Focused verification observed locally

```sh
node --check test/rpp-0263-local-delete-remote-edit-v4.test.js
node --test test/rpp-0263-local-delete-remote-edit-v4.test.js
node --test --test-name-pattern='RPP-0203|RPP-0223|RPP-0243|local deletion|local delete versus remote edit|delete/edit' test/push-planner.test.js test/generated-push-harness.test.js test/rpp-0243-local-delete-remote-edit-v3.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0263-local-delete-remote-edit-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0263 test reported one subtest ok and zero failures; checklist lint returned `"ok": true`; the scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This remains local focused regression evidence. It does not add release-verifier or live external production coverage; those remain separate gates.
