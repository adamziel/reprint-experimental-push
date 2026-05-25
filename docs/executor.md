# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote source site, one imported local edit
site, and one later drift observation of the same remote identity. The
production harness keeps dry-run and apply separate, revalidates at apply
time, and uses the same `8080`-visible topology in Docker and Playground.

## Executor Summary

The executor runs one fixed production ladder in both Docker and Playground:

| Stage | Route | Authority |
| --- | --- | --- |
| `preflight` | `preflight` | Binds imported pull provenance to one live remote identity and a short-lived session. |
| `snapshot-hashes` | `snapshot-hashes` | Planning-only hash listing. |
| `dry-run` | `dry-run` | Eligibility receipt only. |
| `apply` | `apply` | Separate remote mutation that revalidates before every batch and at the storage boundary. |
| `journal` | `journal` | Read-only durability evidence. |
| `recovery-inspect` | `recovery-inspect` | Read-only recovery classification. |
| `recovery-mutate` | `recovery-mutate` | Mutating recovery only after inspect and auth-floor checks. |

That ladder comes straight from the pull/export/import pipeline:

- exporter discovers the merge base and coverage evidence
- importer persists the immutable pull base package
- `preflight` is the first live bind after importer persistence
- `snapshot-hashes` is planning-only evidence
- `dry-run` is a receipt, not a lock
- `apply` is a separate remote mutation and revalidates fresh live evidence before every batch and again at the storage boundary
- `journal` stays read-only
- `recovery-inspect` must happen before any mutating repair
- `recovery-mutate` uses the same HMAC floor as apply and must not bypass inspect

The same handoff is the pull-to-push map:

| Pull pipeline | Push stage | Boundary it preserves |
| --- | --- | --- |
| Exporter merge-base and coverage scan | `preflight` | First live bind after importer persistence. |
| Importer persisted base package | `snapshot-hashes` | Planning-only remote hash listing. |
| Immutable pull provenance | `dry-run` | Eligibility receipt upload, not a lock. |
| Persisted pull base package plus live drift evidence | `apply` | Fresh live revalidation before every batch and at the storage boundary. |
| Durable pull provenance | `journal` | Read-only durability evidence. |
| Immutable provenance plus fresh live hashes | `recovery-inspect` | Read-only recovery classification before mutation. |
| Importer-owned provenance plus live drift evidence | `recovery-mutate` | Mutating recovery only after inspect and HMAC-floor checks pass. |

The shared test topology is fixed:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The executor maps the pull pipeline into push without ever collapsing the
boundary:

1. exporter discovers the merge base and coverage evidence
2. importer persists the immutable pull base package
3. `preflight` is the first live bind after importer persistence
4. `snapshot-hashes` is planning-only evidence
5. `dry-run` is a receipt, not a lock
6. `apply` is a separate remote mutation and revalidates fresh live evidence before every batch and again at the storage boundary
7. `journal` stays read-only
8. `recovery-inspect` must happen before any mutating repair
9. `recovery-mutate` uses the same HMAC floor as apply and must not bypass inspect

The remote liveness contract stays strict:

- dry-run and apply are separate remote operations
- apply revalidates the live remote before every batch and again at the storage boundary
- journal inspect is read-only and never authorizes mutation
- recovery inspect is read-only and must happen before any mutating repair

The checked proof path for this document is `node --test test/protocol-fixtures.test.js`.
That test pins the route matrix, the one-remote/one-local/one-drift topology,
the production handshake from preflight through inspect-first recovery, and
the explicit missing-secret failure contract that blocks preflight, dry-run,
and apply when the real push secret is unavailable.

The compact release-facing fixture proof is `fixtures/protocol/push-production-executor-flow-contract.json`.
That contract is pinned by the same checked test and is the shortest review path
for the exporter/importer handoff, the preflight-to-recovery ladder, and the
shared Docker and Playground route matrix.

The checked topology proof is `npm run test:playground:production-shaped-topology-proof`.
Use it when you need the fixed one-remote, one-local, one-drift harness summary
and the shared Docker and Playground route matrix without live credentials.

The release-facing live topology proof is `npm run test:playground:production-shaped-live-topology-proof`.
Use it when you need a runnable command that starts a local Playground remote
source, binds production-shaped preflight to it, and reports the same
one-remote, one-local, one-drift topology with real HTTP output.

The release-facing live protocol proof is `npm run test:playground:production-shaped-live-protocol-proof`.
Use it when you need the same live topology plus the snapshot, dry-run, and
apply revalidation boundary, recovery inspect, and journal readback on the
real Playground remote.

The release-facing checked command is `npm run test:playground:production-shaped-proof`.
Use it when you need one executable entry point that proves both the protocol
ladder and the explicit missing-secret and missing-live-source gates.

The release-facing proof command that combines the protocol fixture test with
the explicit missing-secret gate is:

```sh
npm run test:playground:production-shaped-proof
```

The release-facing proof command is the same checked Node test:

```sh
node --test test/protocol-fixtures.test.js
```

The release-facing wrapper that a supervisor should run is:

```sh
npm run test:playground:production-shaped-proof
```

For a supervisor-run retained-source proof, use:

```sh
npm run test:playground:production-shaped-release-verify
```

That wrapper starts a local Playground remote source and a local edited site,
injects production-shaped auth, and prints the live preflight branch plus the
dry-run, apply, journal, and recovery inspect evidence in the release proof.

The supervisor-facing shortcut is `npm run verify:release`.
It resolves to the same retained-source proof, so the checked command and the
release alias stay aligned.
In this lane, that alias is the checked supervisor command for the production
boundary: it must either reach the live Playground preflight path or fail
closed at the explicit live-source or secret gate before any dry-run or apply
mutation begins.

The checked release-verify contract is
`fixtures/protocol/push-production-release-verify-contract.json`.
It pins `npm run verify:release` as the supervisor entrypoint, the one-remote,
one-local, one-drift topology, and the first remaining production boundary:
`auth/session lifecycle and durable journal semantics`.
The same contract now carries the push-ladder mapping back to the pull/export/
import provenance so the checked release proof stays aligned with the executor
order rather than only the prose.
The same checked boundary object also names the unproven durable-journal
storage/lease/fence gap with `PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED`.
That checked command now fails if the live preflight does not mint the
expected session types or if the journal readback does not preserve durable
apply-committed evidence after apply and recovery inspect.
The checked proof also asserts the durable journal summary fields directly:
`rows`, `applyCommitted`, `mutationApplied`, and `idempotencyOpened`.
It also emits the exact boundary verdict `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`
so the supervisor output distinguishes the lab-shaped proof from the missing
production boundary.
The same release path also names the durable storage gap explicitly with
`PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED`, which keeps the auth/session
lifecycle boundary separate from the storage/lease/fence boundary.

That checked release entrypoint has two exact outputs:

- with live source and production-shaped auth, it prints the live preflight
  proof and a JSON envelope whose `releaseProof.code` is `LIVE_PREFLIGHT_OK`
- without a live source, it fails with
  `REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.`

The narrow live-preflight command for a real remote source is:

```sh
npm run test:playground:production-shaped-live-preflight
```

When `REPRINT_PUSH_SOURCE_URL`, `REPRINT_PUSH_USERNAME`, and
`REPRINT_PUSH_APPLICATION_PASSWORD` are present, the narrower live-preflight
command exercises the real production-shaped preflight handshake. When the
source URL or auth is missing, it fails with the exact gate the supervisor
should check:

