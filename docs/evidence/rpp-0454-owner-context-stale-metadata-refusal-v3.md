# RPP-0454 owner context stale metadata refusal v3 evidence

Date: 2026-05-31
Lane: RPP-0454 owner context stale metadata refusal, variant 3
Checklist item: RPP-0454 - Add generated coverage for owner context stale metadata refusal, variant 3.

## Scope

This is local generated-style plugin-driver support evidence for stale owner
plugin metadata refusal. It proves the planner and executor refuse mutation
when owner plugin metadata has drifted, and it keeps release posture at NO-GO.

This evidence is not production-backed and does not update progress or release
gate surfaces.

## Proof surface

`test/rpp-0454-owner-context-stale-metadata-refusal-v3.test.js` adds:

- a generated planner fixture where a local plugin-owned `wp_options` row update
  is refused because live remote `plugin:forms` metadata changed after the pull
  base;
- `stale-plugin-owner-context` blocker assertions with
  `STALE_PLUGIN_METADATA_OWNER_CONTEXT`, `refuse-before-mutation`,
  `PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED`, deterministic context hashes, and no
  planned row mutation or precondition;
- blocked-plan apply refusal with `PLAN_NOT_READY` before any mutation hook;
- a generated ready-plan replay fixture where `plugin:forms` metadata drifts
  after planning and apply raises `STALE_PLUGIN_OWNER_CONTEXT` before the
  mutation hook; and
- before/after row and remote hashes proving the plugin-owned remote option row
  and remote snapshot are preserved on both refusal paths.

## Hash-only evidence shape

The proof envelopes include only resource keys, owner and driver labels, status
counts, refusal codes, driver audit hashes, owner-context hashes, blocker
hashes, error-detail hashes, precondition hashes, and before/after remote data
hashes.

The test asserts raw fixture strings, `option_value` payloads, and `meta_value`
payloads are absent from blocker evidence, mutation audit evidence, error
details, and proof envelopes. Shared evidence redaction assertions also pass for
the generated proof surfaces.

## Focused verification observed locally

```sh
node --check test/rpp-0454-owner-context-stale-metadata-refusal-v3.test.js
node --test --test-name-pattern RPP-0454 test/rpp-0454-owner-context-stale-metadata-refusal-v3.test.js
node --test --test-name-pattern RPP-0474 test/rpp-0474-owner-context-stale-metadata-refusal-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0454-owner-context-stale-metadata-refusal-v3.md
git diff --check
git diff --cached --check
```

Observed result: all commands exited 0. The focused RPP-0454 test reported 2
subtests ok, 0 failed. The adjacent RPP-0474 stale metadata refusal test
reported 2 subtests ok, 0 failed. The scoped artifact redaction scan returned
`"ok": true`; both diff whitespace checks exited 0.

## Release posture

NO-GO for release promotion based on this slice alone. This is local
support-only plugin-driver evidence and should be integrated as a regression
coverage improvement without claiming live production readiness.
