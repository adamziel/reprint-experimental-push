# AO required release checks evidence

Date: 2026-05-28
Lane: required-checks-release-command

## What changed

- Added `src/required-release-checks.js`, a standalone data contract and evaluator for local release-movement checks.
- Added `scripts/release/required-release-checks-report.mjs`, an operator-runnable local command that emits stable JSON and exits nonzero unless mandatory production observations are present and fresh.
- Added `fixtures/protocol/push-required-release-checks-contract.json` so CI/release gates can read the mandatory command, artifact, observation, and expected-summary matrix without consulting GitHub branch protection or external services.
- Added `test/required-release-checks.test.js` with fixture validation, command coverage, and fail-closed assertions for duplicate ids, missing commands/artifacts, stale observations, unknown severities, and tampered `releaseReady` summaries.

## Operator command

```sh
node ./scripts/release/required-release-checks-report.mjs
node ./scripts/release/required-release-checks-report.mjs --fixture fixtures/protocol/push-required-release-checks-contract.json
node ./scripts/release/required-release-checks-report.mjs --observations-file path/to/observations.json --now 2026-05-28T08:30:00.000Z
```

The default current-repo mode enumerates the contract and local artifact presence, but fails closed until observations are supplied. The fixture mode proves the stable release-ready shape.

## Stable JSON summary contract

`summary_fields` are fixed in this order:

1. `ok`
2. `releaseReady`
3. `requiredCount`
4. `passedCount`
5. `missingChecks`
6. `staleChecks`
7. `nonBlockingChecks`

`releaseReady` is only true when every `blocking` production-required check has a passed observation with:

- the exact local command from the contract,
- every required artifact path from the contract,
- an ISO `observedAt` timestamp that is not in the future and not older than `staleAfterMs`.

Missing or invalid `observedAt` values are treated as stale production-required observations and fail closed.

## Required local checks

| Check id | Owner scope | Mandatory local command | Evidence artifacts |
| --- | --- | --- | --- |
| `release-gates-evaluator` | `release-gates` | `node --test test/release-gates.test.js` | `src/release-gates.js`; `test/release-gates.test.js`; `docs/evidence/ao-release-gates.md` |
| `recovery-journal-proof` | `recovery` | `node --test test/recovery-journal.test.js` | `src/recovery-journal.js`; `test/recovery-journal.test.js`; `docs/evidence/ao-journal-recovery.md`; `fixtures/protocol/push-production-journal-lease-recovery-inspect-contract.json` |
| `auth-inspect-proof` | `auth` | `node --test test/authenticated-http-push-client.test.js` | `src/authenticated-http-push-client.js`; `test/authenticated-http-push-client.test.js`; `docs/evidence/ao-executor-auth-leases.md`; `fixtures/protocol/push-auth-session-fencing-contract.json` |
| `graph-identity-proof` | `graph` | `node --test test/graph-mapping-inventory.test.js` | `scripts/bench/graph-mapping-inventory.js`; `test/graph-mapping-inventory.test.js`; `docs/evidence/ao-graph-identity.md` |
| `plugin-driver-proof` | `plugin-driver` | `node --test test/production-plugin-package-scenarios.test.js` | `scripts/playground/production-plugin-package-scenarios.js`; `test/production-plugin-package-scenarios.test.js`; `plugins/reprint-push/reprint-push.php`; `docs/evidence/ao-plugin-driver.md` |
| `route-proof-contracts` | `routes` | `node --test test/protocol-fixtures.test.js` | `fixtures/protocol/push-production-route-matrix-contract.json`; `fixtures/protocol/push-production-ladder-contract.json`; `docs/protocol.md`; `docs/executor.md` |
| `evidence-coverage-proof` | `evidence` | `node --test test/generated-push-harness.test.js` | `test/generated-push-harness.test.js`; `docs/generated-push-harness.md`; `docs/scenario-matrix.md` |
| `operator-proof` | `operator` | `node --test test/release-gates.test.js` | `docs/evidence/ao-release-gates.md`; `docs/evidence/ao-progress-report.md`; `progress.html` |
| `artifact-redaction-proof` | `artifact-integrity` | `node --test test/evidence-redaction.test.js` | `src/evidence-redaction.js`; `test/evidence-redaction.test.js`; `docs/evidence/ao-evidence-redaction.md`; `docs/scenario-matrix.md` |
| `provenance-proof` | `artifact-integrity` | `node --test test/protocol-compatibility.test.js` | `src/protocol-compatibility.js`; `test/protocol-compatibility.test.js`; `fixtures/protocol/push-production-pull-bridge-contract.json`; `docs/protocol.md` |

## Fail-closed behavior covered

Focused test coverage asserts that release movement is denied for:

- duplicate check ids,
- missing command definitions,
- missing artifact definitions,
- missing observations,
- passed observations that omit the required command,
- passed observations that omit mandatory artifacts,
- stale or missing production `observedAt` values,
- unknown severities,
- tampered summaries where `releaseReady: true` coexists with missing required checks,
- current-repo command mode without observations.

## Focused verification

```sh
node --check src/required-release-checks.js
node --check scripts/release/required-release-checks-report.mjs
node --check test/required-release-checks.test.js
node --test test/required-release-checks.test.js
node ./scripts/release/required-release-checks-report.mjs --fixture fixtures/protocol/push-required-release-checks-contract.json
node ./scripts/release/required-release-checks-report.mjs --now 2026-05-28T08:30:00.000Z
git diff --check
```

Observed focused test status: `node --test test/required-release-checks.test.js` passed 9 tests.

## RPP evidence IDs claimed

This contract and command provide evidence toward the earliest release-gate coverage items that need a machine-readable local command/artifact summary before release movement:

- RPP-0041 through RPP-0060: generated release-gate coverage now has a standalone required-check matrix and fail-closed summary validation.
- RPP-0056: the summary fields include explicit `releaseReady`/missing/stale accounting.
- RPP-0057 through RPP-0060: operator proof and `verify:release`-related evidence are enumerated as mandatory local artifacts/commands rather than external branch-protection state.
