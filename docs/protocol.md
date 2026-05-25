# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push extends
the existing exporter/importer pull pipeline with a remote mutation protocol
that keeps pull provenance immutable, separates planning from mutation,
revalidates the live remote identity at apply time, and keeps the dry-run and
apply liveness split explicit.

## Canonical Push Contract

The production push extension is the same in Docker and Playground:

| Stage | Contract |
| --- | --- |
| `push_preflight` | Bind the persisted pull base package to one live remote identity and one short-lived push session. |
| `push_snapshot_hashes` | List remote hashes for planning only and never gain write authority. |
| `push_plan_dry_run` | Upload the canonical plan and return an eligibility receipt, not a lock. |
| `push_batch_apply` | Revalidate fresh live evidence before every batch and again at the storage boundary. |
| `push_journal` | Record durable evidence without authorizing mutation. |
| `push_recover inspect` | Read the journal and fresh live hashes before any mutating repair. |
| `push_recover auto|finish|rollback` | Mutate only after inspect proves the branch safe and the auth floor still holds. |

The contract is intentionally production-shaped:

- preflight is the first live binding after importer provenance exists
- remote snapshot hash listing is planning-only evidence and never write authority
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote mutation and must revalidate fresh live evidence
  before every batch and again at the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair
- mutating recovery may proceed only when journal evidence and fresh live
  hashes still prove the branch safe
- authentication must be at least as strict as current Reprint HMAC usage

The production shape is also explicit about what is live and what is only
planning evidence:

- preflight is the first live binding after importer provenance exists
- remote snapshot hash listing is planning evidence only and never write
  authority
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote mutation and must revalidate fresh live evidence
  before every batch and again at the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair
- mutating recovery may proceed only when journal evidence and fresh live
  hashes still prove the branch safe
- authentication must be at least as strict as current Reprint HMAC usage

The runtime sequence is fixed and non-overlapping:

1. `push_preflight` binds the persisted pull base package to one live remote identity and one short-lived push session.
2. `push_snapshot_hashes` lists remote hashes for planning only.
3. `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary.
5. `push_journal` records durable evidence without authorizing mutation.
6. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe and the auth floor still holds.

That ladder maps directly onto the pull/export/import pipeline:

| Pull pipeline object | Push consumer | Why the boundary stays separate |
| --- | --- | --- |
| Exporter merge-base and coverage scan | `push_preflight` | First live bind after importer persistence. |
| Importer persisted base package | `push_snapshot_hashes` | Planning-only remote comparison evidence. |
| Immutable pull provenance | `push_plan_dry_run` | Eligibility receipt, not a lock. |
| Persisted pull base package plus live drift evidence | `push_batch_apply` | Fresh live revalidation before every batch and at the storage boundary. |
| Durable pull provenance | `push_journal` | Read-only evidence for later recovery. |
| Immutable provenance plus fresh live hashes | `push_recover inspect` | Read-only classification before mutation. |
| Importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutating recovery only when inspect and auth-floor checks pass. |

That mapping is intentionally one-way:

- exporter and importer create the immutable base package once
- push consumes that base package through preflight, planning-only hash
  listing, and dry-run receipt generation
- apply, journal, and recovery remain fenced by fresh live evidence and
  inspect-first recovery rules
- the imported base package is never rewritten into write authority

The fixed test topology is also shared:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The topology proof is intentionally minimal and stable:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits derived from that package
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, remote snapshot hash listing, dry-run plan upload,
  mutation batch apply, journal inspect, and inspect-first recovery
- Docker and Playground both keep the same route names and the same auth
  floor
- the only browser-visible ingress is sandbox-provided `8080` through a
  local-only proxy
- remote tunnels are disallowed

## Canonical Production Extension

The canonical push extension is the smallest production proof that still
captures the full remote safety boundary:

1. Exporter discovers the merge base and coverage evidence.
2. Importer persists the pull base package as immutable provenance.
3. `push_preflight` binds that persisted package to one live remote identity
   and one short-lived push session.
4. `push_snapshot_hashes` lists remote hashes for planning only.
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
7. `push_journal` records durable evidence without authorizing mutation.
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe and the auth floor still holds.

The pull-to-push bridge is one-way:

- exporter/importer create and persist the immutable pull base package
- `push_preflight` is the first live bind after importer persistence
- `push_snapshot_hashes` is planning-only evidence
- `push_plan_dry_run` is a receipt, not a lock
- `push_batch_apply` is a separate remote mutation and revalidates fresh live evidence before every batch and again at the storage boundary
- `push_journal` is read-only evidence
- `push_recover inspect` is read-only and must happen first
- mutating recovery uses the same HMAC floor as apply and must not bypass inspect

In production terms, the bridge is the same three-step handoff repeated in
both Docker and Playground:

1. exporter/importer create the immutable pull base package
2. push consumes that package through preflight, planning-only hash listing, and dry-run receipt generation
3. apply, journal, and recovery stay fenced by fresh live evidence and inspect-first recovery rules

The production proof inventory is intentionally layered:

1. `push-protocol-extension-contract.json` for the end-to-end ladder and pull bridge
2. `push-production-topology-contract.json` for the one-remote, one-local, one-drift harness
3. `push-production-revalidation-contract.json` for auth, session, journal, lease, and apply-time revalidation
4. `push-production-journal-lease-recovery-inspect-contract.json` for journal rows, lease fencing, and inspect-first recovery
5. `push-production-executor-flow-contract.json` for the shortest full flow proof
6. `push-production-route-matrix-contract.json` for the shared Docker and Playground route names, ingress, and proxy policy
7. `push-production-missing-secret-contract.json` for the explicit failure path when real push credentials are unavailable

Those fixtures should read as one chain:

- exporter/importer establish immutable provenance
- preflight binds that provenance to one live remote identity and one short-lived push session
- remote hash listing stays planning-only
- dry-run returns a receipt, not a lock
- apply remains a separate mutation and revalidates before every batch and at the storage boundary
- journal inspect is read-only
- recovery must start with inspect and may mutate only when fresh live evidence and journal evidence still agree
- the auth floor is at least as strict as current Reprint HMAC usage
- when real credentials are unavailable, the harness must fail fast with an explicit missing-secret error before preflight, dry-run, or apply

The checked proof path for this protocol document is `node --test test/protocol-fixtures.test.js`.
That command exercises the production push handshake, live-source preflight,
remote snapshot hash listing, dry-run plan upload, apply-time revalidation,
journal inspection, and inspect-first recovery boundary against the fixture
contracts that model the one-remote, one-local, one-drift topology.

The checked topology proof is `npm run test:playground:production-shaped-topology-proof`.
That command prints the one-remote, one-local, one-drift harness summary and
the shared Docker and Playground route matrix without needing live credentials.

The release-facing proof command is `npm run test:playground:production-shaped-proof`.
It pairs the protocol fixture test with the explicit missing-secret smoke so
the executable boundary proves both the production ladder and the fast-fail
auth gate in one checked entry point.

That same checked wrapper also proves the explicit live-source gate:

- `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` when the live source URL is missing
- `REPRINT_PUSH_SECRET_REQUIRED` when the real push secret is missing

Run the proof command when you need the exact production-shaped boundary:

```sh
npm run test:playground:production-shaped-proof
```

That checked command is the one that matters for the release proof:

- it exercises the protocol fixture ladder
- it fails fast with `REPRINT_PUSH_SECRET_REQUIRED` when the real push secret is absent
- it fails fast with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` when the live source URL is absent
- it keeps dry-run and apply separate
- it preserves the one-remote, one-local, one-drift topology across the checked entry point

The bridge also preserves the existing pull/export/import provenance chain:

| Pull pipeline object | Push consumer | Result |
| --- | --- | --- |
| Exporter merge-base and coverage scan | `push_preflight` | First live bind after immutable provenance exists. |
| Importer persisted base package | `push_snapshot_hashes` | Planning-only remote hash discovery. |
| Immutable pull provenance | `push_plan_dry_run` | Eligibility receipt with no mutation authority. |
| Persisted pull base package plus live drift evidence | `push_batch_apply` | Fresh live revalidation before every batch and again at the storage boundary. |
| Durable pull provenance | `push_journal` | Read-only evidence for later recovery. |
| Immutable provenance plus fresh live hashes | `push_recover inspect` | Read-only classification before any mutating repair. |
| Importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutating recovery only when inspect and auth-floor checks pass. |

The executor should treat that bridge as immutable evidence, not as a
write-authority chain:

- exporter/importer produce the base package once
- preflight binds that package to one live remote identity and one short-lived session
- remote hash listing stays planning-only evidence
- dry-run returns a receipt, not a lock
- apply is a separate remote operation and revalidates before every batch and at the storage boundary
- journal inspect stays read-only
- recovery inspect must happen before any mutating repair
- mutating recovery still requires fresh live evidence plus the same HMAC floor as apply

The same extension is exercised in one fixed topology:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

This is the minimum production proof for the push extension:

- `remote-base` and `remote-changed` are the same remote identity observed at different times
- `local-edited` is the imported local site derived from the persisted pull base package
- `runner` owns preflight, remote snapshot hash listing, dry-run plan upload, batch apply, journal inspect, and inspect-first recovery
- Docker and Playground keep the same route names so the proof carries across both harnesses

The execution proof is intentionally split between three distinct remote
boundaries:

- `push_preflight` binds the persisted pull base package to one live remote
  identity and one short-lived push session.
