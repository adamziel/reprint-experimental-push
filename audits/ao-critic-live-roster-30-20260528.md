# AO critic live roster 30 audit - 2026-05-28

## Findings

### High - Integrator target handoff is inconsistent: rpp-28 is not integrating RPP-0340

- Evidence: `git -C /home/claude/.agent-orchestrator/projects/reprint-push/worktrees/rpp-28 status --short --branch` showed `session/rpp-28-rpp-0062-integration-20260528...origin/lane/evidence-integration-20260527` at `7282d12e3` with no worktree delta.
- Evidence: the `rpp-28` tmux pane printed `lane=integration-rpp0062 intent=create-fresh-integration-branch cmd="git switch -c session/rpp-28-rpp-0062-integration-20260528 origin/lane/evidence-integration-20260527"` after verifying `origin/session/rpp-25-rpp-0062-missing-local-url-gate-regression` at `3ebfb3287`.
- Evidence: `RPP-0340` exists as `origin/session/rpp-30-rpp-0340-production-importer-exporter-identity-map` at `182d524dc`, merge-tree clean, but no `rpp-28` branch or pane output showed `RPP-0340` integration.
- Risk: instructions and dashboards that say `rpp-28/RPP-0340` are stale or wrong; the actual active integrator path is `RPP-0062`, and at inspection time the candidate had not yet been applied to the fresh integration branch.
- Owner suggestion: `rpp-28` should either continue `RPP-0062` or explicitly abort and switch to `RPP-0340`; `rpp-35` should publish a one-line queue correction so progress handoff names the same candidate as the integrator pane.

### High - Release-gate candidates become pairwise conflicts after RPP-0062

- Evidence: merge-tree against current lane `7282d12e3` reports `RPP-0062` clean with files `docs/evidence/ao-release-gates.md,test/release-gate-missing-local-url-regression.test.js`; `RPP-0063` clean with `docs/evidence/ao-release-gates.md,test/release-gate-missing-remote-changed-url-regression.test.js`; `RPP-0064` clean with `docs/evidence/ao-release-gates.md,test/release-gate-packaged-fallback-regression.test.js`.
- Evidence: simulating `RPP-0062` as the next base makes `RPP-0063`, `RPP-0064`, `RPP-0059`, `RPP-0060`, and `RPP-0061` all conflict in `docs/evidence/ao-release-gates.md`.
- Risk: integrating `RPP-0062` first is plausible, but the release-gate queue must be restacked immediately afterward. Otherwise branch-local evidence from `RPP-0063` or `RPP-0064` could be counted while their shared evidence doc is stale.
- Owner suggestion: after `RPP-0062`, queue owner should rebuild exactly one of `RPP-0063`/`RPP-0064` on the new lane rather than cherry-picking the raw branch.

### High - Several completed pre-RPP-0233 generated-harness branches need restack

- Evidence: merge-tree from lane `7282d12e3` reports conflicts in `test/generated-push-harness.test.js` for `RPP-0140` (`0f6b36fa3`, base `229fa37da`), `RPP-0235` (`9c0c12bbb`, base `229fa37da`), `RPP-0234` (`5591fc67e`, base `5057ee38a`), `RPP-0341` (`467a9fb62`, base `5057ee38a`), and `RPP-0455` (`71ec1aa71`, base `229fa37da`).
- Evidence: current active harness lanes also overlap: `rpp-24/RPP-0145` has a background terminal inspecting generated harness patterns, `rpp-33/RPP-0144` has dirty `scripts/harness/generated-push-cases.js`, and `rpp-30/RPP-0342` has dirty `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`, and `test/generated-push-harness.test.js`.
- Risk: the team is correctly busy, but the generated-harness queue is now a shared-file pileup. Raw session refs based before `RPP-0233` should not be used as proof of current production-backed or lane-integrated behavior.
- Owner suggestion: after each harness integration, rerun merge-tree against current lane and require full `test/generated-push-harness.test.js`; queue should prefer clean/current-lane harness refs like `RPP-0143` or `RPP-0342` only after rechecking against any new lane move.

### Medium - Branch-local evidence and progress surfaces are mostly separated, but rpp-36 remains a session-only heartbeat

- Evidence: lane `7282d12e3` and checklist lint report 124/876, with `docs/evidence/ao-progress-report.md`, `docs/progress-log.md`, `docs/supervisor-feedback.md`, and `progress.html` naming `RPP-0233` as integrated and preserving release **NO-GO**.
- Evidence: `rpp-36` is on `session/rpp-36-progress-live-roster-29-20260528` with dirty progress files, and its pane says branch-local active work remains uncounted: `rpp-24/RPP-0145`, `rpp-25/RPP-0064`, `rpp-28/RPP-0062 integration`, `rpp-29/RPP-0236`, `rpp-30/RPP-0342`, `rpp-32/RPP-0456`, `rpp-33/RPP-0144`, and `rpp-34/RPP-0457`.
- Risk: progress is directionally correct, but it is still a session branch until pushed/integrated. Do not treat the dirty `rpp-36` heartbeat as lane truth.
- Owner suggestion: progress should commit/push its heartbeat only after one final fetch confirms the lane remains `7282d12e3` or refreshes to the newer head.

