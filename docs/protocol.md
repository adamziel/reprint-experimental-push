# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push is the
write path that extends the existing exporter/importer pull pipeline with a
safe remote mutation protocol. Push never replaces pull provenance: it
consumes the persisted pull base package as immutable input and revalidates
the live remote identity at apply time.

## Production Contract

The push executor may mutate only after it proves a safe three-way plan from
the persisted pull base package, the edited local site, and the live remote
site. The persisted pull base package is immutable provenance from the pull
pipeline, not a mutable snapshot cache.

The production ladder is fixed and each stage keeps its own boundary:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity, one requested scope, and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock.
4. `push_batch_apply` is the first mutation stage and must revalidate fresh
   live evidence before every batch and again at the storage boundary. Dry-run
   and apply are separate remote operations.
5. `push_journal` is read-only durable evidence and never authorizes a write.
6. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the action safe with fresh live evidence and the same auth floor as the
   write path.

That ladder maps to distinct remote boundaries:

- preflight is the first live binding after importer provenance exists
- snapshot hash listing is planning evidence only
- dry-run is an eligibility receipt, not a lock
- batch apply revalidates before every batch and again at the storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when journal evidence and
  fresh live hashes still prove the branch safe

## Stage Semantics

Each stage has one job and one boundary:

- `push_preflight` binds the persisted pull base package to one live remote
  identity, one requested scope, and one short-lived push session. It proves
  the imported provenance and the current remote target are the same logical
  site before planning begins.
- `push_snapshot_hashes` lists the live remote comparison surface for
  planning only. It may page through large sites, but it never becomes write
  authority and never extends the session on its own.
- `push_plan_dry_run` uploads the canonical plan and returns a receipt that
  proves eligibility only. A dry-run receipt is not a lock, not a lease, and
  not authorization to mutate remote state.
- `push_batch_apply` is the first mutation stage. It must revalidate fresh
  live evidence before every batch and again at the storage boundary so drift
  between dry-run and apply cannot be ignored. Dry-run and apply are separate
  remote operations even when the same runner performs both.
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
- journal rows must persist the claim, lease, fencing state, and apply-time
  evidence that inspect reads before any recovery mutation.

The push protocol extension is therefore not a general remote write API. It is
the production write path for one imported base package, one edited local
site, and one live remote identity that must be revalidated at apply time.

## Topology

The canonical production proof uses one remote source site, one imported local
edit site, and one later observation of the same remote identity after drift.
Both Docker and Playground keep the same stage names, the same route names,
and the same browser-visible ingress rule:

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
- `runner` is the only actor that may run preflight, snapshot listing,
  dry-run upload, batched apply, journal inspect, or recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- Docker and Playground both model the same one-remote, one-local,
  one-drift production proof

The canonical machine-readable bundle for that proof is
`push-production-push-recovery-contract.json`. Use it when a review needs the
full pull provenance, push ladder, and topology story in one place. In that
bundle, `remote-base` and `remote-changed` are two observations of the same
remote identity, not two different sites.

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

Recovery is inspect-first:

- `inspect` is the only safe starting point because it can prove whether the
  journaled target still matches fresh live hashes
- `finish` is only safe when the journal row is complete and the live site can
  still prove the staged target
- `rollback` is only safe when the journal row can prove that backing out will
  restore the imported base package without trampling a newer remote change
- `retry` is only valid when the claim is open but still fenced and the live
  evidence is not contradictory
- `block` is the outcome when the journal or live evidence cannot prove a
  safe mutating recovery path

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

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity, one
  requested scope, and one short-lived push session
- snapshot hash listing reads the live remote comparison surface for planning
  only
- dry-run uploads the canonical plan as a receipt, not a lock
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary, and it is a separate remote operation from dry-run
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the action safe

This is the operational mapping from the existing exporter/importer pipeline:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity and one
  short-lived push session
- snapshot hash listing reads the live remote comparison surface only for
  planning
- dry-run uploads the canonical plan and returns a receipt
- batched apply revalidates the remote before every batch and at the storage
  boundary
- journal inspect reads durable evidence without authorizing mutation
- recovery inspect reads the journal and fresh live hashes before any
  mutating repair
- mutating recovery only proceeds when inspect proves the branch is still
  safe

## Executor Topology

The executor proof is intentionally split across three levels:

- `push_protocol_extension_contract` shows the ordered production ladder from
  preflight through inspect-first recovery.
- `push_pull_to_topology_contract` shows how exporter/importer provenance
  becomes push planning input without rewriting the persisted base package.
- `push_deployment_topology_contract` shows the one-remote, one-local, one-
  drift-witness production shape in both Docker and Playground.
- `push_production_push_recovery_contract` is the canonical end-to-end proof
  that ties the pull provenance, the production push ladder, and the
  one-remote, one-local topology into one reviewable object.
