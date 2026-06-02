# AO Plugin Driver Row Schema Evidence

Date: 2026-06-02

## What Changed

Plugin-owned row driver contracts can now declare optional schema-bound row
metadata through `rowSchema`. The normalized schema is part of the row-driver
contract hash and canonical contract evidence, so a schema-bearing contract
cannot be swapped without changing the contract fingerprint.

The first schema language is intentionally small:

- required row fields
- nested object `properties`
- `additionalProperties: false` for declared object properties
- scalar `const` and `enum` constraints normalized to hash-only `constHash` or
  sorted `enumHashes`
- field types: `string`, `integer`, `number`, `boolean`, `object`, `array`,
  and `null`

Planner, apply, PHP registration/export, and the RPP-0483 production-shaped
verifier now recompute schema validation evidence. A forged ready plan that
changes a schema-bound field type, adds an undeclared nested payload property,
violates a scalar `const` or `enum` constraint, or rewrites payload evidence
while recomputing the value hash still refuses before mutation. Unexpected
nested properties are reported at the declared object path with
`observedExtraPropertyCount`; scalar constraints are reported with
`constraint`, `constraintHash`, and `observedHash`. The evidence does not name
raw extra keys or copy raw constraint values.

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
- planner refusal for row payloads with scalar constraint mismatches
- planner refusal for undeclared nested object properties without exposing raw
  extra key names
- apply refusal for forged ready plans with recomputed value hashes but invalid
  schema-bound payloads
- PHP registered-driver policy export with normalized schema metadata
- PHP exact-key evidence acceptance only when schema validation matches
- RPP-0483 release-verifier refusal when payload hashes match but schema
  validation, exact payload evidence shape, or allowlist schema binding does
  not

## Caveat

This is not a full generic plugin merge driver or JSON Schema implementation.
It proves a plugin-declared row schema contract for required fields, nested
object properties, closed declared objects, and scalar `const`/`enum`
constraints. Merge strategies, activation/update effects, richer JSON Schema
semantics, and broader plugin-owned file contracts remain separate
release-scope work.
