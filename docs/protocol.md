# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push is not a
separate sync system; it is the write path that extends the existing
exporter/importer pull pipeline with a safe remote mutation protocol.

## Production Contract

The push executor may mutate only after it proves a safe three-way plan from
the persisted pull base package, the edited local site, and the live remote
site. The persisted pull base package is immutable provenance from the pull
pipeline, not a mutable snapshot cache.

The production ladder is fixed and ordered:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never upgrades into write authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock.
4. `push_batch_apply` is the first mutation batch apply stage and must
   revalidate fresh live evidence before every batch and again at the storage
   boundary. If the revalidation fails, the dry-run receipt does not become a
   lock.
5. `push_journal` is read-only durable evidence and never authorizes a write.
6. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves the
   action safe with fresh live evidence and the same auth floor as the write
   path.

The push protocol extension is therefore not a general remote write API. It is
the production write path for one imported base package, one edited local
site, and one live remote identity that must be revalidated at apply time.

## Pull To Push Mapping

Push consumes immutable provenance from the existing pull pipeline:

| Pull artifact or stage | Push consumer | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base package to one live remote identity, one requested scope, and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it only as planning provenance for the live snapshot hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan, but do not reserve a lock. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

The pull pipeline remains the source of truth for immutable provenance:

- exporter discovers the merge-base and coverage evidence
- importer stores the pull base package as immutable provenance
- preflight binds that persisted package to the live remote identity and a
  short-lived push session
- snapshot listing reads only the live remote comparison surface for planning
- dry-run uploads the canonical plan as a receipt, not a lock
- batch apply revalidates before every batch and at the storage boundary
- journal inspect stays read-only
- recovery begins with inspect and only mutates when the journal plus fresh
  live hashes still prove the action safe

The boundary rules are one-way:

- exporter/importer establish immutable provenance
- preflight binds that provenance to one live remote identity and one
  short-lived push session
- remote snapshot hash listing remains planning evidence only
- dry-run uploads a canonical plan and returns an eligibility receipt, not a
  lock
- batch apply is the first write stage and must revalidate fresh live evidence
  before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes prove the action

## Liveness

The live remote is trusted in two separate steps:

- remote snapshot hash listing is planning evidence only and never authorizes
  mutation
- apply-time revalidation is the first write-side liveness check and must run
  again before every batch and at the storage boundary

That split is the production liveness rule:

- dry-run and apply are separate remote operations
- dry-run is an eligibility receipt, not a lock
- apply must revalidate fresh live evidence before every batch and at the
  storage boundary
- journal inspect is read-only
- recovery begins with inspect before any mutating repair

## Topology

The minimum production-shaped topology is the same in Docker and Playground:

- one remote source site seeds the persisted pull base
- one imported local site produces the candidate plan
- one later observation of the same remote identity proves drift
- one runner owns preflight, hash listing, dry-run, apply, journal inspect,
  and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

The concrete lab identities used in the proof are `remote-example` for the
remote source site and `local-dev-site` for the imported local site. The same
remote identity is observed again after drift so the topology proves one
remote site, one local edited site, and one runner without introducing a
second remote authority.

The test topology is intentionally identical in Docker and Playground:

- Docker runs the remote source, local edited site, and drift witness on one
  private network behind the runner
- Playground uses disposable blueprints, but the same route names and the same
  remote identity mapping
- both harnesses rely on the sandbox-provided `8080` ingress for browser
  inspection through a local-only proxy

That identity mapping is fixed:

- `remote-base` and `remote-changed` both represent `remote-example`
- `local-edited` represents `local-dev-site`
- `runner` is the only actor that may preflight, list hashes, upload the dry
  run plan, apply mutation batches, inspect the journal, or start recovery

| Role | Docker | Playground |
| --- | --- | --- |
| `remote-base` | `remote-base` | `remote-base` |
| `local-edited` | `local-edited` | `local-edited` |
| `remote-changed` | `remote-changed` | `remote-changed` |
| `runner` | `runner` | local test process |

This is enough to prove one remote identity observed twice, one imported local
edit site, and one shared ingress rule without inventing extra topology.

## Auth And Recovery

Authentication must be at least as strict as current Reprint HMAC usage.

The executor must treat the pull base package as immutable provenance for the
entire push attempt. It is read to build plans and bind preflight, but it is
never rewritten to make stale evidence look current.

Recovery stays inspect-first:

- `push_journal` reads claim, lease, fencing, and idempotency evidence without
  authorizing mutation.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair is allowed.
- `push_recover auto|finish|rollback` is the mutating branch and must never run
  without a prior inspect result.

The extension is intentionally aligned with the pull pipeline:

- exporter/importer create the immutable pull base package
- preflight turns that base package into a live-remote-scoped push session
- snapshot listing is the planning-only read of the live remote hash surface
- dry-run uploads the canonical plan as a receipt
- batch apply mutates in bounded units and revalidates before each mutation
- journal inspect preserves durable evidence without widening authority
- recovery starts by inspecting the journal and only mutates when the live
  hashes still prove the repair path safe

The machine-readable proofs that back this contract are:

- [`fixtures/protocol/push-protocol-extension-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-protocol-extension-contract.json)
- [`fixtures/protocol/push-deployment-topology-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-deployment-topology-contract.json)
- [`fixtures/protocol/push-executor-topology-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-executor-topology-proof.json)
- [`fixtures/protocol/push-topology-matrix.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-topology-matrix.json)
- [`fixtures/protocol/push-snapshot-hashes-page-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-snapshot-hashes-page-contract.json)
- [`fixtures/protocol/push-dry-run-apply-revalidation-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-dry-run-apply-revalidation-contract.json)
- [`fixtures/protocol/push-remote-liveness-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-remote-liveness-contract.json)
- [`fixtures/protocol/push-auth-session-fencing-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-auth-session-fencing-contract.json)
- [`fixtures/protocol/push-auth-session-recovery-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-auth-session-recovery-contract.json)
- [`fixtures/protocol/push-recovery-inspect-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-inspect-contract.json)
- [`fixtures/protocol/push-recovery-revalidation-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-revalidation-contract.json)

Those fixtures keep the production proof compact: exporter/importer establish
the immutable base package, preflight binds it to one live remote identity and
one short-lived session, snapshot listing can be paginated without becoming
write authority, dry-run stays separate from apply, apply revalidates before
every batch and at the storage boundary, journal inspect stays read-only, and
recovery begins with inspect before any mutating repair. The recovery
revalidation contract keeps the same fresh-live-hash rule visible on the
mutating recovery branch so inspect never turns into write authority by
itself.
