# AO critic live roster 27 audit - 2026-05-28

## Scope and lane truth

- Requested scope: independent live roster critique 27 from the latest `origin/lane/evidence-integration-20260527`.
- A final pre-commit fetch moved lane truth from `5057ee38a` to `229fa37da` (`docs: refresh progress for rpp-0058`). This audit was reset to that lane before committing.
- Checklist lint on the current lane reports 123 checked / 877 open, release **NO-GO**, and 0 risky claims.
- This audit changes only the requested critic audit/evidence files.

## Evidence gathered

- Fetched `origin/lane/evidence-integration-20260527` and reset this critic branch to `229fa37da`.
- Ran `node scripts/release/checklist-completion-lint.mjs --root .`; observed `ok: true`, 123 checked IDs, 877 open IDs.
- Inspected worktrees and tmux panes for `rpp-24`, `rpp-25`, `rpp-28`, `rpp-29`, `rpp-30`, `rpp-31`, `rpp-32`, `rpp-33`, `rpp-34`, `rpp-35`, and `rpp-36`.
- Ran merge-tree probes for release-gate, generated-harness, graph, and plugin-driver session refs against current lane `229fa37da`.

## Findings

### High - RPP-0058 is now integrated cleanly; the remaining risk is stale branch-local counting

- Owner suggestion: `rpp-28` integrator can stand down or take the next integration; `rpp-36` progress and `rpp-35` queue need a refresh from `229fa37da`.
- `origin/lane/evidence-integration-20260527` and `origin/session/rpp-28-rpp-0058-integration-20260528` both point to `229fa37da` after fetch.
- Checklist lint on the lane now reports 123/877, so the former 122/878 count is stale. The release remains **NO-GO**.
- `rpp-28` stdout reports one candidate integrated, 31 focused `RPP-0058` tests, a 37-test release-gate suite, checklist lint, artifact redaction scan, `git diff --check`, and zero divergence after push.
- Do not count any later release-gate or generated-harness branch from worker-local docs. `RPP-0062`, `RPP-0140`, `RPP-0455`, and the new progress heartbeat are still branch-local or stale until rebuilt on `229fa37da`.

### High - Release-gate queue now conflicts after RPP-0058

- Owner suggestion: `rpp-25`; queue owner should hold release-gate docs until `ao-release-gates.md` is manually reconciled on the new lane.
- Merge-tree from `229fa37da` reports content conflicts in `docs/evidence/ao-release-gates.md` for:
  - `RPP-0059` at `abf9a86e0` (base `48e05cd25`).
  - `RPP-0060` at `62e0676a1` (base `5057ee38a`).
  - `RPP-0061` at `2ca898068` (base `5057ee38a`).
- Active `rpp-25` is detached during an `RPP-0062` rebase and has `UU docs/evidence/ao-release-gates.md` plus `A test/release-gate-missing-local-url-regression.test.js`.
- Queue output that still lists `RPP-0058` as active from lane `5057ee38a` is stale. The next release-gate integration should not be attempted by applying the old session ref directly.

### High - Generated-harness and planner refs still need strict serialization

- Owner suggestion: `rpp-24`, `rpp-29`, `rpp-30`, and `rpp-33`; queue owner should re-probe pairwise after every lane move.
- Clean-alone refs against `229fa37da` include `RPP-0138`, `RPP-0139`, `RPP-0141`, `RPP-0233`, `RPP-0234`, and `RPP-0341`; all touch generated-harness or planner surfaces.
- Conflict refs remain unsafe as direct candidates: `RPP-0231` conflicts in `test/generated-push-harness.test.js`; `RPP-0232` conflicts in that file; `RPP-0449` conflicts in that file.
- Active `rpp-24` (`RPP-0140`) has replayed onto `229fa37da` with edits to `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`, and `test/generated-push-harness.test.js`, and was rerunning harness checks.
- Active `rpp-33` moved to `RPP-0142` from a branch behind lane and has uncommitted `scripts/harness/generated-push-cases.js` changes. It needs a current-lane replay before any claim can be trusted.

