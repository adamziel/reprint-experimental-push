# Auditor Reorg V2 Audit

Audit time: 2026-05-27 18:18:37 CEST (+0200)

Verdict: `0/4`

## Scope

Executed the next unfinished auditor task from
`/home/claude/reprint-experimental-push/.agents/NEXT_TASKS.md`.

The requested consolidated branch
`origin/supervisor/release-boundary-consolidated-20260527` was not present
after `git fetch --all --prune`, and `git ls-remote` for that branch and the
listed v2 lane branches returned no refs. The available integration branch was
`origin/supervisor/release-boundary-reorg-20260527`.

## Branch Heads

| Ref | Head | Subject |
| --- | --- | --- |
| `origin/main` | `37291101246ebd2e482b9eeb6f2dd363a5e2967f` | Refresh live progress page |
| `origin/supervisor/release-boundary-reorg-20260527` | `889b8d44b0ba215d0796ba15de9a01fa8d8eb3be` | Add fail-closed release verifier command |
| `origin/lane/reliable-executor` | `c54fbd738357c55fb57fe3b6f5e73b8e99450dbf` | Map more core WordPress graph identities |
| `origin/lane/auth-session-boundary-20260527` | `b630f6df1d709a7ce87472a295fdb68719b8e028` | Prove auth session live source boundary |
| `origin/lane/durable-journal-boundary-20260527` | `a35f6bd16a56235358d5f2d4a5380f607f92f98b` | Prove durable journal boundary in release verifier |
| `origin/lane/apply-revalidation-boundary-20260527` | `f73c885ba9aa7fb8784e5b8c2035effd39285028` | Prove apply revalidation boundary |
| `origin/lane/plugin-driver-boundary-20260527` | `275dfac34ebfc6d9dcf108882e762bfadd2392ee` | Prove release plugin driver boundary |
| `origin/lane/topology-verifier-20260527` | `b4545b7e556c25d479ac216a9245e22bf52086e7` | Fail closed release topology verifier |
| `origin/lane/critic-reorg-20260527` | `7a997661b1a56171bf45334be08ee6c2afea9d93` | Record reorg release gate review |

## Command Evidence

Consolidated branch presence:

```bash
git ls-remote --heads origin \
  'supervisor/release-boundary-consolidated-20260527' \
  'lane/*-v2-20260527' \
  'lane/critic-reorg-v2-20260527'
```

Result: no refs returned.

Local consolidated branch check after the 18:20 CEST idle restart:

```bash
git for-each-ref --format='%(refname:short) %(objectname:short) %(committerdate:iso8601) %(subject)' \
  refs/heads/supervisor/release-boundary-consolidated-20260527 \
  refs/heads/lane/auth-session-boundary-v2-20260527 \
  refs/heads/lane/durable-journal-boundary-v2-20260527 \
  refs/heads/lane/apply-revalidation-boundary-v2-20260527 \
  refs/heads/lane/plugin-driver-boundary-v2-20260527 \
  refs/heads/lane/topology-verifier-v2-20260527 \
  refs/remotes/origin/lane/critic-reorg-v2-20260527
git -C /tmp/reprint-reorg-integrator-20260527 status --short --branch
```

Observed local heads:

| Local/ref artifact | Head | Subject |
| --- | --- | --- |
| `supervisor/release-boundary-consolidated-20260527` | `24ec8558b` | Fail closed release topology verifier |
| `lane/auth-session-boundary-v2-20260527` | `ce6ded3de` | Prove apply revalidation boundary |
| `lane/durable-journal-boundary-v2-20260527` | `ce6ded3de` | Prove apply revalidation boundary |
| `lane/apply-revalidation-boundary-v2-20260527` | `4e30d9883` | Prove release plugin driver boundary |
| `lane/plugin-driver-boundary-v2-20260527` | `275dfac34` | Prove release plugin driver boundary |
| `lane/topology-verifier-v2-20260527` | `4e30d9883` | Prove release plugin driver boundary |
| `origin/lane/critic-reorg-v2-20260527` | `334b923b1` | Record reorg v2 critic review |

