# RPP-0475 remote plugin removal refusal v4 evidence

Date: 2026-05-30

## Scope

This is variant-4 focused plugin-driver regression evidence for remote owner
plugin removal refusal. It covers planner and executor refusal before mutation,
with release-gate evidence explicitly distinguishing local-only proof from a
production-backed remote snapshot scope.

## Proof surface

`test/rpp-0475-remote-plugin-removal-refusal-v4.test.js` proves:

- a plugin-owned `wp_postmeta` row update is blocked with zero mutations and no
  preconditions when the live remote has removed the owner plugin metadata from
  the pull base;
- the blocker emits `REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT` evidence with
  `operation: refuse-before-mutation`, `format: hash-only`, and
  `rawValuesIncluded: false`;
- a local candidate policy records `proofScope: local-focused`,
  `releaseGateEvidenceScope: local-candidate`, `productionBacked: false`, and
  a release-gate note that production-backed evidence is still required;
- a production-backed remote snapshot policy records `proofScope:
  production-backed`, `releaseGateEvidenceScope: production-backed`, and
  `productionBacked: true` on the refusal evidence; and
- a previously ready plan refuses at apply time with
  `STALE_PLUGIN_OWNER_CONTEXT` after the live remote owner plugin is removed,
  before the `beforeMutation` hook is reached, while the remote row and full
  remote hash remain unchanged.

The focused assertions build hash-only proof envelopes and check that raw row
payload and owner plugin fixture markers are absent from blocker evidence,
release-gate refusal evidence, apply error details, and replay proof metadata.

## Focused verification observed locally

```sh
node --check test/rpp-0475-remote-plugin-removal-refusal-v4.test.js
node --test test/rpp-0475-remote-plugin-removal-refusal-v4.test.js
node --test test/rpp-0475-remote-plugin-removal-refusal-v4.test.js test/rpp-0435-remote-plugin-removal-refusal.test.js test/plugin-remote-removal-refusal.test.js test/plugin-uninstall-delete-refusal.test.js
node --test test/plugin-owner-context-file-refusal.test.js test/plugin-owner-context-metadata-refusal.test.js test/plugin-driver-delete-support-flag.test.js test/plugin-driver-dry-run-validation-hook.test.js test/plugin-driver-apply-validation-hook.test.js test/plugin-driver-audit-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0475-remote-plugin-removal-refusal-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0 in this lane. The focused RPP-0475 test
reported four subtests ok and zero failures; the adjacent remote-removal and
plugin-uninstall refusal slice reported its subtests ok; the adjacent
owner-context/plugin-driver refusal slice reported its subtests ok; checklist
lint returned `"ok": true`; and the scoped artifact redaction scans returned
`"ok": true`.

## Release posture

This lane adds focused local regression evidence and a production-backed scope
marker regression only. It is not a live production release run; keep the final
release posture at NO-GO until separate production-backed release evidence is
captured by the release gate.
