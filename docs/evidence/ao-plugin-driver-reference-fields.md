# AO Plugin Driver Reference Field Evidence

Date: 2026-06-02

## What Changed

Plugin-owned row driver contracts can now declare optional `referenceFields`.
Version 1 supports only positive-integer scalar references at declared
dot-separated row paths:

```json
{
  "schemaVersion": 1,
  "fields": [
    {
      "path": "payload.post_id",
      "targetTable": "wp_posts",
      "targetIdField": "ID",
      "scalarType": "positive-integer",
      "required": true
    }
  ],
  "rawValuesIncluded": false
}
```

The normalized reference-field contract is included in the plugin row-driver
contract hash and canonical contract evidence. Planner carries the accepted
contract into plugin-owned row mutations, and apply recomputes contract-bound
payload validation before mutation.

Payload evidence now includes hash-only `referenceValidation` when a contract
declares reference fields. Missing required reference paths and non-positive or
non-integer reference values fail closed before mutation with
`PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_MISSING` or
`PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_INVALID`. Evidence reports the
declared path, target table/id field, observed type, observed hash, and a
`targetResourceKey` only after the scalar reference is valid.

The PHP snapshot/registration path now exports normalized `referenceFields`,
includes them in plugin row-driver contract hashes, and validates exact
reference-bound payload evidence for registered drivers.

The generated push harness now carries the same reference-field contract
boundary beyond fixture-scoped custom-table allowlists. The
`pluginOwnedReferenceFieldVariant3` target emits 20 deterministic cases across
all 10 tiers: 10 ready `forms-reference-row` mutations whose
`payload.post_id` target is stable on the live remote graph, and 10 blocked
stale-target cases where the referenced `wp_posts.ID` row is absent on remote.
Ready cases apply with accepted contract, payload, and reference-target
evidence, then refuse apply-time target drift with
`INVALID_PLUGIN_DRIVER_REFERENCE_TARGET`. Stale cases emit no plugin row
mutation and block as `stale-plugin-driver-reference-target` with
`PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_ABSENT`.

The same slice also records hash-only merge-policy conflict evidence for
contract-bound plugin rows whose accepted policy is `refuse-on-conflict`.
Conflicting local/remote edits remain `conflict` plans and refuse apply with
`PLAN_NOT_READY`; the new evidence binds the conservative refusal to the
accepted contract hash, contract-validation hash, normalized merge policy, and
base/local/remote row hashes.

## Verification

Focused checks passed:

```bash
node --check src/plugin-driver-contracts.js
node --check src/plugin-driver-validators.js
node --check src/planner.js
node --check src/apply.js
php -l scripts/playground/snapshot-lib.php
node --test test/plugin-driver-contract.test.js
node --test test/plugin-driver-registration-api.test.js test/playground-snapshot-lib.test.js
node --test test/plugin-driver-contract.test.js test/plugin-driver-registration-api.test.js test/playground-snapshot-lib.test.js test/production-plugin-package-scenarios.test.js test/rpp-0441-driver-registration-api-v3.test.js test/rpp-0481-driver-registration-api-release-verifier-v5.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
node --test --test-name-pattern='plugin-owned reference-field' test/generated-push-harness.test.js
```

The broad plugin-driver bundle passed with 95 tests/subtests and 0 failures.
The focused generated-harness reference-field proof passed with 1 subtest and
0 failures.

## Caveat

This is a reference-field validator contract, not a generic plugin reference
extractor or rewriter. It proves declared scalar reference fields are shaped,
hash-bound, target-stability-checked, and exact across planner, JS apply, PHP
registered-driver evidence, and generated harness ready/refusal cases.
Arbitrary plugin graph traversal, reference rewriting, plugin-owned files,
activation/update side effects, and merge policies beyond `refuse-on-conflict`
remain release-scope work.
