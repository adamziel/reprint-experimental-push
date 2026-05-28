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

## Driver registration API proof

This lane adds `reprint_push_register_plugin_owned_row_driver(array $driver)` to the shared snapshot/apply helper. The API registers a plugin-owned row driver without requiring callers to mutate the `reprint_push_plugin_owned_row_drivers` filter payload directly, then exposes the registered driver through:

- `reprint_push_registered_plugin_owned_row_drivers()`
- `reprint_push_plugin_owned_row_driver_by_name()`
- `reprint_push_plugin_owned_row_driver_for_table()`

The same fail-closed validation is applied at registration time and at registry read time: missing driver name, table, plugin owner, export/apply/validate callbacks, duplicate driver names, and duplicate table mappings throw exact `RuntimeException` messages before a driver can be used by snapshot export, apply, or mutation validation.

## Focused verification

Passing checks:

```sh
php -l scripts/playground/snapshot-lib.php
node --check test/plugin-driver-registration-api.test.js
node --test test/plugin-driver-registration-api.test.js
node --test test/production-plugin-package-scenarios.test.js
node --test --test-name-pattern 'production plugin-driver boundary|production-shaped release verify owns the production plugin-driver boundary proof fields|snapshot package registers only the production-owned release state driver boundary' test/production-shaped-proof.test.js
REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-owner-driver-allowlist-guards node ./scripts/playground/production-plugin-package-smoke.mjs
```

`test/plugin-driver-registration-api.test.js` runs a PHP probe against `scripts/playground/snapshot-lib.php` and proves exact behavior for:

- normalized driver registration return values;
- lookup by driver name and table;
- deterministic built-in plus registered driver order;
- `null` lookup for unknown driver names;
- duplicate registered driver name refusal;
- duplicate registered table refusal;
- duplicate built-in table refusal;
- missing validate callback refusal; and
- no registry mutation after rejected registrations.

The support-only package smoke alias proved fail-closed registration guards for missing plugin owner, duplicate driver name, and duplicate table mapping. The focused proof tests covered exact owner/driver allowlists, wrong-driver allowlist rejection, arbitrary custom table rejection, serialized plugin-owned option rejection, direct plugin activation/update rejection, direct `active_plugins` rejection, unknown plugin data rejection, and accepted single-row release-state proof.

Non-claim: an over-broad full run of `node --test test/production-plugin-package-scenarios.test.js test/production-shaped-proof.test.js` was stopped/failed after live Playground readiness timeouts in unrelated apply-revalidation smoke tests. It is not used as passing evidence for this lane.

## RPP items with new evidence

- RPP-0401 — driver registration API: exact API behavior is covered by `test/plugin-driver-registration-api.test.js`; checklist status was not edited in this lane.
- RPP-0402 / RPP-0422 — owner identity binding: exact owner/driver fields are exposed and wrong owner/driver proofs fail closed.
- RPP-0403 / RPP-0423 — custom table allowlist exact match: accepted production table is singular; extra arbitrary custom table mutations block the proof.
- RPP-0404 / RPP-0424 and RPP-0408 / RPP-0428 — option/serialized option semantics: serialized plugin-owned option mutations are detected and fail closed on the production boundary.
- RPP-0409 / RPP-0429 and RPP-0410 / RPP-0430 — activation/update dependency validators: direct production plugin activation/update mutations are detected and fail closed.
- RPP-0412 / RPP-0432 — direct `active_plugins` mutation refusal: direct option-row activation mutations remain detected and blocked.
