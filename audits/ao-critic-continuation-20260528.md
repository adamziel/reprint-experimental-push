# AO critic continuation audit — 2026-05-28

Lane: `critic-continuation` (`session/rpp-15`)
Audited product integration head: `bb40db8c1` (auth integration). Critic branch rebased on latest `origin/lane/evidence-integration-20260527` `25c667cd4`, a docs-only supervision handoff refresh observed before push.
Write scope used: `audits/ao-critic-continuation-20260528.md`, `docs/evidence/ao-critic-continuation.md`

## Verdict

Final release readiness remains **held**. The newly integrated graph/plugin/audit/chunk/auth commits and the newly pushed `session/rpp-11` through `session/rpp-14` branches add useful support evidence, but none of the reviewed lanes proves production release movement. Keep release posture at support/local-candidate until the same auth/session, durable journal, graph/plugin, rollback/repair, protocol, and production topology evidence is consumed by the release path and the release-critical checks are green.

## Critic command evidence

| Scope | Command / observation | Result |
| --- | --- | --- |
| Project classification | `node <wp-project-triage>/scripts/detect_wp_project.mjs` | Node harness; WP triage could not classify as plugin/theme/core; recommended `npm run test`. |
| Active roster | `tmux list-sessions`, `tmux capture-pane` for `rpp-10`..`rpp-14`, later `rpp-17`..`rpp-19` | `rpp-10`..`rpp-14` active; `rpp-11`/`12`/`13`/`14` pushed; `rpp-17` auth integration advanced into the integration lane; `rpp-19` integration lane active. |
| Newly pushed branches | `git for-each-ref --sort=-committerdate refs/remotes/origin/session` | New pushed heads include `origin/session/rpp-11` `16bfbcd77`, `rpp-12` `14bf669ca`, `rpp-13` `becc23804`, `rpp-14` `6b57056a3`, plus older `rpp-1`..`rpp-9`; the integration lane also advanced to `bb40db8c1` with the read-only inspect auth work. |
| Release gates branch | `node --test test/release-gates.test.js` on `rpp-1` worktree | 11/11 pass; diff check pass. |
| Recovery journal branch | `node --test test/recovery-journal.test.js` on `rpp-2` worktree | 21/21 pass; diff check pass. |
| Graph identity branch | `node --test test/graph-mapping-inventory.test.js test/push-planner.test.js` on `rpp-3` worktree | 89/89 pass; diff check pass. |
| Plugin-driver branch broad check | `timeout 25s node --test test/production-shaped-proof.test.js` on `rpp-4` worktree | Timed out (`124`) after TAP header only; do not use full file as passing evidence. |
| Executor auth branch / current integration broad check | `node --test test/authenticated-http-push-client.test.js` on `rpp-5`, repeated on current integration `bb40db8c1` | 117 pass / 10 fail. Failures include lifecycle observation recording, preserved-remote retry precedence, consumed-claim identity, recovery-journal fallback precedence, and durable-journal auth envelope precedence. |
| Chunking branch | `node --test test/guarded-executor-benchmark.test.js` on `rpp-6` worktree | 6/6 pass; diff check pass. |
| Release CI branch | `node --check scripts/release/check-release-gates.mjs && node --test test/release-gate-cli.test.js test/release-gates.test.js` on `rpp-12` | 12/12 pass; diff check pass. |
| Rollback repair branch | `node --test test/recovery-repair.test.js test/recovery-journal.test.js` on `rpp-11` | 26/26 pass; diff check pass. |
| Evidence redaction branch | `node --check src/evidence-redaction.js src/release-gates.js src/recovery-journal.js && node --test test/evidence-redaction.test.js test/release-gates.test.js test/recovery-journal.test.js` on `rpp-13` | 39/39 pass; diff check pass. |
| Protocol compatibility branch | `node --check src/protocol-compatibility.js && node --test test/protocol-compatibility.test.js` on `rpp-14` | 8/8 pass; diff check pass. |
| Docker local production WIP | `command -v docker`; `npm run -s verify:release:docker-local-production` on `rpp-10` | Docker not found; harness exits `2` with `DOCKER_CLI_MISSING`, `acceptedForReleaseGate: false`, `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`. |

## Lane findings and exact next corrections

### rpp-10 — Docker local production harness (active WIP)

What held:
- The WIP harness correctly detects the sandbox has no Docker CLI and fails closed before starting containers.
- Focused tests passed 9/9 and assert only `127.0.0.1:8080:80` is published, the Compose network is internal, and tunnel-shaped references are rejected.

Risks / corrections:
- This is **unavailable-capability evidence**, not Docker WordPress production proof. Keep `acceptedForReleaseGate: false` in this sandbox.
- The branch is behind current integration and edits `package.json`; rebase before push and re-run the fail-closed harness after rebase.
- Add a Docker-capable CI or manual run artifact before claiming `RPP-0802` or any real local-production pass. The passing artifact must include `releaseEvidence.ok: true`, verifier exit `0`, and the generated `release-gate-input.json`.

### rpp-11 — Rollback/repair boundaries (`origin/session/rpp-11`)

What held:
- Focused recovery repair and recovery journal tests pass after rebase: 26/26.
- The new API fails closed on incomplete target envelopes and requires exact operator evidence for drift.

