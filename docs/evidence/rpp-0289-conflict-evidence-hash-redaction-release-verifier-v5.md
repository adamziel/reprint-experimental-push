# RPP-0289 conflict evidence hash redaction release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0289 conflict evidence hash redaction release verifier carry-through, variant 5
Checklist item: RPP-0289 — Carry through the release verifier for conflict evidence hash redaction, variant 5.

## Scope

This adds focused local release-verifier support evidence for conflict evidence
hash redaction. The proof is support-only and productionBacked `false`; it does
not broaden the live production release boundary.

## Proof surface

`test/rpp-0289-conflict-evidence-hash-redaction-release-verifier-v5.test.js`
builds a mixed conflict fixture with private raw values in source snapshots:

- a file create/create conflict under
  `file:wp-content/uploads/rpp-0289-private-conflict-report.txt`;
- a core `wp_posts` row delete/update conflict; and
- a plugin-owned `wp_options` update/update conflict classified as
  `plugin-data-conflict` for owner `forms`.

The test verifies that conflict evidence carries only resource keys, conflict
classes, owner labels, resolution policies, change-state labels, file type
where applicable, and SHA-256 hashes derived from the observed
base/local/remote resources. It also proves conflicted resources do not emit
mutations or live-remote preconditions, `applyPlan()` refuses with
`PLAN_NOT_READY`, no durable journal event is written, and the remote snapshot
hash is unchanged.

The release-verifier proof envelope records support-only status, NO-GO release
posture, deterministic replay hash equality, refusal details hash, conflict
projection hashes, and redaction metadata. It scans for the private fixture
values plus raw field names such as `option_value`, `post_title`, and
`__pluginOwner`, and uses the shared evidence redaction helper to prove the
surfaces are already hash-only.

## Focused verification observed locally

```sh
node --check test/rpp-0289-conflict-evidence-hash-redaction-release-verifier-v5.test.js
node --test test/rpp-0289-conflict-evidence-hash-redaction-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0249|RPP-0269' test/rpp-0249-conflict-evidence-hash-redaction-v3.test.js test/rpp-0269-conflict-evidence-hash-redaction-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0289-conflict-evidence-hash-redaction-release-verifier-v5.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0289
test reported 1 subtest ok, 0 failed. The adjacent conflict-redaction
test-name-pattern suite covering RPP-0249 and RPP-0269 reported 2 subtests ok,
0 failed. The scoped artifact redaction scan returned `"ok": true` for the new
evidence doc.

## Release posture

This is local release-verifier support evidence only. The emitted proof is
hash-only and explicitly productionBacked `false`; final release remains NO-GO
until live production-backed proof satisfies the broader release boundary.
