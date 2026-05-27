# Reorg Auditor V2 - 2026-05-27

Audit time: 2026-05-27 18:35 CEST

Verdict: `0/4`

No release gate moves without a checked command that uses a real live
`REPRINT_PUSH_SOURCE_URL`.

## Branch Heads

| Ref | Head | Current proof |
| --- | --- | --- |
| `origin/supervisor/release-boundary-consolidated-20260527` | `8c6b9afb8` | Consolidated support branch exists, includes the previous auditor apply/topology refresh, and fails closed when the live source is absent. |
| `origin/lane/auth-session-boundary-v2-20260527` | `4e5c34074` | Auth/session support branch merged the consolidated release-boundary base; support evidence only. |
| `origin/lane/durable-journal-boundary-v2-20260527` | `876214854` | Durable support branch merged the consolidated release-boundary base; no live durable proof. |
| `origin/lane/apply-revalidation-boundary-v2-20260527` | `ff23bd33e` | Focused apply-revalidation boundary test hardening plus consolidated branch merge; support evidence only. |
| `origin/lane/plugin-driver-boundary-v2-20260527` | `08e6b1c3d` | Plugin-driver test hardening; support evidence only. |
| `origin/lane/topology-verifier-v2-20260527` | `0de2e08a6` | Topology fail-closed behavior proof plus consolidated base merge; support evidence only. |
| `origin/lane/critic-reorg-v2-20260527` | `90a5c9f66` | Critic review rejects gate movement without live source evidence. |

Local-only refs observed:

- `lane/apply-revalidation-boundary-v2-20260527` at `5d987234a`
- `lane/plugin-driver-boundary-v2-consolidated-20260527` at `7e8f8b947`

## Command Evidence

Run from `/tmp/reprint-reorg-integrator-20260527` on
`supervisor/release-boundary-consolidated-20260527` at `8c6b9afb8`:

```bash
timeout 300s npm run verify:release
```

Result:

- Exit status: `1`
- Primary code: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- `releaseMovement.allowed`: `false`
- `releaseMovement.gates`: `0/4`
- Source service: missing
- Remote-changed service: missing
- Local-edited service: missing
- Packaged fallback allowed: `false`

## Gate Table

| Requirement | Current proof | Missing proof | Command evidence | Verdict impact |
| --- | --- | --- | --- | --- |
| GATE-1 production executor/auth boundary | Auth v2 hardens source-command handling, rejects alias/fallback behavior, covers auth readback source drift, and has merged the consolidated base. | Real endpoint proof of auth/session issuance and readback from the same live source and same source command. | `verify:release` exits `1` before live source access with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`. | No movement. |
| GATE-2 durable recovery journal boundary | Durable v2 preserves support metadata, consolidates verifier wiring, scopes the preserved retry probe, and has merged the consolidated base. | Live durable `ownsJournal: true`, `restartReadable: true`, and lease-fenced journal evidence on the same mutation boundary. | No live source command evidence. | No movement. |
| GATE-3 live production topology | Consolidated verifier emits explicit topology JSON and rejects missing source, packaged fallback, and mismatched source aliases; topology v2 now exists on origin. | Real source/local/changed topology using a live `REPRINT_PUSH_SOURCE_URL`. | Missing-source command reports no accepted source/local/changed services. | No movement. |
| GATE-4 plugin-driver ownership boundary | Plugin v2 hardens plugin-driver guard tests; apply v2 adds focused stale-remote/replay preservation support tests. | Live plugin-owned mutation proof with rejected-remote preservation and apply-time revalidation on the release boundary. | No live source command evidence. | No movement. |

## First Missing Primitive

A single checked release run must use a real live `REPRINT_PUSH_SOURCE_URL` and
prove, on that same boundary: auth/session issuance and readback, durable
restart-readable lease-fenced journal ownership, preserved rejected-remote
evidence, apply-time revalidation before the first mutation, and plugin-driver
ownership.

## Next Exact Command

```bash
REPRINT_PUSH_SOURCE_URL=<real-live-reprint-source-url> \
REPRINT_PUSH_REMOTE_CHANGED_URL=<real-live-changed-url> \
REPRINT_PUSH_LOCAL_URL=<real-live-local-edited-url> \
REPRINT_PUSH_USERNAME=<production-user> \
REPRINT_PUSH_APPLICATION_PASSWORD=<production-application-password> \
REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND=<same-live-source-readback-command> \
timeout 300s npm run verify:release
```

Until that command passes on a real live source, release verdict remains `0/4`.
