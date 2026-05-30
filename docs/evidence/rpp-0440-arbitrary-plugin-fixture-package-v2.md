# RPP-0440 arbitrary plugin fixture package evidence

Date: 2026-05-30

## Scope

This is variant-2 focused plugin-driver proof for the arbitrary plugin fixture
package. It proves the release-gate summary for the packaged fixture labels
local Playground evidence separately from production-backed evidence.

## Proof surface

`test/rpp-0440-arbitrary-plugin-fixture-package-v2.test.js` proves:

- the `arbitrary-plugin-fixture-package` smoke alias expands only to the bounded
  `driver-receipt-guards` scenario for the `driver-fixture` package;
- local fixture package evidence reports `evidenceScope: local-playground`,
  `supportOnly: true`, `releaseGate.status: NO-GO`, and a note that
  production-backed release-gate evidence is still required;
- production-backed fixture package evidence reports `evidenceScope:
  production-backed`, `supportOnly: false`, `releaseGate.status: GO`, and a
  production-backed release-gate note when all package checks pass;
- production-scoped evidence that fails the package checks stays `NO-GO` with
  `ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE`; and
- fixture summaries do not carry raw fixture payload or rejected-message text
  into the release-gate summary.

## Focused verification observed locally

```sh
node --check test/rpp-0440-arbitrary-plugin-fixture-package-v2.test.js
node --test test/rpp-0440-arbitrary-plugin-fixture-package-v2.test.js
node --test test/production-plugin-package-scenarios.test.js
REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only \
  REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=arbitrary-plugin-fixture-package \
  NODE_NO_WARNINGS=1 \
  node ./scripts/playground/production-plugin-package-smoke.mjs
node --test --test-name-pattern 'production plugin package smoke includes the revoked packaged driver credential guard summary|production-shaped release verify source runs the packaged plugin driver revoked credential guard in bounded mode' \
  test/production-shaped-proof.test.js
node --test --test-name-pattern 'RPP-0440|arbitrary plugin fixture package' \
  test/rpp-0440-arbitrary-plugin-fixture-package-v2.test.js \
  test/production-plugin-package-scenarios.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs \
  docs/evidence/rpp-0440-arbitrary-plugin-fixture-package-v2.md \
  docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all commands above exited 0. The focused RPP-0440 test
reported 4 subtests ok, 0 failed; the existing package-scenario regression
reported 9 subtests ok, 0 failed; the production-shaped source slice
reported 2 subtests ok, 0 failed; the combined focused pattern reported 6
subtests ok, 0 failed; the driver-guard-only package smoke emitted
`evidenceScope: local-playground`, `supportOnly: true`, `releaseGate.status:
NO-GO`, and a release-gate note that production-backed evidence is still
required; checklist lint returned `"ok": true`; the scoped artifact redaction
scan returned `"ok": true`; and both diff whitespace checks exited 0.

## Release posture

This lane adds local focused proof and a local package-smoke run only. The
release-gate summary distinguishes local support evidence from production-backed
evidence; this lane does not claim live external production release readiness.
