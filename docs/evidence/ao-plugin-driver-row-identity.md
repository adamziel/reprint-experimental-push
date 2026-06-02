# AO Plugin Driver Row Identity Evidence

Date: 2026-06-02

## What Changed

Contract-bound custom row drivers now bind the planned payload body back to the
row resource id. A mutation for a resource like
`row:["wp_forms_contract_rows","entry_id:7"]` must carry a present payload whose
`entry_id` value is `7`. The planner and apply path both emit hash-only
`rowIdentity` evidence and refuse mismatches before mutation.

New refusal reasons:

- `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_MISMATCH`
- `PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_UNSUPPORTED`

The release-verifier summary also tracks
`driverContractBoundary.payloadRowIdentityMatchesExpected`, so production-shaped
evidence distinguishes a payload whose value hash matches from a payload whose
row identity is actually bound to the target row.

## Verification

Focused checks passed:

```bash
node --check src/plugin-driver-validators.js
node --check src/apply.js
node --check scripts/playground/production-shaped-release-verify.mjs
php -l scripts/playground/snapshot-lib.php
node --test test/plugin-driver-contract.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
node --test test/plugin-driver-registration-api.test.js test/rpp-0441-driver-registration-api-v3.test.js test/rpp-0481-driver-registration-api-release-verifier-v5.test.js
```

Coverage includes:

- accepted custom row-driver payload evidence carrying matched row identity
- planner refusal when the local payload row id no longer matches the resource
- apply refusal for forged ready plans that alter the payload row id before
  execution
- PHP registration API parity for manually generated payload evidence
- RPP-0483 release-verifier refusal when payload hashes match but row identity
  does not

## Caveat

This is a contract-bound row payload invariant. It does not make arbitrary
plugin tables production-ready by itself; general plugin schemas, activation and
update side effects, broad graph identity mapping, and hosted production smoke
remain separate release-scope boundaries.
