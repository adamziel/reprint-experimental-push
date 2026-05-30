# RPP-0281 independent local file plus remote row release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0281 independent local file plus remote row edit release-verifier carry-through, variant 5
Checklist item: RPP-0281 — Carry through the release verifier for independent local file plus remote row edit, variant 5.

## Scope

This adds local production-shaped release-verifier carry-through for the
independent merge invariant where a local file mutation coexists with an
independent remote `wp_posts` row edit. The verifier now emits a support-only
`mergeInvariants.independentLocalFileRemoteRow` proof beside the existing
release-verifier evidence.

The proof is local/support-only. It does not broaden the checked live production
boundary and final release posture remains NO-GO without separate
production-backed release evidence.

## Proof surface

`test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js`
proves that the release verifier:

- builds a focused ready plan with exactly one local file mutation, one
  hash-only remote row `keep-remote` decision, one live-remote precondition for
  the file, and no row mutation or row precondition;
- applies the focused plan with mutation enabled, writes the local file, and
  preserves the remote row hash without durable row mutation events;
- replays the existing deterministic generated `independent-local-and-remote`
  fixtures across tiers 0 through 9 and requires the
  `independent-file-remote-row` target tag;
- confirms generated validation applies successfully, rejects stale replay with
  `PRECONDITION_FAILED`, and leaves the remote unchanged; and
- keeps release-verifier evidence hash-only, excluding private focused payloads,
  generated file contents, generated row titles, and raw `post_title` fields.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js
node --test test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js
node --test test/rpp-0241-independent-local-file-remote-row-v3.test.js test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js
node --test --test-name-pattern='RPP-0221 generated harness preserves independent local files and remote rows|RPP-0281' test/generated-push-harness.test.js test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js
node --test test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0498-driver-apply-validation-release-verifier-v5.test.js test/rpp-0281-independent-local-file-remote-row-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0281-independent-local-file-remote-row-release-verifier-v5.md docs/reprint-push-completion-checklist.md
node --test test/checklist-completion-lint.test.js test/artifact-redaction-scan.test.js
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0281
test reported 3 subtests ok, 0 failed. The adjacent independent file/row slice
and release-verifier slices exited 0. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

This is local release-verifier carry-through evidence only. The emitted
`independentLocalFileRemoteRow` proof is explicitly support-only and
productionBacked `false`; final release remains NO-GO until live production
proof satisfies the broader release boundary.
