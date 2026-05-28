# AO plugin-driver evidence — 2026-05-28

Lane: `plugin-driver`

## New proof surface

The production plugin-driver boundary summary now emits machine-readable evidence for:

- exact production allowlist match: owner `reprint-push`, driver `reprint-push-release-state`, table `wp_reprint_push_release_state`, row `state_id:1`, delete disabled;
- exact mutation binding: the release plan must contain exactly the production-owned release-state row mutation with the expected owner/driver and no delete support;
- custom-table refusal: any additional non-production custom table resource keys are listed under `ownershipBoundary.nonProductionCustomTableResourceKeys` and keep the verifier blocked;
- serialized option refusal: plugin-owned `wp_options` mutations are listed under `ownershipBoundary.serializedPluginOwnedOptionResourceKeys` and keep the verifier blocked;
- direct activation/update refusal: direct `plugin:reprint-push` mutations are listed under `ownershipBoundary.directPluginActivationOrUpdateResourceKeys` and keep the verifier blocked;
- direct `active_plugins` mutation refusal remains listed under `ownershipBoundary.activePluginsDirectResourceKeys`.

This does not broaden planner support or weaken fail-closed behavior: non-boundary resources make `summarizeProductionPluginDriverBoundaryProof()` return `PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED`.

## Focused verification

Passing checks:

```sh
node --test test/production-plugin-package-scenarios.test.js
node --test --test-name-pattern 'production plugin-driver boundary|production-shaped release verify owns the production plugin-driver boundary proof fields|snapshot package registers only the production-owned release state driver boundary' test/production-shaped-proof.test.js
REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-owner-driver-allowlist-guards node ./scripts/playground/production-plugin-package-smoke.mjs
```

The support-only package smoke alias proved fail-closed registration guards for missing plugin owner, duplicate driver name, and duplicate table mapping. The focused proof tests covered exact owner/driver allowlists, wrong-driver allowlist rejection, arbitrary custom table rejection, serialized plugin-owned option rejection, direct plugin activation/update rejection, direct `active_plugins` rejection, unknown plugin data rejection, and accepted single-row release-state proof.

Non-claim: an over-broad full run of `node --test test/production-plugin-package-scenarios.test.js test/production-shaped-proof.test.js` was stopped/failed after live Playground readiness timeouts in unrelated apply-revalidation smoke tests. It is not used as passing evidence for this lane.

## RPP items with new evidence

- RPP-0402 / RPP-0422 — owner identity binding: exact owner/driver fields are exposed and wrong owner/driver proofs fail closed.
- RPP-0403 / RPP-0423 — custom table allowlist exact match: accepted production table is singular; extra arbitrary custom table mutations block the proof.
- RPP-0404 / RPP-0424 and RPP-0408 / RPP-0428 — option/serialized option semantics: serialized plugin-owned option mutations are detected and fail closed on the production boundary.
- RPP-0409 / RPP-0429 and RPP-0410 / RPP-0430 — activation/update dependency validators: direct production plugin activation/update mutations are detected and fail closed.
- RPP-0412 / RPP-0432 — direct `active_plugins` mutation refusal: direct option-row activation mutations remain detected and blocked.

## RPP-0434 stale owner metadata refusal

Focused local verification:

```sh
node --test --test-name-pattern 'RPP-0434|stale plugin metadata owner context|allowed plugin driver row update' test/plugin-owner-context-metadata-refusal.test.js
```

The RPP-0434 proof keeps a plugin-owned `wp_options` row unchanged on the
remote while the local side attempts to mutate that row under an explicit
`wp-option` policy and the live remote plugin metadata has drifted from the
pull base. The planner fails closed with blocker class
`stale-plugin-owner-context` and metadata reason code
`STALE_PLUGIN_METADATA_OWNER_CONTEXT`; no mutation is emitted for the
plugin-owned row. Applying the blocked plan returns `PLAN_NOT_READY`, and the
test asserts the before/after remote snapshot hash and plugin-owned row hash
are identical.

The test evidence object is hash-only: it records `sha256:` hashes for owner
context, metadata refusal evidence, blocker evidence, remote snapshot
preservation, plugin-owned row preservation, and the combined proof hash. It
also asserts the local attempted value and the preserved remote plugin-owned
value do not appear in either blocker JSON or the proof JSON. This is local
focused evidence, not production-backed evidence.