### Medium - At least five developers are active, but some refs are already pushed and need refills

- Evidence: active panes observed: `rpp-24/RPP-0145`, `rpp-29/RPP-0236`, `rpp-30/RPP-0342`, `rpp-33/RPP-0144`, plus `rpp-28/RPP-0062` integration and `rpp-36` progress. `rpp-32` reported `RPP-0456` pushed and clean, and `rpp-34` reported `RPP-0457` pushed and clean.
- Evidence: `rpp-25/RPP-0064` is pushed at `68eabb1f0` and prompt-facing; `rpp-34/RPP-0457` is pushed at `fa14167c5`; `rpp-32/RPP-0456` is pushed at `177ba9554`.
- Risk: the active-developer floor is currently satisfied if integrator/progress count, but it is thin if completed prompt-facing workers are excluded. The roster needs immediate follow-up assignments for `rpp-25`, `rpp-32`, and `rpp-34`.
- Owner suggestion: refill `rpp-25` after `RPP-0064`, `rpp-32` after `RPP-0456`, and `rpp-34` after `RPP-0457`; keep `rpp-33` moving only after its dirty harness work is resolved.

### Medium - AO dashboard/process metadata is not reliable enough as the sole handoff source

- Evidence: `rpp-ao-lifecycle` heartbeat was current enough at inspection time (`2026-05-28T07:42:44Z` versus local `2026-05-28T09:43:16+02:00`), and `rpp-ao-web` was listening on port 8080.
- Evidence: the web pane also shows repeated historical Next.js errors: `TypeError: controller[kState].transformAlgorithm is not a function`, followed by dashboard restarts at `09:11` and `09:31`.
- Evidence: `ps` for AO worker prompts still includes stale launch text such as `Current integration lane ... a195ac53a with 107 checked / 893 open` for `rpp-35` and `rpp-36`, even though git lane truth is `7282d12e3` and 124/876.
- Risk: dashboards and process command lines are useful for liveness but not authoritative for release handoff. They can mislead reviewers about current lane, counts, and worker intent.
- Owner suggestion: handoff should cite `git rev-parse origin/lane/evidence-integration-20260527`, checklist lint output, and tmux pane markers rather than AO process metadata.

### Low - Redaction and production/local caveats remain release blockers, not release proof

- Evidence: release remains **NO-GO** in lane progress surfaces. Graph/plugin-driver candidates `RPP-0340`, `RPP-0452`, `RPP-0454`, `RPP-0456`, and `RPP-0457` are local-focused or production-shaped, not external production validation.
- Risk: clean merge-tree status must not be translated into production-backed completion. `RPP-0340` in particular is clean but based at `5057ee38a` with four lane commits behind and should be described as local production-shaped proof only.
- Owner suggestion: keep local-vs-production caveats in every progress refresh and require artifact redaction scan before any evidence branch is counted.

## Exact lane and command evidence

- Lane truth command: `git rev-parse --short origin/lane/evidence-integration-20260527` -> `7282d12e3`.
- Checklist command: `node scripts/release/checklist-completion-lint.mjs --root .` -> `ok: true`, 124 checked, 876 unchecked.
- Integrator command evidence: `rpp-28` pane printed `lane=integration-rpp0062 intent=create-fresh-integration-branch cmd="git switch -c session/rpp-28-rpp-0062-integration-20260528 origin/lane/evidence-integration-20260527"`.
- Queue command evidence: `rpp-35` pane printed `lane=queue intent=recompute-merge-tree-statuses-after-rpp0233 cmd="merge-tree all requested rpp ids from new lane"` and ranked `RPP-0062`, `RPP-0063`, `RPP-0340`, `RPP-0452`, `RPP-0454`, `RPP-0143`, `RPP-0456`.
- Dashboard evidence: `tmux capture-pane -t rpp-ao-web:0` showed dashboard restarts and Next.js TypeErrors before the current 8080 process became ready.

## Validation for this audit branch

Commands run after writing this audit:

- `node scripts/release/checklist-completion-lint.mjs --root .` returned `ok: true`.
- `node scripts/release/artifact-redaction-scan.mjs audits/ao-critic-live-roster-30-20260528.md docs/evidence/ao-critic-live-roster-30.md docs/evidence audits progress.html` returned `ok: true`.
- `git diff --check` returned no whitespace errors.