- `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- `REPRINT_PUSH_SECRET_REQUIRED`

If `REPRINT_PUSH_SOURCE_URL`, `REPRINT_PUSH_LAB_AUTH_ADMIN_USER`, and
`REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD` are set, the same wrapper runs the
real production-shaped preflight probe instead of only the missing-input gates.

If the real push secret is missing, the harness must fail fast with
`REPRINT_PUSH_SECRET_REQUIRED` before preflight, dry-run, or apply can run.

If the live source URL is missing, the harness must fail fast with
`REPRINT_PUSH_LIVE_SOURCE_REQUIRED` before preflight, dry-run, or apply can
run.

The direct missing-secret smoke is:

```sh
npm run test:playground:production-shaped-missing-secret
```

It emits `REPRINT_PUSH_SECRET_REQUIRED` unless
`REPRINT_PUSH_SIGNING_SECRET` or `REPRINT_PUSH_APPLICATION_PASSWORD` is set.

For the full production-shaped topology proof, the checked command is:

```sh
node --test test/protocol-fixtures.test.js
```

That command pins the one-remote, one-local, one-drift harness, the shared
Docker and Playground route matrix, the pull-to-push bridge, and the strict
remote liveness split between dry-run and apply.

## Canonical Proof Set

The executor should cite the same proof chain as the protocol document:

1. `push-protocol-extension-contract.json`
2. `push-production-topology-contract.json`
3. `push-production-pull-bridge-contract.json`
4. `push-production-revalidation-contract.json`
5. `push-production-auth-session-journal-recovery-inspect-contract.json`
6. `push-production-journal-lease-recovery-inspect-contract.json`
7. `push-production-executor-flow-contract.json`
8. `push-production-route-matrix-contract.json`
9. `push-production-missing-secret-contract.json`

That set keeps the executor review path short without hiding any boundary:

- the exporter/importer bridge stays the only source of immutable push provenance
- preflight is the first live bind after importer persistence
- snapshot listing is planning-only
- dry-run stays separate from apply
- apply revalidates fresh live evidence before every batch and at the storage boundary
- journal and recovery inspect remain read-only
- mutating recovery still requires the HMAC floor, the live hashes, and the inspect result
- if the real push secret is missing, the executor must fail fast with an explicit error before preflight, dry-run, or apply can proceed

## Canonical Executor Contract

The executor should treat the production push extension as a fixed ladder:

1. `preflight`
2. `snapshot-hashes`
3. `dry-run`
4. `apply`
5. `journal`
6. `recovery-inspect`
7. `recovery-mutate`

Those boundaries are not interchangeable:

- `preflight` binds the persisted pull base package to one live remote
  identity and one short-lived push session.
- `snapshot-hashes` lists remote hashes for planning only and never becomes
  write authority.
- `dry-run` uploads the canonical plan and returns an eligibility receipt,
  not a lock.
- `apply` is a separate remote operation and revalidates fresh live evidence
  before every batch and again at the storage boundary.
- `journal` is read-only evidence.
- `recovery-inspect` reads the journal and fresh live hashes before any
  mutating repair.
- `recovery-mutate` only proceeds when inspect proves the branch safe and the
  auth floor still holds.

That means the executor never treats snapshot hashes or a dry-run receipt as
write authority. The live remote must be revalidated again during apply, and
recovery still starts with read-only inspect before any mutation branch.

The production route surface is intentionally split:

| Stage | Route | What it proves |
| --- | --- | --- |
| `preflight` | `preflight` | The imported pull base is bound to one live remote identity and one short-lived session. |
| `snapshot-hashes` | `snapshot-hashes` | Remote hashes are visible for planning only. |
| `dry-run` | `dry-run` | The canonical plan uploads as a receipt, not a lock. |
| `apply` | `apply` | Live evidence is revalidated before each batch and again at the storage boundary. |
| `journal` | `journal` | Journal rows are durable but read-only. |
| `recovery-inspect` | `recovery-inspect` | Recovery is classified before any mutation. |
| `recovery-mutate` | `recovery-mutate` | Mutation is allowed only after inspect and the HMAC floor still hold. |

The shared route matrix is the same in Docker and Playground:

- `preflight` maps to the first live bind against the persisted pull base package.
- `snapshot-hashes` maps to planning-only remote hash listing.
- `dry-run` maps to the canonical plan upload and eligibility receipt.
- `apply` maps to batched mutation with fresh live revalidation before every batch and at the storage boundary.
- `journal` maps to read-only durability evidence.
- `recovery-inspect` maps to read-only classification of finish, rollback, retry, or block.
- `recovery-mutate` maps to the mutating recovery branch that still respects inspect and the HMAC floor.

The executor test topology is intentionally one remote source and one local
edit site with a later drift witness of the same remote identity:

| Role | Identity | Purpose |
| --- | --- | --- |
| Remote source | `remote-base` | Seeds the persisted pull base package. |
| Local edit site | `local-edited` | Carries the imported local edits. |
| Drift witness | `remote-changed` | Reuses the same remote identity after drift. |
| Runner | `runner` | Owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery. |

Docker and Playground use the same logical topology and the same route names:

- Docker uses one private network.
- Playground uses separate disposable blueprints.
- Browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy.
- Remote tunnels are disallowed.

The executor maps those stages to the pull pipeline directly:

- exporter discovers the merge base and coverage evidence
- importer persists the immutable pull base package
- `preflight` is the first live bind after importer persistence
- `snapshot-hashes` is planning-only evidence
- `dry-run` is a receipt, not a lock
- `apply` revalidates again at apply time
- `journal` remains read-only
- `recovery-inspect` is the read-only recovery gate
- `recovery-mutate` uses the same HMAC floor as apply

The executor should treat the production contract as a strict route matrix,
not a loose checklist:

| Stage | Route | Authority |
| --- | --- | --- |
| `preflight` | `preflight` | Binds imported pull provenance to one live remote identity and a short-lived session. |
| `snapshot-hashes` | `snapshot-hashes` | Planning-only hash listing. |
| `dry-run` | `dry-run` | Eligibility receipt only. |
| `apply` | `apply` | Separate remote mutation that revalidates before every batch and at the storage boundary. |
| `journal` | `journal` | Read-only durability evidence. |
| `recovery-inspect` | `recovery-inspect` | Read-only recovery classification. |
| `recovery-mutate` | `recovery-mutate` | Mutating recovery only after inspect and auth-floor checks. |

The executor test topology is the same in Docker and Playground:

| Role | Identity | Purpose |
| --- | --- | --- |
| Remote source | `remote-base` | Seeds the persisted pull base package. |
| Local edit site | `local-edited` | Carries the imported local edits. |
| Drift witness | `remote-changed` | Reuses the same remote identity after drift. |
| Runner | `runner` | Owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery. |

The topology rules are fixed:

- Docker uses one private network.
- Playground uses separate disposable blueprints.
- Browser-visible inspection stays on the sandbox-provided `8080` ingress.
- The local inspection proxy stays local-only.
- Remote tunnels are disallowed.

This is the only test topology the executor should rely on:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls
- Docker and Playground share the same logical route matrix
- `8080` is only for browser-visible inspection through the local proxy

The production test shape is intentionally one remote source site, one
imported local edit site, and one later drift observation of the same remote
identity:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover

## Production Contract

The executor owns these remote boundaries in order:

1. `preflight`
2. `snapshot-hashes`
3. `dry-run`
4. `apply`
5. `journal`
6. `recovery-inspect`
7. `recovery-mutate`

Each boundary is distinct:

- `preflight` binds the persisted pull base package to one live remote
  identity and one short-lived push session.
- `snapshot-hashes` lists remote hashes for planning only and never becomes
  write authority.
- `dry-run` uploads the canonical plan and returns an eligibility receipt,
  not a lock.
- `apply` revalidates fresh live evidence before every batch and again at the
  storage boundary.
- `journal` is read-only evidence.
- `recovery-inspect` reads the journal and fresh live hashes before any
  mutating repair.
- `recovery-mutate` only proceeds when inspect proves the branch safe and the
  auth floor still holds.

## Test Topology

Use the same logical harness in Docker and Playground:

| Role | Identity | Purpose |
| --- | --- | --- |
| Remote source | `remote-base` | Seeds the persisted pull base package. |
| Local edit site | `local-edited` | Carries the imported local edits. |
| Drift witness | `remote-changed` | Reuses the same remote identity after drift. |
| Runner | `runner` | Owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery. |

The topology proof is one remote source, one imported local edit site, one
later drift observation of the same remote identity, and one runner:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run,
  apply, inspect the journal, or recover

The production mapping to the pull/export/import pipeline is direct:

- exporter discovers the merge base and coverage evidence
- importer persists the immutable pull base package
- `preflight` is the first live bind after importer persistence
- `snapshot-hashes` stays planning-only
- `dry-run` is a receipt, not a lock
- `apply` revalidates live evidence before every batch and at the storage
  boundary
- `journal` remains read-only
- `recovery-inspect` happens before any mutating repair
- `recovery-mutate` uses the same auth floor as the write path

That is the fixed production test topology in both Docker and Playground:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns preflight, snapshot listing, dry-run,
  apply, journal inspect, and recovery

The topology is intentionally minimal:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls

The topology rules are fixed:

- Docker uses one private network.
- Playground uses separate disposable blueprints.
- Browser-visible inspection stays on the sandbox-provided `8080` ingress.
- The local inspection proxy stays local-only.
- Remote tunnels are disallowed.

The production harness is the same one-remote, one-local, one-drift shape in
both environments:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

That topology is the test contract, not a suggestion:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or start recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The executor uses the same route names in Docker and Playground:

| Stage | Route name |
| --- | --- |
| Preflight | `preflight` |
| Remote snapshot hash listing | `snapshot-hashes` |
| Dry-run plan upload | `dry-run` |
| Mutation batch apply | `apply` |
| Journal inspect | `journal` |
| Recovery inspect | `recovery-inspect` |
| Recovery mutate | `recovery-mutate` |

That is the production topology in compact form:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls

The harness routes stay identical across both environments:

| Route | Docker | Playground |
| --- | --- | --- |
| Preflight | `preflight` | `preflight` |
| Snapshot hashes | `snapshot-hashes` | `snapshot-hashes` |
| Dry-run | `dry-run` | `dry-run` |
| Apply | `apply` | `apply` |
| Journal | `journal` | `journal` |
| Recovery inspect | `recovery-inspect` | `recovery-inspect` |
| Recovery mutate | `recovery-mutate` | `recovery-mutate` |

Those route names are the production API boundary:

- `preflight` binds the persisted pull base package to one live remote identity
  and one short-lived push session
- `snapshot-hashes` lists live remote comparison evidence for planning only
- `dry-run` uploads the canonical plan and returns an eligibility receipt, not
  a lock
- `apply` revalidates fresh live evidence before every batch and at the
  storage boundary
- `journal` inspects durable evidence without authorizing mutation
- `recovery-inspect` reads the journal and fresh live hashes before any
  mutating repair
- `recovery-mutate` only runs after inspect proves the branch safe and the
  auth floor still holds

The route matrix is the contract boundary for the one-remote, one-local, one-
drift production harness:

- `remote-base` seeds the persisted pull base package.
- `local-edited` carries the imported local edits derived from that package.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover.
- Docker and Playground both call the same route names for preflight through
  recovery mutate.
- Browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy.
- Remote tunnels are disallowed in both harnesses.

That topology is the production definition, not just an example:

- `remote-base` and `remote-changed` are the same remote identity observed at
  different times
- `local-edited` is the imported local site derived from the persisted pull
  base package
- `runner` is the only actor that may call preflight, snapshot listing,
  dry-run, apply, journal inspect, or recovery
- Docker and Playground both call the same route names for preflight through
  recovery mutate
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The one-remote, one-local, one-drift harness is the production shape:

- `remote-base` seeds the persisted pull base package
- `local-edited` is the imported local site derived from that package
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- Docker uses one private network for those roles
- Playground uses separate disposable blueprints for the same roles
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The executor also maps the pull/export/import pipeline directly onto the push
stages:

| Pull provenance | Push stage | Executor rule |
| --- | --- | --- |
| Exporter discovers merge base and coverage evidence | `push_preflight` | Bind the persisted pull base package to one live remote identity and one short-lived push session. |
| Importer persists the base package as immutable provenance | `push_snapshot_hashes` | Read live comparison evidence for planning only. |
| Persisted pull base package | `push_plan_dry_run` | Upload the canonical plan as an eligibility receipt, not a lock. |
| Immutable pull provenance | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Durable pull provenance | `push_journal` | Record durable evidence without authorizing mutation. |
| Immutable provenance plus fresh live hashes | `push_recover inspect` | Read the journal and fresh live hashes before any mutating repair. |
| Importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutate only after inspect proves the branch safe with the same auth floor as the write path. |

The proof set stays split across focused production contracts:

- `push-production-topology-contract.json` proves the one-remote, one-local,
  one-drift harness in Docker and Playground.
- `push-production-pull-bridge-contract.json` proves the exporter/importer
  handoff into push.
- `push-production-auth-session-journal-recovery-inspect-contract.json`
  proves auth, push-session minting, journal rows, lease fencing, and
  apply-time revalidation.
- `push-production-journal-lease-recovery-inspect-contract.json` proves the
  journal row, lease fence, and inspect-first recovery branch after dry-run
  and apply have already split.
- `push-production-executor-flow-contract.json` proves the compact end-to-end
  route order from preflight through inspect-first recovery.

That mapping keeps the pull pipeline separate from the push mutation path:

- exporter discovers the merge base and coverage evidence
- importer persists the immutable base package
- `push_preflight` is the first live bind after that persistence
- `push_snapshot_hashes` is planning-only remote hash listing
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
  lock
- `push_batch_apply` is a separate live mutation path and must revalidate
  before every batch and again at the storage boundary
- `push_journal` is durable evidence only
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The pull bridge and the topology are the same contract in route form:

- exporter/importer establish immutable provenance before push starts
- `push_preflight` binds that provenance to one live remote identity and one
  short-lived push session
- `push_snapshot_hashes` remains planning-only remote hash listing
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` stays read-only durable evidence
- `push_recover inspect` runs before any mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