- `push_snapshot_hashes` lists remote hashes for planning only and never
  gains write authority.
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock.
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary.
- `push_journal` records durable evidence without authorizing mutation.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair.
- `push_recover auto|finish|rollback` may mutate only after inspect proves the
  branch safe and the auth floor still holds.

If the real push secret is unavailable, the production harness must stop at an
explicit missing-secret error before any preflight, dry-run, or apply work
can begin. The missing-secret path must not silently fall back to lab-only
authentication or to local-only executor behavior.

That split keeps remote liveness strict: dry-run and apply are separate remote
operations, and apply must revalidate the live remote before every batch and
again at the storage boundary.

The checked command that exercises this protocol shape in the repo is:

```sh
node --test test/protocol-fixtures.test.js
```

The release-facing command that also proves the explicit missing-secret gate
is:

```sh
npm run test:playground:production-shaped-proof
```

The direct production-shaped missing-secret gate is:

```sh
npm run test:playground:production-shaped-missing-secret
```

It fails fast with `REPRINT_PUSH_SECRET_REQUIRED` when neither
`REPRINT_PUSH_SIGNING_SECRET` nor `REPRINT_PUSH_APPLICATION_PASSWORD` is set,
which keeps the preflight/dry-run/apply boundary explicit even when a real
remote credential is unavailable.

## Canonical Proof Set

Use this order when reviewing the production push extension end to end:

1. `push-protocol-extension-contract.json` for the full ladder, pull bridge, auth floor, and one-remote/one-local/one-drift topology.
2. `push-production-topology-contract.json` for the production harness and the Docker/Playground topology proof.
3. `push-production-pull-bridge-contract.json` for the immutable exporter/importer handoff into push.
4. `push-production-revalidation-contract.json` for preflight, planning-only remote hashes, dry-run eligibility, apply-time revalidation, journal evidence, and inspect-first recovery.
5. `push-production-auth-session-journal-recovery-inspect-contract.json` for auth, short-lived session minting, journal rows, lease fencing, and read-only recovery inspect on the same remote identity.
6. `push-production-journal-lease-recovery-inspect-contract.json` for the narrow journal/lease/recovery proof after dry-run and apply have split.
7. `push-production-executor-flow-contract.json` for the shortest compact end-to-end flow object.
8. `push-production-route-matrix-contract.json` for the shared route names, ingress, and proxy policy in Docker and Playground.

The ladder and the proof set stay aligned:

- exporter/importer establish immutable provenance before push starts
- preflight is the first live bind after importer persistence
- remote snapshot hash listing stays planning-only
- dry-run returns an eligibility receipt, not a lock
- apply is a separate remote mutation and revalidates live evidence before every batch and at the storage boundary
- journal inspect is read-only
- recovery starts with inspect and mutates only when fresh live evidence and the HMAC floor still hold
- Docker and Playground use the same route semantics, the same auth floor, and the same 8080-visible inspection rule

## Production Summary

The production contract is the same in Docker and Playground:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns preflight, remote snapshot hash listing,
  dry-run plan upload, batched apply, journal inspect, and inspect-first
  recovery

The push extension is a strict continuation of the pull exporter/importer
pipeline:

1. Exporter discovers the merge base and coverage evidence.
2. Importer persists the base package as immutable provenance.
3. `push_preflight` binds that persisted base package to one live remote
   identity and one short-lived push session.
4. `push_snapshot_hashes` lists remote hashes for planning only.
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
7. `push_journal` records durable evidence without authorizing mutation.
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
9. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe with the same auth floor as the write path.

The auth floor is at least as strict as current Reprint HMAC usage, and the
remote liveness split is strict: dry-run and apply are separate remote
operations, and apply must revalidate live evidence again before mutation.

## Push Ladder

The production push protocol is a fixed ladder:

1. Exporter/importer create and persist the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only.
4. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary, separate from dry-run.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe with the same auth floor as the write path.

That ladder is exercised in one fixed topology: one remote source site,
one imported local edit site, one later drift observation of the same remote
identity, and one runner that owns the push protocol calls in Docker and
Playground.

The production ladder is easiest to review when the proof set stays paired
with the executor topology:

- `push-production-topology-contract.json` proves the one-remote, one-local,
  one-drift Docker and Playground harness.
- `push-production-pull-bridge-contract.json` proves the immutable
  exporter/importer handoff into push.
- `push-production-auth-session-journal-recovery-inspect-contract.json`
  proves the auth floor, short-lived push session, journal rows, lease fence,
  apply-time revalidation, and inspect-first recovery branch on the same
  remote identity.
- `push-production-journal-lease-recovery-inspect-contract.json` isolates the
  journal row, lease fence, and inspect-first recovery evidence after dry-run
  and apply have already split.
- `push-production-executor-flow-contract.json` proves the full preflight
  through inspect-first recovery flow in one compact object.

The production proof inventory is intentionally redundant across those
contracts so each risk has a dedicated object:

| Risk area | Primary proof |
| --- | --- |
| Auth floor and session minting | `push-production-auth-session-journal-recovery-inspect-contract.json` |
| Remote snapshot hash listing | `push-production-executor-flow-contract.json` |
| Dry-run plan upload | `push-production-executor-flow-contract.json` |
| Batched apply revalidation | `push-production-auth-session-journal-recovery-inspect-contract.json` |
| Journal rows and lease fencing | `push-production-journal-lease-recovery-inspect-contract.json` |
| Recovery inspect | `push-production-journal-lease-recovery-inspect-contract.json` |
| Docker and Playground topology | `push-production-topology-contract.json` |

The same proof set also defines the pull-to-push bridge in production terms:

- exporter/importer create the immutable pull base package before any push
  request exists
- `push_preflight` is the first live bind after importer persistence
- `push_snapshot_hashes` stays planning-only and only lists remote hashes
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
  a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` must happen before any mutating repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe with the same auth floor as the write path

The extension is the composition of those stages, not a shortcut around them:

- exporter/importer create the immutable pull base package
- `push_preflight` is the first live bind after importer persistence
- `push_snapshot_hashes` is planning-only remote hash listing
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
  lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The same handoff can be read as a pull-stage to push-stage map:

| Pull stage | Push stage | Why it stays separate |
| --- | --- | --- |
| Exporter merge-base and coverage scan | `push_preflight` | The first live bind after importer persistence. |
| Importer persisted base package | `push_snapshot_hashes` | Planning-only remote comparison evidence. |
| Immutable pull provenance | `push_plan_dry_run` | Canonical plan upload with an eligibility receipt, not a lock. |
| Persisted pull base package plus live drift evidence | `push_batch_apply` | Fresh live revalidation before every batch and at the storage boundary. |
| Durable pull provenance | `push_journal` | Read-only evidence for later recovery. |
| Immutable provenance plus fresh live hashes | `push_recover inspect` | Read-only classification before any mutation. |
| Importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutating recovery only after inspect and auth-floor checks pass. |

The pull-to-push bridge is therefore a strict provenance chain:

- exporter discovers the merge base and coverage evidence
- importer persists the immutable base package
- `persisted_pull_base_package` is the only object push may consume as origin
- `push_preflight` binds that origin to one live remote identity and one short-lived session
- `push_snapshot_hashes` lists remote hashes for planning only
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the branch safe with the same auth floor as the write path

The production topology is fixed to the same four roles in both Docker and
Playground:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns preflight, snapshot listing, dry-run,
  apply, journal inspect, and recovery

That mapping preserves the pull pipeline boundaries instead of collapsing them
into one mutable push session:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object push consumes
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` lists remote snapshot hashes for planning only
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The seven protocol surfaces are the ones the executor must treat as distinct
remote boundaries:

| Surface | Contract |
| --- | --- |
| `push_preflight` | Bind the immutable pull base package to one live remote identity and one short-lived push session. |
| `push_snapshot_hashes` | List remote snapshot hashes for planning only and never become write authority. |
| `push_plan_dry_run` | Upload the canonical dry-run plan and return an eligibility receipt, not a lock. |
| `push_batch_apply` | Revalidate fresh live evidence before every batch and again at the storage boundary. |
| `push_journal` | Record durable evidence without authorizing mutation. |
| `push_recover inspect` | Read the journal and fresh live hashes before any mutating repair. |
| `push_recover auto|finish|rollback` | Mutate only after inspect proves the branch safe with the same auth floor as the write path. |

The remote liveness boundary is part of the ladder, not an implementation
detail:

| Step | What it proves |
| --- | --- |
| `push_preflight` | Binds the persisted pull base package to one live remote identity and one short-lived push session. |
| `push_snapshot_hashes` | Lists the live remote comparison surface for planning only. |
| `push_plan_dry_run` | Uploads the canonical plan and returns an eligibility receipt, not a lock. |
| `push_batch_apply` | Revalidates fresh live evidence before every batch and again at the storage boundary. |
| `push_journal` | Records durable evidence without authorizing mutation. |
| `push_recover inspect` | Reads the journal and fresh live hashes before any mutating repair. |
| `push_recover auto|finish|rollback` | Mutates only after inspect proves the branch safe with the same auth floor as the write path. |

The liveness split is strict:

- `push_plan_dry_run` is only a receipt for a canonical plan upload and never
  becomes a lock.
- `push_batch_apply` must revalidate live evidence again at apply time, so a
  stale dry-run receipt cannot authorize mutation.
- `push_journal` is inspectable evidence, not write authority.
- `push_recover inspect` is read-only, must happen first, and classifies
  finish, rollback, retry, or block before any mutating repair.