The local consolidated worktree had no conflicted files. It was five commits
ahead of `origin/lane/reliable-executor` and had only untracked `.agents/*`
runtime ledger files.

Remote consolidated branch check after the 18:22 CEST idle restart:

```bash
git ls-remote --heads origin \
  'supervisor/release-boundary-consolidated-20260527' \
  'lane/*-v2-20260527' \
  'lane/auditor-reorg-20260527' \
  'lane/critic-reorg-v2-20260527'
```

Observed remote heads:

| Remote ref | Head | Note |
| --- | --- | --- |
| `origin/supervisor/release-boundary-consolidated-20260527` | `24ec8558b14eec8fc26c049f6a2427bf261fccb9` | Published after the prior audit update |
| `origin/lane/auditor-reorg-20260527` | `ea2ebc7f03a483287123fc6f1d3da309ff850ee3` | Prior auditor update |
| `origin/lane/critic-reorg-v2-20260527` | `c5db7e1c6e774541c0913419dff9cbcf4cac4074` | Critic follow-up says verdict remains `0/4` |

No remote auth/durable/apply/plugin/topology v2 lane refs were returned by the
glob.

Available integration branch verifier:

```bash
git worktree add --detach /tmp/reprint-audit-reorg-integration-verify-20260527 \
  origin/supervisor/release-boundary-reorg-20260527
timeout 300s npm run verify:release
```

Observed status: `1`

Key structured output:

```json
{
  "ok": false,
  "code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
  "topology": {
    "sourceUrl": "",
    "ingressPort": 8080,
    "remoteTunnels": "disallowed",
    "releaseMovementAllowed": false,
    "fallbackSourcesAllowed": false,
    "packagedSourceAllowed": false,
    "labSourceAllowed": false,
    "fixtureSourceAllowed": false
  },
  "requirements": {
    "authSession": {
      "verdict": "PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED"
    },
    "durableJournal": {
      "ownsJournal": false,
      "restartReadable": false,
      "leaseFenced": false,
      "verdict": "PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED"
    },
    "preservedRejectedRemoteEvidence": {
      "preserved": false,
      "verdict": "PRESERVED_REMOTE_RETRY_REQUIRED"
    },
    "applyTimeRevalidation": {
      "proven": false,
      "verdict": "APPLY_TIME_REVALIDATION_REQUIRED"
    }
  },
  "boundary": {
    "status": "blocked",
    "releaseVerdict": "0/4",
    "gatesMoved": [],
    "verdict": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
  }
}
```

Local consolidated branch verifier:

```bash
cd /tmp/reprint-reorg-integrator-20260527
timeout 300s npm run verify:release
```

Observed status: `1`

Key structured output from `24ec8558b`:

```json
{
  "ok": false,
  "boundary": {
    "firstRemainingProductionBoundary": "explicit live production-owned release boundary",
    "status": "blocked",
    "verdict": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "liveSource": {
      "required": "REPRINT_PUSH_SOURCE_URL",
      "observed": "missing-live-source",
      "verdict": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
    }
  },
  "releaseProof": {
    "ok": false,
    "status": 1,
    "code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
  },
  "topologyEvidence": {
    "runner": {
      "script": "scripts/playground/production-shaped-live-release-verify.mjs",
      "routeProfile": "production-shaped",
      "packagedFallbackAllowed": false
    },
    "ports": {
      "sandboxIngress": 8080,
      "source": null,
      "remoteChanged": null,
      "localEdited": null,
      "applyRevalidationSource": null
    },
    "releaseMovement": {
      "allowed": false,
      "gates": "0/4",
      "reason": "REPRINT_PUSH_SOURCE_URL is required before the release verifier can run preflight, dry-run, apply, or recovery."
    }
  }
}
```

Published consolidated branch verifier:

