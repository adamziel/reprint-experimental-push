# AO Independent Audit — 2026-05-28

Lane: `independent-audit`
Audited branch head before this evidence commit: `0841d3cc23908de2155eb7244eb9bc7553cb42fd` (`session/rpp-7`, matching `origin/lane/evidence-integration-20260527` at audit start).
Write scope used: `audits/ao-independent-audit-20260528.md`, `docs/evidence/ao-independent-audit.md`.
Production code changed: no.

## Executive verdict

The integrated branch has strong executable lab and local-production-shaped evidence for generated planning coverage, graph inventory, plugin-driver guards, durable journal/recovery classification, and a loopback WordPress release-verifier path. It is **not release-ready by default** because the canonical `npm run verify:release` gate correctly fails closed when no explicit live production-owned source topology is supplied.

The closest successful release evidence observed in this pass is a local loopback WordPress topology that reached `LIVE_RELEASE_BOUNDARY_OK` and `releaseMovement.allowed: true` inside the nested release verifier. The wrapper still exited non-zero because the nested plugin-driver guard failed with a Playground readiness HTTP 401, even though the same plugin-driver guard passed standalone in this audit. Treat that as an integration/stability gap, not as release-green evidence.

## Commands run and observed results

| Area | Command | Exit | Evidence observed |
| --- | --- | ---: | --- |
| Repo/runtime orientation | `node /home/claude/.codex/skills/wp-project-triage/scripts/detect_wp_project.mjs` | 0 | Repo classified as Node harness/unknown WP project shape; recommendation: `npm run test`. |
| Generated harness | `npm run test:generated-push-harness` | 0 | 1/1 test passed. Generated harness covers 360 cases, all ten tiers, 203 ready, 129 conflict, 28 blocked. |
| Generated harness summary | `node --input-type=module -e 'import { runGeneratedPushHarness } from "./scripts/harness/generated-push-cases.js"; const { summary } = runGeneratedPushHarness(); console.log(JSON.stringify(summary, null, 2));'` | 0 | `totalCases: 360`, `totalMutations: 5008`, `totalConflicts: 312`, `totalBlockers: 375`, max ready resource count 66, max ready mutation count 43. |
| Focused support tests | `node --test test/local-production-complex-site-proof.test.js test/graph-mapping-inventory.test.js test/production-plugin-package-scenarios.test.js test/recovery-journal.test.js test/protocol-fixtures.test.js` | 0 | 75/75 tests passed, including release-verifier support parsing, graph inventory shape/fail-closed behavior, plugin-driver scenario aliases, protocol fixture gates, and recovery-journal inspection. |
| Graph inventory | `npm run bench:graph-mapping-inventory` | 0 | 7 families total; 6 mapped; 1 intentionally guarded (`unsupportedPluginOwnedSurfaces`); 31 mapped references; 0 unmapped references; 0 blocked families. |
| Plugin-driver proof | `npm run test:playground:production-plugin-driver-verifier-guards` | 0 | Standalone driver guard bundle passed: receipt guard rejected revoked credentials and malformed/missing/duplicate driver registrations failed closed. |
| Recovery proof | `npm run test:recovery:file-journal` | 0 | File-backed journal smoke classified `old-remote`, `blocked-recovery`, `fully-updated-remote`, and drift-blocked states; storage guard `filesystem-compare-rename`; `fsyncEvidence: true`; monotonic sequence true. |
| Canonical release gate | `npm run verify:release` | 1 | Topology proof printed port 8080/local-only/no-tunnels, then gate failed closed with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, `gates: 0/4`. |
| Non-live release support proof | `npm run test:playground:production-shaped-release-verify` | 1 | Static retained-source support proof printed `ok: true`, but boundary remained `auth/session lifecycle and durable journal semantics`, `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`, `PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED`; not release-movement evidence. |
| Local-production complex graph verifier | `npm run verify:release:local-production:complex-site:graph` | 1 | Loopback WordPress planner proof passed with 24 ready mutations/24 preconditions, 9 remote-drift conflicts, featured-image graph evidence, plugin-driver mutation/precondition evidence, and nested release verifier summary `LIVE_RELEASE_BOUNDARY_OK`. Overall wrapper failed because nested `test:playground:production-plugin-driver-verifier-guards` hit `Timed out waiting for Playground server ... readiness HTTP 401`; invariant `verifierExitedZero: false`. |
| CI/workflow inspection | `find .github -maxdepth 3 -type f -print 2>/dev/null` plus grep for release scripts | 0 | No repo-local `.github` workflow files were found. Release scripts exist in `package.json`, but no repo CI gate was present to require them. |

Raw command logs were captured under `.lane-output/independent-audit-*.log` in this worktree and are intentionally not committed.

## Positive evidence from this pass

### Generated harness

The generated push harness is broad enough to count as real evidence rather than exact-shaped fixture coverage:

- 360 generated cases against a 300-case minimum.
- Status spread: 203 ready, 129 conflict, 28 blocked.
- Tiers 0 through 9 all covered with 36 cases each.
- High-complexity reach: max resource count 69, max mutation count 44.
- Ready-path high-complexity reach: max ready resource count 66, max ready mutation count 43.
- Feature families include plugin-owned supported/unsupported, graph families, forms-lab table, file topology, deletes, direct conflicts, and atomic plugin stack outcomes.

