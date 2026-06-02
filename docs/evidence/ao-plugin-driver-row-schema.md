# AO Plugin Driver Row Schema Evidence

Date: 2026-06-02

## What Changed

Plugin-owned row driver contracts can now declare optional schema-bound row
metadata through `rowSchema`. The normalized schema is part of the row-driver
contract hash and canonical contract evidence, so a schema-bearing contract
cannot be swapped without changing the contract fingerprint.

The first schema language is intentionally small:

- required top-level row fields
- field types: `string`, `integer`, `number`, `boolean`, `object`, `array`,
  and `null`

Planner, apply, PHP registration/export, and the RPP-0483 production-shaped
verifier now recompute schema validation evidence. A forged ready plan that
changes a schema-bound field type and recomputes the value hash still refuses
before mutation.

## Verification

Focused checks passed:

```bash
node --check src/plugin-driver-contracts.js
node --check src/plugin-driver-validators.js
node --check scripts/playground/production-shaped-release-verify.mjs
php -l scripts/playground/snapshot-lib.php
node --test test/plugin-driver-contract.test.js
node --test test/plugin-driver-registration-api.test.js
node --test test/rpp-0441-driver-registration-api-v3.test.js test/rpp-0481-driver-registration-api-release-verifier-v5.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
```

Coverage includes:

- accepted schema-bound custom row-driver payload evidence
- planner refusal for malformed schema contracts
- planner refusal for row payloads with wrong schema-bound field types
- apply refusal for forged ready plans with recomputed value hashes but invalid
  schema-bound payloads
- PHP registered-driver policy export with normalized schema metadata
- PHP exact-key evidence acceptance only when schema validation matches
- RPP-0483 release-verifier refusal when payload hashes match but schema
  validation does not

## Caveat

This is not a full generic plugin merge driver or JSON Schema implementation.
It proves the first plugin-declared schema contract: top-level required fields
and field types. Nested properties, enum/const rules, merge strategies,
activation/update effects, and broader plugin-owned file contracts remain
separate release-scope work.
