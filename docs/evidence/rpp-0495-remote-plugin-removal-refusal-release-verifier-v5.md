# RPP-0495 remote plugin removal refusal release verifier v5 evidence

Date: 2026-05-30

## Scope

This is focused release-verifier carry-through evidence for remote owner-plugin
removal refusal, variant 5. It carries the existing remote-plugin-removal
guardrail into `production-shaped-release-verify.mjs` under
`pluginDriver.remotePluginRemovalRefusal`.

The verifier proof is hash-only and support-only by default. It records both a
local candidate proof and a production-backed scope marker, but it does not
claim a live production release run.

## Proof surface

`test/rpp-0495-remote-plugin-removal-refusal-release-verifier-v5.test.js`
proves:

- the release verifier builds local and production-backed remote owner-plugin
  removal refusal cases for the exact `wp_postmeta` plugin-owned resource;
- both cases block with zero mutations and zero preconditions before apply can
  mutate the remote row;
- the local case remains `NO-GO` with a release-gate note that
  production-backed evidence is still required;
- the production-backed scoped case remains `NO-GO` unless checked production
  verifier evidence is explicitly supplied; and
- the proof includes only resource ids, scope labels, hashes, refusal codes,
  release-gate notes, and remote-preservation hashes.

The focused assertions also prove the owner-plugin removal context is
`REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT`, the apply refusal is `PLAN_NOT_READY`,
the remote row and whole remote hash are unchanged after refusal, and raw
`meta_value` or post content fields are absent from emitted evidence.

## Focused verification observed locally

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0495-remote-plugin-removal-refusal-release-verifier-v5.test.js
node --test test/rpp-0495-remote-plugin-removal-refusal-release-verifier-v5.test.js
node --test test/rpp-0495-remote-plugin-removal-refusal-release-verifier-v5.test.js test/rpp-0475-remote-plugin-removal-refusal-v4.test.js test/rpp-0435-remote-plugin-removal-refusal.test.js test/plugin-remote-removal-refusal.test.js test/plugin-uninstall-delete-refusal.test.js
node --test --test-name-pattern 'RPP-0484|RPP-0485|RPP-0486|RPP-0495|production plugin-driver boundary proof accepts one owned row and fails closed for remote or unknown data' test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0485-wp-postmeta-release-verifier-v5.test.js test/rpp-0486-wp-termmeta-release-verifier-v5.test.js test/rpp-0495-remote-plugin-removal-refusal-release-verifier-v5.test.js test/production-shaped-proof.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0495-remote-plugin-removal-refusal-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result after validation: all commands exited 0. The focused RPP-0495
test reported 3 subtests ok and 0 failed. The combined remote-plugin-removal
and plugin-uninstall refusal run reported 17 tests ok and 0 failed. The
adjacent release-verifier run reported 14 tests ok and 0 failed. Checklist
lint returned `"ok": true`; the scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This lane is local release-verifier carry-through evidence. The emitted
`remotePluginRemovalRefusal` proof remains release-gate `NO-GO` unless checked
production verifier evidence is explicitly supplied. Final release remains
`NO-GO` without live production proof.
