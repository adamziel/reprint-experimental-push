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

## Gate Classification

| Requirement | Current proof | Missing proof | Command evidence | Verdict impact |
| --- | --- | --- | --- | --- |
| GATE-1 Production executor/auth boundary | Available integration verifier fails closed and requires a real `REPRINT_PUSH_SOURCE_URL`; prior public audit still says `0/4`. | Live Reprint endpoint proof of auth/session issuance and readback on the same live source boundary. | `timeout 300s npm run verify:release` on `889b8d44` exited `1` with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` and `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`. | No gate movement. |
| GATE-2 Durable recovery journal boundary | The verifier states durable journal proof is required and not met. | `ownsJournal: true`, `restartReadable: true`, and lease-fenced durable journal ownership on the release boundary. | Structured output reports `ownsJournal: false`, `restartReadable: false`, `leaseFenced: false`. | No gate movement. |
| GATE-3 Live Docker/Playground production topology | The verifier blocks fallback sources and records local-only ingress policy. | A checked live source/local/changed topology against a real production-owned boundary. | Structured output reports `releaseMovementAllowed: false` because `sourceUrl` is empty and fallback sources are disallowed. | No gate movement. |
| GATE-4 Plugin-driver ownership boundary | No live plugin-driver mutation proof is present in this verifier run. | Plugin-owned mutation on the release boundary with allowlisted semantics, precondition evidence, rejected remote preservation, apply-time revalidation, and audit evidence. | Structured output reports preserved rejected remote evidence and apply-time revalidation are not proven. | No gate movement. |

## Blocker

The consolidated branch requested by `NEXT_TASKS.md` does not exist remotely.
The available integration branch now has a coherent fail-closed
`verify:release` command, but it correctly does not move any release gate
without a real live `REPRINT_PUSH_SOURCE_URL`.

Next exact command after the consolidated branch is published:

```bash
git fetch --all --prune
git worktree add --detach /tmp/reprint-audit-consolidated-verify-20260527 \
  origin/supervisor/release-boundary-consolidated-20260527
cd /tmp/reprint-audit-consolidated-verify-20260527
timeout 300s npm run verify:release
```