The production executor checklist is the same in every harness:

1. preflight binds the persisted pull base package to one live remote identity
   and one short-lived push session.
2. remote snapshot hash listing stays planning-only and never becomes write
   authority.
3. dry-run uploads the canonical plan and returns an eligibility receipt, not
   a lock.
4. apply revalidates fresh live evidence before every batch and again at the
   storage boundary.
5. journal inspect stays read-only.
6. recovery inspect happens before any mutating repair.
7. recovery mutate runs only when inspect proves the branch safe and the same
   auth floor still holds.

The production topology stays fixed across Docker and Playground:

- one remote source site, `remote-base`
- one imported local edit site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner, `runner`, that owns the push protocol calls
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The topology proof is the same in both harnesses:

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

The production topology is the same one-remote, one-local, one-drift harness
in both environments:

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

## Canonical Production Extension

The production push extension is the same in Docker and Playground and keeps
the pull/export/import pipeline as the only source of immutable provenance:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `push_preflight` binds that persisted base package to one live remote
   identity and one short-lived push session.
4. `push_snapshot_hashes` lists remote hashes for planning only.
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
7. `push_journal` records durable evidence without authorizing mutation.
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe and the auth floor still holds.

That extension keeps the remote liveness split explicit:

- dry-run and apply are separate remote operations
- apply must revalidate the live remote before every batch and at the storage
  boundary
- remote snapshot hash listing is planning evidence, not write authority
- journal inspection is read-only and never authorizes mutation by itself
- recovery must begin with inspect before any mutating repair
- authentication must be at least as strict as current Reprint HMAC usage

The same production proof bundle is reviewed in a fixed order:

1. `push-protocol-extension-contract.json` for the full ladder, pull bridge,
   auth floor, and one-remote-one-local-one-drift topology.
2. `push-production-topology-contract.json` for the Docker and Playground
   topology and ingress rules.
3. `push-production-pull-bridge-contract.json` for the immutable
   exporter/importer handoff.
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

## Canonical Proof Set

The production push extension is reviewed in a fixed order so the protocol,
executor, and fixture suite stay aligned:

1. `push-protocol-extension-contract.json` is the top-level production
   ladder.
2. `push-production-pull-bridge-contract.json` is the immutable
   exporter/importer bridge into push.
3. `push-remote-snapshot-listing-contract.json` is planning-only remote hash
   listing.
4. `push-production-revalidation-contract.json` is the dry-run/apply liveness
   split.
5. `push-production-auth-session-journal-recovery-inspect-contract.json` is
   the auth/session/journal/recovery-inspect floor plus the apply-time
   revalidation boundary.
6. `push-production-recovery-inspect-contract.json` is the inspect-first
   recovery branch.
7. `push-production-executor-flow-contract.json` is the compact end-to-end
   flow for the one-remote, one-local, one-drift topology.

That proof set keeps the ladder readable:

- exporter/importer create the immutable pull base package
- `push_preflight` binds that package to one live remote identity and one
  short-lived push session
- `push_snapshot_hashes` stays planning-only
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary, separate from dry-run
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

## Pull Bridge

The pull/export/import pipeline is the immutable source of push provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object push consumes
- `push_preflight` is the first live bind after the importer persists that
  handoff
- `push_snapshot_hashes` is planning-only comparison evidence, not write
  authority
- `push_plan_dry_run` is an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The mapping from pull exporter/importer to push surfaces is explicit and
one-way:

| Pull stage | Push surface | Why it stays separate |
| --- | --- | --- |
| Exporter merge-base and coverage scan | `push_preflight` | The first live bind after importer persistence. |
| Importer persisted base package | `push_snapshot_hashes` | Planning-only comparison evidence. |
| Immutable pull provenance | `push_plan_dry_run` | Canonical plan upload with an eligibility receipt, not a lock. |
| Persisted pull base plus live drift evidence | `push_batch_apply` | Fresh live revalidation before every batch and at the storage boundary. |
| Durable pull provenance | `push_journal` | Read-only evidence for later recovery. |
| Immutable provenance plus fresh live hashes | `push_recover inspect` | Read-only classification before any mutation. |
| Importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutating recovery only after inspect and auth-floor checks pass. |

The pull-to-push bridge is the executor contract boundary, not just a note in
the docs:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object push consumes
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only and may page, but never
  becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe with the same auth floor as the write path

Recovery is inspect-first by design:

- `push_journal` is never a write gate
- `push_recover inspect` reads the journal, claim, lease, and live-hash
  evidence before deciding whether the branch is safe
- `push_recover auto|finish|rollback` is only available when inspect sees a
  safe branch and the current remote still matches the live proof
- live drift between dry-run and apply is expected, so apply-time revalidation
  is mandatory and separate from dry-run

The review order is fixed when you need the production proof bundle:

1. `push-protocol-extension-contract.json` for the full ladder, pull bridge,
   auth floor, and one-remote-one-local-one-drift topology.
2. `push-deployment-topology-contract.json` for the Docker and Playground
   harness with the sandbox-provided `8080` ingress.
3. `push-production-topology-contract.json` for the production harness and
   immutable pull bridge together.
4. `push-production-auth-session-journal-recovery-inspect-contract.json` for
   the auth/session/journal/lease/recovery-inspect floor plus the apply-time
   revalidation boundary.
5. `push-production-executor-flow-contract.json` for the compact route order
   from preflight through inspect-first recovery.

The auth floor does not weaken the existing Reprint HMAC model:

- preflight authenticates and mints, but never grants mutation authority
- remote snapshot hash listing is planning-only and never write authority
- dry-run is a receipt for a canonical plan, not a write lock
- apply is a separate remote operation and revalidates fresh live evidence
  before every batch and again at the storage boundary
- journal inspect is read-only and never authorizes mutation
- recovery inspect is read-only and happens before any mutating repair
- apply uses the short-lived push session plus idempotency and revalidation
- journal inspect is read-only
- recovery is inspect-first and keeps the same auth floor as the write path

The bridge also maps to the persisted pull package that the importer stores:

| Pull artifact | Push use |
| --- | --- |
| merge-base and coverage evidence from the exporter | `push_preflight` binds the imported package to the live remote identity. |
| persisted pull base package from the importer | `push_snapshot_hashes` reads planning-only live comparison evidence. |
| immutable pull provenance | `push_plan_dry_run` uploads the canonical plan as an eligibility receipt. |
| persisted pull base package plus live drift evidence | `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary. |
| durable pull provenance | `push_journal` records read-only evidence for recovery. |
| immutable provenance plus fresh live hashes | `push_recover inspect` classifies finish, rollback, retry, or block before any mutating repair. |
| importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` mutates only when the inspect branch and auth floor still agree. |

This is the exact bridge into the executor runbook:

- exporter/importer create the immutable handoff object once
- `push_preflight` consumes that persisted handoff and binds it to the live
  remote identity
- `push_snapshot_hashes` only surfaces comparison evidence for planning
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
  lock
- `push_batch_apply` revalidates before every batch and at the storage
  boundary
- `push_journal` preserves recovery evidence
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` can only mutate after inspect proves
  the branch safe

## Auth Floor

Authentication stays at least as strict as current Reprint HMAC usage:

- preflight requires an HMAC-authenticated request, a canonical push
  signature, and a short-lived push session mint
- dry-run uses the same HMAC-authenticated identity proof but never grants
  mutation authority
- apply requires the short-lived push session, the canonical push signature,
  and an idempotency key, then revalidates fresh live evidence before every
  batch and at the storage boundary
- journal inspect is read-only and never authorizes mutation by itself
- recovery stays inspect-first and may mutate only when the journal row and
  fresh live hashes still prove the branch safe

The auth boundary is the same one the current Reprint HMAC flow already uses
or exceeds:

- `push_preflight` authenticates the request and mints a short-lived push
  session
- `push_snapshot_hashes` uses the same authenticated identity but remains
  planning-only
- `push_plan_dry_run` uploads the canonical plan without granting mutation
- `push_batch_apply` revalidates live evidence before every batch and at the
  storage boundary
- `push_journal` stays read-only
- `push_recover inspect` stays read-only
- `push_recover auto|finish|rollback` requires the same auth floor plus the
  live recovery proof

The bridge is also easiest to review as a source-to-sink mapping:

- exporter produces the immutable pull provenance
- importer persists that provenance as `persisted_pull_base_package`
- `push_preflight` binds that package to one live remote identity and one
  short-lived push session
- `push_snapshot_hashes` lists the live remote comparison surface for
  planning only
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` may mutate only after inspect proves
  the branch safe with the same auth floor as the write path

Authentication is intentionally conservative:

- push auth must be at least as strict as current Reprint HMAC usage
- preflight mints a short-lived session but does not grant mutation authority
- dry-run is a receipt, not a lock
- apply must revalidate fresh live evidence after dry-run and before every
  storage boundary commit
- journal inspect is read-only and never authorizes mutation by itself
- mutating recovery is fenced by fresh live hashes and the journal row claim
  and lease evidence

## Test Topology

The canonical test topology is one remote source, one imported local edit
site, and one later drift observation of the same remote identity:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

The same routes are used in both Docker and Playground:

| Stage | Route name |
| --- | --- |
| Preflight | `preflight` |
| Remote snapshot hash listing | `snapshot-hashes` |
| Dry-run plan upload | `dry-run` |
| Mutation batch apply | `apply` |
| Journal inspect | `journal` |
| Recovery inspect | `recovery-inspect` |
| Recovery mutate | `recovery-mutate` |

