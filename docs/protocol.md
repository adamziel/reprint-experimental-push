# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push is not a
separate sync system; it is the write path that extends the existing
exporter/importer pull pipeline with a safe remote mutation protocol.

## Production Contract

The push executor may mutate only after it proves a safe three-way plan from
the persisted pull base package, the edited local site, and the live remote
site. The persisted pull base package is immutable provenance from the pull
pipeline, not a mutable snapshot cache.

The production shape is fixed:

- exporter/importer establish the immutable pull base package
- preflight is the first live-remote binding step after importer provenance
  exists and it binds that package to one live remote identity and one
  short-lived push session
- snapshot hash listing reads the live remote comparison surface for planning
  only
- dry-run uploads the canonical plan as an eligibility receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when fresh live evidence and
  journal evidence still prove the repair safe

The production ladder is fixed and ordered:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity, one requested scope, and one short-lived push session.
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
7. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the action safe with fresh live evidence and the same auth floor as the
   write path.

The stage contract stays narrow:

- `push_preflight` binds immutable pull provenance to one live remote
  identity, one requested scope, and one short-lived push session.
- `push_snapshot_hashes` lists the live remote comparison surface for
  planning only, including cursoring when the remote is large.
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock.
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary.
- `push_journal` is durable evidence only and never authorizes a mutation.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery mode.
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds.

The push protocol extension is therefore not a general remote write API. It is
the production write path for one imported base package, one edited local
site, and one live remote identity that must be revalidated at apply time.

The wire contract is intentionally small and ordered:

1. `push_preflight` binds immutable pull provenance to one live remote
   identity, one requested scope, and one short-lived session.
2. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only.
3. `push_plan_dry_run` uploads a canonical plan and returns an eligibility
   receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
5. `push_journal` is read-only durable evidence.
6. `push_recover inspect` reads the journal and live hashes before any
   mutating repair.
7. `push_recover auto|finish|rollback` may mutate only when inspect proves
   the branch safe and the write-path auth floor still holds.

That ordering matters because the pull pipeline stays the provenance source:

- exporter discovers the merge base and coverage evidence
- importer persists the pull base package as immutable provenance
- preflight binds that package to one live remote identity and one short-lived
  push session
- snapshot hash listing reads the live comparison surface for planning only
- dry-run produces a receipt, not a lock
- batch apply revalidates fresh live evidence before every batch and at the
  storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the action safe

The handoff into push is one-way and explicit:

| Pull stage or artifact | Push consumer | Boundary rule |
| --- | --- | --- |
| Exporter merge-base and coverage scan | `push_preflight` | Bind the imported base package to one live remote identity, one requested scope, and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it only as planning provenance for the live remote hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan as a receipt, not a lock. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

That handoff never rewrites persisted provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the pull base package as immutable provenance
- preflight binds that package to one live remote identity and one short-lived
  push session
- snapshot hash listing stays planning-only
- dry-run uploads the canonical plan as a receipt, not a lock
- batch apply revalidates before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the action safe

The executor proof is intentionally split across three levels:

- `push_pull_mapping` shows how exporter/importer provenance becomes push
  planning input without rewriting the persisted base package.
- `push_protocol_extension_contract` shows the ordered production ladder from
  preflight through inspect-first recovery.
- `push_topology` and `push_executor_topology_proof` show the one-remote,
  one-local, one-drift harness in Docker and Playground, including the shared
  `8080` ingress rule.

In that harness:

- `remote-base` is the seeded remote source site
- `local-edited` is the imported local site with user edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may run preflight, snapshot listing,
  dry-run upload, batched apply, journal inspect, or recovery
- Docker uses one private network, and Playground uses separate disposable
  blueprints, but both keep the same route names and the same local-only
  `8080` browser ingress rule

Use these fixtures as the canonical proof bundle:

- `push-protocol-extension-contract.json` is the end-to-end production ladder
  proof.
- `push-pull-to-topology-contract.json` is the smallest composite proof that
  links pull provenance, push stages, auth floor, and topology.
- `push-executor-topology-proof.json` is the shortest executor-shaped proof
  for Docker and Playground ingress behavior.
- `push-topology-matrix.json` is the machine-readable one-remote,
  one-local, one-drift matrix.

The canonical test topology is always the same:

| Role | Docker | Playground |
| --- | --- | --- |
| Remote source | `remote-base` | `remote-base` |
| Local edited site | `local-edited` | `local-edited` |
| Drift witness | `remote-changed` | `remote-changed` |
| Runner | `runner` | local test process |

The remote source and drift witness are two observations of the same remote
identity. The local edited site is the imported clone derived from the
persisted pull base package, and the runner is the only actor that may run
preflight, snapshot hash listing, dry-run, apply, journal inspect, or
recovery.

The proof identities stay fixed across both harnesses:

- `remote-base` and `remote-changed` are two observations of the same remote
  identity
- `local-edited` is the imported local clone derived from the persisted pull
  base package
- `runner` is the only actor that may run preflight, snapshot listing,
  dry-run upload, batch apply, journal inspect, or recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

## Pull To Push Mapping

Push consumes immutable provenance from the existing pull pipeline. The
exporter/importer path remains the source of truth, and push only reads the
persisted base package that importer saved:

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
- preflight binds that persisted package to the live remote identity, the
  requested scope, and a short-lived push session
