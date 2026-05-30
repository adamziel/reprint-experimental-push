# RPP-0481 driver registration API release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0481 driver registration API, variant 5
Checklist item: RPP-0481 — Carry through the release verifier for driver registration API, variant 5.

## Scope

This is focused local release-verifier carry-through evidence for the plugin-owned
row driver registration API. It validates existing release verifier/package-smoke
wiring and exact snapshot-library driver behavior only. No production source,
progress page, or shared release-verifier implementation file changed.

## Proof surface

`test/rpp-0481-driver-registration-api-release-verifier-v5.test.js` proves:

- `verify:release` still invokes the packaged plugin driver verifier guard bundle
  through `test:playground:production-plugin-driver-verifier-guards`;
- the guard command runs in `driver-guard-only` mode and selects the
  `driver-verifier-guards` scenario alias;
- `driver-verifier-guards` expands to the driver receipt guard plus every driver
  registration guard: missing export/apply/validate callbacks, missing driver
  name, missing plugin owner, missing table, duplicate driver name, and duplicate
  table mapping;
- the package-smoke source has a concrete `runScenario()` and summary field for
  each registration guard; and
- a PHP probe against `scripts/playground/snapshot-lib.php` proves exact accepted
  driver behavior for the release-verifier fixture driver: registration, lookup
  by driver name/table, export callback, apply callback, supported update
  validation, unsupported delete refusal, and all malformed-registration
  fail-closed messages.

The test builds a hash-only RPP-0481 proof envelope with
`rawValuesIncluded: false`. It asserts the envelope contains only `sha256:`
hashes for selected verifier scenarios, accepted registration behavior,
callback logs, validation, and fail-closed guard messages, and that raw driver
names, table names, plugin-owner strings, row ids, fixture modes, callback names,
callable names, and raw exception messages are absent from the proof JSON.

## Focused verification observed locally

```sh
node --check test/rpp-0481-driver-registration-api-release-verifier-v5.test.js
node --test test/rpp-0481-driver-registration-api-release-verifier-v5.test.js
node --test --test-name-pattern 'driver registration API|driver-registration alias|verifier alias|packaged driver verifier bundle|preserved-remote retry' test/plugin-driver-registration-api.test.js test/rpp-0441-driver-registration-api-v3.test.js test/production-plugin-package-scenarios.test.js test/protocol-fixtures.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0481-driver-registration-api-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result in this lane: all commands exited 0. The focused RPP-0481 test
reported 2 subtests ok and zero failures; the adjacent driver registration and
release-verifier slice reported its selected subtests ok; checklist lint
returned `"ok": true`; and the scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This remains local focused release-verifier/plugin-driver evidence. It is not a
live production release run and is not production-backed proof. Keep the final
release posture at NO-GO until separate live production-backed release evidence
is captured and accepted by the release gate.
