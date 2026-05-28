# AO critic live roster 4 audit — 2026-05-28

Lane: `critic-live-roster-4` (`session/rpp-31-critic-live-roster-4`)
Role: critic / evidence only
Audit window: 2026-05-28 03:46-03:54 CEST
Latest default lane audited after refresh: `origin/lane/evidence-integration-20260527` at `fdb02ab6a` (`test: add checklist completion linter`)

## Verdict

Final release remains **NO-GO**.

The lane advanced during this critic pass from `ae959cdbe` (`Refresh checklist after integration lanes`) to `fdb02ab6a` by integrating the prior checklist-completion linter. That is useful process evidence, but it does not change release movement. `node ./scripts/release/check-release-gates.mjs` still exits `1` with `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`, `releaseMovement.allowed: false`, `finalGates: 3/20`, and 17 missing blocking gates.

The live tmux roster is productive, but AO lifecycle remains unstable. The main AO start pane records OOM/kill exits (`AO_START_STATUS:134`, `137`, `143`) before a partial restart, and the supervisor handoff explicitly says `ao spawn`/polling is unreliable. There are `ao-web` helper processes now, but the effective management path remains tmux/git/ps plus bounded AO checks.

## Command evidence gathered

| Area | Command / inspection | Result |
| --- | --- | --- |
| Current lane | `git fetch --all --prune`; `git log -1 origin/lane/evidence-integration-20260527` | Lane moved to `fdb02ab6a`; branch realigned before this audit doc was written. |
| Live panes | `tmux list-sessions`, `tmux list-panes`, `tmux capture-pane` for `rpp-24`, `rpp-25`, `rpp-26`, `rpp-28`, `rpp-29`, `rpp-30`, `rpp-orchestrator` | Active reduced roster exists: developers/integrator `rpp-24`, `rpp-25`, `rpp-28`, `rpp-29`, `rpp-30`; progress `rpp-26`; critic `rpp-31`; recreated `rpp-orchestrator`. |
| Branch statuses | `git -C <worktree> status --short --branch`; selected remote ref listing | `rpp-24`, `rpp-29`, `rpp-30` are ahead/behind the latest lane; `rpp-25` is in an add/add conflict after the linter landed; `rpp-28` is clean at the lane head. |
| Release gate state | `node ./scripts/release/check-release-gates.mjs` | Exit `1`; `status: held`; `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `finalGates: 3/20`; 17 missing gates. |
| Checklist linter current tree | `node scripts/release/checklist-completion-lint.mjs` | Exit `0`; `ok: true`; `riskyClaims: 0`; `scannedFiles: 29`; current output says 85 checked / 915 unchecked. |
| Focused red-suite probes | `node --test --test-name-pattern 'production-shaped authenticated push records revoked' test/authenticated-http-push-client.test.js`; `node --test --test-name-pattern 'snapshot apply gate allows only exact forms lab custom table rows' test/playground-snapshot-lib.test.js` | Both fail on the current lane. Auth lifecycle still stops after preflight/dry-run instead of preserving apply/recovery/replay/journal observations; snapshot gate still sees `Call to undefined function apply_filters()` instead of the expected unsupported-table error. |
| Artifact scanner smoke | Pushed `origin/session/rpp-29` scanner run from `/tmp` against current `docs/evidence`, `audits`, progress files, and `progress.html` | Exit `1`; 29 files scanned; 2 rejected (`audits/auditor-reorg-v2-20260527.md` for a redacted application-password command sample and `docs/evidence/ao-docker-local-production.md` for Docker-internal WP service URLs). |
| AO lifecycle | `tmux capture-pane main:1.0`; `ps` filtered for AO/Codex; orchestrator pane tail | AO startup repeatedly OOMed/killed before partial restart. `rpp-orchestrator` is alive but its own handoff says AO helpers are not stable and it is using bounded checks. |
| Scratch hygiene | `git ls-files .ao .lane-output` | Current lane still tracks `.lane-output/final.md` from earlier history. This audit does not touch it, but the tracked runtime scratch file remains a hygiene issue. |

## Critical findings

### 1. Release remains honestly NO-GO

The current release-gate command is fail-closed:

```json
{
  "ok": false,
  "status": "held",
  "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
  "releaseMovement.allowed": false,
  "finalGates": "3/20",
  "missing": 17
}
```

The exact blocker remains missing production source topology: `REPRINT_PUSH_SOURCE_URL` is required before release gates can run preflight, dry-run, apply, or recovery. The checklist is 85 checked / 915 open after `ae959cdbe`; `fdb02ab6a` added the linter but did not mark more checklist items complete.

### 2. The new team is mostly building useful standalone guardrails

Useful work is visible, but much of it is still not wired into release movement:

- Integrated but standalone: route proof matrix, operator proof status utility, protocol compatibility evaluator, checklist completion linter.
- Integrated and partially wired: evidence redaction is imported by `src/release-gates.js` and `src/recovery-journal.js`, so it affects current release-gate/journal evidence paths.
- Branch-local/in progress: provenance release-gate wiring (`rpp-24`), artifact redaction current-tree scanner (`rpp-29`), required release checks command (`rpp-30`), live-roster progress refresh (`rpp-26`).

This is acceptable if reports keep saying support evidence. It becomes risky if these tools are counted as release gates before they are invoked by `verify:release`, `check:release-gates`, or a CI-equivalent local command with generated evidence artifacts.

### 3. Write-scope overlap is now real

The most immediate overlap is the checklist linter:

- `rpp-28` integrated `origin/session/rpp-25` into the lane as `fdb02ab6a`.
- `rpp-25` simultaneously started `session/rpp-25-checklist-lint-current` from `ae959cdbe` and now has add/add conflicts in `docs/evidence/ao-checklist-completion-lint.md` and `test/checklist-completion-lint.test.js`.

Additional stale-base hazards appeared after `fdb02ab6a` landed:

- `rpp-24`, `rpp-29`, and `rpp-30` are each ahead/behind the lane. A two-dot diff from latest lane to those branch heads shows deletions of the newly integrated checklist-linter files because they are based on `ae959cdbe` or older. They must rebase/reset to `fdb02ab6a` or cherry-pick only additive commits before any lane push.
- Conceptual overlap: `rpp-29` artifact redaction, integrated evidence redaction, `rpp-24` provenance, and `rpp-30` required checks all aim at release evidence gating. They need one integration owner to avoid multiple disconnected gate vocabularies.

### 4. Linter, redaction, provenance, and required-check work can be integrated only with constraints

- **Checklist linter:** The old linter is now on the lane and passes current docs with 0 risky claims. Its evidence doc is stale: it records 81/919 from the old tree while current output is 85/915. The `rpp-25-current` hardening lane must resolve the add/add conflict and update docs/tests from the lane head.
- **Artifact redaction scanner:** The pushed `rpp-29` scanner is useful but not yet gate-safe. A smoke run against current docs rejects two existing files: a documented sample application-password command and Docker-internal WP service URLs. That may be desired for release artifacts, but it is too strict for all historical evidence/docs unless policy narrows scan targets or docs are redacted/allowlisted.
- **Integrated evidence redaction:** Real wiring exists in release gates and recovery journal, but heuristic edge cases remain: benign `value`/`data`/`payload` metadata can over-block, while secrets under unexpected keys or PII under innocuous names may still evade detection.
- **Provenance:** Prior `origin/session/rpp-24` is stale and a wholesale merge would delete many integrated files. Active `rpp-24-provenance-gate` cherry-picked the validator but is already behind `fdb02ab6a`; it should rebase before wiring into `check-release-gates`. Its 24-hour freshness window should be used for generated release artifacts, not for historical audit docs.
- **Required checks:** Prior `origin/session/rpp-30` is stale relative to current lane. Active `rpp-30-required-checks-command` is ahead/behind and has uncommitted edits. It should preserve the integrated linter and report missing artifact/provenance/redaction checks as blockers instead of passing release readiness.

### 5. Full-suite failures remain release-relevant

This pass intentionally ran only focused probes, not a full suite. Both selected red-suite probes still fail on the current lane:

- Auth lifecycle evidence is still incomplete: the selected authenticated push test observes only preflight and dry-run, not apply/recovery-inspect/replay/journal lifecycle observations.
- Snapshot apply gate behavior is still broken for the selected forms-lab table guard: it fails because `apply_filters()` is undefined instead of producing the expected unsupported-table rejection.

These are release-critical classes of failures. Focused green checks from integration lanes must continue to be described as focused-only until these and the other known production-shaped/auth/plugin failures are fixed or explicitly quarantined.

### 6. AO lifecycle remains unstable despite productive tmux supervision

The reduced team is active, stdout-auditable, and producing pushed branches. However, AO lifecycle is still not reliable:

- the main AO pane shows OOM and killed statuses (`134`, `137`, `143`);
- `rpp-orchestrator` was recreated and is alive, but its prompt explicitly instructs not to rely on hanging AO helpers;
- process listing shows AO web helper processes, but practical coordination is still happening through tmux, git, and bounded commands.

Continue supervising with tmux/git/ps and avoid unbounded `ao` helper calls until lifecycle stability is proven.

## Active roster snapshot

| Lane | Observed state | Critic note |
| --- | --- | --- |
| `rpp-24` | `session/rpp-24-provenance-gate`, ahead 1 / behind 1 after `fdb02ab6a`. | Must rebase before push; otherwise diff appears to delete integrated linter files. |
| `rpp-25` | `HEAD (no branch)` with add/add conflicts on checklist linter doc/test. | Direct overlap with `rpp-28` integration; needs conflict resolution from latest lane. |
| `rpp-26` | `session/rpp-26-progress-live-roster`, behind latest lane after fdb. | Reporting branch must include the linter integration and latest lane head. |
| `rpp-28` | `session/rpp-28-checklist-integration` clean at `fdb02ab6a`; remote pushed. | Safely integrated old rpp-25 linter, but release still NO-GO. |
| `rpp-29` | `session/rpp-29-artifact-redaction-current`, ahead/behind with modified scanner. | Rebase needed; scanner currently rejects current docs when run broadly. |
| `rpp-30` | `session/rpp-30-required-checks-command`, ahead/behind with modified required-check module. | Rebase needed; preserve linter and keep missing checks blocking. |
| `rpp-orchestrator` | Alive but behind latest lane; bounded AO checks in progress. | Lifecycle remains unstable; tmux supervision is productive but manual. |

## Recommendations

1. Keep release **NO-GO** until release gates pass with generated production-backed artifacts and release-critical test failures are resolved or explicitly quarantined.
2. Immediately rebase/reset `rpp-24`, `rpp-25`, `rpp-29`, and `rpp-30` onto `fdb02ab6a` before any push or integration.
3. Assign one integration lane for evidence policy vocabulary: redaction scanner, provenance validator, checklist linter, and required checks should feed one release-gate/report command rather than parallel standalone definitions.
4. Update `docs/evidence/ao-checklist-completion-lint.md` because it now has stale 81/919 counts on a lane with 85/915.
5. Keep AO lifecycle work bounded; do not depend on `ao spawn/status/session` as the source of truth while OOM/killed status remains visible.
