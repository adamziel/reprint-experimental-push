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

## RPP-0437 driver dry-run validation hook

Focused local verification:

```sh
node --test --test-name-pattern 'RPP-0437|plugin-owned option rows|plugin-owned data' test/push-planner.test.js
```

The RPP-0437 proof adds a driver dry-run validation hook for plugin-owned
`wp_options` rows. A policy entry may declare `dryRunValidation` with hook
`wp-option-object-mode`; the planner hashes the expected and planned
`option_value.mode` values and emits only hash evidence.

The focused proof covers three variants:

- supported and passing: the local row matches the declared expected mode, the
  plan is ready, the mutation carries `dryRunValidation.status: passed`, and
  apply writes the planned row;
- supported but failing: the same hook sees a mismatched planned mode, the
  planner emits a `stale`-free `unsupported-plugin-owned-resource` blocker
  with `dryRunValidation.status: failed`, no mutation is planned, and the
  blocked plan refuses apply with the remote unchanged;
- unsupported hook: unknown validation hooks fail closed at planning with
  `dryRunValidation.status: unsupported`.

The executor also validates dry-run hook evidence on plugin-owned mutations, so
a forged ready plan carrying failed validation evidence is rejected before
mutation with `UNSUPPORTED_PLUGIN_OWNED_RESOURCE`. The test evidence stores
`sha256:` hashes for passed validation, blocked validation, unsupported
validation, executor error details, remote preservation, and the combined proof;
it asserts private option values do not appear in blocker or proof JSON. This is
local focused evidence, not production-backed evidence.
