# RPP-0473 owner context stale plugin file refusal v4 evidence

Date: 2026-05-30
Lane: RPP-0473 owner context stale plugin file refusal, variant 4
Checklist item: RPP-0473 — Add focused regression coverage for owner context stale plugin file refusal, variant 4.

## Scope

This is local focused plugin-driver regression evidence. It does not claim live
external production coverage and keeps the release posture at NO-GO until a
separate production-backed proof exists.

## Proof surface

`test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js` proves:

- a local production-shaped `wp_postmeta` plugin-driver policy with
  `releaseGateEvidenceScope: local-production-shaped` plans exactly one
  plugin-owned row mutation when the owner plugin file context is valid;
- the valid path remains distinct from stale remote drift by allowing a shared
  owner plugin file update that local and remote independently reached, while
  still applying only the `wp_postmeta` row mutation with `mutateRemote: true`;
- a stale live owner plugin file blocks the plugin-owned row in planning with
  `stale-plugin-owner-context`, `STALE_PLUGIN_FILE_OWNER_CONTEXT`, and
  `operation: refuse-before-mutation`; and
- a previously ready plan replayed against a live remote whose owner plugin file
  changed fails with `STALE_PLUGIN_OWNER_CONTEXT` before the `beforeMutation`
  hook and preserves the remote row and full remote hash.

## Hash-only evidence shape

The proof envelopes record resource keys, status/counts, reason codes,
precondition hashes, owner-context hashes, blocker hashes, driver/audit evidence
hashes, error-detail hashes, journal hashes, and before/after row and remote
hashes. They intentionally do not serialize plugin file contents or raw
`meta_value` payloads. The test also runs the shared redaction assertion over
planner audit evidence, driver audit evidence, driver evidence, apply validation
evidence, journal artifacts, blocker evidence, replay error details, and the
proof envelopes.

## Focused verification observed locally

```sh
node --check test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js
node --test test/rpp-0473-owner-context-stale-plugin-file-refusal-v4.test.js
node --test test/rpp-0433-owner-context-stale-plugin-file-refusal.test.js test/rpp-0434-owner-context-stale-metadata-refusal.test.js test/rpp-0435-remote-plugin-removal-refusal.test.js test/plugin-owner-context-file-refusal.test.js test/plugin-owner-context-metadata-refusal.test.js test/plugin-remote-removal-refusal.test.js test/plugin-driver-audit-redaction.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0473-owner-context-stale-plugin-file-refusal-v4.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0473 test reported 2
subtests ok, 0 failed. The adjacent owner-context/plugin-driver refusal slice
reported 20 subtests ok, 0 failed. Checklist lint returned `"ok": true`; the
scoped artifact redaction scan returned `"ok": true` for the touched docs.

## Release posture

NO-GO for release promotion based on this slice alone. This is local focused and
local production-shaped evidence only; it does not update `progress.html` or
replace production-backed release-verifier evidence.