Docker and Playground prove the same three-site story with different harness
shapes:

- Docker uses one private network and the runner talks to the three sites by
  route name.
- Playground uses separate disposable blueprints for the same three site
  identities.
- Both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy.
- Remote tunnels are disallowed in both harnesses.

The same production proof stack is reviewed in this order:

1. `push-protocol-extension-contract.json` for the full ladder, pull bridge,
   auth floor, and one-remote-one-local-one-drift topology.
2. `push-production-topology-contract.json` for the Docker and Playground
   topology and ingress rules.
3. `push-production-pull-bridge-contract.json` for the importer-owned base
   package bridge.
4. `push-remote-snapshot-listing-contract.json` for planning-only remote hash
   discovery.
5. `push-production-revalidation-contract.json` for the dry-run/apply liveness
   split.
6. `push-production-auth-session-journal-recovery-inspect-contract.json` for
   the auth/session/journal/lease/recovery-inspect floor plus the apply-time
   revalidation boundary.
7. `push-production-journal-lease-recovery-inspect-contract.json` for the
   narrow journal and lease fence proof.
8. `push-production-executor-flow-contract.json` for the full end-to-end flow
   in one compact bundle.

If you only need the topology boundary, use the smaller pair:

1. `push-deployment-topology-contract.json` for the Docker and Playground
   one-remote, one-local, one-drift harness.
2. `push-production-topology-contract.json` for that same harness plus the
   immutable pull bridge that feeds push.

That topology is the same one-remote, one-local, one-drift proof in both
environments:

- `remote-base` seeds the persisted pull base package.
- `local-edited` carries the imported local edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover.

The executor treats each write-path step as a separate remote boundary:

| Stage | Boundary |
| --- | --- |
| `push_preflight` | First live binding after importer persistence; mints the short-lived push session. |
| `push_snapshot_hashes` | Planning-only remote comparison surface; never write authority. |
| `push_plan_dry_run` | Eligibility receipt only; never a lock. |
| `push_batch_apply` | Separate mutation path; revalidates fresh live evidence before every batch and again at the storage boundary, separate from dry-run. |
| `push_journal` | Durable evidence only; never authorizes mutation. |
| `push_recover inspect` | Read-only recovery inspection; must happen before any mutating repair. |
| `push_recover auto|finish|rollback` | Mutating recovery only after inspect proves the branch safe and the auth floor still holds. |

The same route matrix is used in both Docker and Playground:

| Stage | Route name |
| --- | --- |
| Preflight | `preflight` |
| Remote snapshot hash listing | `snapshot-hashes` |
| Dry-run plan upload | `dry-run` |
| Mutation batch apply | `apply` |
| Journal inspect | `journal` |
| Recovery inspect | `recovery-inspect` |
| Recovery mutate | `recovery-mutate` |

The harness topology is fixed and browser-visible inspection stays on the
sandbox-provided `8080` ingress through a local-only proxy:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls
- Docker uses one private network
- Playground uses separate disposable blueprints
- remote tunnels are disallowed

The remote liveness split stays explicit across the whole executor:

- dry-run and apply are separate remote operations
- apply must revalidate the live remote before every batch and at the storage
  boundary
- remote snapshot hash listing is planning evidence only
- journal inspection is read-only and never authorizes mutation by itself
- recovery inspect stays read-only and cannot authorize mutation
- recovery must begin with inspect before any mutating repair
- authentication must be at least as strict as current Reprint HMAC usage

The pull-to-push bridge is the executor contract boundary:

| Pull provenance | Push stage | Executor rule |
| --- | --- | --- |
| Exporter discovers merge base and coverage evidence | `push_preflight` | Bind the persisted pull base package to one live remote identity and one short-lived push session. |
| Importer persists the base package as immutable provenance | `push_snapshot_hashes` | Read live comparison evidence for planning only. |
| Persisted pull base package | `push_plan_dry_run` | Upload the canonical plan as an eligibility receipt, not a lock. |
| Immutable pull provenance | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Durable pull provenance | `push_journal` | Record durable evidence without authorizing mutation. |
| Immutable provenance plus fresh live hashes | `push_recover inspect` | Read the journal and fresh live hashes before any mutating repair. |
| Importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutate only after inspect proves the branch safe with the same auth floor as the write path. |

The production executor proof is therefore anchored on
`push-protocol-extension-contract.json` plus the
`push-production-executor-flow-contract.json` route matrix, which together pin
the same stage order in Docker and Playground.

The compact auth/session proof to cite is
`push-production-auth-session-journal-recovery-inspect-contract.json`, which
now bundles the short-lived session, durable journal rows, lease fence,
apply-time revalidation boundary, and read-only recovery inspect in one
review object.

## Canonical Proof Set

The executor should be reviewed against the same compact proof set as the
protocol docs:

1. `push-protocol-extension-contract.json` for the full ladder, pull bridge,
   auth floor, and topology.
2. `push-production-pull-bridge-contract.json` for the immutable
   exporter/importer handoff.
3. `push-remote-snapshot-listing-contract.json` for planning-only hash
   listing.
4. `push-production-revalidation-contract.json` for the dry-run/apply split.
5. `push-production-auth-session-journal-recovery-inspect-contract.json` for
   the auth/session/journal/recovery-inspect floor.
6. `push-production-recovery-inspect-contract.json` for inspect-first
   recovery.
7. `push-production-executor-flow-contract.json` for the full production flow
   on the one-remote, one-local, one-drift harness.

The executor rules that matter most are the same ones the fixtures prove:

- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only and never becomes write
  authority
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary, separate from dry-run
- `push_journal` is read-only durable evidence
- `push_recover inspect` classifies finish, rollback, retry, or block before
  any mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

That split is strict enough that a stale dry-run receipt can never act like a
lock:

- `push_preflight` mints the short-lived session from immutable pull
  provenance.
- `push_snapshot_hashes` only exposes planning evidence and never gains write
  authority.
- `push_plan_dry_run` uploads the canonical plan and returns eligibility
  evidence.
- `push_batch_apply` revalidates the live remote again before each batch and
  at the storage boundary.
