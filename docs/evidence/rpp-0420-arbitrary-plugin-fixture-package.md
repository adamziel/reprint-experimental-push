# RPP-0420 arbitrary plugin fixture package

This is variant-1 focused evidence for the arbitrary plugin-owned row fixture
package used by `production-plugin-package-smoke.mjs`.

## What changed

- The package smoke now emits a canonical `arbitraryPluginFixturePackage`
  summary alongside the raw `arbitraryPluginFixturePackageProof` details.
- The summary carries `evidenceScope` and `releaseGateEvidenceScope` so the
  release gate can distinguish local Playground evidence from
  `production-backed` evidence.
- Local package-smoke evidence remains `supportOnly` with `releaseGate.status:
  NO-GO` and a note that production-backed release gate evidence is still
  required.
- When a future proof supplies `production-backed` scope and the package checks
  are complete, the same summary labels that release-gate evidence as
  production-backed.

## Focused verification

```sh
node --check scripts/playground/production-plugin-package-scenarios.js scripts/playground/production-plugin-package-smoke.mjs test/production-plugin-package-scenarios.test.js test/production-shaped-proof.test.js
node --test test/production-plugin-package-scenarios.test.js
node --test --test-name-pattern 'production plugin package smoke includes the revoked packaged driver credential guard summary|production-shaped release verify source runs the packaged plugin driver revoked credential guard in bounded mode' test/production-shaped-proof.test.js
REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=arbitrary-plugin-fixture-package NODE_NO_WARNINGS=1 node ./scripts/playground/production-plugin-package-smoke.mjs
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0420-arbitrary-plugin-fixture-package.md
git diff --check
```

## Release posture

The checked fixture package proof in this lane is local Playground support
evidence, not production-backed release evidence. Release movement remains held
until the release verifier consumes production-backed source/local/changed
boundaries and the plugin-driver package evidence reports production scope.