- `push_journal_inspect_contract` isolates the read-only journal boundary from
  mutating recovery and keeps the claim, lease, and live-hash evidence
  separate.
- `push_topology` and `push_executor_topology_proof` show the one-remote,
  one-local, one-drift harness in Docker and Playground, including the shared
  `8080` ingress rule.
- `push_remote_liveness_topology_contract` keeps the liveness split and the
  one-remote, one-local, one-drift harness aligned in one compact proof.
- `push_production_recovery_drift_contract` adds the inspect-first recovery
  proof after live drift while preserving pull provenance, the auth floor, and
  the one-remote, one-local production topology.
- `push_production_push_recovery_contract` ties the pull provenance, the
  production push ladder, and the one-remote, one-local topology into one
  reviewable object for the full preflight-to-recovery story.

The canonical test topology is fixed across both harnesses:

| Role | Docker | Playground |
| --- | --- | --- |
| Remote source | `remote-base` | `remote-base` |
| Local edited site | `local-edited` | `local-edited` |
| Drift witness | `remote-changed` | `remote-changed` |
| Runner | `runner` | local test process |

That topology means:

- `remote-base` and `remote-changed` are two observations of the same remote
  identity
- `local-edited` is the imported local clone derived from the persisted pull
  base package
- `runner` is the only actor that may run preflight, snapshot listing,
  dry-run upload, batched apply, journal inspect, or recovery
- Docker uses one private network, and Playground uses separate disposable
  blueprints, but both keep the same route names and the same local-only
  `8080` browser ingress rule

The proof identities stay fixed across both harnesses:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits used to build the canonical
  plan
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may run preflight, snapshot listing,
  dry-run upload, batch apply, journal inspect, or recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

For both Docker and Playground, the test topology is intentionally the same:

- one remote source site provides the persisted pull base package
- one local edited site carries the imported edits that become the candidate
  push plan
- one drift observation proves the same remote identity still revalidates at
  apply time
- one later observation of the same remote identity proves drift handling
- one runner process owns preflight, hash listing, dry-run upload, batch
  apply, journal inspection, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  and never uses a remote tunnel
- Docker and Playground both model the same one-remote, one-local, one-drift
  production proof

The push half of the story is intentionally separate from pull execution:

- exporter/importer provenance creates the immutable base package
- preflight binds that base package to one live remote identity and one
  short-lived push session
- remote snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan as a receipt, not a lock
- batched apply revalidates fresh live evidence before every batch and at the
  storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when fresh live hashes still
  prove the branch safe

Use these fixtures as the canonical proof bundle:

- `push-production-ladder-contract.json` is the canonical machine-readable
  production ladder proof for preflight, remote snapshot hash listing, dry-run
  plan upload, batched apply, journal inspect, and inspect-first recovery.
- `push-protocol-extension-contract.json` is the top-level compact proof that
  keeps the full production story and pull provenance mapping in one object.
- `push-production-revalidation-contract.json` is the compact proof that
  keeps preflight, planning-only snapshot hashes, dry-run eligibility,
  apply-time revalidation, journal evidence, and inspect-first recovery in
  one object.
- `push-dry-run-apply-revalidation-contract.json` keeps the live snapshot
  planning, dry-run eligibility, apply-time revalidation, and storage-boundary
  proof explicit.
- `push-pull-to-topology-contract.json` is the smallest composite proof that
  links pull provenance, push stages, auth floor, and topology.
- `push-journal-inspect-contract.json` is the compact proof that journal
  inspection remains read-only evidence and never grants write authority.
- `push-auth-session-journal-recovery-contract.json` is the compact proof that
  ties auth, session minting, journal rows, lease fencing, and inspect-first
  recovery together.
- `push-auth-session-journal-recovery-inspect-contract.json` is the compact
  proof that folds live drift classification into the same auth, session,
  journal, lease, and inspect-first recovery chain.
- `push-production-recovery-inspect-contract.json` is the compact proof that
  recovery inspect stays read-only while the journal row, lease fence, auth
  floor, and `8080` topology still match the write path.
- `push-remote-liveness-topology-contract.json` is the compact proof that the
  liveness split and the one-remote, one-local, one-drift test topology stay
  aligned in one object.
- `push-executor-topology-proof.json` is the shortest executor-shaped proof
  for Docker and Playground ingress behavior.
- `push-deployment-topology-contract.json` is the smallest topology-only
  contract that still proves the remote identity split, the local edit site,
  the drift witness, and the sandbox-provided `8080` ingress rule.
- `push-topology-matrix.json` is the machine-readable one-remote,
  one-local, one-drift matrix.
- `push-recovery-boundary-contract.json` is the compact proof that keeps
  inspect-first recovery, the auth floor, and the Docker/Playground topology
  in one object.