### Release verifier support tests

The 75-test focused set passed and specifically kept these support surfaces executable:

- Complex-site planner/release evidence parser fails closed without receipts.
- Graph inventory output shape and fail-closed ownership/status checks.
- Plugin-driver scenario alias expansion and unknown scenario rejection.
- Protocol fixture checks for the production ladder, live-source gate, topology, recovery inspect-before-mutate, and `verify:release` fail-closed behavior.
- Recovery journal wrapper and checked release path consume restart-readable claim-fenced journal evidence.

### Graph inventory

The graph inventory reports no unmapped references and no blocked families in the current unit profile. The one non-mapped family is intentionally guarded:

- `unsupportedPluginOwnedSurfaces`: status `planner-guarded`, blocker `surface remains intentionally fail-closed outside explicit driver allowlists`.

That is acceptable as conservative behavior, but it is not proof that arbitrary plugin-owned data is supported.

### Plugin-driver proof

The standalone plugin-driver guard smoke passed and produced concrete proof that malformed driver registration and receipt paths fail closed. Notable observations:

- Revoked credential apply was rejected with `reprint_push_lab_auth_required`.
- Target row was retained after rejected apply.
- Missing export/apply/validate/name/plugin owner/table and duplicate name/table guard scenarios all reported `exportFailed: true` or equivalent failure markers.

### Recovery proof

The recovery file-journal smoke exercised the concrete restart states expected from the release model:

- Failure before mutation: `old-remote`, 8 old / 0 new / 0 unknown.
- Failure after two mutations: `blocked-recovery`, 6 old / 2 new / 0 unknown, and retry remains blocked.
- Completed replay: zero replay mutations, `fully-updated-remote`.
- Drift: `blocked-recovery`, 0 old / 7 new / 1 unknown.
- Journal evidence used compare/rename storage guard, `fsyncEvidence: true`, and monotonic sequence evidence.

## Exact remaining release gaps observed

1. **Canonical release gate is still blocked without explicit live topology.**
   `npm run verify:release` exits 1 with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` and `gates: 0/4`. The release gate must stay red until a production-owned `REPRINT_PUSH_SOURCE_URL` plus required source/local/drift topology and credentials are supplied and pass.

2. **Retained/non-live release support proof cannot move release gates.**
   `npm run test:playground:production-shaped-release-verify` still reports the remaining boundary as `auth/session lifecycle and durable journal semantics` and exits non-zero. It is useful support evidence only.

3. **Local-production complex graph wrapper is not consistently green.**
   The local loopback complex graph run produced strong planner and nested release-verifier evidence (`LIVE_RELEASE_BOUNDARY_OK`, 24 applied mutations, 24 live revalidations, durable journal accepted, stale-claim rejected), but the wrapper exited 1 because the nested plugin-driver guard failed readiness with HTTP 401. Since the same plugin-driver guard passed standalone, the likely remaining work is to stabilize or isolate the nested guard inside `verify:release:local-production:complex-site:graph` before treating this wrapper as release evidence.

4. **No repo-local CI workflow was present to block release on required proofs.**
   `package.json` defines the right scripts, but no `.github` workflow files were found. Unless CI is configured outside this repo, RPP release-gate items that require CI blocking remain open.

5. **Unsupported plugin-owned surfaces remain intentionally fail-closed, not supported.**
   Graph inventory has 0 unmapped references, but `unsupportedPluginOwnedSurfaces` remains guarded. This is safe conservative behavior; it still means arbitrary plugin-owned data is not release-supported without explicit semantic drivers.

6. **Operator/release-ops artifacts remain partly documentation evidence, not fully verified release gates.**
   Existing docs contain extensive recovery/protocol text, but this pass did not find a release artifact package, repo-local CI required-check enforcement, or a final go/no-go record that can override the observed `verify:release` failure. The correct release state remains no-go/default-blocked.

## RPP item coverage claimed by this evidence

This audit adds concrete evidence toward the primary lane range:

- RPP-0901 through RPP-0906: final/objective/critic audit evidence now has exact commands, exits, and current commit context rather than stale percentages.
- RPP-0907 through RPP-0908: security/privacy evidence is partially supported by auth rejection, redaction-oriented recovery tests, and no-tunnel topology proof; remaining production review is still open.
- RPP-0909 through RPP-0911: operator/failure/rollback evidence is supported by recovery classification commands; production repair/rollback remains open.
- RPP-0912: CI required checks are explicitly identified as a gap because no repo-local `.github` workflow was found.
- RPP-0913 through RPP-0915: progress publishing, release artifact packaging, and versioned protocol docs were not closed by this pass; evidence says they should remain open until tied to the release verifier and CI gate.

## Release recommendation

Do not mark the project release-ready from this branch alone. The next release-readiness proof should be a single green command path that:

1. Supplies explicit production-owned source/local/drift URLs and credentials to `npm run verify:release`.
2. Runs without packaged fallback and without local-only retained-source substitution.
3. Completes plugin-driver guards, recovery file journal, and release verifier checks in one zero-exit gate.
4. Is enforced by CI or an equivalent required release gate.