- `push_journal` stays read-only evidence.
- `push_recover inspect` classifies the branch before any mutating repair.
- `push_recover auto|finish|rollback` can only run after inspect and with the
  same auth floor as the write path.

The production proof uses one remote identity across both the base and drift
observations, with the imported local edit site carrying the only local
mutation surface:

- `remote-base` seeds the persisted pull base package.
- `local-edited` is the imported local edit site derived from that package.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover.

## Canonical Execution

The executor follows the production ladder in `protocol.md` without changing
its ordering or auth floor:

1. Exporter/importer create and persist the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` stays planning-only and never becomes write
   authority.
4. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and at
   the storage boundary.
6. `push_journal` records durable evidence but never authorizes mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe with the same auth floor as the write path.

The executor treats the live remote as a liveness boundary, not a cached
plan:

- `push_preflight` is a short-lived identity bind to the persisted pull base.
- `push_snapshot_hashes` is remote hash listing only and must not authorize a
  write.
- `push_plan_dry_run` returns a receipt that can be inspected, replayed, or
  rejected, but never a lock.
- `push_batch_apply` rechecks the live remote before each batch and again at
  the storage boundary, so drift between dry-run and apply is visible.
- `push_journal` is durable evidence for later inspection, not an apply gate.
- `push_recover inspect` must happen before any mutating repair and must
  classify the branch before mutation starts.
- `push_recover auto|finish|rollback` may only run after inspect, and only
  when the same auth floor still holds.

The compact end-to-end production proof is
`push-production-executor-flow-contract.json`:

- it combines the pull handoff, preflight, planning-only hash listing,
  dry-run receipt, batched apply, journal inspect, and inspect-first
  recovery in one production-shaped object
- it keeps the one remote source site, one imported local site, and one later
  drift observation of the same remote identity explicit
- it preserves the same auth floor as the write path and the same dry-run
  versus apply liveness split

The shortest review path through the production bundle is:

1. `push-protocol-extension-contract.json` for the full production ladder and
   pull/export/import bridge.
2. `push-production-topology-contract.json` for the one-remote, one-local,
   one-drift harness in Docker and Playground.
3. `push-production-auth-session-journal-recovery-inspect-contract.json` for
   the auth/session/journal/lease/recovery-inspect proof on the same remote
   identity.
4. `push-production-executor-flow-contract.json` when you need the entire
   production flow in one object.

The pull/export/import pipeline is the only immutable provenance source:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the only pull-derived input the executor
  may consume
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only
- `push_plan_dry_run` is an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` records durable evidence, but never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

The production bridge is the same in both docs:

1. exporter/importer establish immutable provenance
2. `push_preflight` binds that provenance to one live remote identity and one
   short-lived push session
3. `push_snapshot_hashes` remains planning evidence only
4. `push_plan_dry_run` uploads a receipt, not a lock
5. `push_batch_apply` revalidates before every batch and at the storage
   boundary
6. `push_journal` records durable evidence without authorizing mutation
7. `push_recover inspect` reads the journal and live hashes before mutation
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe

The test topology is the same in Docker and Playground:

| Role | Identity | Contract |
| --- | --- | --- |
| Remote source | `remote-base` | Seeds the persisted pull base package. |
| Local edit site | `local-edited` | Carries the imported local edits. |
| Drift witness | `remote-changed` | Reuses the same remote identity after drift. |
| Runner | `runner` | Owns preflight, hash listing, dry-run, apply, journal inspect, and recovery. |

Implementation notes for that topology:

- Docker uses one private network.
- Playground uses separate disposable blueprints.
- Browser-visible inspection stays on the sandbox-provided `8080` ingress.
- The local inspection proxy stays local-only.
- Remote tunnels are disallowed.

The executor proof should be read as one compact production bundle:

1. exporter/importer create the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only.
4. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe with the same auth floor as the write path.

In executor terms, that bridge is a one-remote, one-local, one-drift story:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits derived from that package
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

That same bridge is the Docker and Playground topology definition:

- Docker uses one private network with `remote-base`, `local-edited`,
  `remote-changed`, and `runner` as separate route names.
- Playground uses separate disposable blueprints for the same four logical
  roles.
- The `runner` is the only actor that may call preflight, snapshot listing,
  dry-run, apply, journal inspect, or recovery.
- `remote-base` and `remote-changed` are the same remote identity observed at
  different times.
- `local-edited` is the imported local site derived from the persisted pull
  base package.

For executor review, the pull pipeline maps to the push stages like this:

| Pull provenance | Push stage | Executor rule |
| --- | --- | --- |
| exporter discovers merge base and coverage evidence | `push_preflight` | Bind the persisted pull base package to one live remote identity and one short-lived push session. |
| importer persists the base package as immutable provenance | `push_snapshot_hashes` | Read live comparison evidence for planning only. |
| persisted pull base package | `push_plan_dry_run` | Upload the canonical plan as an eligibility receipt, not a lock. |
| immutable pull provenance | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| durable pull provenance | `push_journal` | Record durable evidence without authorizing mutation. |
| immutable provenance plus fresh live hashes | `push_recover inspect` | Read the journal and fresh live hashes before any mutating repair. |
| importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutate only after inspect proves the branch safe with the same auth floor as the write path. |

That mapping is the direct bridge from the exporter/importer pipeline into the
push executor:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the only pull-derived input the executor
  may consume
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only and never becomes write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` records durable evidence, but never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

The production topology is fixed:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner process that owns the push protocol calls
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The executor and the protocol both require the same liveness split:

- dry-run is a receipt, not a lock
- apply is a separate remote operation
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- recovery inspect is read-only and must happen before any mutating repair
- recovery mutation still requires the same auth floor as the write path

## Canonical Execution Ladder

The executor follows the same production ladder the protocol defines:

1. Exporter/importer create and persist the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` stays planning-only and never becomes write
   authority.
4. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and at
   the storage boundary.
6. `push_journal` records durable evidence but never authorizes mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe with the same auth floor as the write path.

That means the executor is not a generic remote write loop. It is a
single-remote, single-local production proof:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The pull/export/import pipeline is the only source of immutable push
provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable object the push executor
  consumes after importer persistence
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only
- `push_plan_dry_run` is an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The concrete production proof shape is fixed:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner that owns preflight, snapshot listing, dry-run, apply, journal
  inspect, and recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The executor maps the pull pipeline into the push ladder without turning the
pull provenance back into a mutable cache:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the only pull-derived input the executor
  may consume
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only and never becomes write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` records durable evidence, but never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

The production proof stack is fixed and should be read in this order:

1. `push-production-ladder-contract.json` for the compact stage order from
   preflight through inspect-first recovery.
2. `push-production-pull-bridge-contract.json` for the immutable
   exporter/importer handoff into push.
3. `push-remote-snapshot-listing-contract.json` for planning-only remote
   hash listing.
4. `push-production-revalidation-contract.json` for dry-run separation and
   apply-time revalidation.
5. `push-production-auth-session-journal-recovery-inspect-contract.json` for
   the auth/session/journal/inspect-first recovery floor.
6. `push-production-recovery-inspect-contract.json` for the inspect-first
   recovery branch that stays aligned with the journal row, lease fence, and
   fresh live hashes.
7. `push-production-push-recovery-contract.json` for the full preflight-
   through-mutation recovery ladder.
8. `push-remote-liveness-topology-contract.json` for the one-remote,
   one-local, one-drift harness plus the liveness split.
9. `push-production-topology-contract.json` for the Docker and Playground
   harness shape, including the one-remote, one-local, one-drift roles, the
   `8080` ingress rule, and the journal-row/recovery-inspect boundary.
10. `push-topology-matrix.json` for the compact Docker and Playground route
   matrix that keeps the same harness and ingress rules explicit.

The executor follows the same production ladder the protocol defines:

1. pull exporter/importer create the immutable base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` stays planning-only.
4. `push_plan_dry_run` returns an eligibility receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
6. `push_journal` stays read-only.
7. `push_recover inspect` classifies finish, rollback, retry, or block before
   any mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe.

The bridge is reviewed in a fixed order:

1. exporter/importer create the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only.
4. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
   a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe and the auth floor still holds.

The executor should treat that as one replay-safe boundary:

- exporter/importer create the immutable pull base package
- `persisted_pull_base_package` is the only pull-derived input the executor
  may consume
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only and never becomes write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
  a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence, but never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe

The executor runs that ladder against one persisted pull base package and one
fixed remote identity:

The pull/import pipeline maps to the executor in the same order:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `persisted_pull_base_package` is the only pull-derived input the executor
   may consume.
4. `push_preflight` creates the first live binding after importer
   persistence.
5. `push_snapshot_hashes` stays planning-only.
6. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt.
7. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
8. `push_journal` is read-only durable evidence.
9. `push_recover inspect` classifies finish, rollback, retry, or block before
   any mutating repair.
10. `push_recover auto|finish|rollback` mutates only after inspect proves the
    branch safe.

