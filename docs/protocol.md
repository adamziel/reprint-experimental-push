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
   planning only and never becomes write authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock.
4. `push_batch_apply` is the first mutation stage. It must revalidate fresh
   live evidence before every batch and again at the storage boundary. Dry-run
   and apply are separate remote operations, and apply must not trust the
   dry-run receipt as a lock, a lease, or a substitute for fresh live
   evidence.
5. `push_journal` records durable evidence and never authorizes a write.
6. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the action safe with fresh live evidence and the same auth floor as the
   write path.

The ladder maps directly to the pull pipeline:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only
- dry-run is an eligibility receipt, not a lock
- batch apply revalidates before every batch and again at the storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when journal evidence and
  fresh live hashes still prove the branch safe

## Stage Semantics

Each stage has one job and one boundary:

- `push_preflight` proves the imported provenance and the current remote
  target are the same logical site before planning begins.
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

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity, one
  requested scope, and one short-lived push session
- snapshot hash listing reads the live remote comparison surface for planning
  only and can page through large sites without becoming write authority
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary, and it is a separate remote operation from dry-run
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the branch safe