- remote tunnels are disallowed

The topology proof is intentionally the same one-remote, one-local, one-drift
shape in both environments:

| Role | Identity | Meaning |
| --- | --- | --- |
| Remote source | `remote-base` | Seeds the persisted pull base package. |
| Local edit site | `local-edited` | Carries the imported local edits. |
| Drift witness | `remote-changed` | Reuses the same remote identity after drift. |
| Runner | `runner` | Owns preflight, hash listing, dry-run, apply, journal inspect, and recovery. |

Docker and Playground differ only in harness mechanics:

- Docker uses one private network.
- Playground uses separate disposable blueprints.
- both harnesses use the same route names for preflight, snapshot hashes,
  dry-run, apply, journal, recovery inspect, and recovery mutate
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- both harnesses forbid remote tunnels

The shared route matrix is:

| Stage | Route |
| --- | --- |
| Preflight | `preflight` |
| Remote snapshot hash listing | `snapshot-hashes` |
| Dry-run plan upload | `dry-run` |
| Mutation batch apply | `apply` |
| Journal inspect | `journal` |
| Recovery inspect | `recovery-inspect` |
| Recovery mutate | `recovery-mutate` |

The most useful review order is:

1. `push-protocol-extension-contract.json` for the full ladder, pull bridge,
   auth floor, and topology.
2. `push-production-topology-contract.json` for the Docker and Playground
   harness proof.
3. `push-production-pull-bridge-contract.json` for the importer-owned base
   package bridge.
4. `push-production-revalidation-contract.json` for the dry-run/apply split.
5. `push-production-auth-session-journal-recovery-inspect-contract.json` for
   the auth/session/journal/lease/recovery-inspect floor.
6. `push-production-executor-flow-contract.json` for the compact end-to-end
   production flow.

The machine-readable proof bundle is layered around that same ladder:

- `push-protocol-extension-contract.json` is the top-level production ladder
  proof
- `push-protocol-extension-topology-contract.json` is the compact umbrella
  proof that keeps the full ladder aligned with the one-remote, one-local,
  one-drift Docker and Playground topology
- `push-production-pull-bridge-contract.json` proves the immutable
  exporter/importer handoff into the push path
- `push-remote-snapshot-listing-contract.json` proves planning-only remote
  hash listing
- `push-production-revalidation-contract.json` proves dry-run separation and
  apply-time revalidation
- `push-production-auth-session-journal-recovery-inspect-contract.json` proves
  the auth/session/journal/recovery floor
- `push-production-push-recovery-contract.json` proves the full preflight
  through mutating recovery ladder
- `push-production-executor-flow-contract.json` proves the complete
  production executor flow in one object, from pull provenance through
  preflight, planning hashes, dry-run receipt, batched apply, journal
  inspect, and inspect-first recovery
- `push-production-recovery-inspect-contract.json` proves inspect-first
  recovery stays aligned with the journal row, lease fence, and fresh live
  hashes
- `push-production-recovery-drift-contract.json` proves inspect-first
  recovery after live drift while the pull provenance, auth floor, and
  one-remote, one-local topology still line up for a safe mutating branch
- `push-remote-liveness-topology-contract.json` proves the one-remote,
  one-local, one-drift harness plus the liveness split
- `push-production-topology-contract.json` proves the Docker and Playground
  harness shape
- `push-topology-matrix.json` proves the exact stage order and route matrix
  for Docker and Playground

The existing pull/export/import pipeline maps to the push ladder without
changing the auth floor or the liveness split:

| Pull stage | Push stage | Contracted behavior |
| --- | --- | --- |
| exporter discovers merge base and coverage evidence | `push_preflight` | Binds the persisted pull base package to one live remote identity and one short-lived push session. |
| importer persists the base package as immutable provenance | `push_snapshot_hashes` | Lists live remote comparison evidence for planning only. |
| persisted pull base package | `push_plan_dry_run` | Uploads the canonical plan as an eligibility receipt, not a lock. |
| immutable pull provenance | `push_batch_apply` | Revalidates fresh live evidence before every batch and again at the storage boundary. |
| durable pull provenance | `push_journal` | Records durable evidence without authorizing mutation. |
| immutable provenance plus fresh live hashes | `push_recover inspect` | Reads the journal and fresh live hashes before any mutating repair. |
| importer-owned provenance plus live drift evidence | `push_recover auto|finish|rollback` | Mutates only after inspect proves the branch safe with the same auth floor as the write path. |

The production topology proof is fixed to one remote source site, one imported
local edit site, one later drift observation of the same remote identity, and
one runner:

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

## Canonical Production Contract

The production push ladder is fixed and should be read in this order:

1. Exporter/importer create and persist the immutable pull base package.
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

The pull/export/import pipeline maps to the push ladder one step at a time:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object push consumes
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

Read as a route-by-route production ladder, the same bridge is:

- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` lists the live remote comparison surface for
  planning only and never becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at
  the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

That bridge is the production mapping the executor consumes:

- one exported merge base becomes one persisted pull base package
- one persisted pull base package becomes one live remote binding in preflight
- one live remote binding becomes one planning-only hash listing surface
- one planning-only hash listing becomes one dry-run receipt
- one dry-run receipt becomes one batched apply path with fresh live
  revalidation
- one apply path becomes one durable journal row set
- one durable journal row set becomes one read-only recovery inspect step
- one recovery inspect step becomes one mutating repair only if fresh live
  evidence and the auth floor still agree

The machine-readable umbrella contract is `push-protocol-extension-contract.json`:

- it captures the full production stage ladder in one object
- it binds the persisted pull base package to a live remote identity before
  any mutating stage
- it keeps dry-run and apply separate while apply revalidates fresh live
  evidence before every batch and at the storage boundary
- it requires journal inspect to stay read-only and recovery to start with
  inspect before any mutating repair
- it carries the one-remote, one-local, one-drift topology for Docker and
  Playground

Authentication is deliberately conservative:

- push auth must be at least as strict as current Reprint HMAC usage
- preflight mints a short-lived session but does not grant mutation authority
- dry-run is a receipt, not a lock
- apply must revalidate fresh live evidence after dry-run and before every
  storage boundary commit
- journal inspect is read-only and never authorizes mutation by itself
- mutating recovery is still fenced by fresh live hashes and the journal row
  claim/lease evidence

The canonical topology proof is always one remote source, one imported local
edit site, and one later drift observation of the same remote identity:

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

Docker and Playground prove the same three-site story with different harness
shapes:

- Docker uses one private network and the runner talks to the three sites by
  route name
- Playground uses separate disposable blueprints for the same three site
  identities
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- remote tunnels are disallowed in both harnesses

The production proof bundle is intentionally layered around that contract:

- `push-protocol-extension-contract.json` is the umbrella ladder proof
- `push-production-pull-bridge-contract.json` is the immutable pull-to-push
  bridge proof
- `push-production-executor-flow-contract.json` is the compact end-to-end
  executor proof that combines the pull handoff, preflight, planning-only
  hash listing, dry-run receipt, batched apply, journal inspect, and
  inspect-first recovery
- `push-remote-snapshot-listing-contract.json` proves planning-only remote
  hash listing
- `push-production-revalidation-contract.json` proves dry-run separation and
  apply-time revalidation
- `push-production-auth-session-journal-recovery-inspect-contract.json` proves
  the auth/session/journal/recovery floor
- `push-production-push-recovery-contract.json` proves the full preflight
  through mutating recovery ladder while keeping the pull bridge, dry-run/apply
  split, and inspect-first recovery boundary aligned
- `push-production-recovery-inspect-contract.json` proves inspect-first
  recovery stays aligned with the journal row, lease fence, and fresh live
  hashes
- `push-remote-liveness-topology-contract.json` proves the one-remote,
  one-local, one-drift harness plus the liveness split
- `push-production-topology-contract.json` proves the Docker and Playground
  harness shape for the same one-remote, one-local, one-drift topology
- `push-topology-matrix.json` is the compact machine-readable topology map
  for the same one-remote, one-local, one-drift harness and shared route
  names

The production push extension is the same ladder the fixtures prove:

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
8. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe.

Read as one production contract, the push ladder is:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object
- `push_preflight` binds that handoff to one live remote identity and one
  short-lived push session
- `push_snapshot_hashes` lists the live remote comparison surface for
  planning only
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary, separate from dry-run
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair
- `push_recover auto|finish|rollback` mutates only after inspect proves the
  branch safe with the same auth floor as the write path

In implementation terms, the push executor is a strict request ladder over a
single persisted pull base package:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `persisted_pull_base_package` becomes the only pull-derived object push may
   consume.
4. `push_preflight` binds that immutable package to one live remote identity
   and one short-lived push session.
5. `push_snapshot_hashes` lists live remote hashes for planning only.
6. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
7. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
8. `push_journal` records durable evidence and never authorizes mutation.
9. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
10. `push_recover auto|finish|rollback` mutates only after inspect proves the
    branch safe with the same auth floor as the write path.

That ladder is one-way:

- pull exporter/importer remain the only source of immutable push provenance
- dry-run and apply are separate remote operations
- remote snapshot hash listing is planning evidence only
- journal inspect is read-only
- mutating recovery keeps the same auth floor as the write path
- push auth must be at least as strict as current Reprint HMAC usage

The read-only and mutating branches are deliberately separated:

- preflight authenticates a push-scoped session but does not authorize
  mutation
- snapshot hash listing is planning evidence only and may page large sites
- dry-run uploads the canonical plan, but the receipt is never a lock
- apply must revalidate the live remote before every batch and at the storage
  boundary
- journal inspect reads durable evidence and classifies ambiguity, but never
  grants write authority
- mutating recovery requires inspect first and uses the same auth floor as
  the write path

The canonical test topology is also fixed:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner that owns preflight, hash listing, dry-run, apply, journal
  inspect, and recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The topology proof is carried by the production fixture set:

- `push-production-pull-bridge-contract.json` proves the immutable
  exporter/importer handoff into the persisted pull base package
- `push-remote-snapshot-listing-contract.json` proves planning-only remote
  hash listing
- `push-production-revalidation-contract.json` proves dry-run and apply stay
  separate and that apply revalidates fresh live evidence before every batch
  and at the storage boundary
- `push-production-auth-session-journal-recovery-inspect-contract.json`
  proves the auth, session, journal, and inspect-first recovery floor
- `push-remote-liveness-topology-contract.json` proves the one-remote,
  one-local, one-drift harness plus the liveness split
- `push-production-topology-contract.json` proves the Docker and Playground
  harness shape

The pull-to-push handoff is the same contract expressed as machine-readable
artifacts:

- exporter/importer produce immutable provenance
- `push-pull-mapping.json` maps that provenance into preflight, snapshot
  listing, dry-run, batched apply, journal inspect, and inspect-first
  recovery
- `push-protocol-extension-contract.json` ties the bridge, auth floor,
  revalidation, recovery fence, and topology proof into the umbrella bundle

The canonical production proof bundle is reviewed in this order:

1. `push-production-pull-bridge-contract.json` for the immutable pull-to-push bridge.
2. `push-remote-snapshot-listing-contract.json` for planning-only remote hash listing.
3. `push-production-revalidation-contract.json` for dry-run separation and apply-time revalidation.
4. `push-production-auth-session-journal-recovery-inspect-contract.json` for the auth/session/journal/recovery boundary.
5. `push-production-push-recovery-contract.json` for the full preflight-through-recovery ladder.
6. `push-remote-liveness-topology-contract.json` for the one-remote, one-local, one-drift topology.
7. `push-production-topology-contract.json` for the Docker and Playground harness proof.

The machine-readable bridge is carried by the same pull/import artifacts the
executor already trusts:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable object the push executor consumes after importer persistence
- `push-pull-mapping.json` is the compact contract that maps that immutable pull provenance into preflight, snapshot listing, dry-run, batched apply, journal inspect, and inspect-first recovery
- `push-protocol-extension-contract.json` is the umbrella contract that ties the pull bridge, auth floor, apply revalidation, and topology proof into one production ladder

The pull/import pipeline maps to the push ladder in the same order the executor runs it:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `persisted_pull_base_package` becomes the immutable push input.
4. `push_preflight` is the first live binding after importer persistence.
5. `push_snapshot_hashes` lists the remote comparison surface for planning only.
6. `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt, not a lock.
7. `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary.
8. `push_journal` records durable evidence but never authorizes mutation.
9. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
10. `push_recover auto|finish|rollback` mutates only after inspect proves the branch safe with the same auth floor as the write path.

## Production Contract

The push executor may mutate only after it proves a safe three-way plan from
the persisted pull base package, the edited local site, and the live remote
site. The persisted pull base package is immutable provenance from the pull
pipeline, not a mutable snapshot cache.

The production ladder is fixed:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity, one requested scope, and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority. It may page through
   large sites, but it never becomes a lock, a lease, or apply authority.
   This is the remote snapshot hash listing stage, and it stays read-only.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock. The receipt proves planning eligibility
   only and cannot be reused as write authority.
4. `push_batch_apply` is the first mutation stage. It must revalidate fresh
   live evidence before every batch and again at the storage boundary. Dry-run
   and apply are separate remote operations, and apply must not trust the
   dry-run receipt as a lock, a lease, or a substitute for fresh live
   evidence. Apply-time revalidation is mandatory.
5. `push_journal` records durable evidence and never authorizes a write.
6. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair. Inspect is read-only and does not authorize mutation.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the action safe with fresh live evidence and the same auth floor as the
   write path.

The pull-to-push handoff is explicit in the machine-readable proof:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable object the push executor
  consumes after importer persistence
- preflight is the first live binding after that immutable handoff and the
  first place the pull provenance is tied to a live remote identity
- `push_snapshot_hashes` stays planning-only and never becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` is a separate remote operation that revalidates fresh
  live evidence before every batch and at the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair

The production proof bundle is the same one used to review the real push
extension:

- `push-production-pull-bridge-contract.json` proves the immutable pull-to-push bridge.
- `push-production-ladder-contract.json` proves the compact stage order from preflight through inspect-first recovery.
- `push-remote-snapshot-listing-contract.json` proves planning-only remote hash listing.
- `push-production-revalidation-contract.json` proves dry-run separation and apply-time revalidation.
- `push-production-auth-session-journal-recovery-inspect-contract.json` proves the auth/session/journal/recovery floor.
- `push-production-push-recovery-contract.json` proves the full push ladder from preflight through mutating recovery.
- `push-production-recovery-inspect-contract.json` proves the inspect-first recovery branch stays aligned with the journal row, lease fence, and fresh live hashes.
- `push-production-recovery-drift-contract.json` proves inspect-first recovery after live drift while the pull provenance, auth floor, and one-remote, one-local topology still line up for a safe mutating branch.
- `push-remote-liveness-topology-contract.json` proves the one-remote, one-local, one-drift harness plus the liveness split.
- `push-production-topology-contract.json` proves the Docker and Playground harness shape.
- `push-topology-matrix.json` is the compact machine-readable topology map for the same one-remote, one-local, one-drift harness and shared route names.

That review order is the production proof stack:

1. `push-production-ladder-contract.json` for the compact stage order from preflight through inspect-first recovery.
2. `push-production-pull-bridge-contract.json` for immutable provenance handoff.
3. `push-remote-snapshot-listing-contract.json` for planning-only live hash discovery.
4. `push-production-revalidation-contract.json` for dry-run separation and apply-time revalidation.
5. `push-production-auth-session-journal-recovery-inspect-contract.json` for the auth floor and inspect-first boundary.
6. `push-production-push-recovery-contract.json` for the full push ladder from preflight through mutating recovery.
7. `push-production-recovery-inspect-contract.json` for the inspect-first recovery branch and its journal-row, lease-fence, and fresh-live proof.
8. `push-production-recovery-drift-contract.json` for the production-shaped recovery-after-drift proof.
9. `push-remote-liveness-topology-contract.json` for the dry-run/apply split under live drift.
10. `push-production-topology-contract.json` for the one-remote, one-local, one-drift harness proof.

The stage contract is intentionally simple:

| Stage | What it does | What it does not do |
| --- | --- | --- |
| `push_preflight` | Binds the imported pull base package to one live remote identity and one short-lived push session. | It does not authorize mutation. |
| `push_snapshot_hashes` | Lists the live remote comparison surface for planning. | It does not become write authority or a lock. |
| `push_plan_dry_run` | Uploads the canonical dry-run plan and returns an eligibility receipt. | It does not authorize apply. |
| `push_batch_apply` | Applies the mutation plan in batches after fresh live revalidation. | It does not reuse the dry-run receipt as a lock. |
| `push_journal` | Records durable evidence for inspect and recovery. | It does not authorize mutation. |
| `push_recover inspect` | Reads the journal and fresh live hashes before any repair. | It does not mutate. |
| `push_recover auto|finish|rollback` | Mutates only when inspect proves the branch safe. | It does not skip inspect or lower the auth floor. |

The auth floor is never relaxed for push:

- push authentication must be at least as strict as current Reprint HMAC
  usage
- dry-run, apply, journal inspect, and recovery all stay under that floor
- stronger session material is allowed only when it does not weaken the write
  path or the inspect-first recovery path

The recovery fence is the durable journal-side guard that keeps stale work out
of mutation:

- journal rows carry the claim owner, claim generation, lease expiry, and the
  recovery fence that inspect must re-read before any mutating repair
- inspect is read-only and must confirm fresh live hashes before finish,
  rollback, or auto can mutate anything
- if the fence and fresh live hashes do not line up, the branch blocks rather
  than downgrading the auth floor

The pull/export/import pipeline is the only source of immutable push
provenance, and push consumes that provenance as immutable input:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` performs the remote snapshot hash listing for
  planning only and may page large sites, but it never becomes write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` is a separate remote operation that revalidates fresh
  live evidence before every batch and again at the storage boundary
- `push_journal` is durable evidence only and never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch

The pull pipeline maps to push like this:

| Pull artifact | Push use |
| --- | --- |
| Merge base discovery | `push_preflight` binds the persisted pull base package to one live remote identity and one short-lived push session. |
| Coverage evidence | `push_snapshot_hashes` lists live remote hashes for planning only. |
| Persisted base package | `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt, not a lock. |
| Persisted provenance checksum | `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary. |
| Durable pull provenance | `push_journal` records evidence without authorizing mutation. |
| Imported pull base package | `push_recover inspect` reads the journal and fresh live hashes before any mutating repair. |

The pull pipeline is therefore the only source of immutable push provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable handoff object push consumes
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only
- `push_plan_dry_run` is an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary
- `push_journal` is read-only durable evidence
- `push_recover inspect` is read-only and must happen before any mutating repair
- `push_recover auto|finish|rollback` mutates only when inspect proves the
  branch safe and the auth floor still holds