```bash
git worktree add --detach /tmp/reprint-audit-remote-consolidated-verify-20260527 \
  origin/supervisor/release-boundary-consolidated-20260527
cd /tmp/reprint-audit-remote-consolidated-verify-20260527
timeout 300s npm run verify:release
```

Observed status: `1`

Key structured output from the published `24ec8558b` ref:

```json
{
  "ok": false,
  "boundary": {
    "firstRemainingProductionBoundary": "explicit live production-owned release boundary",
    "status": "blocked",
    "verdict": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "liveSource": {
      "required": "REPRINT_PUSH_SOURCE_URL",
      "observed": "missing-live-source",
      "verdict": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
    }
  },
  "releaseProof": {
    "ok": false,
    "status": 1,
    "code": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
  },
  "topologyEvidence": {
    "runner": {
      "script": "scripts/playground/production-shaped-live-release-verify.mjs",
      "routeProfile": "production-shaped",
      "packagedFallbackAllowed": false
    },
    "ports": {
      "sandboxIngress": 8080,
      "source": null,
      "remoteChanged": null,
      "localEdited": null,
      "applyRevalidationSource": null
    },
    "releaseMovement": {
      "allowed": false,
      "gates": "0/4",
      "reason": "REPRINT_PUSH_SOURCE_URL is required before the release verifier can run preflight, dry-run, apply, or recovery."
    }
  }
}
```

## Gate Classification

| Requirement | Current proof | Missing proof | Command evidence | Verdict impact |
| --- | --- | --- | --- | --- |
| GATE-1 Production executor/auth boundary | Available integration plus local and published consolidated verifiers fail closed and require a real `REPRINT_PUSH_SOURCE_URL`; critic follow-up still says `0/4`. | Live Reprint endpoint proof of auth/session issuance and readback on the same live source boundary. | `timeout 300s npm run verify:release` on `889b8d44`, local `24ec8558b`, and published `24ec8558b` exited `1` with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`. | No gate movement. |
| GATE-2 Durable recovery journal boundary | The verifier states durable journal proof is required and not met. | `ownsJournal: true`, `restartReadable: true`, and lease-fenced durable journal ownership on the release boundary. | `889b8d44` structured output reports `ownsJournal: false`, `restartReadable: false`, `leaseFenced: false`; `24ec8558b` stops before live journal proof because the source URL is missing. | No gate movement. |
| GATE-3 Live Docker/Playground production topology | The verifier blocks fallback sources and records local-only ingress policy. | A checked live source/local/changed topology against a real production-owned boundary. | `24ec8558b` reports `packagedFallbackAllowed: false`, source/local/drift ports as `null`, and release movement `allowed: false`. | No gate movement. |
| GATE-4 Plugin-driver ownership boundary | No live plugin-driver mutation proof is present in these verifier runs. | Plugin-owned mutation on the release boundary with allowlisted semantics, precondition evidence, rejected remote preservation, apply-time revalidation, and audit evidence. | The local consolidated command exits at the missing live-source boundary before plugin-driver release proof can move a gate. | No gate movement. |

## Blocker

The consolidated branch requested by `NEXT_TASKS.md` now exists remotely at
`24ec8558b14eec8fc26c049f6a2427bf261fccb9` and has a coherent fail-closed
`verify:release` command, but it correctly does not move any release gate
without a real live `REPRINT_PUSH_SOURCE_URL`.

Next exact command for repeat artifact review:

```bash
git fetch --all --prune
git worktree add --detach /tmp/reprint-audit-consolidated-verify-20260527 \
  origin/supervisor/release-boundary-consolidated-20260527
cd /tmp/reprint-audit-consolidated-verify-20260527
timeout 300s npm run verify:release
```

Next exact command that can move a release gate requires real live boundary
values:

```bash
cd /tmp/reprint-reorg-integrator-20260527
REPRINT_PUSH_SOURCE_URL='<real-live-source-url>' \
REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND='<command-that-issues-and-reads-back-the-same-live-source-session>' \
timeout 300s npm run verify:release
```

Gate movement remains forbidden unless that command proves the same live source
boundary in its proof JSON.
