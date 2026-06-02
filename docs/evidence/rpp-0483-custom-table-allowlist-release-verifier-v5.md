# RPP-0483 custom-table allowlist release verifier v5 evidence

Date: 2026-05-30
Lane: RPP-0483 custom table allowlist exact match, variant 5
Checklist item: RPP-0483 — Carry through the release verifier for custom table allowlist exact match, variant 5.

## Scope

This is local release-verifier carry-through evidence for the production-shaped
plugin-driver boundary. It keeps the release posture at NO-GO because it is not
live production-owned external evidence.

## Proof surface

`test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js` proves:

- the release verifier summary carries the exact custom-table tuple for
  `row:["wp_reprint_push_release_state","state_id:1"]`, owner `reprint-push`,
  driver `reprint-push-release-state`, table
  `wp_reprint_push_release_state`, and `supportsDelete: false`;
- the verifier summary now exposes `applyCarryThrough` and requires an apply
  status `200`, DB-journal commit, at least one mutation-applied row, and
  before-first-mutation revalidation for the plugin-driver resource;
- the contract-bound payload validator evidence is accepted only when the
  payload evidence binds the mutation action, planned value hash, expected
  value state, contract `supportsDelete` flag, contract hash, and
  `contractValidationHash`;
- the verifier binds the allowlist row schema and contract hash to the
  mutation contract, and rejects allowlist row-schema mismatches even when the
  owner/driver/table tuple is exact;
- nested schema-bound payload evidence rejects undeclared payload properties
  with redacted count-only evidence rather than raw extra key names;
- forged payload evidence with surplus raw sidecars is not release-verifier
  eligible because the verifier requires exact hash-only evidence shape;
- explicit final-state mismatch evidence fails the release-verifier
  plugin-driver boundary even when the allowlist and mutation tuple are exact;
- wrong owner, wrong driver, wrong table, forged contract fingerprints, forged
  payload action, forged payload value hash, forged contract-validation hash,
  and extra custom-table mutation near misses stay blocked; and
- the focused proof envelope and summary stay hash-only for the RPP-0483 private
  sentinels.

## Focused verification observed locally

```sh
node --check src/plugin-driver-contracts.js
node --check src/plugin-driver-validators.js
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
php -l scripts/playground/snapshot-lib.php
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
node --test test/plugin-driver-contract.test.js test/plugin-driver-registration-api.test.js test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js
node --test test/rpp-0441-driver-registration-api-v3.test.js test/rpp-0481-driver-registration-api-release-verifier-v5.test.js
node --test --test-name-pattern 'production plugin-driver boundary' test/production-shaped-proof.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0483-custom-table-allowlist-release-verifier-v5.md docs/progress-log.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: the focused RPP-0483 test exited 0 with 23 subtests ok, the
combined plugin-driver contract, PHP registration API, and RPP-0483 run exited
0 with 59 tests ok, and the adjacent RPP-0441/RPP-0481 driver-registration
release-verifier run exited 0 with 3 tests ok. The shared production-shaped
plugin-driver boundary subset exited 0 with 11 tests ok. JS syntax checks, PHP
lint, scoped redaction scan, and whitespace checks exited cleanly.

## Release posture

NO-GO for final release movement from this slice alone. The proof is local and
production-shaped; a live production-owned source boundary is still required for
release promotion.