The pull pipeline is the only source of immutable push provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object push consumes
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only
- `push_plan_dry_run` is an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` mutates only when inspect proves the
  branch safe and the auth floor still holds

The executor is therefore not a general remote write loop:

- dry-run and apply remain separate remote operations
- remote snapshot hash listing is planning evidence only
- recovery starts with inspect
- journal inspection never authorizes mutation by itself
- push auth must be at least as strict as current Reprint HMAC usage

That split matters operationally:

- preflight authenticates the session and binds the immutable pull base to
  one live remote identity
- snapshot listing can page through large sites, but it never becomes a lock
- dry-run produces eligibility evidence, not write authority
- apply must revalidate the live remote before every batch and at the
  storage boundary
- journal inspect only resolves ambiguity after timeout or crash
- mutating recovery must re-check the same auth floor before it writes

The recovery fence is the journal-side guard that inspect must re-read before
any mutating branch:

- journal rows carry the claim owner, claim generation, lease expiry, and the
  recovery fence for the current remote identity
- inspect is read-only and must confirm fresh live hashes before finish,
  rollback, or auto can mutate anything
- if the fence and fresh live hashes do not line up, recovery blocks instead
  of weakening the auth floor

The pull-to-push bridge is also fixed and one-way:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the only pull-derived input the executor may
  consume
- `push-pull-mapping.json` is the compact machine-readable handoff that maps
  the immutable pull package into the push ladder
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` classifies finish, rollback, retry, or block before
  any mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe

The topology is fixed for both Docker and Playground:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner process that owns the push protocol calls
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The top-level production proof is the umbrella contract:

- `push-protocol-extension-contract.json` binds the pull bridge, the auth
  floor, the dry-run/apply split, the journal boundary, the recovery floor,
  and the one-remote, one-local, one-drift topology in one object
- `push-protocol-extension-topology-contract.json` is the compact umbrella
  proof for the full ladder on the same one-remote, one-local, one-drift
  harness
- `push-production-pull-bridge-contract.json` is the smaller bridge proof
- `push-production-revalidation-contract.json` is the smaller dry-run/apply
  separation proof
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the smaller auth/session/journal/recovery proof
- `push-production-push-recovery-contract.json` is the smaller full recovery
  ladder proof

Docker and Playground differ only in harness shape, not in protocol
semantics:

- Docker uses one private network around `remote-base`, `local-edited`,
  `remote-changed`, and `runner`.
- Playground uses separate disposable blueprints for the same four roles.
- In both harnesses, `remote-base` seeds the persisted pull base package,
  `local-edited` carries the imported edits, and `remote-changed` is the same
  remote identity observed later after drift.
- In both harnesses, the runner is the only actor that may preflight, list
  hashes, dry-run, apply, inspect the journal, or recover.

Docker and Playground differ only in how they provision the same proof:

- Docker uses one private network and three WordPress site roles plus the
  runner.
- Playground uses separate disposable blueprints for the same roles.
- In both cases, `remote-base` seeds the persisted pull base package,
  `local-edited` carries imported local changes, and `remote-changed` is the
  same remote identity observed later after drift.
- The runner is the only caller that may preflight, list hashes, dry-run,
  apply, inspect the journal, or recover.
- Browser-visible inspection stays behind the sandbox-provided `8080` ingress
  through a local-only proxy.
- Remote tunnels stay disallowed.

Docker and Playground differ only in how they provision the same roles:

- Docker uses one private network around `remote-base`, `local-edited`,
  `remote-changed`, and `runner`
- Playground uses separate disposable blueprints for the same four roles
- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported edits
- `remote-changed` is the same remote identity observed later after drift
- the runner is the only actor that may preflight, list hashes, dry-run,
  apply, inspect the journal, or recover
- the `8080` ingress and local-only proxy are the only browser-visible path

## Production Shape

The production proof is one remote source site, one imported local edit site,
and one later observation of the same remote identity after drift. In both
Docker and Playground, that proof keeps browser-visible inspection on the
sandbox-provided `8080` ingress through a local-only proxy.

That topology stays aligned with the pull-to-push bridge:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only and may page large sites
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal, fresh live hashes, and the
  recovery fence before any mutating repair

The pull pipeline is the immutable provenance source and the executor
consumes it in order:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair

The handoff from pull to push is fixed:

| Pull pipeline artifact | Push stage |
| --- | --- |
| Merge base discovery | `push_preflight` |
| Coverage evidence | `push_snapshot_hashes` |
| Persisted base package | `push_plan_dry_run` |
| Persisted provenance checksum | `push_batch_apply` |
| Durable pull provenance | `push_journal` |
| Imported pull base package | `push_recover inspect` |

The pull/export/import pipeline becomes the executor's concrete runbook in
the same order:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `persisted_pull_base_package` is the immutable input to push.
4. `push_preflight` binds that input to one live remote identity and one
   short-lived push session.
5. `push_snapshot_hashes` stays planning-only.
6. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
   a lock.
7. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
8. `push_journal` stays read-only.
9. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
10. `push_recover auto|finish|rollback` mutates only after inspect proves
   the branch safe.

The one-remote, one-local, one-drift harness is fixed in both Docker and
Playground:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor allowed to preflight, list hashes, dry-run,
  apply, inspect the journal, or recover
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed
- the same one-remote, one-local, one-drift shape is used in both Docker and
  Playground when validating dry-run/apply separation and inspect-first
  recovery

The concrete lab roles are:

- `remote-base`: the source site that seeds the persisted pull base package
- `local-edited`: the imported local site that carries the candidate edits
- `remote-changed`: the same remote identity observed later after drift
- `runner`: the only actor allowed to preflight, list hashes, upload the dry-
  run plan, apply batches, inspect the journal, or run recovery

The canonical push ladder is:

| Stage | Purpose | Boundary rule |
| --- | --- | --- |
| `push_preflight` | Bind the persisted pull base package to one live remote identity and one short-lived push session. | First live binding after importer persistence. |
| `push_snapshot_hashes` | List the live remote comparison surface for planning only. | Read-only; never becomes write authority. |
| `push_plan_dry_run` | Upload the canonical dry-run plan and get an eligibility receipt. | Receipt only; not a lock or lease. |
| `push_batch_apply` | Mutate in batches after fresh validation. | Revalidate before every batch and again at the storage boundary. |
| `push_journal` | Record durable evidence. | Read-only. |
| `push_recover inspect` | Classify finish, rollback, retry, or block before repair using the journal, fresh live hashes, and the recovery fence. | Inspect first; read-only. |
| `push_recover auto|finish|rollback` | Perform a recovery branch only when inspect proves it safe. | Same auth floor as the write path. |

The executor uses the same stage contract as the protocol:

- `push_preflight` binds the imported pull base package to one live remote
  identity and one short-lived push session
- `push_snapshot_hashes` lists the live remote comparison surface for
  planning only and never becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence only
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` may mutate only after inspect proves
  the branch safe with the same auth floor as the write path

The executor reviews the compact proof set in this order:

1. `push-production-pull-bridge-contract.json` for the immutable pull-to-push provenance handoff.
2. `push-remote-snapshot-listing-contract.json` for planning-only remote hash listing.
3. `push-production-revalidation-contract.json` for dry-run separation and apply-time revalidation.
4. `push-production-auth-session-journal-recovery-inspect-contract.json` for auth, session, journal, and inspect-first recovery.
5. `push-production-recovery-inspect-contract.json` for the inspect-first recovery branch and its journal-row, lease-fence, and fresh-live proof.
6. `push-production-push-recovery-contract.json` for the full preflight-through-mutation recovery ladder.
7. `push-remote-liveness-topology-contract.json` for the one-remote, one-local, one-drift topology.
8. `push-production-topology-contract.json` for the Docker and Playground harness proof.

The pull-to-push bridge is one-way:

| Pull provenance | Push use | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the immutable base package to one live remote identity and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it as planning provenance only. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical dry-run plan as an eligibility receipt. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only. |
| Coverage and lineage replay | `push_recover inspect` | Classify recovery before any mutating repair. |

The executor-specific mapping is:

- exporter/importer are the immutable provenance source.
- `push_preflight` mints the short-lived push session after the importer has
  persisted the base package.
- `push_snapshot_hashes` is the remote hash listing phase and cannot grant
  write authority.
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
  lease.
- `push_batch_apply` must revalidate fresh live evidence before every batch
  and again at the storage boundary.
- `push_journal` records durable evidence and stays read-only.
- `push_recover inspect` must run before any mutating recovery branch.
- `push_recover auto|finish|rollback` only runs after inspect proves the
  branch safe and the auth floor still holds.

The persisted pull base package is the concrete handoff object used by push:

- `persisted_pull_base_package` is immutable provenance, not a mutable
  snapshot cache
- the exporter discovers the merge base and coverage evidence
- the importer persists that base package
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` remains read-only
- `push_recover inspect` reads the journal, fresh live hashes, and the
  recovery fence before any mutating repair

The production topology contract also names the immutable bridge explicitly:

- `persisted_pull_base_package` is immutable provenance, not a mutable snapshot cache
- `push_guards.journal_inspect` reads the journal, claim, lease, and recovery fence without authorizing mutation
- Docker and Playground both keep journal inspect read-only before any mutating recovery branch

The pull pipeline remains the source of immutable push provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning-only evidence
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any mutating repair

The production topology is fixed to one remote source, one imported local
site, and one drift witness:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or recover
- Docker uses one private network for those four roles
- Playground uses separate disposable blueprints with the same route names
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The same one-remote, one-local, one-drift harness is used in Docker and
Playground:

- Docker uses one private network around `remote-base`, `local-edited`,
  `remote-changed`, and `runner`