Risks / corrections:
- The final report claimed evidence toward `RPP-0618` (process kill mid mutation set), but the tests model partial state through in-memory snapshots and file journals; they do **not** kill/restart a process. Reframe as support evidence until an injected process-kill/restart test proves the item.
- Add a positive drift-with-operator-decision replay test. Current tests prove missing/stale operator evidence is rejected, but do not prove an exact valid decision applies only the intended drifted target.
- Add a claim-fenced `markRecoveryJournalRepaired()` test with a stale claim ID to prove the repaired marker cannot be appended by an old worker.

### rpp-12 — Release CI gate command (`origin/session/rpp-12`)

What held:
- CLI is machine-readable, exits `1` with missing production evidence, and keeps local-candidate evidence nonzero for final release.
- Focused CLI plus release-gate tests pass 12/12.

Risks / corrections:
- This is a package script, not a required CI workflow. Do not claim CI enforcement until a required check or release script invokes it.
- The zero-exit test uses synthetic final-release evidence. Before a release gate can trust this command, add provenance constraints for the evidence file (e.g. generated by the verifier with command/status/artifact refs) and a regression that arbitrary hand-authored JSON cannot stand in for production-owned evidence.
- Add explicit tests for invalid/missing evidence file error output (`exitCode: 2`) so CI can distinguish malformed input from a held release.

### rpp-13 — Evidence redaction (`origin/session/rpp-13`)

What held:
- Redaction, release-gate, and recovery-journal focused tests pass 39/39.
- The branch centralizes raw value/session token rejection and keeps hash metadata readable.

Risks / corrections:
- The branch touches broad release-gate and recovery-journal paths. It must be integrated with care because it can reject any field normalized to `data`, `payload`, `value`, etc. Add compatibility tests for legitimate non-secret diagnostic metadata that the release path currently needs to preserve, or document that those fields must be renamed/hash-only.
- Add regression coverage for summary consumers (`releaseGateSummary()` / persisted progress artifacts), not only individual gate evidence, to prove redacted evidence remains redacted after summarization.
- Rebase/integrate after current graph/plugin/chunk commits and rerun the release/recovery critical slices before claiming broad evidence hygiene.

### rpp-14 — Protocol compatibility (`origin/session/rpp-14`)

What held:
- Standalone protocol contract tests pass 8/8.
- Unknown versions, downgrades, missing required auth/journal/lease capabilities, and capability extras fail closed in the new evaluator.

Risks / corrections:
- The evaluator is standalone. It is not wired into the authenticated HTTP client, production routes, release verifier, or release gates. `mutationAllowed: true` means only “protocol contract negotiated,” not “the request may mutate.” Rename or wrap that field before consumers overread it.
- Add integration tests that `runAuthenticatedHttpPush` / preflight cannot proceed without a negotiated protocol result and that apply refuses when the negotiated capability digest changes between dry-run and apply.
- The fixture lists the 8080/no-tunnel invariant, but the protocol tests only exercise capability strings. Add a test that ties topology/no-tunnel policy to the actual release verifier or Docker/local-production topology artifact before using it as release evidence.

### Previously pushed branches now partly integrated

- `rpp-3` graph identity: focused tests pass and current integration includes `577c74282`. Still add tests for nested/invalid identity maps. The current implementation validates a mapping while the raw `identityMap.bySourceKey` may still contain entries that later prove unusable; a mapping must not become usable because an invalid nested mapping made rows look equivalent. Also test duplicate identical maps across base/local/remote snapshots so importer/exporter metadata does not fail closed unnecessarily.
- `rpp-4` plugin driver: current integration includes plugin proof commit `b348c56b8`. The branch evidence correctly limits itself to focused tests. The broad `production-shaped-proof` file timed out in this audit, so do not use that full file as green evidence. Replace brittle source-shape assertions with behavior checks and fix Playground/snapshot readiness before release-critical CI depends on it.
- `rpp-5` executor auth leases: the read-only inspect auth work is now in the integration lane at `bb40db8c1`, but the broad auth client file remains red (117/127 pass in this audit on current integration). Do not treat the integration as release movement; fix or explicitly quarantine the 10 auth failures with release gates still held.
- `rpp-6` chunking benchmark: focused tests pass and integration includes `4d5c96d78`. Keep `productionThroughput: not-claimed` until production storage receipts, row batch CAS, and atomic-group commit evidence exist.
- `rpp-7`/`rpp-8` audit docs: integrated as `05050392b`; no product code risk. They correctly hold release readiness.
- `rpp-9` progress docs: still stale against current integration head in the pushed session branch; rebase/update before any progress publish. It references `243dfe777` and old sibling-output state.

## Overlap and branch hygiene risks

- `rpp-10`, `rpp-13`, and `rpp-14` started behind the current integration branch. Rebase before integration to avoid reverting the integrated graph/plugin/chunk/audit commits.
- `rpp-13` and `rpp-12` both affect release gate consumption paths; `rpp-19` was observed as a fresh integration lane for `rpp-11`/`12`/`13`/`14`. Integration must preserve the redaction wrapper when adding the CLI script and must rerun `test/release-gates.test.js`, `test/release-gate-cli.test.js`, and `test/evidence-redaction.test.js` together.
- `bb40db8c1` integrates the known-red `rpp-5` auth branch. Treat it as support evidence only unless the auth client full-file failures are fixed.

## Bottom line

The strongest safe movements are: fail-closed Docker prerequisite proof, recovery repair model contracts, release-gate CLI wrapper, evidence redaction support, protocol contract support, graph/plugin/chunk support evidence. The blocking corrections are production/Docker pass evidence, auth client red tests, protocol integration into the actual push path, and release evidence provenance/CI enforcement.