- snapshot listing reads only the live remote comparison surface for planning
- dry-run uploads the canonical plan as a receipt, not a lock
- batch apply revalidates before every batch and at the storage boundary
- journal inspect stays read-only
- recovery begins with inspect and only mutates when the journal plus fresh
  live hashes still prove the action safe

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
  live hashes prove the action

The same bridge applies to the live mutation stages:

- `push_snapshot_hashes` reads the live remote comparison surface for planning
  only.
- `push_plan_dry_run` uploads the canonical plan as an eligibility receipt,
  not a lock.
- `push_batch_apply` revalidates fresh live evidence before every batch and
  at the storage boundary.
- `push_journal` is durable evidence only and never authorizes mutation.
- `push_recover inspect` reads journal and live evidence before any mutating
  repair can start.

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

The concrete test topology is one remote source site and one local edited
site:

- `remote-base` seeds the persisted pull base
- `local-edited` is the imported local site that produces the candidate plan
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor allowed to preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or start recovery

The same shape is mirrored in both harnesses:

| Environment | Remote source | Local edited site | Drift witness | Runner |
| --- | --- | --- | --- | --- |
| Docker | `remote-base` | `local-edited` | `remote-changed` | `runner` |
| Playground | `remote-base` | `local-edited` | `remote-changed` | local test process |

The proof identifiers are fixed:

- `remote-base` and `remote-changed` are two observations of the same remote
  identity, separated by drift
- `local-edited` is the imported local clone derived from the persisted pull
  base package
- `runner` is the only actor allowed to preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or start recovery

The harness differences are only orchestration details:

- Docker uses one private network behind the runner
- Playground uses separate disposable blueprints
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy

The concrete lab identities are fixed as well:

- `remote-example` is the source identity behind both `remote-base` and
  `remote-changed`
- `local-dev-site` is the imported local site behind `local-edited`
- `runner` is the executor process in Docker or the local test process in
  Playground
- `runner` owns preflight, remote snapshot hash listing, dry-run upload,
  batched apply, journal inspect, and recovery
- dry-run and apply stay separate remote operations, and apply revalidates
  fresh live evidence before every batch and at the storage boundary
- journal inspect is read-only, and recovery begins with inspect before any
  mutating repair

That topology is the one the harness matrix must keep stable:

| Harness | Remote source | Local edited site | Drift witness | Runner |
| --- | --- | --- | --- | --- |
| Docker | `remote-base` | `local-edited` | `remote-changed` | `runner` |
| Playground | `remote-base` | `local-edited` | `remote-changed` | local test process |

## Production Proof

The production proof is the smallest usable statement of the executor
protocol:

- exporter/importer create the immutable pull base package
- preflight binds that package to one live remote identity and one short-lived
  push session
- snapshot hash listing is planning-only and never write authority
- dry-run uploads the canonical plan as a receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect is read-only and does not widen authority
- recovery begins with inspect and only mutates when the journal plus fresh
  live hashes still prove the branch safe

The same proof is also the pull-to-push bridge:

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

That proof is what the fixtures below pin down, so the docs and tests stay
aligned:

- [`fixtures/protocol/push-protocol-extension-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-protocol-extension-contract.json)
- [`fixtures/protocol/push-pull-to-topology-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-pull-to-topology-contract.json)
- [`fixtures/protocol/push-executor-topology-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-executor-topology-proof.json)

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

Apply-time revalidation stays separate from recovery:

- `push_snapshot_hashes` is planning evidence only.
- `push_plan_dry_run` returns a receipt, not a lock.
- `push_batch_apply` must revalidate fresh live evidence before every batch and
  again at the storage boundary.
- `push_recover inspect` is read-only and must happen before any mutating
  recovery mode.
- `push_recover auto|finish|rollback` may mutate only when the journal plus
  fresh live hashes still prove the branch safe.

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
- [`fixtures/protocol/push-session-journal-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-session-journal-proof.json)
- [`fixtures/protocol/push-auth-session-recovery-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-auth-session-recovery-contract.json)
- [`fixtures/protocol/push-recovery-inspect-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-inspect-contract.json)
- [`fixtures/protocol/push-recovery-revalidation-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-revalidation-contract.json)
- [`fixtures/protocol/push-pull-to-topology-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-pull-to-topology-contract.json)

The topology proofs are intentionally split by concern:

- `push-deployment-topology-contract.json` keeps the one-remote, one-local,
  one-drift deployment proof compact.
- `push-topology-matrix.json` keeps the Docker and Playground stage matrix
  explicit.
- `push-pull-to-topology-contract.json` bridges exporter/importer provenance
  into the production topology and push ladder.

Those fixtures keep the production proof compact: exporter/importer establish
the immutable base package, preflight binds it to one live remote identity and
one short-lived session, snapshot listing can be paginated without becoming
write authority, dry-run stays separate from apply, apply revalidates before
every batch and at the storage boundary, journal inspect stays read-only, and
recovery begins with inspect before any mutating repair. The session-journal
proof keeps the minted push session, journal claim, lease fence, and
inspect-first recovery tuple together so a restarted apply can be classified
without promoting stale evidence into write authority. The recovery
revalidation contract keeps the same fresh-live-hash rule visible on the
mutating recovery branch so inspect never turns into write authority by
itself.