- Playground uses separate disposable blueprints for the same four roles
- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The canonical production proof bundle is `push-protocol-extension-contract.json`:

- it ties exporter/importer provenance to preflight, snapshot hash listing, dry-run upload, batched apply, journal inspect, and inspect-first recovery
- it keeps dry-run and apply separate while apply revalidates fresh live evidence before every batch and at the storage boundary
- it maps the persisted pull base package into the push ladder without turning the pull provenance back into a mutable cache
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit
- it is the canonical bridge from the persisted pull base package into the production push executor
- it preserves the one-way mapping from immutable pull provenance to mutable push execution
- it is the top-level production ladder proof, with `push-production-ladder-contract.json` reserved for the compact stage-order citation
- it is the umbrella contract that sits above `push-production-topology-contract.json` and `push-remote-liveness-topology-contract.json`, which are the compact one-remote, one-local, one-drift harness proofs for Docker and Playground

The executor reviews the compact proofs in this order:

1. `push-production-pull-bridge-contract.json` for immutable pull-to-push provenance.
2. `push-remote-snapshot-listing-contract.json` for planning-only remote hash listing.
3. `push-production-revalidation-contract.json` for the preflight, dry-run, apply-time revalidation, journal, and recovery ladder.
4. `push-production-auth-session-journal-recovery-inspect-contract.json` for auth/session/journal/inspect recovery proof.
5. `push-remote-liveness-topology-contract.json` for the dry-run/apply separation on that topology.
6. `push-production-topology-contract.json` for the Docker and Playground harness proof.

The executor can be implemented as a strict request ladder:

1. `push_preflight` mints the short-lived push session after the importer has persisted the immutable pull base package.
2. `push_snapshot_hashes` lists remote hashes for planning only and never becomes write authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an eligibility receipt, not a lock.
4. `push_batch_apply` mutates in batches and must revalidate fresh live evidence before every batch and at the storage boundary.
5. `push_journal` records durable evidence and stays read-only.
6. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe with the same auth floor as the write path.

That ladder maps directly to the production harness:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edit site
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, hash listing, dry-run upload, apply, journal inspect, and recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The same topology is the one used by the Docker and Playground contract pair:

- `push-production-topology-contract.json` is the smallest topology-only proof for the one-remote, one-local, one-drift harness and the `8080` ingress rule
- `push-remote-liveness-topology-contract.json` adds the dry-run/apply separation and live revalidation boundary on top of that same harness

The review path is intentionally layered:

- `push-production-pull-bridge-contract.json` is the immutable exporter/importer-to-push bridge.
- `push-remote-snapshot-listing-contract.json` is the planning-only hash-listing proof that stays cursorable without becoming write authority.
- `push-production-revalidation-contract.json` is the compact production proof for preflight, snapshot listing, dry-run eligibility, apply-time revalidation, journal evidence, and inspect-first recovery.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is the compact proof for the auth floor, push session minting, journal rows, lease fencing, and read-only recovery inspect.
- `push-production-journal-lease-recovery-inspect-contract.json` is the compact proof for the journal-row and lease-fence boundary when you only need inspect-first recovery after the dry-run/apply split.
- `push-production-topology-contract.json` is the production harness proof for one remote source, one imported local edit site, and one later drift observation of the same remote identity.
- `push-remote-liveness-topology-contract.json` is the smallest proof for the dry-run/apply separation plus live revalidation boundary.

The inspect-first recovery proof path is intentionally explicit:

- `push-production-auth-session-journal-recovery-inspect-contract.json` is the compact production proof for auth floor, push session minting, journal rows, lease fencing, and read-only recovery inspect.
- `push-production-journal-lease-recovery-inspect-contract.json` is the compact production proof for journal rows, lease fencing, and read-only recovery inspect after the dry-run/apply split.
- `push-production-recovery-inspect-contract.json` is the production-shaped proof for the same inspect-first boundary when you need the journal row, lease fence, and live drift classification to stay aligned with the write path.
- `push-production-recovery-drift-contract.json` is the production-shaped proof for recovery inspect after the remote has drifted and the same remote identity still has to be revalidated before mutation.

For quick navigation, use this proof order:

1. `push-protocol-extension-contract.json` for the full executor ladder.
2. `push-production-pull-bridge-contract.json` for the exporter/importer to push bridge.
3. `push-remote-snapshot-listing-contract.json` for planning-only remote hash listing.
4. `push-production-auth-session-journal-recovery-inspect-contract.json` for the auth/session/journal/recovery proof.
5. `push-remote-liveness-topology-contract.json` for the liveness split on the one-remote, one-local topology.
6. `push-production-topology-contract.json` for the compact production topology bundle.

That order is the production proof stack:

- extension contract for stage order and recovery gates
- pull bridge contract for immutable provenance handoff
- remote snapshot listing contract for planning-only live hash discovery
- production revalidation contract for dry-run separation and apply-time revalidation
- auth/session/journal/recovery inspect contract for the auth floor and inspect-first boundary
- remote liveness topology contract for dry-run/apply separation with live drift
- production topology contract for the one-remote, one-local, one-drift harness proof

The real push executor maps that proof bundle onto the existing pull pipeline in a fixed order:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `push_preflight` binds the persisted pull base package to one live remote identity and one short-lived push session.
4. `push_snapshot_hashes` performs planning-only remote hash listing.
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt.
6. `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary.
7. `push_journal` records durable evidence without authorizing mutation.
8. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
9. `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe with the same auth floor as the write path.

The bridge is reviewed in a fixed order:

1. exporter/importer create the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one short-lived push session.
3. `push_snapshot_hashes` lists the live remote comparison surface for planning only.
4. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
8. `push_recover auto|finish|rollback` may mutate only when inspect proves the branch safe and the auth floor still holds.

The executor consumes that bridge in the same order:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` binds the persisted base package to one live remote identity and one short-lived push session
- `push_snapshot_hashes` stays planning-only and never upgrades into write authority
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary
- `push_journal` stays read-only
- `push_recover inspect` classifies finish, rollback, retry, or block before any mutating recovery
- `push_recover auto|finish|rollback` mutates only when inspect proves the branch safe and the auth floor still holds

The executor follows the same ordered stages defined in the protocol:

1. `push_preflight` binds the imported pull base package to one live remote
   identity and one short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only and may page large sites. It is the remote snapshot hash
   listing step and never becomes mutation authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock. The dry-run receipt never substitutes for
   a live revalidation.
4. `push_batch_apply` is a separate remote call that revalidates fresh live
   evidence before every batch and again at the storage boundary. Apply must
   not reuse the dry-run receipt as authority, as a lease, or as a session
   substitute.
5. `push_journal` stays read-only.
6. `push_recover inspect` classifies finish, rollback, retry, or block before
   any mutating recovery and keeps the same auth floor as the write path.
   Inspect is read-only.
7. `push_recover auto|finish|rollback` mutates only when inspect proves the
   branch safe and the auth floor still holds.

The executor boundary is intentionally production-shaped:

- exporter/importer are the immutable provenance source
- preflight is the first live binding after importer persistence
- remote snapshot hash listing is planning evidence only
- dry-run is a receipt, not a lock
- apply is a separate remote call that revalidates before every batch and at
  the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

Dry-run and apply remain separate remote operations, and apply must
revalidate fresh live evidence before each batch and again at the storage
boundary.

The pull/export/import handoff remains the provenance source for every push
stage:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote call that revalidates before every batch and at
  the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

The same topology proof stays fixed in both Docker and Playground:

- `remote-base` seeds the persisted pull base package.
- `local-edited` carries the imported local edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery.
- `push-production-topology-contract.json` is the canonical pull-bridge plus
  one-remote, one-local, one-drift harness proof.
- `push-deployment-topology-contract.json` is the smaller Docker and
  Playground topology-only proof when you only need the one-remote,
  one-local shape.
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy.
- remote tunnels are disallowed.

The production test topology is therefore one remote source, one imported
local edit site, and one later drift witness:

- `remote-base` seeds the persisted pull base package.
- `local-edited` carries the imported local edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor allowed to preflight, list hashes, dry-run,
  apply, inspect the journal, or recover.
- Docker uses one private network.
- Playground uses separate disposable blueprints.
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy.
- remote tunnels are disallowed.

That topology is also the live-drift proof:

- `remote-base` seeds the persisted pull base package.
- `local-edited` is the imported local site carrying candidate edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` keeps dry-run and apply separate and revalidates before every batch.
- `push_recover inspect` is read-only and must happen before any mutating recovery branch.

That topology is the minimum production-shaped harness:

- Docker uses one private network for `remote-base`, `local-edited`,
  `remote-changed`, and `runner`
- Playground uses separate disposable blueprints with the same role names and
  route paths
- both harnesses keep dry-run and apply separate remote operations
- both harnesses require apply-time revalidation against fresh live hashes
- both harnesses keep recovery inspect-first and read-only until the branch is
  proven safe
- the compact proof pair for this harness shape is
  `push-deployment-topology-contract.json` plus
  `push-production-topology-contract.json`

Use this as the standard one-remote, one-local production proof shape:

- `remote-base` seeds the persisted pull base package
- `local-edited` is the imported local edit site
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor allowed to call preflight, snapshot listing,
  dry-run, apply, journal inspect, and recovery
