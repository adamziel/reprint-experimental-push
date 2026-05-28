# AO critic live roster 36 audit - 2026-05-28

Current source of truth after the lane moved during this audit: `origin/lane/evidence-integration-20260527` at `9140a7645` (`docs: refresh progress for rpp-0067`). Checklist lint reports 128 checked / 872 open; final release remains **NO-GO**. This audit started from `a180f44e9` / 127 checked and was replayed onto `9140a7645` before commit. It writes only the live-roster-36 audit/evidence files and does not edit checklist, progress, or product code surfaces.

## Findings first

| Severity | Finding | Exact evidence | Required correction / owner |
| --- | --- | --- | --- |
| High | Release-gate docs are now stale behind `RPP-0067`: `RPP-0068` and `RPP-0069` both conflict directly with the current lane. | After fetch, `origin/lane/evidence-integration-20260527` is `9140a7645`. `git merge-tree --write-tree origin/lane/evidence-integration-20260527 origin/session/rpp-25-rpp-0068-application-password-credential-binding` reports `CONFLICT (content): Merge conflict in docs/evidence/ao-release-gates.md`; the same command for `origin/session/rpp-25-rpp-0069-manage-options-capability-proof` reports the same conflict. | `rpp-25` should restack `RPP-0068` and `RPP-0069` from `9140a7645`, regenerate the `ao-release-gates.md` prose, and rerun focused release-gate tests, checklist lint, redaction scan, and `git diff --check`. |
| High | The generated-harness queue remains pairwise conflicting even though each pushed candidate merges cleanly into the current lane. | `RPP-0151` (`66cdeeec6`), `RPP-0150` (`9e776dfbd`), and `RPP-0345` (`0e9848bc4`) each merge cleanly into `9140a7645`. Pairwise `git merge-tree --write-tree` reports conflicts for `RPP-0151 + RPP-0150`, `RPP-0151 + RPP-0345`, and `RPP-0150 + RPP-0345` in `docs/generated-push-harness.md`, `scripts/harness/generated-push-cases.js`, and `test/generated-push-harness.test.js`. `rpp-33/RPP-0152` also has local generator edits. | Queue owner `rpp-35` and integrator `rpp-28` should integrate only one generated-harness candidate, then require all remaining generated-harness workers to restack and rerun full generated harness tests before lane inclusion. |
| High | Plugin-driver queue is still a shared-doc/test collision after `RPP-0067`. | `RPP-0463`, `RPP-0464`, `RPP-0466`, and local `RPP-0467` each merge cleanly into `9140a7645`. Pairwise checks report conflicts in `docs/evidence/ao-plugin-driver.md` for `RPP-0464 + RPP-0466`, `RPP-0466 + RPP-0467`, and `RPP-0463 + RPP-0467`, with repeated overlap in `test/push-planner.test.js`. | Plugin-driver owners `rpp-32` and `rpp-34` should serialize these branches and preserve local-only caveats after every restack. Do not batch `ao-plugin-driver.md` updates. |
| High | Several active panes are now stale-based relative to `9140a7645`. | Post-move statuses show `rpp-24/RPP-0153`, `rpp-25/RPP-0070`, `rpp-33/RPP-0152`, and `rpp-34/RPP-0468` are `[behind 2]` with heads still at `a180f44e9`; `rpp-32/RPP-0467` is `[ahead 1, behind 2]`; `rpp-36` is `[ahead 1, behind 2]`. | Owners should fetch/replay before commit or push. Queue/progress must not count any branch that does not include `9140a7645`. |
| Medium | `RPP-0238` remains stale behind `RPP-0237`, while newer merge-invariant work continues on shared planner/generated test surfaces. | Fresh checks before the lane move showed `RPP-0238` conflicting in `test/generated-push-harness.test.js`; after `9140a7645`, `rpp-29/RPP-0240` is active with modified `test/generated-push-harness.test.js` and `test/push-planner.test.js`. | `rpp-29` should restack any `RPP-0238` replay and rerun full touched planner/generated suites after each generated-harness or plugin-driver lane move. |
| Medium | Progress and queue handoff surfaces remain branch-local or stale compared with the public lane. | `rpp-36` branch `session/rpp-36-progress-post-rpp0237-live-roster-36` is `[ahead 1, behind 2]` after the lane moved. `rpp-35` remains on worktree branch `session/rpp-35` behind 42 commits even though its stdout queue was refreshed. `rpp-31` still has untracked stale `ao-critic-live-roster-10` files. | Handoff should cite `origin/lane/evidence-integration-20260527` at `9140a7645` plus checklist lint 128/872, not sidecar progress branches or queue pane summaries alone. |
| Medium | Developer floor is satisfied, but activity is concentrated on conflict-prone shared files. | Current/refilled roster has at least seven developer panes: `rpp-24/RPP-0153`, `rpp-25/RPP-0070`, `rpp-29/RPP-0240`, `rpp-30/RPP-0346`, `rpp-32/RPP-0467`, `rpp-33/RPP-0152`, and `rpp-34/RPP-0468`. The risky clusters are release-gate docs, generated harness docs/cases/tests, and plugin-driver docs/planner tests. | Keep the developer floor, but route new work away from these shared files until the queue drains and restacks. |
| Low | Production/local and redaction caveats remain release blockers, not final release proof. | Public progress on the current lane still states **NO-GO for final release**. Graph/generated candidates touch local production complex-site proof files; plugin-driver branches document local-only planner evidence. Artifact redaction scans in panes are branch-local unless rerun on the final lane. | Keep final release **NO-GO** until production release-gate evidence and final-lane redaction scans pass. |

## Candidate ordering notes

1. After `RPP-0067`, hold `RPP-0068`, `RPP-0069`, and active `RPP-0070` until they restack on the current release-gate docs.
2. Pick only one generated-harness branch (`RPP-0151`, `RPP-0150`, or `RPP-0345`) before restacking `RPP-0152`/`RPP-0153` and any older generated candidates.
3. Pick only one plugin-driver branch (`RPP-0463`, `RPP-0464`, `RPP-0466`, active `RPP-0467`, or `RPP-0468`) before restacking the rest.
4. Treat `RPP-0238` as stale behind `RPP-0237`; prefer a restacked branch or a clean fallback.
5. Keep public dashboards pinned to `9140a7645` / 128 checked / 872 open / **NO-GO** until `origin/lane` advances and checklist lint confirms the new count.

## Commands used for this audit

- `git fetch origin --prune`
- `git reset --hard origin/lane/evidence-integration-20260527` to replay onto the lane move while preserving only the two untracked audit files
- `node scripts/release/checklist-completion-lint.mjs --root .`
- `git worktree list --porcelain`
- `tmux list-sessions`
- `git -C <worktree> status --short --branch` and `git -C <worktree> log --oneline -1` for the live roster
- `tmux capture-pane` for active developer, integrator, queue, and progress panes
- `git merge-tree --write-tree` for lane-vs-candidate and pairwise conflict checks
