# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push is the
write path that extends the existing exporter/importer pull pipeline with a
safe remote mutation protocol.

## Production Contract

The push executor may mutate only after it proves a safe three-way plan from
the persisted pull base package, the edited local site, and the live remote
site. The persisted pull base package is immutable provenance from the pull
pipeline, not a mutable snapshot cache.

The production ladder is fixed:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity, one requested scope, and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock.
4. `push_batch_apply` is the first mutation stage and must revalidate fresh
   live evidence before every batch and again at the storage boundary.
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
- batch apply revalidates before every batch and at the storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when journal evidence and
  fresh live hashes still prove the branch safe

The push protocol extension is therefore not a general remote write API. It is
the production write path for one imported base package, one edited local
site, and one live remote identity that must be revalidated at apply time.

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

The pull-to-push bridge is intentionally one-way:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity, one
  requested scope, and one short-lived push session
- snapshot hash listing reads the live remote comparison surface for planning
  only
- dry-run uploads the canonical plan as a receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the action safe

## Executor Topology

The executor proof is intentionally split across three levels:

- `push_protocol_extension_contract` shows the ordered production ladder from
  preflight through inspect-first recovery.
- `push_pull_to_topology_contract` shows how exporter/importer provenance
  becomes push planning input without rewriting the persisted base package.
- `push_topology` and `push_executor_topology_proof` show the one-remote,
  one-local, one-drift harness in Docker and Playground, including the shared
  `8080` ingress rule.

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

Use these fixtures as the canonical proof bundle:

- `push-protocol-extension-contract.json` is the end-to-end production ladder
  proof.
- `push-pull-to-topology-contract.json` is the smallest composite proof that
  links pull provenance, push stages, auth floor, and topology.
- `push-auth-session-journal-recovery-contract.json` is the compact proof that
  ties auth, session minting, journal rows, lease fencing, and inspect-first
  recovery together.
- `push-remote-liveness-topology-contract.json` is the compact proof that the
  liveness split and the one-remote, one-local, one-drift test topology stay
  aligned in one object.
- `push-executor-topology-proof.json` is the shortest executor-shaped proof
  for Docker and Playground ingress behavior.
- `push-topology-matrix.json` is the machine-readable one-remote,
  one-local, one-drift matrix.
