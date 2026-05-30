# RPP-0441 driver registration API v3 evidence

Date: 2026-05-30
Lane: RPP-0441 driver registration API, variant 3
Checklist item: RPP-0441 — Add generated coverage for driver registration API, variant 3.

## Scope

This is local generated plugin-driver evidence for the driver registration API.
It adds a dedicated RPP-0441 probe without editing generated-harness files or
progress surfaces.

## Proof surface

`test/rpp-0441-driver-registration-api-v3.test.js` runs a PHP probe against
`scripts/playground/snapshot-lib.php` and proves exact behavior for two generated
API-registered drivers plus one filter-registered driver:

- deterministic driver order: built-in release-state driver, generated alpha,
  generated beta, then the filter-provided driver;
- exact normalized fields for driver name, table, plugin owner, delete support,
  callbacks, built-in allowlist metadata, lookup by name, and lookup by table;
- fallback driver naming from a string filter key when the filter entry omits
  the `driver` field;
- generated registered drivers flowing into plugin-owned policy export,
  registered-row export callbacks, apply-row callbacks, and mutation validation;
- delete support enforcement before mutation validation when a registered driver
  does not opt in to deletes;
- callback-returned mutation refusal for an otherwise registered driver; and
- fail-closed malformed registration behavior for a missing API driver name,
  duplicate registry driver name, duplicate filter table, and non-array filter
  fallback.

The test also builds a hash-only RPP-0441 evidence envelope with
`rawValuesIncluded: false`. It asserts the envelope contains only `sha256:`
hashes and does not include raw generated driver names, table names, plugin
owners, row keys, callback names, callable names, or raw refusal messages.

## Focused verification observed locally

```sh
node --check test/rpp-0441-driver-registration-api-v3.test.js
node --test test/rpp-0441-driver-registration-api-v3.test.js
```

Observed result: both commands exited 0. The new focused test reported 1 subtest
ok, 0 failed.

## Release posture

This remains focused local generated plugin-driver evidence only. It is not
production-backed release evidence, does not update `progress.html`, and does
not broaden accepted production plugin-driver resources.