### Medium - Graph and plugin-driver candidates are clean one-by-one but overlap shared docs and generated harness

- Owner suggestion: `rpp-30`, `rpp-32`, and `rpp-34`.
- Clean-alone graph refs from `229fa37da` include `RPP-0340` and `RPP-0341`; both must keep local production-shaped caveats and must not imply external production validation.
- Clean-alone plugin-driver refs include `RPP-0448`, `RPP-0450`, `RPP-0451`, `RPP-0452`, `RPP-0453`, and `RPP-0454`. They share `docs/evidence/ao-plugin-driver.md`; several also touch generated-harness or planner/apply files.
- Active `rpp-32` is replaying `RPP-0455` on `229fa37da` after the lane moved. It remains branch-local until it pushes a session ref and the queue re-probes it.
- `RPP-0454` is pushed at `9c81b933e` but was built from the pre-`RPP-0058` base; merge-tree is clean now, yet its evidence should still be treated as local-focused and not production-backed.

### Medium - Progress and queue surfaces have stale baseline risk

- Owner suggestion: `rpp-35` queue and `rpp-36` progress.
- `rpp-35` remains on branch `session/rpp-35` at `a195ac53a`, behind the lane by 32 commits. Its latest visible queue summary still says lane `5057ee38a`, 122/878, and `RPP-0058` active. That is no longer lane truth.
- `rpp-36` pushed progress heartbeat `9cb09c1ab` representing lane `5057ee38a` and 122/878. After `229fa37da`, that progress heartbeat is stale and should not be integrated without a rebase and count refresh.
- `rpp-31` critic branch is ahead/behind and still has untracked older live-roster audit files. Those local files should not be counted as integrated evidence.

### Medium - The visible developer roster is near the minimum after several workers pushed and stopped

- Owner suggestion: supervisor/progress reporter should refill idle developer panes promptly.
- Clearly active panes with current work at inspection time: `rpp-24` (`RPP-0140` checks after replay), `rpp-25` (`RPP-0062` release-gate conflict resolution), `rpp-32` (`RPP-0455` replay), and `rpp-33` (`RPP-0142` generated-harness work).
- Recently pushed but idle or prompt-facing panes: `rpp-29` (`RPP-0234`), `rpp-30` (`RPP-0341`), and `rpp-34` (`RPP-0454`). They are available worktrees, but they should receive fresh next actions if the release invariant requires at least five active developers.
- `rpp-28` has integrated `RPP-0058` and is no longer an active blocker unless assigned the next candidate.

## Candidate order recommendation after lane `229fa37da`

1. Refresh `rpp-35` queue and `rpp-36` progress from `229fa37da`; remove stale 122/878 and stale `RPP-0058 active` wording.
2. Hold `RPP-0059`, `RPP-0060`, `RPP-0061`, and active `RPP-0062` until `docs/evidence/ao-release-gates.md` is reconciled on the new lane.
3. Avoid direct retries of `RPP-0231`, `RPP-0232`, and `RPP-0449`; rebuild them on the current generated-harness layout.
4. Serialize clean generated-harness candidates (`RPP-0138`, `RPP-0139`, `RPP-0141`, `RPP-0233`, `RPP-0234`, `RPP-0341`) and rerun the full generated harness after each lane move.
5. Consider graph/plugin-driver refs only after confirming they retain **NO-GO** and local-vs-production caveats.
6. Refill at least one idle developer pane before treating the roster as safely above the five-worker floor.

## Validation for this audit branch

Commands run after updating to `229fa37da`:

- `node scripts/release/checklist-completion-lint.mjs --root .` returned `ok: true`.
- `node scripts/release/artifact-redaction-scan.mjs audits/ao-critic-live-roster-27-20260528.md docs/evidence/ao-critic-live-roster-27.md docs/evidence audits progress.html` returned `ok: true`.
- `git diff --check` returned no whitespace errors.