The same pull-to-push bridge is exercised in Docker and Playground:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` binds that persisted package to one live remote identity
  and one short-lived push session
- `push_snapshot_hashes` stays planning-only and never becomes write
  authority
- `push_plan_dry_run` uploads the canonical dry-run plan and returns a
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` stays read-only
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair

The pull/export/import pipeline maps to the push ladder in the same order the
executor runs it:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `persisted_pull_base_package` becomes the push input and stays immutable.
4. `push_preflight` performs the first live binding to one remote identity
   and one short-lived session.
5. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only.
6. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
   a lock.
7. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
8. `push_journal` records durable evidence but never authorizes mutation.
9. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating branch.
10. `push_recover auto|finish|rollback` may mutate only after inspect proves
    the branch safe with the same auth floor as the write path.

The topology proof is fixed and intentionally small:

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

The one-remote, one-local, one-drift harness is the same in Docker and
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

The pull pipeline stays authoritative and push only consumes its immutable
output:

| Pull pipeline artifact | Push use | Boundary rule |
| --- | --- | --- |
| Merge base discovery | `push_preflight` | First live binding after importer persistence. |
| Coverage evidence | `push_snapshot_hashes` | Planning evidence only. |
| Persisted base package | `push_plan_dry_run` | Canonical plan upload, not a lock. |
| Persisted provenance checksum | `push_batch_apply` | Fresh live revalidation before every batch and at storage boundary. |
| Immutable importer record | `push_journal` | Durable evidence only. |
| Replayable lineage evidence | `push_recover inspect` | Read-only inspection before any mutating repair. |
| Pull-derived provenance | `push_recover auto|finish|rollback` | Mutate only after inspect proves the branch safe. |

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

In Docker, the topology is a single private network with three site roles and
one runner:

- `remote-base` is the source WordPress site that seeds the persisted pull
  base package.
- `local-edited` is the imported local site that carries candidate edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover.

In Playground, the same roles run as separate disposable blueprints:

- the remote source blueprint exports the base package
- the local blueprint holds the imported edit state
- the later remote blueprint reuses the same remote identity to expose drift
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels remain disallowed
- the same one-remote, one-local, one-drift shape is used in both Docker and
  Playground when validating dry-run/apply separation and inspect-first
  recovery
- `push_recover auto|finish|rollback` may mutate only after inspect proves
  the branch safe with the same auth floor as the write path

The test topology is fixed across both Docker and Playground:

- `remote-base` is the source site at pull time and seeds the persisted pull
  base package
- `local-edited` is the imported local edit site that carries the candidate
  changes
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or recover
- Docker uses one private network for those four roles
- Playground uses separate disposable blueprints with the same role split
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The compact auth/session proof is `push-production-auth-session-journal-recovery-inspect-contract.json`:

- it binds the persisted pull base package to one short-lived push session and the same remote identity
- it keeps the auth floor at least as strict as current Reprint HMAC usage
- it records claim generation, lease expiry, and the storage fence in the journal row
- it keeps recovery inspect read-only and classification-only before any mutating repair

Put differently, the exporter/importer handoff stays authoritative for the
base package, and push only consumes that immutable package in the order
above:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. `push_preflight` is the first live binding after importer persistence
4. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary
7. `push_journal` records durable evidence without authorizing mutation
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe with the same auth floor as the write path

The persisted pull base package is the concrete provenance object that push
consumes:

- `base_manifest_id` identifies the imported pull base package
- `base_manifest_hash` pins the immutable manifest content
- `base_coverage_hash` pins the coverage evidence that supported import
- `remote_site_id` ties that package back to the source remote identity

The write path is deliberately one-way:

- pull discovers and persists the immutable base package
- push consumes that persisted package and never turns it back into a mutable
  snapshot cache
- preflight is the first live binding after importer persistence
- snapshot hash listing is read-only planning evidence
- dry-run is an eligibility receipt, not write authority
- apply is a separate remote operation that must revalidate fresh live
  evidence before every batch and again at the storage boundary
- journal inspect is read-only evidence gathering
- recovery starts with inspect before any mutating repair

The recovery proof chain is also one-way:

- journal rows carry claim ownership, generation, lease expiry, and the
  recovery fence that prevents stale reuse
- inspect reads the journal row, the recovery fence, and fresh live hashes
  before any repair
- finish, rollback, retry, and block are the only recovery classifications
- mutating recovery may proceed only when the journal row, recovery fence,
  and fresh live hashes prove the branch safe
- stale dry-run evidence never becomes recovery authority

The inspect-first recovery path is intentionally stricter than planning:

- recovery inspect is read-only and never substitutes for a push session
- journal rows must prove the claim owner, claim generation, and lease
  expiry before any mutating branch starts
- the recovery fence must still match the same remote identity and the same
  persisted pull base package
- finish, rollback, retry, and block are the only allowed recovery outcomes
- mutating recovery must still recheck fresh live hashes after inspect and
  before any repair writes

For implementation and review, the bridge should be read in the same order as
the production executor:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `push_preflight` binds that persisted package to one live remote identity.
4. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and may page through the live comparison surface.
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
7. `push_journal` stays read-only.
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe with the same auth floor as the write path.

The ladder maps directly to the pull pipeline:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only and may page large sites,
  but it never becomes write authority
- dry-run is an eligibility receipt, not a lock, and never authorizes apply
- batch apply is a separate remote operation that revalidates before every
  batch and again at the storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when journal evidence and
  fresh live hashes still prove the branch safe

That bridge is one-way:

- exporter/importer provenance is the immutable base that push consumes
- push never turns the persisted pull base package back into a mutable
  snapshot cache
- preflight binds that persisted package to one live remote identity and one
  short-lived push session
- dry-run and apply remain separate remote operations
- journal inspect is read-only evidence gathering
- recovery starts with inspect before any mutating repair

The canonical production ladder bundle is `push-protocol-extension-contract.json`:

- it binds the immutable pull base package to preflight, remote snapshot hash listing, dry-run plan upload, batched apply, journal inspect, and inspect-first recovery
- it keeps dry-run and apply separate while apply revalidates fresh live evidence before every batch and at the storage boundary
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit
- it is the canonical machine-readable bridge from the exporter/importer pull pipeline into the push write path
- it maps the persisted pull base package into preflight, remote snapshot hash listing, dry-run plan upload, batched apply, journal inspect, and inspect-first recovery
- it preserves the one-way rule that pull provenance is immutable push input, not a mutable snapshot cache
- it is the umbrella contract that pairs with `push-production-topology-contract.json` and `push-remote-liveness-topology-contract.json` so the one remote source, one imported local edit site, and one later drift observation stay explicit in both harnesses

The compact production proofs are split by concern:

- `push-production-pull-bridge-contract.json` proves the immutable exporter/importer handoff into the push ladder
- `push-production-revalidation-contract.json` proves preflight, planning-only snapshot hashes, dry-run eligibility, apply-time revalidation, journal evidence, and inspect-first recovery
- `push-production-auth-session-journal-recovery-inspect-contract.json` proves the auth floor, push session minting, journal rows, lease fencing, and read-only recovery inspect
- `push-production-topology-contract.json` proves the one remote source, one imported local site, and one later drift observation in Docker and Playground
- `push-remote-liveness-topology-contract.json` proves dry-run and apply are separate remote operations on the same topology

The production proof is also split into smaller reviewable fixtures:

- `push-production-pull-bridge-contract.json` proves the exporter/importer handoff becomes immutable push provenance.
- `push-production-revalidation-contract.json` proves preflight, planning-only snapshot hashes, dry-run eligibility, apply-time revalidation, durable journal evidence, and inspect-first recovery stay on separate liveness boundaries.
- `push-production-auth-session-journal-recovery-inspect-contract.json` proves the auth floor, push-session minting, journal rows, lease fencing, and read-only recovery inspect stay aligned with the write path.
- `push-production-topology-contract.json` proves the one-remote, one-local, one-drift harness shape in both Docker and Playground.
- `push-remote-liveness-topology-contract.json` proves dry-run and apply stay separate while apply revalidates fresh live evidence before every batch and at the storage boundary.
- `push-production-topology-contract.json` proves the sandbox-provided `8080` ingress, local-only proxying, and no-tunnel rule for the topology harness.

For review and test planning, the production proof stack is:

1. `push-protocol-extension-contract.json` for the full production ladder.
2. `push-production-pull-bridge-contract.json` for the immutable pull-to-push provenance bridge.
3. `push-remote-liveness-topology-contract.json` for the one-remote, one-local, one-drift topology plus dry-run/apply separation.
4. `push-production-push-recovery-contract.json` for the full preflight-through-recovery ladder.
5. `push-production-topology-contract.json` for the compact topology and provenance bundle.

Those four proofs are the canonical production sequence:

- the protocol extension contract defines the stage order and recovery guards
- the pull bridge contract proves the immutable exporter/importer handoff into push
- the remote liveness topology contract proves dry-run/apply separation on one remote source, one imported local edit site, and one drift witness
- the production topology contract bundles the same topology with the pull provenance and apply-time revalidation proof
The bridge is machine-readable and stage-ordered:

1. `push_preflight` binds the imported pull base package to one live remote identity and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and may page large sites.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an eligibility receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary.
5. `push_journal` records durable evidence without authorizing mutation.
6. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe with the same auth floor as the write path.

The bridge is exactly:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` remains planning-only evidence and never becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any mutating repair
- `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe with the same auth floor as the write path

