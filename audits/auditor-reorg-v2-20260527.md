# Reorg Auditor V2 - 2026-05-27

Audit time: 2026-05-27 18:51 CEST (+0200)

Verdict: local `candidate-for-review`; final external release held

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

Follow-up at 2026-05-27 23:22 CEST: `lane/durable-journal-local-production-20260527`
adds the missing local durable-journal storage guard. The command
`npm run verify:release:local-production` passed in `main:durable-proof2` with
`DURABLE_PROOF_STATUS:0`. The live local topology now reports
`LIVE_RELEASE_BOUNDARY_OK` for auth session, durable journal, and replay/retry,
plus `releaseMovement.allowed: true` and `gates: candidate-for-review`. The DB
journal proof includes `ownsJournal: true`, `restartReadable: true`,
`writerLease.storageGuard: wpdb-single-statement-cas`, and
`leaseFence.storageGuard: wpdb-single-statement-cas`. This moves the local
Playground production-shaped release posture from blocked to candidate review.
Final release readiness is still held because Docker is not installed in this
sandbox, these services are local Playground loopback WordPress instances, and
graph identity/general plugin-driver coverage is still incomplete.

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
| `lane/durable-journal-local-production-20260527` | current branch | Local live topology candidate proof with checked durable DB journal storage guard; Docker/external proof still absent. |

Local refs not matching same-name origin, or local-only refs observed:

- `lane/plugin-driver-boundary-v2-20260527` at `979d680cd`
- `lane/apply-revalidation-boundary-v2-20260527` at `e90030040`
- `lane/plugin-driver-boundary-v2-consolidated-20260527` at `88330602b`
- `lane/topology-verifier-v2-20260527` at `eac254071`

## Command Evidence

Run from `/tmp/reprint-durable-local-production-20260527` on
`lane/durable-journal-local-production-20260527`:

```bash
npm run verify:release:local-production
```

Result:

- Exit status: `0` (`DURABLE_PROOF_STATUS:0` in `main:durable-proof2`)
- `releaseMovement.allowed`: `true`
- `releaseMovement.gates`: `candidate-for-review`
- Boundary verdicts: auth session `LIVE_RELEASE_BOUNDARY_OK`, durable journal
  `LIVE_RELEASE_BOUNDARY_OK`, replay/retry `LIVE_RELEASE_BOUNDARY_OK`
- Source service: live local loopback WordPress
- Remote-changed service: live local loopback WordPress
- Local-edited service: live local loopback WordPress
- Packaged fallback allowed: `false`
- Durable storage guard: `leaseFence.storageGuard:
  wpdb-single-statement-cas`
- Scope caveat: local Playground production-shaped evidence, not Docker or
  external production WordPress.

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
| GATE-1 production executor/auth boundary | Local live topology proves auth/session source readback and `LIVE_RELEASE_BOUNDARY_OK` with packaged fallback disabled. | Docker/external production credential lifecycle. | `main:durable-proof2` exits `0`; older missing-source command remains useful fail-closed evidence. | Local movement only. |
| GATE-2 durable recovery journal boundary | Local live topology proves `ownsJournal: true`, `restartReadable: true`, claim-fenced writer lease, stale-claim rejection, and `leaseFence.storageGuard: wpdb-single-statement-cas`. | Docker/external crash and restart durability. | `main:durable-proof2` exits `0`. | Local movement only. |
| GATE-3 live production topology | Four Brewcommerce-derived local WordPress sites run as source, changed remote, local edited, and apply-revalidation source; source command readback matches. | Docker/external WordPress topology. | `main:durable-proof2` exits `0`. | Local movement only. |
| GATE-4 plugin-driver ownership boundary | Release-state plugin-owned mutation proof preserves rejected remote and apply-time revalidation on the local release boundary; plugin-driver guard bundle runs. | General plugin-driver coverage beyond release-state fixture. | `main:durable-proof2` exits `0`. | Local movement only. |

## First Missing Primitive

A single checked release run has now proven the local live loopback form of
auth/session issuance and readback, durable restart-readable lease-fenced
journal ownership, preserved rejected-remote evidence, apply-time revalidation
before the first mutation, and release-state plugin-driver ownership. The first
missing primitive is the same evidence on Docker or external WordPress, followed
by graph identity mapping and general plugin-driver coverage.

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

Until the same command class passes on Docker or external WordPress with graph
identity and general plugin-driver evidence, final release readiness remains
held even though the local topology is `candidate-for-review`.
