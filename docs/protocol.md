# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push extends
the existing exporter/importer pull pipeline with a remote mutation protocol
that keeps pull provenance immutable, separates planning from mutation, and
revalidates the live remote identity at apply time.

## Production Contract

The push executor may mutate only after it proves a safe three-way plan from
the persisted pull base package, the edited local site, and the live remote
site. The persisted pull base package is immutable provenance from the pull
pipeline, not a mutable snapshot cache.

The production ladder is fixed:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity, one requested scope, and one short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison surface for
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

The pull/export/import pipeline is the only source of immutable push
provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is read-only planning evidence and may page large
  sites, but it never becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` is a separate remote operation that revalidates fresh
  live evidence before every batch and again at the storage boundary
- `push_journal` is durable evidence only and never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch

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
- it keeps apply-time revalidation separate from the dry-run receipt
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit

The Docker and Playground topology contract is intentionally one remote, one
local, one drift witness:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns the protocol calls
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- remote tunnels are disallowed

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

The topology is captured in these fixtures:

- `push-deployment-topology-contract.json` for the smallest topology-only
  proof
- `push-remote-liveness-topology-contract.json` for the dry-run/apply split
  that proves liveness stays separate from write authority
- `push-production-topology-contract.json` for the compact production bundle
  that includes the pull provenance, push stage sequence, and topology proof

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
`push-topology-matrix.json` or `push-deployment-topology-contract.json` for
the explicit Docker/Playground test topology.

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
