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

## Driver Apply Validation Hook

RPP-0438 adds focused support-only evidence for the apply-time plugin-driver
validation hook. A valid fixture driver mutation reaches the apply
`beforeMutation` hook with `driverApplyValidation` evidence marked
`PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED`, then commits exactly one row
mutation. A forged ready plan with invalid fixture driver evidence fails before
the hook and before mutation with `PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED`.

The validation evidence is hash-only: resource key, owner, driver, row identity,
planned/remote hashes, and driver proof hashes. Raw fixture payload values are
redacted from both successful journals and refusal details.

Focused verification:

```sh
node --test --test-name-pattern 'RPP-0438|fixture forms lab table journal redacts raw payload values' test/push-planner.test.js
```

This evidence does not broaden accepted plugin-owned resources. The fixture
driver still requires exact owner, table, positive id row, active unchanged
driver plugin evidence, and no delete mutation.

## RPP-0439 driver audit evidence redaction

Focused local verification:

```sh
node --test --test-name-pattern 'RPP-0439|plugin-owned option rows|plugin-owned data' test/push-planner.test.js
```

The RPP-0439 proof adds hash-only driver audit evidence to plugin-owned
mutations. The planner records the resource key, owner, driver, policy source,
delete-support flag, base/local/remote hashes, owner-context hash, and optional
driver-evidence hash under `mutation.pluginOwnedResource.auditEvidence`. It does
not include raw row values.

The focused proof plans a plugin-owned `wp_options` update and then applies the
dry-run plan to a remote whose same plugin-owned row drifted after planning.
Apply fails before mutation with `PRECONDITION_FAILED`, and the test asserts the
remote plugin-owned row hash and full remote hash are identical before and after
the failed apply. The proof evidence stores only `sha256:` hashes for the audit
envelope, stale-apply details, row preservation, remote preservation, and the
combined proof hash; it asserts base, local, and drifted remote private values
do not appear in either audit JSON or proof JSON. This is local focused
evidence, not production-backed evidence.

## RPP-0461 driver registration API focused regression

Focused local verification:

```sh
node --test --test-name-pattern 'RPP-0461|plugin-owned row driver registration API' test/playground-snapshot-lib.test.js
```

The RPP-0461 focused regression reuses the local PHP snapshot-library driver
registry probe to prove exact registration behavior for the plugin-owned row
driver API. It checks the built-in production release-state driver fields, a
valid extension driver, lookup-by-name and lookup-by-table behavior, and the
empty-list fallback when the registration filter returns a non-array value.

The same proof asserts fail-closed registration for invalid entries (missing
driver name, table, plugin owner, export/apply/validate callbacks) and ambiguous
entries (duplicate driver name and duplicate table mapping). Failure evidence
contains only exception class plus `sha256:` message hashes, and the focused
accepted/refused proof envelope stores only `sha256:` hashes for accepted
drivers, lookup proof, empty-list fallback, failure registrations, and the
combined proof hash. Raw failure messages, callback names, and invalid duplicate
table names are asserted absent from the focused evidence. This is local focused
plugin-driver evidence only, not production-backed evidence, and the release gate
remains NO-GO.

## RPP-0468 serialized option validator focused regression

Focused local verification:

```sh
node --test --test-name-pattern 'RPP-0468|plugin-owned option rows|plugin-owned data' test/push-planner.test.js
```

The RPP-0468 focused proof adds a hash-only serialized option validator for
plugin-owned `wp_options` rows declared as `serialization: php-serialize` or
whose option value is PHP-serialized. The accepted path applies one valid
serialized option update through the `wp-option` driver and records only
hash/redacted plan, mutation, audit, validator, and journal evidence.

Fail-closed coverage proves two invalid variants. A malformed serialized option
payload in the local dry-run snapshot emits an `unsupported-plugin-owned-resource`
blocker with validator evidence and no mutation. A forged ready plan whose
mutation value is changed to a malformed serialized payload fails apply before
mutation with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE` and
`PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED`. In both refusals the remote row and
full remote hashes are unchanged.

This is local focused plugin-driver evidence, not production-backed evidence.
It preserves the release NO-GO caveat and does not widen accepted production
plugin-driver resources. The proof asserts raw serialized option payloads are
absent from audit, journal, blocker/refusal, and combined proof evidence.

## RPP items with new evidence

- RPP-0401 — driver registration API: exact API behavior is covered by `test/plugin-driver-registration-api.test.js`; checklist status was not edited in this lane.
- RPP-0402 / RPP-0422 — owner identity binding: exact owner/driver fields are exposed and wrong owner/driver proofs fail closed.
- RPP-0403 / RPP-0423 — custom table allowlist exact match: accepted production table is singular; extra arbitrary custom table mutations block the proof.
- RPP-0404 / RPP-0424 and RPP-0408 / RPP-0428 — option/serialized option semantics: serialized plugin-owned option mutations are detected and fail closed on the production boundary.
- RPP-0409 / RPP-0429 and RPP-0410 / RPP-0430 — activation/update dependency validators: direct production plugin activation/update mutations are detected and fail closed.
- RPP-0412 / RPP-0432 — direct `active_plugins` mutation refusal: direct option-row activation mutations remain detected and blocked.
- RPP-0438 — driver apply validation hook: accepted fixture driver evidence
  carries one real mutation through apply, and forged driver evidence fails
  closed before mutation.
- RPP-0439 — driver audit evidence redaction: plugin-owned mutations now carry
  hash-only driver audit evidence, and stale apply preserves drifted remote
  plugin-owned data before mutation.
- RPP-0461 — driver registration API focused regression: accepted registration
  and invalid/ambiguous refusal evidence is hash-only, redacted, and local-only.
- RPP-0468 — serialized option validator: valid serialized `wp-option` rows
  apply with hash-only validator evidence; malformed serialized option payloads
  fail closed in planning or apply before mutation while preserving remote data.
