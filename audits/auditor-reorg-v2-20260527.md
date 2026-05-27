# Reorg Auditor V2 - 2026-05-27

Audit time: 2026-05-27 18:51 CEST (+0200)

Verdict: `0/4`

No release gate moves without a checked command that uses a real live
`REPRINT_PUSH_SOURCE_URL`.

Follow-up at 2026-05-27 19:26 CEST: `origin/lane/local-production-topology-20260527`
at `540723dc8` adds a checked local production topology. The command
`npm run verify:release:local-production` passed in `main:local-prod-proof`
with `POST_REBASE_LAST_STATUS:0` after booting four Brewcommerce-derived
loopback WordPress sites and feeding `verify:release` real local source,
remote-changed, local-edited, and apply-revalidation-source URLs. This removes
the missing-live-source blocker for local Playground production-shaped evidence
only. It does not move the release verdict because the services are local
Playground, Docker is unavailable in this sandbox, and durable production
journal ownership remains unproven.

## Branch Heads

| Ref | Head | Current proof |
| --- | --- | --- |
| `origin/supervisor/release-boundary-consolidated-20260527` | `2c5681b0f` | Consolidated support branch exists, includes the latest auditor support-branch-head refresh, and fails closed when the live source is absent. |
| `origin/lane/auth-session-boundary-v2-20260527` | `e2e2e391a` | Auth/session support branch merged the consolidated release-boundary base; support evidence only. |
| `origin/lane/durable-journal-boundary-v2-20260527` | `702adf8ae` | Durable support branch merged the consolidated release-boundary base; no live durable proof. |
| `origin/lane/apply-revalidation-boundary-v2-20260527` | `c84629f82` | Focused apply-revalidation boundary test hardening plus consolidated branch merge; support evidence only. |
| `origin/lane/plugin-driver-boundary-v2-20260527` | `9e943390e` | Plugin-driver test hardening on origin; support evidence only. |
| `origin/lane/topology-verifier-v2-20260527` | `2ce3df0f3` | Topology fail-closed behavior proof plus consolidated base merge; support evidence only. |
| `origin/lane/critic-reorg-v2-20260527` | `110d3c970` | Critic follow-up rejects gate movement without live source evidence. |
| `origin/lane/auditor-reorg-20260527` | `88a4249ac` | Separate auditor lane artifact refreshed; not live release proof. |

Local refs not matching same-name origin, or local-only refs observed:

- `lane/plugin-driver-boundary-v2-20260527` at `979d680cd`
- `lane/apply-revalidation-boundary-v2-20260527` at `e90030040`
- `lane/plugin-driver-boundary-v2-consolidated-20260527` at `88330602b`
- `lane/topology-verifier-v2-20260527` at `eac254071`

## Command Evidence

Run from `/tmp/reprint-reorg-integrator-20260527` on
`supervisor/release-boundary-consolidated-20260527` at `2c5681b0f`:

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
- Canonical script stops before later guard/recovery checks because the live
  source boundary is absent.

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
