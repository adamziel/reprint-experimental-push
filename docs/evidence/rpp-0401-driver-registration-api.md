# RPP-0401 driver registration API evidence

This is variant-1 focused evidence toward `RPP-0401`. The checklist remains
unchanged for integrator validation.

## Prior proof inspected

- `RPP-0421` already added the shared PHP driver-registration proof in
  `test/playground-snapshot-lib.test.js`, covering the built-in
  `reprint-push-release-state` driver, a filter-registered extension driver,
  lookup by driver name/table, and fail-closed malformed registrations.
- `RPP-0461` already added hash-only local regression evidence for accepted
  registration and invalid/ambiguous refusal paths. Its redaction proof keeps
  raw failure messages, callback names, and invalid table names out of the
  focused evidence envelope.

## Variant-1 scope

`test/plugin-driver-registration-api.test.js` is the dedicated variant-1 PHP
probe against `scripts/playground/snapshot-lib.php`. It proves:

- normalized registration return values for `driver`, `table`, `pluginOwner`,
  `supportsDelete`, and callback bindings;
- deterministic registered-driver ordering with the built-in production-owned
  release-state driver first;
- lookup by registered driver name and table, plus `null` for an unknown driver;
- duplicate registered driver-name refusal, duplicate registered-table refusal,
  duplicate built-in table refusal, and missing validate callback refusal; and
- no registry mutation after rejected registrations.

The added audit-safe test constructs a redacted evidence envelope with
`rawValuesIncluded: false` and only `sha256:` hashes for accepted registration,
lookup, duplicate refusal, invalid-driver refusal, registry state, and the proof
summary. The test asserts the envelope does not include raw driver names, table
names, plugin-owner strings, callback names, callable names, or raw exception
messages.

## Focused verification observed locally

```sh
node --test --test-name-pattern 'RPP-0401|plugin-owned row driver registration API' test/plugin-driver-registration-api.test.js
```

Observed result: exit code 0; 3 subtests ok, 0 fail.

## Release posture

This remains local focused plugin-driver evidence only. It is not
production-backed release evidence, and release remains held for the broader
checklist until the integrator validates and updates status.
