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

## RPP items with new evidence

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

## RPP-0446 wp_termmeta driver semantics, variant 3

Generated local plugin-driver coverage now proves exact `wp_termmeta` driver
semantics. Accepted cases cover both `wp-termmeta` and `wp-term-meta`; each
plans one plugin-owned `wp_termmeta` row mutation and applies it through the
local apply executor.

Fail-closed generated cases cover missing policy, a wrong `wp-postmeta` driver,
near-miss resource table `wp_termmetas`, and a wrong explicit policy table.
Standard WordPress meta drivers do not accept table overrides that differ from
their exact WordPress table.

Evidence status: local plugin-driver node proof only; it is not
production-backed and keeps the release gate at NO-GO. The proof object is
hash-only (`rawValuesIncluded: false`) and records row, mutation, journal-entry,
and blocker hashes without raw plugin-owned private values.

Focused verification:

```sh
node --test --test-name-pattern 'RPP-0446|termmeta|plugin-owned custom table|fixture forms lab' test/push-planner.test.js
```