That bridge is the production contract the tests should exercise:

- one remote source site seeds the persisted pull base package
- one imported local edited site carries the candidate changes
- one later observation of the same remote identity proves live drift handling
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The Docker and Playground topology contract is intentionally one remote, one
local, one drift witness:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns the protocol calls
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The same topology should be exercised in both harnesses:

- Docker uses one private network around `remote-base`, `local-edited`,
  `remote-changed`, and `runner`
- Playground uses separate disposable blueprints with the same role names
- both harnesses keep dry-run and apply separate
- both harnesses require apply-time revalidation against fresh live hashes
- both harnesses keep recovery inspect-first and read-only until the branch is
  proven safe

The operator-facing test shape is therefore one remote source, one imported
local edit site, and one later drift witness of the same remote identity:

- `remote-base` is the remote source site
- `local-edited` is the imported local edited site
- `remote-changed` is the later drift witness for the same remote identity
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The topology proof is the same in both harnesses:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor allowed to preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or run recovery
- Docker and Playground both keep browser-visible inspection on the
  sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed in both harnesses
- `push-deployment-topology-contract.json` proves the topology-only shape
- `push-remote-liveness-topology-contract.json` proves the topology plus the
  dry-run/apply liveness split and apply-time revalidation
- `push-protocol-extension-contract.json` is the umbrella proof that binds the
  topology to the production ladder

For review, the canonical one-remote, one-local test topology is:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery
- the browser-visible path stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- the pull exporter/importer pipeline remains the provenance source for all
  push stages

The same topology is used to prove live drift handling:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits used to build the canonical plan
- `remote-changed` is the same remote identity observed later after drift
- `runner` keeps dry-run and apply separate and revalidates before mutation
- `push_recover inspect` stays read-only before any mutating recovery branch

The same topology is reused in both harnesses:

- `remote-base` is the source site that seeds the persisted pull base package
- `local-edited` is the imported local site carrying candidate edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery
- the browser-facing path stays on the sandbox-provided `8080` ingress through a local-only proxy

For the harness shape, keep the topology pair together:

- `push-deployment-topology-contract.json` is the smallest topology-only
  proof for one remote source site, one imported local edited site, and one
  later drift observation of the same remote identity, with the sandbox-only
  `8080` ingress policy spelled out
- `push-remote-liveness-topology-contract.json` adds the dry-run/apply
  liveness split to the same one-remote, one-local, one-drift harness
  and keeps apply-time revalidation separate from the dry-run receipt

The same topology is mirrored in the fixtures:

- `push-deployment-topology-contract.json` is the smallest Docker and
  Playground topology-only proof, with the sandbox-provided `8080` ingress
  rule, the local-only proxy policy, and the no-tunnel rule spelled out
- `push-remote-liveness-topology-contract.json` combines that topology with
  the dry-run/apply split so liveness stays separate from write authority
- `push-topology-matrix.json` keeps the Docker and Playground stage matrix in
  machine-readable form
- `push-protocol-extension-contract.json` is the most complete production
  bridge because it combines the pull provenance mapping, the push stage
  ladder, the recovery chain, and the one-remote, one-local, one-drift test
  topology in one contract
- `push-executor-topology-proof.json` keeps the pull provenance, push ladder,
  and 8080 topology aligned in one compact production-shaped fixture

The machine-readable bridge is split across the fixtures:

- `push-preflight-contract.json` captures the first live binding between the
  importer-owned base package, the live remote identity, and the short-lived
  push session.
- `push-remote-snapshot-listing-contract.json` and
  `push-snapshot-hashes-page-contract.json` keep the remote hash listing
  cursorable while still treating it as planning-only evidence.
- `push-pull-mapping.json` and `push-pull-to-topology-contract.json` map the
  immutable pull provenance into the push stages without turning it into
  write authority.
- `push-dry-run-apply-revalidation-contract.json` keeps dry-run and apply
  separate while proving the live remote is revalidated before each batch and
  again at the storage boundary.
- `push-journal-inspect-contract.json` and the recovery contracts keep
  journal inspection read-only before any mutating repair.
- `push-auth-session-journal-recovery-contract.json` and
  `push-production-push-recovery-contract.json` bind the auth floor, minted
  push session, journal rows, lease fencing, and inspect-first recovery into
  one production-shaped proof.
- `push-production-ladder-contract.json` captures the same one-remote,
  one-local ladder in a shorter stage-by-stage proof with the pull base,
  session minting, dry-run receipt, apply-time revalidation, journal
  inspection, and inspect-first recovery all pinned together.
- `push-production-recovery-inspect-contract.json` captures the compact
  inspect-first recovery proof with the auth floor, live evidence, lease
  fencing, and `8080` topology in one place.
- `push-production-auth-session-journal-recovery-inspect-contract.json`
  captures the compact production auth/session/journal/lease/recovery-inspect
  proof on the same remote identity and local edit site.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the minimum production proof to cite when you need auth floor, push session
  minting, journal rows, lease fencing, and read-only recovery inspect on the
  same remote identity.
- `push-production-journal-lease-recovery-inspect-contract.json` is the
  narrower production proof for the journal-row and lease-fence boundary when
  you only need inspect-first recovery after dry-run and apply have already
  split.
- `push-recovery-boundary-contract.json` captures the compact inspect-first
  recovery boundary with the auth floor and Docker/Playground topology in one
  place.
- `push-auth-session-journal-recovery-inspect-contract.json` and
  `push-recovery-inspect-contract.json` keep the read-only inspect gate
  explicit before any mutating repair can run.
- `push-topology-matrix.json`, `push-deployment-topology-contract.json`, and
  `push-remote-liveness-topology-contract.json` define the Docker and
  Playground test topology with one remote source, one imported local site,
  one later drift observation of that same remote identity, the
  sandbox-provided `8080` ingress rule, and the local-only proxy policy.
- `push-remote-liveness-topology-contract.json` also proves that dry-run and
  apply are separate remote calls and that apply revalidates fresh live
  evidence before every batch and at the storage boundary.
- `push-protocol-extension-contract.json` is the canonical production ladder
  bundle. It ties the persisted pull base to preflight, remote snapshot hash
  listing, dry-run plan upload, batched apply, journal inspect, and
  inspect-first recovery in one object.
- `push-production-topology-contract.json` is the compact production topology
  proof for the same one-remote, one-local, one-drift harness and keeps the
  full push stage sequence in one compact production object.
- `push-executor-topology-proof.json` is the compact executor proof that ties
  the pull provenance, push ladder, and topology together for the same
  one-remote, one-local, one-drift harness.
- `push-production-revalidation-contract.json` is the compact production proof
  that binds auth, push sessions, journal rows, lease fencing, and inspect-
  first recovery to the same one-remote, one-local topology.
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` are the production-shaped
  proof pair for auth, session minting, journal rows, lease fencing, apply
  revalidation, and inspect-first recovery on the same remote identity.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the compact proof that binds auth floor, push session minting, journal
  rows, lease fencing, and read-only recovery inspect to the same remote
  identity and local edit site.
- `push-protocol-extension-contract.json` is the canonical production ladder
  bundle. It binds the immutable pull base package to preflight, remote
  snapshot hash listing, dry-run plan upload, batched apply, journal inspect,
  and inspect-first recovery on the same one-remote, one-local, one-drift
  topology.

For review and implementation work, the canonical production push chain is:

1. pull exporter/importer create the immutable base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` lists live remote hashes for planning only.
4. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
   a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live evidence before
   any mutating recovery branch.
8. `push_recover auto|finish|rollback` may mutate only when inspect proves
   the branch safe with the same auth floor as the write path.

The wire contract is intentionally split into request classes so the executor
can keep liveness boundaries narrow:

| Request class | Example stage | Mutates | Reuses prior authority |
| --- | --- | --- | --- |
| Preflight binding | `push_preflight` | No | No |
| Remote hash listing | `push_snapshot_hashes` | No | No |
| Dry-run upload | `push_plan_dry_run` | No | No |
| Batched apply | `push_batch_apply` | Yes | No; it revalidates fresh live evidence before each batch and at the storage boundary |
| Journal inspect | `push_journal` | No | No |
| Recovery inspect | `push_recover inspect` | No | No |
| Recovery mutate | `push_recover auto|finish|rollback` | Yes | No; it must pass inspect first and keep the same auth floor as the write path |

Recovery is therefore a two-step loop:

1. Inspect the journal and fresh live hashes.
2. Mutate only if the journal, fence, and live evidence still agree.

The reviewable bridge is the same chain rendered as fixture evidence:

- `push-protocol-extension-contract.json` ties the pull pipeline, the push
  sequence, the auth floor, and the one-remote, one-local topology into one
  production object
- `push-remote-liveness-topology-contract.json` keeps dry-run and apply
  separate while proving apply-time revalidation
- `push-deployment-topology-contract.json` keeps the `8080` ingress rule and
  local-only proxy policy explicit
- `push-pull-to-topology-contract.json` maps immutable pull provenance into
  the production harness without turning it back into write authority

The compact proof chain is intentionally one-way:

- pull exporter/importer produce the immutable base package that push consumes
- `push_preflight` binds that immutable provenance to one live remote
  identity and one short-lived push session
- remote snapshot hash listing stays planning-only
- dry-run is a receipt, not a lock
- apply is a separate remote operation that revalidates fresh live evidence
  before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect before any mutating repair

The compact production proof stack is:

- `push-pull-to-topology-contract.json` for the immutable pull provenance
  bridge into the one-remote, one-local topology
- `push-deployment-topology-contract.json` for the smallest Docker and
  Playground topology contract with the `8080` ingress rule
- `push-remote-liveness-topology-contract.json` for the liveness split that
  keeps dry-run and apply separate while apply revalidates fresh live hashes
- `push-protocol-extension-contract.json` for the full production ladder from
  preflight through inspect-first recovery, including the pull/export/import
  bridge and the one-remote-one-local test topology
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` for the production auth,
  session, journal, lease, and recovery proof pair
- `push-production-auth-session-journal-recovery-inspect-contract.json` for
  the compact auth/session/journal/lease/recovery-inspect proof on the same
  remote identity

The pull-to-push bridge is one-way:

- exporter/importer produce the immutable base package that push consumes
- push never turns that base package back into a mutable snapshot cache
- dry-run is a receipt, not a lock
- apply must revalidate fresh live evidence before every batch and at the
  storage boundary
- journal inspect stays read-only
- recovery starts with inspect before any mutating repair

The production proof order is also one-way:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity and one
  short-lived session
- remote snapshot hash listing stays planning-only and never becomes write
  authority
- dry-run uploads the canonical plan and returns an eligibility receipt
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary
- journal inspect remains read-only
- recovery starts with inspect and only mutates when the journal plus fresh
  live hashes prove the action safe

That bridge also defines the recovery floor:

- journal inspection is read-only evidence gathering, not a mutation gate
- inspect must happen before any mutating recovery branch
- finish, rollback, retry, and block are the only recovery classifications
- mutating recovery must still satisfy the same auth floor as the write path
- stale dry-run evidence never becomes recovery authority

The topology model is deliberately minimal:

- `remote-base` is the source site that seeds the persisted pull base.
- `local-edited` is the imported local site that carries the candidate edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, dry-run,
  apply, inspect the journal, or recover.
- `push_preflight` is the first live binding after importer persistence.
- `push_snapshot_hashes` is planning-only and never becomes write authority.
- `push_plan_dry_run` returns an eligibility receipt, not a lock.
- `push_batch_apply` revalidates before every batch and at the storage
  boundary.
- `push_journal` is read-only durable evidence.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch.
- journal inspection remains read-only and recovery must begin with inspect
  before any mutating repair.

The deployment test topology is the same in Docker and Playground:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner that owns all push protocol calls
- browser-visible inspection only through the sandbox-provided `8080`
  ingress and a local-only proxy
- Docker uses one private network; Playground uses separate disposable
  blueprints.
- both harnesses keep the same route names and the same dry-run/apply split.
- remote tunnels are disallowed.

The topology is captured in these fixtures:

- `push-deployment-topology-contract.json` for the smallest topology-only
  proof
- `push-remote-liveness-topology-contract.json` for the dry-run/apply split
  that proves liveness stays separate from write authority
- `push-production-topology-contract.json` for the compact production bundle
  that includes the pull provenance, push stage sequence, and topology proof

Those fixtures map the bridge in one direction only:

- exporter/importer discover and persist immutable provenance
- `push_preflight` is the first live binding after importer persistence
- remote snapshot hash listing is planning-only evidence
- dry-run returns a receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

Docker and Playground use the same topology labels and the same ingress
policy:

- `remote-base`, `local-edited`, `remote-changed`, and `runner` mean the same
  thing in both harnesses
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- tunnels are disallowed
- Docker uses one private network
- Playground uses separate disposable blueprints

## Stage Semantics

Each stage has one job and one boundary:

- `push_preflight` proves the imported provenance and the current remote
  target are the same logical site before planning begins. It is the first
  live binding after importer persistence.
- `push_snapshot_hashes` reads the live remote comparison surface for
  planning only. It may page through large sites, but it never becomes write
  authority, never extends the session on its own, and never authorizes dry-
  run or apply by itself.
- `push_plan_dry_run` uploads the canonical plan and returns a receipt that
  proves eligibility only. A dry-run receipt is not a lock, not a lease, and
  not authorization to mutate remote state.
- `push_batch_apply` is the first mutation stage. It must revalidate fresh
  live evidence before every batch and again at the storage boundary so drift
  between dry-run and apply cannot be ignored.
- `push_journal` is read-only durable evidence. It records claim, lease,
  fencing, and recovery facts, but it never authorizes mutation by itself.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch. It classifies finish, rollback, retry, or block.
- `push_recover auto|finish|rollback` may mutate only after inspect proves
  the action safe with fresh live evidence and the same auth floor as the
  write path.

Recovery is intentionally inspect-first:

- `inspect` is the only safe starting point because it can prove whether the
  journaled target still matches fresh live hashes.
- `finish` is only safe when the journal row is complete and the live site can
  still prove the staged target.
- `rollback` is only safe when the journal row can prove that backing out will
  restore the imported base package without trampling a newer remote change.
- `retry` is the only option when the claim is open but still fenced and the
  remote evidence is not yet contradictory.
- `block` is the outcome when the journal or live evidence cannot prove a
  safe mutating recovery path.
- Journal rows must persist the claim, lease, fencing state, and apply-time
  evidence that inspect reads before any recovery mutation.
- Recovery inspect is read-only and must happen before any mutating repair;
  the same auth floor that protects the write path also protects recovery.

The push protocol extension is therefore not a general remote write API. It is
the production write path for one imported base package, one edited local
site, and one live remote identity that must be revalidated at apply time.

The reviewable bridge from pull to push is intentionally linear:

| Pull provenance | Push stage | Why it exists |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base package to one live remote identity and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use the imported package only as planning provenance for the live hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan as eligibility evidence, not write authority. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and again at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

That table is the contract boundary: pull discovers and persists immutable
provenance, and push consumes that provenance without ever rewriting it.

The production executor therefore has one source of truth for provenance and
one source of truth for live state:

- exporter/importer own the immutable pull base package
- preflight binds that package to one live remote identity and one
  short-lived push session
- snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- batch apply is the only mutation stage and must revalidate fresh live
  evidence before every batch and at the storage boundary
- journal inspect is read-only evidence gathering
- recovery must begin with inspect before any mutating repair

The auth floor is explicit:

- push auth must be at least as strict as current Reprint HMAC usage
- stronger session material is allowed, but it may not weaken that HMAC floor
- journal inspect and recovery keep the same auth floor as the write path

## Topology

The canonical production proof uses one remote source site, one imported local
edit site, and one later observation of the same remote identity after drift.
Docker and Playground keep the same stage names, the same route names, and the
same browser-visible ingress rule:

| Role | Docker | Playground |
| --- | --- | --- |
| Remote source | `remote-base` | `remote-base` |
| Local edited site | `local-edited` | `local-edited` |
| Drift witness | `remote-changed` | `remote-changed` |
| Runner | `runner` | local test process |

The topology proof means:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits used to form the canonical
  push plan
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may run preflight, remote snapshot hash
  listing, dry-run upload, batched apply, journal inspect, or recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- Docker and Playground both model the same one-remote, one-local,
  one-drift production proof

The machine-readable topology proof keeps those roles consistent. Use
`push-protocol-extension-contract.json` for the full ladder,
`push-pull-to-topology-contract.json` for the provenance bridge, and
`push-production-topology-contract.json` for the production-shaped Docker
and Playground harness. Use `push-topology-matrix.json` or
`push-deployment-topology-contract.json` when you need the explicit
Docker/Playground test topology. Use
`push-production-journal-lease-recovery-inspect-contract.json` when you need
the narrow journal and lease fence proof after the dry-run/apply split.

## Auth And Recovery

Push auth must be at least as strict as current Reprint HMAC usage. The write
path may use stronger session material, but it may not weaken that floor.

The auth floor applies consistently:

- preflight mints a short-lived push session bound to the persisted pull base
  package and the live remote identity
- dry-run uses that session only to upload the canonical plan receipt
- apply must revalidate the live remote before every batch and again at the
  storage boundary
- journal inspection stays read-only
- mutating recovery must satisfy the same auth floor, plus journal evidence
  and fresh live hashes

## Pull To Push Mapping

Push consumes immutable provenance from the existing pull pipeline. The
exporter/importer path remains the source of truth, and push only reads the
persisted base package that importer saved:

| Pull artifact or stage | Push consumer | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base package to one live remote identity, one requested scope, and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it only as planning provenance for the live remote hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan as a receipt, not a lock. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

The pull-to-push bridge is intentionally one-way and preserves the same remote
identity across the staged proof:

- exporter discovers the merge base and coverage evidence.
- importer persists the base package as immutable provenance.
- preflight binds that persisted package to one live remote identity, one
  requested scope, and one short-lived push session.
- snapshot hash listing reads the live remote comparison surface for planning
  only and can page through large sites without becoming write authority.
- dry-run uploads the canonical plan and returns a receipt, not a lock.
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary, and it is a separate remote operation from dry-run.
- journal inspect stays read-only.
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the branch safe.

The production topology for this ladder is fixed as well:

- one remote source site seeds the persisted pull base package
- one imported local edit site carries the applied local changes
- one later drift observation reuses the same remote identity after the
  remote has changed
- one runner owns preflight, remote snapshot hash listing, dry-run plan
  upload, batched apply, journal inspect, and recovery
- Docker and Playground both run that same three-site story
- browser-visible inspection stays on the sandbox-provided `8080` ingress
- local proxies stay local-only
- remote tunnels are disallowed