- Docker keeps the proof inside one private network
- Playground keeps the proof inside separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed
- cite `push-deployment-topology-contract.json` for topology-only review
- cite `push-remote-liveness-topology-contract.json` when the dry-run/apply
  separation and apply-time revalidation are part of the proof

That handoff is intentionally one-way:

- exporter/importer produce the immutable base package that push consumes
- push never rewrites the persisted pull base package or treats it like a
  mutable snapshot cache
- preflight is the first live binding after importer persistence
- dry-run and apply remain separate remote operations
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspection stays read-only
- recovery starts with inspect before any mutating repair

That same bridge is the executor contract:

- exporter/importer produce the immutable base package that push consumes
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only and never upgrades into write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
  lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch

The canonical production proof bundle is `push-protocol-extension-contract.json`:

- it ties exporter/importer provenance to preflight, snapshot hash listing, dry-run upload, batched apply, journal inspect, and inspect-first recovery
- it keeps dry-run and apply separate while apply revalidates fresh live evidence before every batch and at the storage boundary
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit
- it is the umbrella contract that sits above `push-production-topology-contract.json` and `push-remote-liveness-topology-contract.json`

The auth floor is not relaxed for the executor:

- push auth must be at least as strict as current Reprint HMAC usage
- stronger session material is allowed, but it may not weaken that floor
- journal inspect and recovery use the same auth floor as the write path

That means the executor can rely on the imported pull base package, but it
must still rebind the live remote identity before any mutating stage and must
revalidate the live remote again at apply time.

The recovery/journal/session chain is equally strict:

- the imported pull base package is provenance only, never a reusable lock
- journal rows carry claim ownership, generation, and lease expiry
- `push_recover inspect` must read the journal before any mutating repair
- inspect classifies finish, rollback, retry, or block and may still refuse
  to mutate when the live remote no longer matches the persisted proof
- stale dry-run evidence never becomes recovery authority
- the same auth floor applies to apply, journal inspection, and recovery

For reviewers, the shortest proof chain is:

1. exporter discovers the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. preflight binds that persisted base to one live remote identity
4. snapshot hash listing stays planning-only
5. dry-run uploads the canonical plan and returns a receipt, not a lock
6. apply revalidates fresh live evidence before every batch and at the
   storage boundary
7. journal inspect stays read-only
8. recovery starts with inspect and only mutates when the journal plus fresh
   live hashes prove the branch safe

That means the executor is not a general remote write loop. It is the
production write path for one imported base package, one edited local site,
and one live remote identity that must be revalidated at apply time.

The same pull-to-push bridge applies here:

- exporter/importer provenance produces the immutable pull base package.
- importer persistence is the only source of the base package that push may
  bind to, so push never reads from a mutable snapshot cache.
- preflight binds that package to one live remote identity and one short-lived
  push session.
- remote snapshot hash listing stays planning-only and may page through the
  live remote comparison surface without upgrading into write authority.
- dry-run uploads a canonical plan receipt and never becomes a lock.
- batched apply is a separate remote operation from dry-run, revalidates
  fresh live evidence before every batch and again at the storage boundary,
  and rechecks the auth floor before mutation.
- journal inspection stays read-only.
- inspect-first recovery is the only safe starting point for mutating
  recovery.

Read as a production chain, the executor consumes exporter/importer
provenance in order:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. `push_preflight` is the first live binding after importer persistence
4. `push_snapshot_hashes` stays planning-only and may page through large
   sites, but it never becomes write authority
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock
6. `push_batch_apply` revalidates before every batch and again at the storage
   boundary
7. `push_journal` stays read-only
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe with the same auth floor as the write path

The production harness is the same in Docker and Playground:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The imported pull base package is the anchor point for the executor:

| Imported field | Why it matters |
| --- | --- |
| `base_manifest_id` | Names the persisted pull package that preflight must bind. |
| `base_manifest_hash` | Pins the immutable manifest content used for planning. |
| `base_coverage_hash` | Pins the coverage evidence that justified the import. |
| `remote_site_id` | Binds the package back to the source remote identity. |

The executor treats those fields as immutable provenance, not a reusable
snapshot cache:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` may page the live comparison surface, but it stays
  planning-only
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and live hashes before any
  mutating repair

The production shape is fixed:

- exporter/importer produce the immutable pull base package
- `push_preflight` binds that package to one live remote identity and one
  short-lived push session
- `push_snapshot_hashes` only lists live hashes for planning
- `push_plan_dry_run` uploads a canonical plan receipt and never becomes
  write authority
- `push_batch_apply` is a separate remote mutation and revalidates fresh
  live evidence before every batch and again at the storage boundary
- `push_journal` is read-only evidence
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- mutating recovery only proceeds when the journal row and fresh live hashes
  still prove the branch safe
- the auth floor is at least as strict as current Reprint HMAC usage

Recovery stays inspect-first even when the journal is present:

1. read the journal
2. inspect live hashes
3. classify finish, rollback, retry, or block
4. mutate only when the journal and fresh live evidence still prove the
   branch safe

The pull pipeline is the provenance source for the executor ladder:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote call that revalidates fresh live evidence before
  every batch and again at the storage boundary
- journal inspect reads durable evidence without authorizing mutation
- inspect-first recovery may mutate only when the journal row, lease fence,
  and fresh live hashes still prove the action safe

That mapping is the executor contract, not just an implementation note:

- `push_preflight` is the first live binding after importer provenance exists.
- `push_snapshot_hashes` is planning-only evidence and may page large sites,
  but it never becomes write authority.
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt that cannot be reused as a lock.
- `push_batch_apply` must revalidate before every batch and again at the
  storage boundary, so drift between dry-run and apply is observable.
- `push_journal` is durable evidence only and never authorizes mutation.
- `push_recover inspect` is read-only and must precede any mutating repair.
- `push_recover auto|finish|rollback` may mutate only when inspect plus fresh
  live hashes prove the branch safe.

The production test topology is fixed to the same three site roles in both
Docker and Playground:

| Role | Meaning |
| --- | --- |
| `remote-base` | Source site that seeds the persisted pull base package. |
| `local-edited` | Imported local site that carries the candidate edits. |
| `remote-changed` | Later observation of the same remote identity after drift. |
| `runner` | Only actor that may preflight, list hashes, dry-run, apply, inspect, or recover. |

Both harnesses keep browser-visible inspection on the sandbox-provided `8080`
ingress through a local-only proxy, and remote tunnels remain disallowed.

The proof target is the same one-remote, one-local, one-drift shape:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, remote snapshot hash listing, dry-run plan
  upload, mutation batch apply, journal inspect, and inspect-first recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The same mapping is what the Docker and Playground proofs must exercise:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner that owns the protocol calls
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- dry-run and apply remain separate remote operations even when the same
  runner executes both
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect stays read-only before any mutating recovery branch

The production proof topology is intentionally minimal and repeated across
both harnesses:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- both harnesses keep the same route names for preflight, dry-run, apply,
  journal inspect, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

The harness contracts that pin that shape are:

- `push-deployment-topology-contract.json` for the smallest topology-only
  proof with the `8080` ingress rule and the no-tunnel policy
- `push-remote-liveness-topology-contract.json` for the topology plus
  dry-run/apply liveness split
- `push-production-topology-contract.json` for the compact production bundle
  that keeps the pull provenance, push stage sequence, and topology aligned
- `push-production-revalidation-contract.json` for the auth, session, journal,
  lease, and fencing proof that still requires inspect-first recovery
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` for the production auth,
  session, journal, lease, and inspect-first recovery pair
- `push-production-recovery-drift-contract.json` for the production-shaped
  inspect-first recovery proof after live drift
- `npm run test:playground:production-shaped-release-proof` for the
  supervisor-facing command that either runs the supplied live-source
  preflight or fails at the explicit missing-secret and missing-live-source
  gates with exact output

Use `push-deployment-topology-contract.json` for the smallest topology proof
and `push-remote-liveness-topology-contract.json` when you need the dry-run
and apply liveness split in the same harness.

The same topology is mirrored in both harnesses:

- Docker uses one private network
- Playground uses separate disposable blueprints
- both harnesses use the same route names for preflight, dry-run, apply,
  journal inspection, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

This keeps the exporter/importer pipeline authoritative for the base package
while making push a separate production write path that can only consume that
persisted provenance.

For review, the canonical executor chain is:

1. exporter/importer create the immutable pull base package.
2. `push_preflight` binds that package to the live remote identity and a
   short-lived push session.
3. `push_snapshot_hashes` stays planning-only.
4. `push_plan_dry_run` returns a receipt, not a lock.
5. `push_batch_apply` revalidates before every batch and again at the storage
   boundary.
6. `push_journal` remains read-only.
7. `push_recover inspect` classifies recovery before any mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe.

The canonical production contract stack is:

1. `push-protocol-extension-contract.json`
2. `push-production-topology-contract.json`
3. `push-production-revalidation-contract.json`
4. `push-production-journal-lease-recovery-inspect-contract.json`
5. `push-production-executor-flow-contract.json`

In runbook form, the executor keeps the same order and boundary discipline:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after that persistence boundary
- snapshot hash listing is planning-only evidence and may page, but never
  becomes write authority
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote call that revalidates fresh live evidence before
  every batch and again at the storage boundary
