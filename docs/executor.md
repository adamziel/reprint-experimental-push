# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote site and one local site.

## Production Shape

The production proof is one remote source site, one imported local edit site,
and one later observation of the same remote identity after drift. In both
Docker and Playground, that proof keeps browser-visible inspection on the
sandbox-provided `8080` ingress through a local-only proxy.

The executor follows the same ordered stages defined in the protocol:

1. `push_preflight` binds the imported pull base package to one live remote
   identity and one short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only.
3. `push_plan_dry_run` uploads the canonical plan as a receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
5. `push_journal` stays read-only.
6. `push_recover inspect` classifies finish, rollback, retry, or block before
   any mutating recovery.
7. `push_recover auto|finish|rollback` mutates only when inspect proves the
   branch safe and the auth floor still holds.

That means the executor is not a general remote write loop. It is the
production write path for one imported base package, one edited local site,
and one live remote identity that must be revalidated at apply time.

The same pull-to-push bridge applies here:

- exporter/importer provenance produces the immutable pull base package
- preflight binds that package to one live remote identity and one short-lived
  push session
- remote snapshot hash listing stays planning-only
- dry-run uploads a canonical plan receipt and never becomes a lock
- batched apply revalidates fresh live evidence before every batch and again
  at the storage boundary, and is a separate remote operation from dry-run
- journal inspection stays read-only
- inspect-first recovery is the only safe starting point for mutating
  recovery

The executor should treat the mapped pull pipeline as immutable provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that package to one live remote identity and one short-lived
  push session
- snapshot hash listing reads the live remote comparison surface only for
  planning
- dry-run uploads the canonical plan and returns a receipt
- apply revalidates before every batch and again at the storage boundary
- journal inspect reads durable evidence without authorizing mutation
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the branch safe

## Stage Semantics

The executor needs the same boundary discipline as the protocol:

- preflight is the first live binding after importer provenance exists
- remote snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary, and does not reuse the dry-run receipt as a lock
- journal inspection stays read-only
- recovery starts with inspect and only mutates when inspect proves the branch
  safe with fresh live evidence

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

The bridge is one-way and fixed:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity and one
  short-lived push session
- snapshot hash listing stays planning-only
- dry-run returns a receipt, not a lock
- batch apply revalidates before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the action safe

In other words:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity and one
  short-lived push session
- snapshot listing reads the live remote comparison surface only for planning
- dry-run uploads the canonical plan as a receipt
- apply revalidates before each batch and again at the storage boundary
- journal inspection reads durable evidence without authorizing mutation
- recovery inspection reads the journal and fresh live hashes before any
  mutating repair

## Topology

The executor uses the same production topology in Docker and Playground:

| Role | Docker | Playground |
| --- | --- | --- |
| Remote source | `remote-base` | `remote-base` |
| Local edited site | `local-edited` | `local-edited` |
| Drift witness | `remote-changed` | `remote-changed` |
| Runner | `runner` | local test process |

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

## Canonical Proofs

The canonical proof stack for that executor story is the same one named in
[protocol.md](protocol.md):

- `push-production-ladder-contract.json` for the canonical machine-readable
  production ladder from preflight through inspect-first recovery
- `push-protocol-extension-contract.json` for the compact end-to-end
  production story and pull provenance mapping
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
- `push-production-push-recovery-contract.json` for the compact end-to-end
  proof that ties pull provenance, the production push ladder, and inspect-
  first recovery into one reviewable object
- `push-pull-to-topology-contract.json` for the pull-to-push bridge
- `push-deployment-topology-contract.json` for the smallest topology-only
  contract that still proves the same remote identity twice, the imported
  local site, and the sandbox-provided `8080` ingress rule
- `push-journal-inspect-contract.json` for the read-only journal boundary
- `push-auth-session-journal-recovery-contract.json` for the compact auth,
  session, journal-row, lease-fence, and inspect-first recovery proof
- `push-executor-topology-proof.json` for the shortest Docker/Playground
  executor proof
- `push-remote-liveness-topology-contract.json` for the compact liveness plus
  one-remote, one-local, one-drift harness proof
- `push-topology-matrix.json` for the stage-level Docker/Playground matrix
- `push-preflight-contract.json` for the first live binding between imported
  provenance, scope, and session
- `push-recovery-inspect-contract.json` for the read-only recovery classifier
- `push-auth-session-journal-recovery-inspect-contract.json` for the combined
  auth, session, journal, lease, live drift, and inspect-first recovery proof
- `push-recovery-revalidation-contract.json` for mutating recovery after
  inspect proves the branch safe
- `push-deployment-topology-contract.json` for the exact one-remote,
  one-local, one-drift Docker and Playground harness shape
- `push-recovery-boundary-contract.json` for the compact inspect-first
  recovery boundary proof with the auth floor and topology in one object

- `push-production-push-recovery-contract.json` for the canonical end-to-end
  proof that ties the pull provenance, the production push ladder, and the
  one-remote, one-local topology into one reviewable object

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
