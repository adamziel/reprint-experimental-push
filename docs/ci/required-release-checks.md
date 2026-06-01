# CI required release checks

Variant: RPP-0912 CI required checks list variant 1
Scope: support-only CI release gate discipline
Evidence: [RPP-0912 support-only evidence artifact](../evidence/rpp-0912-ci-required-checks-list.md)

This list records the required CI checks that must remain blocking before any
release-gate status can move. Release gate status moves only after
production-backed evidence is present for every blocking check. Support-only
evidence is not production-backed evidence, and missing production-backed proof
keeps the final release at **NO-GO**.

This list does not authorize release-gate status changes. It is a support-only
control surface for CI and release-ops review.

## Blocking check list

| Check id | Area | Required command | Blocking | Production proof | Required artifacts |
| --- | --- | --- | --- | --- | --- |
| `release-gates-evaluator` | release gates | `node --test test/release-gates.test.js` | Blocking | Required | `src/release-gates.js`; `test/release-gates.test.js`; `docs/evidence/ao-release-gates.md` |
| `recovery-journal-proof` | recovery journal | `node --test test/recovery-journal.test.js` | Blocking | Required | `src/recovery-journal.js`; `test/recovery-journal.test.js`; `docs/evidence/ao-journal-recovery.md`; `fixtures/protocol/push-production-journal-lease-recovery-inspect-contract.json` |
| `auth-inspect-proof` | authentication boundary | `node --test test/authenticated-http-push-client.test.js` | Blocking | Required | `src/authenticated-http-push-client.js`; `test/authenticated-http-push-client.test.js`; `docs/evidence/ao-executor-auth-leases.md`; `fixtures/protocol/push-auth-session-fencing-contract.json` |
| `graph-identity-proof` | graph identity | `node --test test/graph-mapping-inventory.test.js` | Blocking | Required | `scripts/bench/graph-mapping-inventory.js`; `test/graph-mapping-inventory.test.js`; `docs/evidence/ao-graph-identity.md` |
| `plugin-driver-proof` | plugin driver | `node --test test/production-plugin-package-scenarios.test.js` | Blocking | Required | `scripts/playground/production-plugin-package-scenarios.js`; `test/production-plugin-package-scenarios.test.js`; `plugins/reprint-push/reprint-push.php`; `docs/evidence/ao-plugin-driver.md` |
| `route-proof-contracts` | route contracts | `node --test test/protocol-fixtures.test.js` | Blocking | Required | `fixtures/protocol/push-production-route-matrix-contract.json`; `fixtures/protocol/push-production-ladder-contract.json`; `docs/protocol.md`; `docs/executor.md` |
| `evidence-coverage-proof` | evidence coverage | `node --test test/generated-push-harness.test.js` | Blocking | Required | `test/generated-push-harness.test.js`; `docs/generated-push-harness.md`; `docs/scenario-matrix.md` |
| `operator-proof` | operator proof | `node --test test/release-gates.test.js` | Blocking | Required | `docs/evidence/ao-release-gates.md`; `docs/evidence/ao-progress-report.md`; `progress.html` |
| `artifact-redaction-proof` | artifact integrity | `node --test test/evidence-redaction.test.js` | Blocking | Required | `src/evidence-redaction.js`; `test/evidence-redaction.test.js`; `docs/evidence/ao-evidence-redaction.md`; `docs/scenario-matrix.md` |
| `provenance-proof` | artifact integrity | `node --test test/protocol-compatibility.test.js` | Blocking | Required | `src/protocol-compatibility.js`; `test/protocol-compatibility.test.js`; `fixtures/protocol/push-production-pull-bridge-contract.json`; `docs/protocol.md` |

## Release-gate movement rule

The required checks stay blocking until fresh production-backed observations
exist for the exact command and every required artifact listed above. A passing
local or support-only check can support review, but it cannot move a release
gate from `support_only` to `partially_proven` or `proven`.

CI and release-ops evidence must keep release movement held when any blocking
check has missing, stale, non-production-backed, or support-only evidence. The
expected final posture without production-backed proof is **NO-GO**.