- apply-time revalidation is the boundary that keeps the dry-run receipt from
  becoming remote write authority
- journal inspection stays read-only
- recovery starts with inspect and only mutates when the journal plus fresh
  live hashes prove the branch safe

The production test topology is the same in Docker and Playground:

- one remote source site (`remote-base`)
- one imported local edited site (`local-edited`)
- one later observation of the same remote identity after drift
  (`remote-changed`)
- one runner process that owns all push protocol calls
- browser-visible inspection only through the sandbox-provided `8080` ingress
  and a local-only proxy

The topology roles stay fixed:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery

The minimal site split is always the same:

- `remote-base` seeds the persisted pull base package.
- `local-edited` holds the imported local changes.
- `remote-changed` is the same remote identity observed later after drift.

That gives the minimal remote/local pair the task asks for:

- `remote-base` is the remote site under observation.
- `local-edited` is the imported local site carrying the candidate changes.
- `remote-changed` is the same remote site observed later after drift.
- the runner proves dry-run and apply are separate by taking a fresh snapshot
  listing, uploading a dry-run plan, and then applying only after live
  revalidation succeeds.

`push-topology-matrix.json`, `push-deployment-topology-contract.json`, and
`push-remote-liveness-topology-contract.json` are the fixtures that pin that
shared topology. Use the deployment contract when you need the smallest
topology-only proof, and the liveness-topology contract when you need the same
one-remote, one-local, one-drift harness plus the dry-run/apply split.
Use `push-topology-matrix.json` when you need the shared Docker and
Playground route matrix with the ingress and proxy policy named explicitly.
Use `push-production-topology-contract.json` when you need the compact
production bundle that keeps the pull provenance, push stage sequence, and
topology proof together in one object.

For the compact bridge between the pull pipeline and that topology, cite
`push-pull-to-topology-contract.json`. For the smallest topology-only proof,
cite `push-deployment-topology-contract.json`. For the strongest liveness
boundary proof, cite `push-remote-liveness-topology-contract.json`.
For the shortest stage-by-stage production proof, cite
`push-production-ladder-contract.json`.

The topology story is intentionally small:

- `remote-base` seeds the persisted pull base package.
- `local-edited` is the imported local site that carries the candidate plan.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or run recovery.

The executor is therefore not a general remote write loop. It is the
production write path for one imported base package, one edited local site,
and one live remote identity that must be revalidated at apply time.

## Stage Semantics

The executor needs the same boundary discipline as the protocol:

- preflight is the first live binding after importer provenance exists
- remote snapshot hash listing is planning evidence only and never a write
  precondition by itself
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote operation that revalidates fresh live evidence
  before every batch and again at the storage boundary, and does not reuse
  the dry-run receipt as a lock
- journal inspection stays read-only
- recovery starts with inspect and only mutates when inspect proves the branch
  safe with fresh live evidence

That bridge is one-way:

- exporter and importer create the immutable pull base package once
- preflight is the first live bind after importer persistence
- snapshot listing is planning-only evidence
- dry-run is a receipt, not a lock
- apply is a separate remote mutation and revalidates fresh live evidence
  before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the branch safe

The operational recovery order is strict:

- `inspect` first
- `finish` or `rollback` only when the journal plus live hashes prove the
  branch safe
- `retry` only when the claim is open but still fenced
- `block` when the evidence cannot prove a safe mutation

## Pull To Push Mapping

The pull pipeline remains the provenance source for every push stage:

| Pull artifact or stage | Push stage | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base package to one live remote identity, one requested scope, and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it only as planning provenance for the live remote hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan as a receipt, not a lock. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

That mapping is intentionally one-way:

- the exporter/importer pipeline discovers and persists immutable provenance
- push consumes that provenance and never rewrites the pull base package
- preflight is the first live binding after importer persistence
- snapshot hashes are planning evidence only
- dry-run is a receipt, not a lock, and cannot authorize apply
- apply revalidates before every batch and again at the storage boundary
- journal inspect stays read-only
- mutating recovery only happens after inspect proves the branch safe

## Topology

The executor uses the same production topology in Docker and Playground:

| Role | Docker | Playground |
| --- | --- | --- |
| Remote source | `remote-base` | `remote-base` |
| Local edited site | `local-edited` | `local-edited` |
| Drift witness | `remote-changed` | `remote-changed` |
| Runner | `runner` | local test process |

The test topology is the same in both harnesses:

- one remote source site
- one imported local edited site
- one later drift witness of the same remote identity
- one runner process that owns all push protocol calls
- one browser-visible inspection path on the sandbox-provided `8080`
  ingress via a local-only proxy

That topology keeps the executor proof stable:

- `remote-base` seeds the persisted pull base package
- `local-edited` is the imported local site with user edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or start recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- Docker uses one private network; Playground uses separate disposable
  blueprints
- both harnesses use the same route names and the same dry-run/apply split
- remote tunnels are disallowed
- both harnesses keep `remote-base` and `remote-changed` as two observations
  of the same remote identity, not two different sites
- both harnesses require journal inspection before any mutating recovery

Both harnesses also enforce the same ingress rule:

- no remote tunnels
- local-only proxying for browser-visible inspection
- the only exposed port is sandbox-provided `8080`

The bridge from pull to push stays one-way:

- exporter/importer establish the immutable base package before push
- `push_preflight` binds that package to one live remote identity and one
  short-lived push session
- `push_snapshot_hashes` stays planning-only and never becomes write
  authority
- `push_plan_dry_run` returns a receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` stays read-only
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` still requires the same HMAC floor as
  apply and cannot bypass inspect

## Canonical Proofs

The canonical proof stack for that executor story is the same one named in
[protocol.md](protocol.md):

- `push-protocol-extension-contract.json` for the canonical machine-readable
  production ladder from preflight through inspect-first recovery
- `push-pull-to-topology-contract.json` for the compact bridge from pull
  provenance into the production push topology
- `push-production-revalidation-contract.json` for the compact proof that
  keeps preflight, planning-only snapshot hashes, dry-run eligibility,
  apply-time revalidation, journal evidence, and inspect-first recovery
  together
- `push-dry-run-apply-revalidation-contract.json` for the planning-only dry-
  run receipt and apply-time revalidation boundary
- `push-production-recovery-inspect-contract.json` for the compact proof that
  recovery inspect stays read-only while the journal row, lease fence, auth
  floor, and `8080` topology still match the write path
- `push-production-recovery-drift-contract.json` for the compact proof that
  recovery inspect stays read-only after live drift while pull provenance,
  auth, and the one-remote, one-local topology still line up
- `push-production-auth-session-journal-recovery-inspect-contract.json` for
  the compact production proof that keeps the auth floor, minted push
  session, journal row, lease fence, and read-only recovery inspect together
- `push-production-recovery-drift-contract.json` for the compact proof that
  recovery inspect stays read-only after live drift while pull provenance,
  auth, and the one-remote, one-local topology still line up
- `push-production-push-recovery-contract.json` for the compact end-to-end
  proof that ties pull provenance, the production push ladder, and inspect-
  first recovery into one reviewable object, with `remote-base` and
  `remote-changed` proving the same remote identity before and after drift
  and with apply-time revalidation kept separate from dry-run
- `push-auth-session-journal-recovery-contract.json` for the compact auth,
  session, journal-row, lease-fence, and inspect-first recovery proof
- `push-production-auth-session-journal-recovery-inspect-contract.json` for
  the compact production proof that keeps the auth floor, minted push
  session, journal row, lease fence, and read-only recovery inspect together
- `push-recovery-boundary-contract.json` for the compact inspect-first
  recovery boundary proof that keeps the auth floor and Docker/Playground
  topology together
- `push-auth-session-journal-recovery-inspect-contract.json` for the compact
  proof that binds auth, session minting, journal rows, lease fencing, live
  drift, and inspect-first recovery into one object
- `push-recovery-inspect-contract.json` for the read-only inspect gate that
  must classify recovery before any mutation can proceed
- `push-deployment-topology-contract.json` for the smallest topology-only
  contract that still proves the same remote identity twice, the imported
  local site, and the sandbox-provided `8080` ingress rule
- `push-journal-inspect-contract.json` for the read-only journal boundary
- `push-remote-liveness-topology-contract.json` for the compact liveness plus
  one-remote, one-local, one-drift harness proof
- `push-production-ladder-contract.json` for the shortest stage-by-stage
  production proof that still keeps the pull base, dry-run receipt,
  apply-time revalidation, journal inspection, and inspect-first recovery
  explicit
- `push-topology-matrix.json` for the canonical Docker/Playground stage
  matrix proving one remote source, one local edited site, and one drift
  witness
- `push-production-push-recovery-contract.json` for the canonical end-to-end
  proof that ties the pull provenance, the production push ladder, and the
  one-remote, one-local topology into one reviewable object while proving the
  same remote identity before and after drift, and keeps the shared
  auth/session floor, journal rows, lease fencing, and inspect-first recovery
  path explicit

These are the same proof points the protocol contract uses:

- preflight binds imported provenance to one live remote identity and one
  short-lived session
- remote snapshot hash listing is planning-only
- dry-run is a receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect is read-only
- recovery starts with inspect and mutates only when fresh live evidence and
  journal evidence still prove the branch safe
