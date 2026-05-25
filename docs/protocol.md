# Reprint Push Protocol Extension

This document defines the production push extension for Reprint. Push is not a
separate synchronization system. It is the write path that extends the existing
exporter/importer pull pipeline with a safe remote mutation protocol.

The production extension has one non-negotiable shape:

- preflight binds the persisted pull base to one live remote identity and one
  short-lived push session
- remote snapshot hashes are planning evidence only, even when cursorable
- dry-run uploads a canonical plan and returns an eligibility receipt, not a
  lock
- apply is the first write stage and must revalidate live evidence before
  every batch and again at the storage boundary
- journal inspect is read-only
- recovery must begin with inspect before any mutating finish or rollback
- authentication must be at least as strict as current Reprint HMAC usage

The remote write path is deliberately split into a planning half and a write
half:

- `push_preflight` binds the persisted pull base to one live remote identity
  and one short-lived push session.
- `push_snapshot_hashes` is a cursorable planning-only hash listing; paging it
  only advances evidence collection and never grants write authority.
- `push_plan_dry_run` uploads a canonical plan and returns an eligibility
  receipt, not a lock.
- `push_batch_apply` is the first write stage and must revalidate live remote
  evidence before every batch and again at the storage boundary.
- `push_journal` is read-only.
- `push_recover` starts with `inspect`; mutating recovery is only allowed
  after inspect proves the action safe with fresh live hashes.

The live remote is trusted in two different ways and those ways must stay
separate:

- snapshot hashes are planning evidence only and never authorize mutation
- apply-time revalidation is the first write-side liveness check and must
  run again before every batch and at the storage boundary

## Contract

Push is allowed only when the executor can prove that the persisted pull base,
the edited local site, and the live remote site still form a safe three-way
plan.

The production contract is deliberately strict:

1. Preflight binds the immutable pull base to a live remote identity and a
   short-lived push session.
2. Snapshot hashes list live remote evidence for planning only and never act as
   write authority, even when the listing is paged or resumed from a cursor.
3. Dry-run and apply are separate remote operations.
4. Apply revalidates the live remote before every batch and again at the
   storage boundary for each mutation, and fails closed if the remote drifted
   after dry-run.
5. A failed or interrupted apply leaves a durable journal that recovery can use
   to prove whether the remote is old, new, or blocked.
6. Journal inspection is read-only, and mutating recovery must start with an
   inspect step before any finish-or-rollback action.
7. Authentication must be at least as strict as current Reprint HMAC usage.

The executor must treat the pull base package as immutable provenance for the
entire push attempt. It is read to build plans and bind preflight, but it is
never rewritten to make stale evidence look current.

That provenance boundary is the same one the pull/export/import pipeline
already establishes:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- push preflight binds that stored base package to the live remote identity
  and a short-lived push session
- push snapshot hashes remain planning evidence only
- push dry-run uploads the canonical plan and returns an eligibility receipt,
  not a lock
- push batch apply revalidates fresh live evidence before every batch and
  again at the storage boundary, and must not reuse a stale dry-run receipt as
  write authority
- push journal and push recover inspect durable evidence first, then permit
  mutating recovery only when fresh live hashes prove the action

The mapping is intentionally one-way:

| Pull artifact or stage | Push consumer | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base to one live remote identity and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it only as planning provenance for the live hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan, but do not reserve a lock. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and again at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

That ladder is the production contract in miniature:

- exporter/importer establish immutable provenance
- preflight binds that provenance to one live remote identity and one
  short-lived push session
- snapshot hashes remain planning evidence only
- dry-run uploads a canonical plan and returns an eligibility receipt, not a
  lock
- apply is the first write stage and must revalidate fresh live evidence
  before every batch and at the storage boundary
- journal inspection stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes prove the action

The one-remote, one-local, one-drift-witness test shape is the same in Docker
and Playground: `remote-base` seeds the persisted pull base, `local-edited`
holds the imported local edits, `remote-changed` is the same remote identity
observed later after drift, and `runner` is the only process allowed to
compare, upload, inspect, and recover. That is the compact end-to-end proof
that dry-run and apply are separate remote operations, apply revalidates live
evidence before every batch and at the storage boundary, and recovery starts
with inspect before any mutating repair. Browser-visible inspection must stay
on the sandbox-provided `8080` ingress through a local-only proxy.
The same proof shape is captured in
[`fixtures/protocol/push-protocol-extension-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-protocol-extension-contract.json)
where `remote-example` and `local-dev-site` act as the concrete lab sites for
the remote-base, local-edited, and remote-changed roles.

The production test topology can be written as a short matrix:

| Role | Docker | Playground | Meaning |
| --- | --- | --- | --- |
| `remote-base` | `remote-base` | `remote-base` | Seeds the persisted pull base and the live remote identity. |
| `local-edited` | `local-edited` | `local-edited` | Holds the imported local edits that form the candidate plan. |
| `remote-changed` | `remote-changed` | `remote-changed` | Reuses the same remote identity later to prove drift after dry-run. |
| `runner` | `runner` | local test process | Owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery. |

The same matrix is the proof that the same remote identity is observed twice,
not that two different remotes were involved.

The smallest machine-readable proof for that topology is
[`fixtures/protocol/push-deployment-topology-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-deployment-topology-contract.json).
It keeps the deployment shape separate from the larger auth and recovery
fixtures so focused tests can assert the one-remote, one-local, one-drift
witness boundary directly.

For the compact end-to-end production ladder, cite
[`fixtures/protocol/push-protocol-extension-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-protocol-extension-contract.json).
It binds the exporter/importer handoff, push stage order, pull provenance,
and Docker/Playground topology into one object.

## Runtime Stages

The production push extension has six ordered remote stages:

1. `push_preflight` binds the persisted pull base to the live remote identity
   and mints a short-lived session.
2. `push_snapshot_hashes` lists the live remote comparison set for planning
   only.
3. `push_plan_dry_run` uploads the canonical plan as eligibility evidence and
   returns a receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
5. `push_journal` reads durable evidence without authorizing mutation.
6. `push_recover` starts with `inspect`, then allows finish, rollback, or
   auto only when the journal and fresh live hashes prove the action.

## Endpoint Contract

Each stage has a distinct job and evidence boundary:

| Stage | Writes remote state? | What it proves |
| --- | --- | --- |
| `push_preflight` | No | The persisted pull base matches the live remote identity and the session can be scoped for push. |
| `push_snapshot_hashes` | No | The live remote comparison set is complete enough for planning, but not a lock. |
| `push_plan_dry_run` | No | The uploaded plan is eligible, signed, and receipt-backed, but still stale-able. |
| `push_batch_apply` | Yes | The remote still matches the live preconditions for this batch and its storage boundary. |
| `push_journal` | No | The durable claim, lease, fencing, and idempotency evidence can be inspected safely. |
| `push_recover inspect` | No | The journal plus fresh live hashes classify the attempt as finish, rollback, retry, or block. |
| `push_recover auto|finish|rollback` | Maybe | Mutating recovery is allowed only after inspect and only when fresh live proof says it is safe. |

That split is the core production rule: the listing stage is planning
evidence, the dry-run stage is a receipt, apply is the first write stage, and
recovery is always inspect-first.

Production liveness is split on purpose:

- `push_plan_dry_run` is an eligibility receipt, not a reservation or lock.
- `push_batch_apply` must re-read live remote evidence before every batch and
  again at the storage boundary.
- `push_journal` and `push_recover inspect` are read-only evidence readers.
- Mutating recovery only proceeds after the journal and fresh live hashes
  prove the action.

Recovery uses four concrete restart classifications:

- `old`: the journal proves the prior write already committed.
- `new`: the remote advanced independently and the stale attempt must be
  discarded or replanned from fresh evidence.
- `open`: the attempt is still in flight and inspect-first recovery must
  continue.
- `blocked`: the journal or fresh live hashes prove finish or rollback would
  be unsafe.

Those classifications keep `push_journal` and `push_recover inspect`
read-only. They do not authorize mutation by themselves; they only explain
which mutating recovery path, if any, is safe after fresh live hashes are
checked again.

Recovery also keeps the durable journal boundary explicit:

- the journal row records the claim owner, claim generation, lease expiry, and
  storage guard for the interrupted batch
- `push_recover inspect` must read that journal row before any finish,
  rollback, or auto step
- fresh live hashes must still match the journaled target before a mutating
  recovery path can proceed
- if the journal row and live hashes disagree, inspect returns `blocked`
  rather than trying to repair state blindly

## Pull Handoff

The pull/export/import pipeline maps to push as a one-way provenance handoff:

1. Exporter scans the merge base and coverage evidence.
2. Importer persists the base package as immutable provenance.
3. `push_preflight` binds that package to the live remote identity and a
   short-lived push session.
4. `push_snapshot_hashes` lists the live remote comparison set for planning
   only.
5. `push_plan_dry_run` uploads the canonical plan as eligibility evidence only
   and returns a receipt, not a lock.
6. `push_batch_apply` revalidates the live remote before every batch and at
   the storage boundary.
7. `push_journal` and `push_recover inspect` inspect durable evidence first,
   then allow mutating recovery only when fresh live hashes prove the action.

That mapping is intentionally one-way:

- exporter/importer establish the immutable base package
- push consumes that package as provenance without rewriting it to make a
  stale remote look current
- the live snapshot hash listing is planning evidence only
- the dry-run receipt is eligibility evidence only
- apply must re-read live state before every batch and at the storage
  boundary even when the dry-run receipt is still valid
- the importer must persist enough lineage, coverage, and resource identity to
  let preflight bind the later push session to the exact imported base
- if the persisted base cannot be matched back to the remote identity that
  produced it, push stops before any write-capable stage can begin

The production push ladder maps directly to the pull pipeline:

| Pull artifact or stage | Push consumer | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base to one live remote identity and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it only as planning provenance for the live hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan, but do not reserve a lock. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and again at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

That ladder is the production contract in miniature:

- exporter/importer establish immutable provenance
- preflight binds that provenance to one live remote identity and one short-lived push session
- snapshot hashes remain planning evidence only
- dry-run uploads a canonical plan and returns an eligibility receipt, not a lock
- apply is the first write stage and must revalidate fresh live evidence before every batch and at the storage boundary
- journal inspection stays read-only
- recovery starts with inspect and only mutates when the journal and fresh live hashes prove the action

The recovery path has one more safety rule:

- `push_recover inspect` is not a shortcut to mutation.
- `push_recover finish|rollback|auto` may only run after inspect has already
  read the journal and live hashes and classified the attempt as safe.

The compact proof objects in `fixtures/protocol/` mirror that ladder:

- `push-pull-mapping.json` is the provenance bridge from exporter/importer to
  preflight, planning, apply, journal inspect, and recovery.
- `push-protocol-extension-contract.json` is the shortest end-to-end proof
  that the production push extension maps the pull exporter/importer
  provenance into preflight, remote hash listing, dry-run upload, batched
  apply, journal inspection, and inspect-first recovery while keeping the
  one-remote, one-local, one-drift topology explicit and naming the concrete
  `remote-example` and `local-dev-site` lab identities.
- `push-remote-liveness-contract.json` keeps snapshot listing, dry-run,
  apply, and recovery on separate liveness boundaries.
- `push-dry-run-apply-revalidation-contract.json` records the stale-between
  dry-run-and-apply case and the storage-boundary revalidation rule.
- `push-deployment-topology-contract.json` is the smallest Docker/Playground
  proof for one remote source, one local edited site, one drift witness, and
  one runner.
- `push-topology-matrix.json` is the detailed machine-readable matrix for the
  Docker and Playground topology, including the live drift witness and the
  `8080` ingress constraint.

The importer must preserve enough lineage for that boundary to remain
provable later:

- `pull_protocol_version`, the exporter/importer bundle, and the base manifest
  identify the exact pull contract that may later be reused for push
- the persisted base package keeps the merge-base resources, coverage proof,
  and remote site identity that `push_preflight` must bind before any write
  stage can begin
- the canonical push plan is derived from that immutable base plus the live
  snapshot listing and the edited local tree
- mutating push stages must never rewrite the stored pull base to make stale
  evidence look current

The inspect-first recovery path is always the same:

1. inspect the journal and live hashes
2. classify the attempt as `old`, `new`, `open`, or `blocked`
3. stop immediately when the journal or fresh live hashes cannot prove safety
4. allow `finish`, `rollback`, or `auto` only after inspect proves the mutating path is safe

The same provenance rule is what keeps the one-remote, one-local test topology
honest:

- `remote-base` is the live remote source of truth.
- `local-edited` is the imported local clone that produced the candidate plan.
- `remote-changed` is the same remote identity observed later after drift.
- the runner is the only process allowed to compare, upload, inspect, or recover.
- browser-visible inspection, when needed, must use the sandbox-provided `8080`
  ingress and a local-only proxy, never a remote tunnel.

The same proof shape is what Docker and Playground must both preserve:

- `remote-base` seeds the persisted pull base
- `local-edited` is the imported local site that produces the candidate plan
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor allowed to preflight, plan, upload, inspect, and recover
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy

In other words, the deployable proof is intentionally minimal:

- one remote source site seeds the persisted pull base
- one local edited site produces the candidate plan
- one later remote observation proves drift on the same identity
- one runner process owns preflight, snapshot listing, dry-run, apply,
  journal inspect, and recovery

## Authentication

Authentication is at least as strict as the current Reprint HMAC floor:

- Read-only inspection keeps the existing HMAC family.
- Dry-run, apply, and mutating recovery require the push session, canonical
  push signature, and idempotency key on top of that floor.
- A remote that cannot prove the same identity and session lineage must reject
  the request rather than weakening the read/write boundary.

## Machine-Readable Proofs

The machine-readable companion at
[`fixtures/protocol/push-pull-mapping.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-pull-mapping.json)
captures the one-way handoff in compact form. Tests can use it to prove the
base package stays immutable provenance while push adds session, snapshot,
dry-run, journal, and recovery evidence on top.

The compact auth-and-recovery proof at
[`fixtures/protocol/push-auth-session-journal-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-auth-session-journal-proof.json)
shows the stricter mutating request floor: push-scoped HMAC auth, a short-lived
session, an idempotency key, durable journal fencing, and inspect-first
recovery. The corresponding
[`fixtures/protocol/push-auth-headers.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-auth-headers.json)
fixture keeps read-only inspection on the existing HMAC family while dry-run,
apply, and mutating recovery require the push session plus canonical push
signature.

The compact inspect-first recovery companion at
[`fixtures/protocol/push-recovery-inspect-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-inspect-contract.json)
ties the minted session, journal row, live drift evidence, and blocked-or-safe
recovery decision into one proof object.

The compact production contract at
[`fixtures/protocol/push-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-contract.json)
is the broadest fixture summary. It now spells out the pull-to-push handoff,
the planning-only remote hash listing, the separate dry-run and apply stages,
and the inspect-first recovery split in one machine-readable object.

The stricter auth-and-session companion at
[`fixtures/protocol/push-auth-session-recovery-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-auth-session-recovery-contract.json)
adds the push HMAC floor, the minted session, claim generation, lease expiry,
and inspect-first recovery fencing into one recovery proof.

The cursoring companion at
[`fixtures/protocol/push-snapshot-hashes-page-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-snapshot-hashes-page-contract.json)
keeps the live snapshot listing in the planning-only lane even when the remote
must be paged.

The dry-run/apply boundary companion at
[`fixtures/protocol/push-dry-run-apply-revalidation-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-dry-run-apply-revalidation-contract.json)
keeps the planning receipt, live revalidation, and storage-boundary proof
separate when the remote drifts between dry-run and apply.

The compact topology fixture at
[`fixtures/protocol/push-topology-matrix.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-topology-matrix.json)
captures the same one-remote, one-local, one-drift-witness test shape for
Docker and Playground. Both packaging modes must preserve the same proof
boundary and the same stage order.

The executor-topology companion at
[`fixtures/protocol/push-executor-topology-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-executor-topology-proof.json)
binds the pull pipeline, push stages, auth/session fencing, recovery inspect,
and ingress policy into one compact proof object. It is the shortest
machine-readable summary of the production push contract and the
one-remote/one-local test topology.

## Topology

The test topology is always one remote source, one local edit site, one later
drift witness, and one runner:

- `remote-base` produces the persisted pull base
- `local-edited` is the imported local clone after user edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only process allowed to preflight, list hashes, dry-run,
  apply, inspect the journal, and recover

Docker and Playground must prove the same identity twice, not two different
sites:

| Role | Docker | Playground |
| --- | --- | --- |
| `remote-base` | source-site container on a private network | source-site blueprint that seeds the persisted pull base |
| `local-edited` | imported edited-site container on the same network | separate disposable blueprint with user edits |
| `remote-changed` | the same remote container after live drift | the same remote blueprint after a later mutation |
| `runner` | client container or host process | local test process |

The topology proof only holds when `remote-base` and `remote-changed` are the
same remote identity at different times. If they are different sites, the
proof no longer demonstrates live revalidation.

- Docker keeps the roles on one private network and exposes browser-visible
  inspection only through the sandbox-provided `8080` ingress with a local-only
  proxy.
- Playground uses separate disposable blueprints, but the same remote identity
  split and the same no-tunnel rule.
- `remote-base` and `remote-changed` are the same remote identity observed at
  two different times.

The topology matrix is the canonical machine-readable representation of that
deployment shape. It names the four roles directly, records the `8080` ingress
rule, and keeps Docker and Playground on the same evidence boundaries so tests
can prove the same identity was observed twice.

The end-to-end companion at
[`fixtures/protocol/push-production-ladder-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-production-ladder-contract.json)
ties the pull provenance, push ladder, and Docker/Playground topology into a
single production contract that spans preflight through inspect-first recovery.
Its `remote_liveness` block makes the live-remote boundary explicit: snapshot
hashes are planning evidence only, dry-run is an eligibility receipt only,
apply revalidates before every batch and at the storage boundary, and
mutating recovery still requires fresh live hashes plus journal evidence.

For machine-readable verification, the compact contract fixture at
[`fixtures/protocol/push-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-contract.json)
binds the pull handoff, push stages, and test topology into one proof object.
Its `push_guards` fields make the production boundaries explicit: preflight
binds the pull base to one remote identity and one short-lived session,
snapshot listing is planning evidence only, dry-run is a receipt not a lock,
apply revalidates fresh live evidence at every batch and storage boundary, and
recovery inspect must happen before any mutating repair.

## Read/Write Split

Push is split into a read-only planning phase and a write phase:

- `push_preflight` authenticates and negotiates session and capability state.
- `push_snapshot_hashes` records the live remote hash view used for planning.
- `push_plan_dry_run` uploads a canonical plan and records a non-mutating
  receipt, not a lock.
- `push_batch_apply` executes accepted plans in bounded batches with live
  revalidation before every write and at the storage boundary.
- `push_journal` resolves lost responses and crash ambiguity.
- `push_recover` is the only endpoint allowed to finish, roll back, or block a
  partially applied batch after proof from the journal and live hashes.

The snapshot phase deserves special emphasis: `push_snapshot_hashes` is a live
remote hash listing, not a lock. It must be complete for the requested scope,
cursorable for large sites, and fresh enough only for planning. The executor
may use it to build the dry-run plan, but apply must still re-read live
evidence before every batch and again at the storage boundary. A valid
snapshot listing never upgrades a dry-run receipt into write authority.

`push_journal` is the read-only inspection endpoint for durable evidence.
`push_recover` must enter through `inspect` first, and only then may a
mutating mode proceed when the journal plus fresh live hashes prove the
action. This keeps lost-response recovery and crash recovery on the evidence
side of the protocol until the remote proves it is safe to mutate.

Recovery classification is intentionally narrow:

- `old` means the journal proves the prior write already committed.
- `new` means the remote advanced independently and the stale attempt must be
  discarded or replanned from fresh evidence.
- `open` means the attempt is still in flight and inspect-first recovery must
  continue.
- `blocked` means the journal or live hashes cannot prove that finish or
  rollback is safe.

The read-only inspect step may return any of those classifications, but it
never authorizes mutation by itself. Mutating recovery still requires the same
fresh-live revalidation boundary used by apply.

Minimal wire shapes:

| Endpoint | Required request evidence | Required response evidence |
| --- | --- | --- |
| `push_preflight` | persisted base package, remote identity, requested scope, push-capable HMAC credential | push session, negotiated protocol version, capability set, limits, journal support, auth requirements |
| `push_snapshot_hashes` | push session, requested scope, cursor, batch size | cursorable live hash list, coverage hash, completion proof, blocked or excluded scope evidence |
| `push_plan_dry_run` | push session, canonical plan, canonical push signature, idempotency key, base manifest binding, snapshot binding | dry-run receipt, plan hash, eligibility state, journal or idempotency trace |
| `push_batch_apply` | push session, accepted dry-run receipt, canonical push signature, idempotency key, batch id, fresh live evidence | batch receipt, journal cursor, per-batch outcome, precondition failure or committed proof |
| `push_journal` | push session, dry-run id, cursor, artifact toggle | durable journal rows, claim generation, lease expiry, before/staged/after hashes, storage-guard outcomes |
| `push_recover` | push session, mode, dry-run id, batch id, canonical push signature for mutating modes, idempotency key for mutating modes | inspect evidence or mutating recovery receipt, final journal state, blocked or committed classification |

The server may reject any request that is missing the stored pull base binding
or that reuses stale live evidence as if it were a lock. `push_batch_apply`
must still re-read the live remote even when the dry-run receipt is valid.

Dry-run and apply are separate remote operations. Dry-run proves eligibility
only. Apply is a later live proof step and must revalidate the remote before
every batch and again at the storage boundary. A dry-run receipt may be valid
as a receipt and still be stale as live evidence.

Required behavior:

- `push_preflight` authenticates a push-capable credential at least as strict
  as the current export HMAC, binds the request to the pulled base identity,
  negotiates capabilities, and mints a short-lived push session. The same
  HMAC floor must continue to protect dry-run, apply, and mutating recovery,
  with the push session plus canonical push signature layered on top.
- `push_snapshot_hashes` returns a complete, cursorable live remote hash list
  plus coverage proof for the requested scopes. It is a planning read only and
  must be treated as stale as soon as live remote state changes.
- `push_snapshot_hashes` is the remote snapshot hash listing stage. It never
  upgrades into write authority, even when the listing is complete.
- `push_plan_dry_run` uploads a canonical plan, validates it, and records the
  result in the journal or idempotency store without mutating target resources.
- `push_plan_dry_run` is the dry-run plan upload stage. It produces an
  eligibility receipt only, not a reservation.
- `push_batch_apply` is the normal mutation path and only applies an accepted
  dry-run plan in legal batches.
- `push_batch_apply` must revalidate the live remote again before every batch
  and at the storage boundary, so a valid dry-run receipt can still be stale.
- `push_journal` reports dry-run, apply, idempotency, claim, lease, fencing,
  and recovery state so the executor can resolve ambiguous responses.
- `push_journal` is read-only and exists to let the executor inspect durable
  rows before any mutating retry.
- `push_recover` has a read-only `inspect` mode plus mutating `auto`,
  `finish`, and `rollback` modes. It inspects, finishes, rolls back, or
  blocks an interrupted batch only when journal artifacts and live hashes
  prove the action. `inspect` must happen first, may surface the evidence
  needed to decide the next step, and must not mutate the remote or imply
  recovery safety. A blocked inspection result is required when the server
  cannot prove a safe finish or rollback.

Endpoint specifics:

- `push_preflight` is the only place where the server may mint or refresh a
  short-lived push session. The session is bound to one persisted pull base,
  one remote identity, one write scope, and one authenticated principal.
- `push_snapshot_hashes` returns a cursorable listing of the requested live
  remote hashes, plus a coverage proof that the requested scope was complete
  enough for planning. It is a read-only remote view and never a lock.
- `push_plan_dry_run` accepts the canonical plan derived from the persisted
  pull base, the local edited site, and the live snapshot. It records the plan
  as eligible or blocked, but it never reserves remote liveness. The dry-run
  receipt is only a planning receipt, never an apply permit, and it does not
  weaken the later storage-boundary revalidation.
- `push_batch_apply` is the only normal mutation path. It must revalidate the
  live remote before every batch and again at the storage boundary before any
  write. Dry-run evidence is not sufficient by itself, and a live mismatch at
  either boundary must stop the batch instead of replaying stale proof. A
  valid dry-run receipt never upgrades into liveness authority.
- `push_journal` is a read-only journal inspector for lost-response recovery,
  idempotency resolution, lease/fencing evidence, and apply classification.
  It reads durable journal rows only; it does not mint a new lock or rewrite a
  prior claim. Journal inspection is how the client distinguishes accepted,
  committed, replayable, and blocked results after a timeout or crash. The
  journal rows must expose claim owner, claim generation, lease expiry, the
  before/staged/after hash triplet for each resource, and storage-guard
  outcomes so the executor can classify each resource as old, new, or blocked.
- `push_recover` is the only recovery entrypoint. `inspect` must stay
  read-only; `auto`, `finish`, and `rollback` may mutate only when the journal
  and fresh live hashes prove the action. Recovery must not infer safety from
  a dry-run receipt or a stale journal row.

Preflight therefore produces the three bindings the executor must persist for
later push steps: the push session, the base manifest binding, and the remote
identity binding. Those bindings are provenance, not a write lock, and they
remain valid only until the session expires.

The protocol extension is production-shaped rather than lab-shaped: a dry-run
receipt is only an eligibility artifact, never a lease. The remote may accept
the plan and still reject later apply batches if the live state has drifted.
The live snapshot listing is therefore a planning read, not a reusable write
authority, and recovery evidence must be read fresh from the journal plus the
current remote before any mutating finish or rollback can proceed.

That means a push executor must treat the remote snapshot listing as a fresh
planning view and the apply path as a later live proof step. The remote may
legitimately change between those steps; in that case the apply path must
revalidate and refuse to reuse the older live evidence.

Dry-run is an eligibility and planning receipt, not a liveness reservation.
The remote may accept a dry-run plan and still reject later apply batches if
the live hash listing changes or the storage boundary can no longer prove the
same mutation is safe. Apply must therefore treat the dry-run receipt as
evidence only and re-run the live preconditions before every write.

Remote liveness is checked at apply time, not at dry-run time. A conforming
apply performs two checks and must refresh live evidence before every batch.
It may reuse the dry-run receipt as an eligibility proof, but it must not reuse
dry-run live hashes as apply-time truth:

1. A batch-level live hash check before staging, based on a fresh live remote
   read or hash listing.
2. A mutation-local storage-boundary check immediately before the write.

A mismatch before any batch mutation returns `PRECONDITION_FAILED` without
target writes. A mismatch after staging or after an earlier mutation must be
represented in the journal and resolved as committed, rolled back, or blocked.
It must not be reported as an ordinary success. Dry-run never relaxes this
requirement; it only establishes that the uploaded plan is eligible to reach
apply.

## Endpoint Sequence

The push extension is a six-step protocol with a seventh recovery mode. Only
the apply and mutating recovery steps may change target resources. Dry-run is
always non-mutating, and apply must revalidate the live remote before each
batch.

| Step | Endpoint | Mutates target resources | Role |
| --- | --- | --- | --- |
| 1 | `push_preflight` | No | Authenticates the client, checks capability, and mints a short-lived session. |
| 2 | `push_snapshot_hashes` | No | Lists the current live remote hashes and coverage for planning. |
| 3 | local planner | No | Builds a three-way plan from pull base, local site, and live remote hashes. |
| 4 | `push_plan_dry_run` | No | Validates the uploaded plan and records a dry-run journal entry. |
| 5 | `push_batch_apply` | Yes | Revalidates live preconditions and storage boundaries before writing. |
| 6 | `push_journal` | No | Lets the executor resolve lost responses, crashes, and ambiguous apply states. |
| 7 | `push_recover` | Mode-dependent | `inspect` is read-only; mutating modes finish, roll back, or block only when journal artifacts and live hashes prove the action. |

`snapshot_id`, `coverage_hash`, `dry_run_id`, and `journal_cursor` are evidence
and request bindings. They are not remote locks. A remote edit between any
non-mutating step and apply must be detected by apply revalidation and must
preserve the remote edit unless a newly planned mutation explicitly covers it.
The live evidence used for apply must be fetched fresh, not copied from the
dry-run receipt.

The pull exporter/importer handoff is one-way:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. push preflight binds that package to the live remote identity and session
4. push snapshot hashes list the current live comparison set for planning
5. push dry-run uploads the canonical plan derived from base, local, and live
6. push apply revalidates the live remote before every batch and at the storage boundary
7. push journal and push recover inspect read durable evidence only

The executor should treat that mapping as the production boundary: the pull
package stays immutable provenance, while push is a later live mutation path
that must still refresh remote evidence before every batch.
The importer never rewrites the stored base package to match later live
evidence; it only preserves the immutable provenance that preflight binds to
the remote identity.

That handoff is intentionally asymmetric. Export/import proves the merge base
and scope coverage. Push consumes that base as provenance, then proves remote
liveness again at apply time instead of promoting the snapshot listing into a
write lock.

The pull package stays immutable throughout this handoff:

- exporter/importer creates the persisted merge base and coverage proof
- push preflight binds that immutable base to the live remote identity and a
  short-lived session
- push snapshot hashes are planning evidence only
- push dry-run uploads the canonical plan as eligibility evidence only
- push batch apply revalidates live state before every batch and again at the
  storage boundary
- push journal and push recover inspect read evidence before any mutating
  recovery mode can proceed

The production test topology is the same in Docker and Playground, only the
packaging differs:

- `remote-base` is the remote source site that produced the persisted pull
  base package.
- `local-edited` is the imported site after user edits.
- `remote-changed` is the same remote site observed later after independent
  drift.
- `runner` is the only actor allowed to compare, upload, inspect, or recover.
- `remote-base` and `remote-changed` are two observations of the same remote
  identity at different times, which is what proves live revalidation.

This same proof must hold in both packaging modes:

- one remote identity is observed twice, first as `remote-base` and later as
  `remote-changed`
- one local edited site stays separate from the live remote
- the runner is the only actor allowed to compare, upload, inspect, or
  recover
- dry-run and apply remain separate remote calls, and apply must revalidate
  fresh live evidence before every batch and again at the storage boundary
- mutating push requests require at least the current Reprint HMAC floor plus
  the short-lived push session and canonical push signature

The precise topology contract is the same for Docker and Playground:

- one remote source role seeds the persisted pull base
- one local edited role builds the candidate plan
- one drift witness role proves the remote can change between dry-run and apply
- one runner role performs comparison, upload, journal inspection, and recovery
- browser-visible inspection must go through the sandbox-provided `8080`
  ingress with a local-only proxy
- remote tunnels are disallowed

For Docker, keep the three site roles on one private network and expose only
browser-visible inspection through the sandbox-provided `8080` ingress via a
local-only proxy. For Playground, use separate disposable blueprints for the
same three roles and keep the same no-tunnel rule. In both cases, the test is
only valid if `remote-base` and `remote-changed` are the same remote identity
at different times, because that is what proves `push_batch_apply`
revalidates live state instead of replaying the dry-run receipt.

The compact machine-readable proof for this boundary lives in
[`fixtures/protocol/push-contract.json`](../fixtures/protocol/push-contract.json).
It binds the pull handoff, protocol sequence, and Docker/Playground topology
into one contract so tests can assert the production shape without re-parsing
the full prose spec.

The stage-order proof lives in
[`fixtures/protocol/push-flow.json`](../fixtures/protocol/push-flow.json), the
topology proof lives in
[`fixtures/protocol/push-topology-matrix.json`](../fixtures/protocol/push-topology-matrix.json),
and the shortest end-to-end packaging proof lives in
[`fixtures/protocol/push-production-ladder-contract.json`](../fixtures/protocol/push-production-ladder-contract.json).

Recovery is inspect-first:

1. read the journal
2. inspect the live hashes
3. classify the batch as finishable, rollback-only, retryable, or blocked
4. only then choose a mutating recovery mode

The inspect result maps the attempt into four recovery states:

- `old` means the journal proves the prior write already committed and no
  repair is needed.
- `new` means the remote advanced independently and the stale attempt must be
  abandoned or replanned from fresh evidence.
- `open` means the batch is still in flight and the executor must continue
  inspect-first recovery.
- `blocked` means the journal or fresh live hashes prove that finish or
  rollback would be unsafe.

The recovery modes have distinct authority:

- `inspect` is always read-only and may only surface journal and live-hash
  evidence.
- `auto` may mutate only when the journal and fresh live hashes prove the
  repair is safe without further operator choice.
- `finish` may mutate only when the journal shows the batch can be completed
  without violating the latest live state.
- `rollback` may mutate only when the journal and live hashes prove the
  target can be returned to the prior state without ambiguity.
- `blocked` is a terminal evidence result, not a repair mode. It means the
  remote cannot prove a safe finish or rollback with the evidence currently
  available.

## Pull Pipeline Mapping

Push reuses the existing pull exporter/importer as the base truth source.
Pull still discovers and records the merge base. Push consumes that base and
adds live-remote revalidation and mutation journaling. The mapping is explicit:
the pull exporter/importer produces the persisted base package, and push reads
that package as immutable provenance rather than re-exporting or rewriting it.
The remote hash listing is similarly one-way evidence: it informs planning, but
it does not reserve the remote or survive as apply-time truth.

The pull pipeline remains the source of truth for the base package:

- exporter scans and serializes the merge base and coverage evidence
- importer persists the base package as read-only provenance for later push
- push preflight binds that provenance to the live remote identity and session
- push snapshot hashes compare the live remote against the persisted base
- push dry-run uploads the canonical three-way plan from base, local, and live
- push apply revalidates the live remote before every batch and again at the
  storage boundary
- push journal records claim ownership, claim generation, lease expiry, and
  per-resource before/staged/after hashes without turning the persisted base
  into a lock
- push recover inspects that journal first and only mutates when fresh live
  hashes and journal evidence prove the action

The persisted pull package is the immutable handoff object for push:

- `base_manifest_id` and `base_manifest_hash` identify the exact exported
  lineage that was pulled.
- `base_coverage_hash` proves the pull scope was complete enough to plan
  against later.
- `remote_site_id` and the resource hashes bind the package to one remote
  identity.
- `push_snapshot_hashes` produces fresh planning evidence only.
- `push_plan_dry_run` proves eligibility only.
- `push_batch_apply` must re-read and revalidate live remote state before
  every batch and again at the storage boundary.
- `push_journal` and `push_recover inspect` explain durable state without
  turning old proof into current authority.

| Pull stage | Push mapping |
| --- | --- |
| `preflight` | `push_preflight` checks protocol support, auth scope, writable roots, database transaction support, budgets, and journal storage. |
| `file_index` / `file_fetch` | `push_snapshot_hashes` lists remote file hashes and metadata without returning bodies. Optional conflict drill-down may reuse pull fetch endpoints. |
| `sql_chunk` / `db_index` | `push_snapshot_hashes` lists row, option, post, term, user, schema, and plugin-owned resource hashes. |
| `db-apply` | The push planner compares the saved pull base, the edited local site, and the live remote hash list to produce a dry-run plan. |
| runtime setup | Push apply validates runtime-sensitive mutations such as plugin/theme activation, generated files, object cache, cron, and maintenance mode gates before write. |

The importer must persist a push base package so later pushes can prove the
merge base. This package is read-only evidence for later push planning:

- `base_manifest_id`
- `base_manifest_hash`
- `base_coverage_hash`
- `remote_site_id`
- `pull_protocol_version`
- the resource keys, hashes, and optional bodies observed during the pull
- the pull-time remote coverage hash and any scope-completion proof that
  showed the base was complete enough for later mutation

That persisted package is what `push_preflight` binds to the live remote. The
server does not re-export the base during push; it only verifies that the
stored pull package still identifies the same remote lineage and requested
scope. The live remote hash listing is then used as fresh planning evidence,
while the dry-run receipt and journal rows capture eligibility and replay
proof without becoming a lock.

The executor should treat the pull/export/import handoff as a chain of
provenance:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. preflight binds that package to a live remote identity and a short-lived
   push session
4. snapshot hashes provide the fresh planning view for the requested scope
5. dry-run uploads the canonical plan derived from base, local, and live
6. apply revalidates the live remote before every batch and at the storage
   boundary
7. journal and recovery inspect read durable evidence only

Recovery is inspect-first because the journal can prove ownership and liveness
without proving safety. A recovery inspect result may be enough to choose the
next mutating mode, but it never replaces fresh live hashes.
- the durable journal row fields used for claim, lease, and fencing proof

If the remote cannot recognize the site identity or the plan cannot prove
which base it was built from, `push_preflight` or `push_plan_dry_run` must
reject. A later push may refresh live remote hashes, but it must not rewrite
the stored pull base to make an old plan look current.

The session boundary is equally strict. `push_preflight` may mint or refresh
the short-lived push session, but only for the same remote identity, same base
manifest lineage, and same requested scope. Any later request that changes the
remote identity or scope must obtain a fresh session rather than reuse the old
one.

Authentication is also one-way. A credential that can only prove the read-only
export HMAC may still be enough for pull endpoints and snapshot listing, but it
must not unlock dry-run upload, batched apply, journal repair, or mutating
recovery. Those calls require the push session plus the canonical push
signature, and the server must recheck them against the live remote before any
write.

The pull-to-push handoff is linear and one-way:

1. Pull exports the base package and coverage evidence.
2. Local editing mutates the imported site.
3. Push preflight binds that stored base to the live remote identity and session.
4. Push snapshot listing records the current remote hash view for the requested
   scope and coverage proof.
5. Push dry-run uploads the canonical three-way plan and records eligibility
   only.
6. Push apply revalidates the live remote before every batch and again at the
   storage boundary before any write.
7. Push journal and recovery inspect explain durable state transitions without
   granting authority to mutate.
8. Push journal and recovery inspect resolve lost responses or interrupted
   apply attempts without turning stale evidence into write authority.

The pull/export/import pipeline maps to push like this:

- `exporter` discovers the merge base, coverage evidence, and resource hashes
  for the pull base package.
- `importer` persists that package as immutable provenance, including the base
  manifest, coverage hash, requested scope, and remote identity binding.
- `push_preflight` binds the stored package to the live remote identity and
  mints a short-lived push session for that same lineage and scope.
- `push_snapshot_hashes` is the fresh live planning read that lists the remote
  comparison set and coverage for the requested scope.
- `push_plan_dry_run` uploads the canonical three-way plan and records
  eligibility only.
- `push_batch_apply` revalidates the live remote before every batch and again
  at the storage boundary before any write.
- `push_journal` resolves lost responses and crash ambiguity from durable
  journal evidence without turning the pull package into a lock.
- `push_recover inspect` reads journal and live-hash evidence first; only
  mutating recovery modes may change state, and only when that evidence proves
  the action.

The existing pull exporter/importer pipeline remains the source of truth for the
persisted merge base. Push does not add a second export format or a second notion
of base ownership. Instead, it layers live remote proof on top of the pull
artifacts already stored on disk:

- pull exporter/importer creates `push-base/` and the immutable base manifest
- push preflight binds that package to the live remote identity and write scope
- push snapshot hashes list the live remote comparison set for the requested scope
- push dry-run uploads the canonical plan derived from the pulled base plus local edits
- push apply revalidates the live remote before every batch and again at the
  storage boundary
- push journal and recovery inspect read durable evidence only, and never
  rewrite the persisted pull base to make a stale plan look current

The machine-readable handoff fixture at
[`fixtures/protocol/push-pull-mapping.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-pull-mapping.json)
captures the pull-to-push provenance boundary for tests. The topology fixture
at
[`fixtures/protocol/push-topology.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-topology.json)
captures the one-remote, one-local, one-drift-witness test shape plus the
sandbox-only `8080` ingress rule used for Docker or Playground proof.
The journal fixture at
[`fixtures/protocol/push-journal-open-response.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-journal-open-response.json)
captures the fenced open-claim state, including claim generation and lease
expiry, so tests can distinguish an open claim from a committed batch.
The session proof fixture at
[`fixtures/protocol/push-session-journal-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-session-journal-proof.json)
captures the short-lived session, apply-time revalidation, and inspect-first
recovery proof tuple used to reject stale dry-run evidence.
The recovery decision fixture at
[`fixtures/protocol/push-recovery-decision.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-decision.json)
captures the inspect-first rule that keeps `push_recover` read-only until
fresh live hashes and journal evidence justify `finish`, `rollback`, or
`auto`.
The recovery path fixture at
[`fixtures/protocol/push-recovery-path.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-path.json)
captures the old/new/blocked/open classification that the executor uses after
an ambiguous apply response and before any mutating recovery mode.

The pull exporter/importer owns the persisted base package and the base
coverage evidence. Push never asks pull to become a write lock. Instead, push
uses the persisted base package as immutable provenance and layers new
attempt-state evidence on top:

- the imported base manifest proves which remote lineage the local site came
  from
- the saved coverage hash proves which scopes were complete enough to plan
  against
- the remote hash listing proves what the live remote looked like at planning
  time
- the dry-run receipt proves the uploaded plan was eligible, not still live
- the journal proves what happened when apply was interrupted or ambiguous

An implementation may reuse the pull transport, cursoring, budgeting, and HMAC
helpers, but it must not reuse the pull streaming export format as the push
mutation format.

The persisted pull package is therefore evidence, not authority:

- `base_manifest_id` and `base_manifest_hash` prove which exported lineage the
  local site came from.
- `base_coverage_hash` proves the pull scope was complete enough for later
  push planning.
- `remote_site_id` and the pull-time resource hashes prove the plan is bound to
  one remote identity.
- `push_snapshot_hashes` supplies the live remote comparison set.
- `push_plan_dry_run` proves only that the uploaded plan was eligible.
- `push_batch_apply` must still re-read and revalidate the live remote before
  each batch and again at the storage boundary.
- `push_journal` and `push_recover inspect` only explain what happened; they do
  not turn an old proof into a current lock.

For the existing exporter/importer pipeline, the pull package is the exact
handoff point:

- exporter produces the merge-base snapshot and the scope coverage evidence
- importer persists that package unchanged as read-only provenance
- push preflight binds that package to one remote identity and one session
- push snapshot listing refreshes the live comparison set for planning
- push dry-run uploads the canonical plan derived from base, local, and live
- push apply revalidates the live remote before every batch and again at the
  storage boundary

This preserves the pull pipeline as the source of truth for the base package
while push adds live-remote proof on top of it.

The remote snapshot listing is the planning view, not the write lock. Any
remote change after snapshot listing, dry-run, or journal inspection must be
considered live until apply revalidates the batch at the storage boundary.
`push_journal` and `push_recover inspect` reuse durable evidence only; neither
call creates a lock or authorizes a later mutation by itself. They can surface
an open claim, a claim generation, and a lease expiry so the executor can tell
whether a worker was fenced before a mutation boundary, but that evidence is
still only proof, not permission.

The hash listing is also how the executor proves scope completeness before it
uploads a dry-run plan. If the live listing is partial, blocked, or incomplete
for the requested scope, the executor must stop before dry-run and refresh the
remote view rather than guessing from the persisted pull base. A stale or
partial listing is not eligible for dry-run upload, even when the persisted
pull base is complete. Apply must fetch fresh live evidence again before every
batch and treat the dry-run listing as stale if the remote changed after it
was recorded.

Recovery classification:

- `committed`: every intended mutation is present, and the final hashes match
  the accepted plan.
- `rolled_back`: no target resource changed, or the server proves the batch
  was fully reversed with matching evidence.
- `blocked`: the journal or live hashes do not prove a safe finish or rollback.
- `open`: the batch is still in flight or the journal shows a live claim that
  may resume under the same request identity.

The inspect-first recovery fixture set includes both a successful evidence
read and a blocked evidence read:

- `push-recovery-inspect-response.json` shows the journal and live-hash review
  result when inspect can narrow the next safe step.
- `push-recovery-inspect-blocked-response.json` shows the same inspect call
  when the remote can prove that finish or rollback is not safe.

The existing pull exporter/importer still owns the base package format. Push
does not invent a second notion of truth; it layers live remote verification
and mutation receipts on top of the pull artifacts already persisted on disk.
The only new persistent push-side evidence is the attempt state directory and
the durable journal rows that describe preflight, snapshot listing, dry-run,
batch apply, journal inspection, and recovery. The executor may reuse pull
transport, cursoring, budgeting, and HMAC helpers, but it must not reuse pull
streaming export payloads as push mutation payloads.

For wire-contract consumers, the production sequence is intentionally strict:

1. `push_preflight` negotiates protocol support, write scope, and journal
   capability against the live remote.
2. `push_snapshot_hashes` lists the current remote hashes and coverage for the
   exact planning scope.
3. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt only.
4. `push_batch_apply` revalidates the live remote again before every batch and
   at the storage boundary.
5. `push_journal` inspects durable evidence after a timeout, crash, or lost
   response.
6. `push_recover` begins in `mode: "inspect"` and only proceeds mutating when
   the journal and live hashes prove the repair is safe.

The same stage order is also captured in
[`fixtures/protocol/push-flow.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-flow.json)
so focused tests can assert the exact flow without re-encoding the sequence.

## Pull-To-Push Topology

The production-shaped topology is one remote source, one edited local clone,
and one runner. That shape is reused for both Docker and Playground.

- `remote-base` is the source site that produced the persisted pull base
- `local-edited` is the imported site after user edits
- `remote-changed` is the same remote site after live drift between dry-run
  and apply
- `runner` is the only process allowed to compare, upload, inspect, and
  recover

The topology is intentionally asymmetric:

- `remote-base` seeds the persisted pull base package and the live source
  identity
- `local-edited` supplies the imported and edited local clone that becomes the
  candidate plan
- `remote-changed` proves dry-run and apply are separate remote operations by
  drifting the same remote site after planning
- `runner` is the only actor that may perform preflight, snapshot listing,
  dry-run, apply, journal inspection, and recovery

For Docker, keep the source and edited sites isolated on separate databases or
volumes so drift is visible without contaminating the local edit history. No
WordPress container should publish a public port. If browser-visible
inspection is needed, use only the sandbox-provided `8080` ingress through a
local-only proxy inside the sandbox, and never a tunnel service.

For Playground, use separate disposable blueprints for `remote-base`,
`local-edited`, and `remote-changed`, and keep the same `8080` ingress rule
for any browser-visible inspection. The point of the topology is to prove that
apply revalidates live state rather than replaying a stale dry-run receipt.

The Docker and Playground proofs are the same at the protocol level:

1. Pull seeds `remote-base` and persists the base package.
2. Local editing mutates `local-edited` without mutating the live remote.
3. `push_preflight` binds the saved base to the remote identity and session.
4. `push_snapshot_hashes` records fresh live evidence for planning.
5. `push_plan_dry_run` uploads the canonical plan as eligibility only.
6. `push_batch_apply` revalidates the live remote before every batch and at
   the storage boundary.
7. `push_journal` and `push_recover inspect` explain ambiguity without
   turning stale proof into authority.

## Authentication

All push endpoints require authentication at least as strict as current Reprint
HMAC authentication.

The current HMAC floor is required on every push request:

- `X-Auth-Signature`
- `X-Auth-Nonce`
- `X-Auth-Timestamp`
- `X-Auth-Content-Hash`

The server verifies freshness, nonce length, content hash, and
`HMAC-SHA256(nonce + timestamp + content_hash, shared_secret)` exactly as the
current exporter does.

Mutating push endpoints also require a push canonical signature:

- `X-Reprint-Push-Signature`
- `X-Reprint-Push-Session`
- `X-Reprint-Push-Idempotency-Key`

`push_snapshot_hashes` and `push_journal` remain read-only and therefore keep
using the existing HMAC floor without the mutating push signature, but they
still inherit the same nonce and freshness rules as other authenticated
requests.

The canonical signature is:

```text
HMAC-SHA256(
  "REPRINT-PUSH-V1" + "\n" +
  push_protocol_version + "\n" +
  method + "\n" +
  endpoint + "\n" +
  canonical_query + "\n" +
  content_hash + "\n" +
  push_session + "\n" +
  idempotency_key,
  shared_secret
)
```

Rules:

- The first line is a fixed domain separator. It must not be reused by pull
  export signatures, lab-only route profiles, or future incompatible push
  versions.
- `push_protocol_version` is the version negotiated by `push_preflight`.
- `content_hash` must match `X-Auth-Content-Hash`.
- `push_session` is minted by `push_preflight` and expires quickly.
- `idempotency_key` is unique per dry-run upload or apply batch.
- Nonces must be rejected on replay within the timestamp window.
- The shared secret must be scoped for push. A read-only export secret must not
  authorize mutation endpoints.
- Apply endpoints must require TLS outside local-only test topologies.

If a server supports only the current export HMAC and not the canonical push
signature, it may serve pull endpoints and hash listing, but it must reject
dry-run upload, apply, journal repair, and recovery mutation. That preserves
the pull contract while making push strictly more restrictive.
Push-capable servers may still require the export HMAC on every push request
because push builds on the same authentication floor as pull.

`push_preflight` is the only step that may mint a push session. It must bind
that session to the authenticated remote site identity, the persisted pull base
package, and the negotiated push protocol version before any planning or
mutation call can proceed.

Endpoint authentication requirements:

| Endpoint | Target resource mutation | Minimum auth |
| --- | --- | --- |
| `push_preflight` | No | Current Reprint HMAC with push-capable credential scope. |
| `push_snapshot_hashes` | No | Current Reprint HMAC and active push session. |
| `push_plan_dry_run` | No | Current Reprint HMAC, canonical push HMAC, active push session, and idempotency key. |
| `push_batch_apply` | Yes | Current Reprint HMAC, canonical push HMAC, active push session, and idempotency key. |
| `push_journal` | No | Current Reprint HMAC and active push session; artifact export may require canonical push HMAC. |
| `push_recover` `inspect` | No | Current Reprint HMAC and active push session. |
| `push_recover` mutating modes | Yes | Current Reprint HMAC, canonical push HMAC, active push session, and idempotency key. |

The canonical query string must be built from the actual received route and
query parameters after URL decoding rules are fixed by the server. The endpoint
name, method, query, body hash, session, negotiated protocol version, domain
separator, and idempotency key are part of the signature so a signed dry-run
body cannot be replayed as apply, against another route, under another session,
or across a different Reprint signing protocol.

## Identity, Idempotency, And Coverage

### Site Identity

Push must target the same remote that produced the local base. The remote
identity is not the raw URL alone because domain names can change between pull
and push. The server should expose a stable `site_id` plus hashed evidence:

- canonical home/site URL hashes
- WordPress install salt or generated Reprint site identity hash
- table prefix and multisite mapping
- exporter protocol and push protocol versions
- scanner coverage hash from the pull base when available

The executor may update stored remote URLs after an explicit user action, but
it must not silently retarget a push to a different `site_id`.

### Pull Base Binding

The push protocol consumes the persisted pull base as its merge base. The pull
pipeline must therefore store enough evidence for later push planning:

- `base_manifest_id`
- `base_manifest_hash`
- `base_coverage_hash`
- `remote_site_id`
- `pull_protocol_version`
- the resource keys, hashes, and optional bodies that were observed during the
  pull

That persisted base is the local truth source for:

- which remote site was originally pulled
- which resource keys existed at pull time
- which hashes are the expected base values for a three-way push plan
- which scopes were scanned completely enough to permit later mutation
- which cursor-completion proofs must be preserved when a later push wants a
  wider or overlapping scope

It is read-only evidence, not a mutable cache. `push_preflight` checks that
the base still belongs to the live remote identity, `push_snapshot_hashes`
compares the stored base hashes against the live remote listing, and
`push_plan_dry_run` uploads the canonical three-way plan built from base,
local, and live remote evidence. Recovery never rewrites the base package; it
only uses the stored evidence to classify committed, replayable, or blocked
state after a lost response or process crash.

Push planning must stop if the stored base package is missing, corrupt,
incomplete for the requested scope, or bound to a different remote identity.
The push planner may still call `push_snapshot_hashes` for inspection, but it
must not upload a dry-run plan without a complete pull base for the intended
scope.

### Idempotency

`X-Reprint-Push-Idempotency-Key` is required for `push_plan_dry_run`,
`push_batch_apply`, and mutating recovery modes. The body may repeat the
`idempotency_key`; if present, it must match the header. The remote stores a
hash of the canonical request body and authenticated identity with each key.

Server behavior:

- Same key, same body, same authenticated identity: return the original result
  or current in-progress journal state without fresh mutation work.
- Same key, different body or different identity: reject with
  `IDEMPOTENCY_KEY_CONFLICT` before mutation.
- Lost response during apply: the executor inspects `push_journal` before
  retrying and retries only with the same key and same body.

### Recovery Rules

`push_journal` and `push_recover` are the ambiguous-response escape hatch.
They let the executor distinguish four cases:

- the batch never started,
- the batch committed and the response was lost,
- the batch is open but still recoverable,
- the batch is blocked by a newer remote edit or a corrupt journal.

Recovery is inspect-first. `push_recover` in `inspect` mode is read-only and
must explain why later mutating recovery is safe, unsafe, or blocked. Mutating
recovery modes use the same auth and idempotency rules as apply, and they
revalidate the live remote again before changing target state.

The recovery journal evidence must be sufficient to classify the attempt as
one of four outcomes without reusing dry-run receipts as locks:

- `never_started`
- `committed`
- `recoverable_open`
- `blocked`

If the server cannot prove a safe finish or rollback from the journal plus
fresh live hashes, `push_recover inspect` must return a blocked result rather
than guessing.

### Snapshot Coverage

`push_snapshot_hashes` returns a coverage manifest as well as resources. The
coverage manifest describes what was scanned, which scanner or semantic driver
owned each scope, which resources were excluded, and whether unknown plugin or
environment-specific data forced a block.

A coverage manifest includes:

- `coverage_id` and `coverage_hash`
- scanner version and hash algorithm
- included roots, tables, plugins, themes, and multisite blog IDs
- cursor completion proof for every requested scope
- excluded generated/cache/runtime resources with policy reasons
- blocked unknown resources that make the plan ineligible for apply
- a complete remote hash listing for the requested scope, including absent
  entries for base keys when requested
- cursor proofs showing that the hash listing was complete for the requested
  scope and page range

Dry-run must reject a plan whose `remote_coverage_hash` does not match the
accepted remote hash listing or whose requested mutations depend on resources
outside covered scopes. Apply must still revalidate the live resources; coverage
only proves the planner had a complete enough view to propose a plan.

Dry-run is therefore an eligibility receipt, not a liveness lock. The remote
may accept the plan and later reject the same batch at apply time if the live
hashes or storage-boundary proof changed.

### Current Playground Auth Lab

`npm run test:playground:authenticated-http-push` is lab HMAC evidence, not
the production push protocol. It verifies authenticated local Playground
source-site mutation under `/wp-json/reprint-push-lab/v1/authenticated/*`
with Basic-auth-shaped Application Password credentials for bootstrapped
users, `manage_options`, auth-bound receipts, `AUTH_RECEIPT_MISMATCH`,
`AUTH_RECEIPT_EXPIRED`, `X-Reprint-Push-Idempotency-Key`, stale no-data-loss,
and replay with zero fresh mutation work. Signed requests are required for
`/authenticated/preflight`, `/authenticated/dry-run`, and
`/authenticated/apply`.

The lab verifier checks signatures before JSON parsing, receipt validation,
idempotency lookup or claim, journal writes, or mutation. `X-Auth-Content-Hash`
is SHA-256 over the raw request body bytes. The auth signature covers
`X-Auth-Nonce`, `X-Auth-Timestamp`, and the content hash. The push signature
binds the lab domain separator, method, actual path, canonical query, content
hash, server-minted lab push session, and idempotency key. Preflight mints
short-lived lab push sessions; dry-run and apply require the session plus
`X-Reprint-Push-Idempotency-Key`. Nonce replay rejects before idempotency
replay, while replay with a fresh nonce/signature still works with zero fresh
mutation work.

Tests cover unsigned, malformed, bad hash, body changed after signing,
stale/future timestamp, wrong method/path/query, wrong session, idempotency
mismatch, public-route signature attempts, nonce replay, and positive signed
preflight, dry-run, apply, and replay. Responses expose stable hash evidence
such as credential/signing-key hashes for lab proof and are not a production
response contract. Production Reprint auth still needs TLS deployment,
nonce/replay store cleanup, production session handling, real exporter
credential binding, durable production audit records, and full production push.

`npm run test:playground:authenticated-cli-push` now verifies the same lab
protocol through the `reprint-push-lab push-authenticated` command. That CLI
fetches the source snapshot, builds a fresh three-way plan from base/local
snapshot files, signs preflight/dry-run/apply, applies with an idempotency key,
refuses a changed source as `PLAN_NOT_READY_LOCALLY` before mutation, and
refuses post-snapshot source drift as `PRECONDITION_FAILED` before apply.

Playground fallback caveat: core Application Password auth did not establish
`/wp-json/wp/v2/users/me`, so the lab route validates stored hashed
app-password entries and sets the current user before capability checks.
Public legacy lab routes remain public/mutable; HMAC applies only to
`/authenticated/*` aliases.

### Current Fixture Plugin Atomicity Lab

`npm run test:playground:plugin-atomic-install` is protocol-shape evidence for
a hard-coded local Playground fixture plugin install, not production plugin
installation support. Through the local lab REST path it proves that a ready
plan can carry a dependency plugin, dependent plugin, exact fixture plugin
files, plugin resources, and allowlisted plugin-owned option data in one atomic
group; apply activates both fixture plugins and replay performs zero fresh
mutation work.

Negative protocol evidence covers missing dependency, dependency outside the
group, incompatible version, hash mismatch, activation requirement mismatch,
remote dependency drift, stale preconditions, stale live-remote dependency
evidence, forged ready plans missing dependency mutation/`atomicGroups`/
dependency requirements, and row-only plugin-owned data bypass attempts. The
row-only bypass rejects with `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`. The lab
keeps an exact fixture plugin file/resource allowlist and blocks arbitrary
plugin files, direct `active_plugins` row mutation, custom tables outside the
exact forms lab driver, and arbitrary plugin-owned data. The exact
`wp_reprint_push_forms_lab` driver `fixture-forms-lab-table` is fixture-only:
owner `forms`, positive `id:N`, explicit policy, unchanged active
`reprint-push-forms-fixture` evidence, precondition hashes, exact PHP
table/column/payload validation, delete blocked, idempotent replay with zero
fresh mutation work, and redacted hash-only journal/recovery evidence. Failure
injection classifies before-commit as
old-remote and during-publish/activation failure as blocked/non-complete
recovery evidence; it does not prove rollback.

The same lab path now performs a just-in-time pre-write hash check for each
mutation target. A live target drift after dry-run and after initial apply
validation, but before mutation `N` writes, returns `PRECONDITION_FAILED`,
preserves the drifted target, writes no `mutation-applied` event for `N`,
writes no later mutations, and writes no `apply-committed`. Plugin atomic
activation has one fixture-scoped exception: an activation-style plugin
mutation whose planned value has `active: true` may see the inactive staged
plugin hash if a prior same-apply fixture plugin file mutation already applied
and the declared ready atomic group explicitly covers both the file mutation
and plugin mutation. The journal marks that case with
`preconditionCheck: same-apply-staged` and `preWriteStagingProof`. Forged
mutation-local group ids without declared group coverage and planned inactive
plugin mutations do not use the exception. This is lab protocol evidence, not
generic production plugin support.

For the accepted storage-boundary DB update slice, that JIT hash check still
runs first. If it passes, existing fixture row updates for `wp_posts`,
allowlisted `wp_options`, allowlisted single-row `wp_postmeta`, and exact
positive-id `wp_reprint_push_forms_lab` rows use one guarded
`$wpdb->query($wpdb->prepare(...))` `UPDATE` with expected stored-column
predicates at the SQL write boundary. The evidence is hash-only
`storageGuard` data: boundary, driver, logical and physical table, operation,
compared column names, expected resource hash, expected storage hash, rows
affected, outcome, and SQL shape hash. If the row storage drifts after JIT but
before SQL, including marker-empty ownership drift for posts or postmeta parent
posts, the guarded update affects zero rows and apply returns
`PRECONDITION_FAILED` without `mutation-applied` for that failed target,
without later mutations, and without `apply-committed`. This is local
Playground/SQLite fixture evidence only. It is not production DB durability,
not production Reprint HTTP mutation, not generic MySQL/InnoDB CAS proof, not
transactions or locking, not rollback, and not storage guarding for
inserts/deletes/files/plugin activation or arbitrary plugin/custom-table
semantics.

For the accepted storage-boundary file update slice, the same JIT hash check
still runs first. If it passes for an existing fixture file update under an
accepted fixture upload path or named fixture plugin file path, the apply path
compares the live file bytes/hash against the storage value observed after JIT,
writes the planned content to a temp file in the same directory, then renames
after the boundary comparison. Existing fixture upload file deletes compare the
same storage value before unlinking. Positive evidence from
`npm run test:playground:storage-guarded-file-write` covers an existing fixture
upload file update, a fixture upload file create, and a fixture upload file
delete with `storageGuard.outcome: applied`. The failure path injects drift
after JIT but before update/create/delete and returns `PRECONDITION_FAILED`,
preserves the drifted file state, records no `mutation-applied` for the failed
file, runs no later mutations, and records no `apply-committed`; same key/body
replay does no fresh mutation work and same key/different body conflicts.
Evidence is hash-only: boundary `filesystem-compare-rename` for update/create
or `filesystem-compare-unlink` for delete, driver, operation, logical fixture
path, compared fields, expected resource/storage hashes, actual/planned storage
hashes, physical path hash, and outcome. It exposes neither raw file contents
nor absolute host paths. This is local Playground fixture evidence only, not
production filesystem durability, not `fsync`, not a production filesystem
CAS/lock, not rollback, not arbitrary files, not production Reprint HTTP
mutation, and not a generic WordPress filesystem safety proof. The code path
supports named fixture plugin file update paths, but the standalone smoke
exercises upload-file update/create/delete only.

## Resource Model

A push resource is the smallest unit that can be compared and guarded by a
precondition.

Resource keys are stable strings:

- `file:<normalized-path>`
- `row:<json-array [table, primary-key-shape]>`
- `schema:<table>`
- `option:<option-name>`
- `plugin:<plugin-slug>`
- `theme:<stylesheet>`
- `runtime:<capability-name>`

Every listed resource has:

- `resource_key`
- `resource_type`
- `hash`: canonical hash of the effective resource value
- `content_hash`: raw file or row payload hash when applicable
- `semantic_hash`: optional plugin/theme driver hash
- `owner`: plugin/theme/core ownership hint
- `size_bytes` or `row_bytes` when known
- `mtime` or database write watermark when known
- `capabilities`: operations the server can safely perform for that resource
- `storage_guard`: how the server can recheck and write the resource at the
  storage boundary, such as `mysql-transaction-row-lock`,
  `sqlite-immediate-guarded-update`, `filesystem-compare-rename`, or
  `semantic-driver`

The canonical resource hash must be independent of listing order, PHP array
iteration order, SQL dump formatting, and host-specific absolute paths.

Resources without a usable storage guard may be listed for conflict display,
but they are not eligible for automatic mutation. The planner must preserve
remote state or require a plugin/theme driver that can prove semantic safety.

## Endpoints

The endpoint names below are the protocol contract. A production
implementation may expose them through the existing exporter dispatcher, a
WordPress REST namespace, or both, but the authenticated signature must bind the
actual received route and query string so a request cannot be replayed across
transports.

| Protocol endpoint | Existing exporter dispatcher | Production REST binding | Current Playground route-shape fixture |
| --- | --- | --- | --- |
| `push_preflight` | `POST /?reprint-api&endpoint=push_preflight` | `POST /wp-json/reprint/v1/push/preflight` | `/wp-json/reprint/v1/push/preflight` |
| `push_snapshot_hashes` | `POST /?reprint-api&endpoint=push_snapshot_hashes` | `POST /wp-json/reprint/v1/push/snapshot-hashes` | `/wp-json/reprint/v1/push/snapshot` |
| `push_plan_dry_run` | `POST /?reprint-api&endpoint=push_plan_dry_run` | `POST /wp-json/reprint/v1/push/dry-run` | `/wp-json/reprint/v1/push/dry-run` |
| `push_batch_apply` | `POST /?reprint-api&endpoint=push_batch_apply` | `POST /wp-json/reprint/v1/push/batches` | `/wp-json/reprint/v1/push/apply` |
| `push_journal` | `POST /?reprint-api&endpoint=push_journal` | `POST /wp-json/reprint/v1/push/journal` | `/wp-json/reprint/v1/push/db-journal` |
| `push_recover` | `POST /?reprint-api&endpoint=push_recover` | `POST /wp-json/reprint/v1/push/recover` | `/wp-json/reprint/v1/push/recovery/inspect` |

The REST bindings are the intended production route names for new
implementations. The existing dispatcher remains valid for compatibility with
the current pull API shape:

```text
/?reprint-api&endpoint=<endpoint-name>
```

The current Playground fixture routes are intentionally narrower: `/snapshot`
returns the fixture snapshot used by the lab planner, `/apply` applies a single
fixture batch, `/db-journal` exposes the lab DB journal, and
`/recovery/inspect` is read-only. They are route-shape evidence, not permission
to weaken the production method, hash-listing, journal, or recovery contracts.

### `push_preflight`

Purpose: prove the remote can participate in push before planning begins.

Method: `POST`

Request body:

```json
{
  "client_protocol_version": 1,
  "client_min_protocol_version": 1,
  "requested_scopes": ["files", "database", "plugins", "themes"],
  "base_manifest_id": "pull-2026-05-24T00:00:00Z",
  "base_manifest_hash": "sha256:base-manifest",
  "base_coverage_hash": "sha256:base-coverage",
  "remote_site_id": "remote-example",
  "local_site_id": "local-dev-site",
  "client_features": [
    "canonical-push-hmac",
    "dry-run-plan-upload",
    "mutation-batches",
    "journal-recovery"
  ]
}
```

Response body:

```json
{
  "ok": true,
  "push_protocol_version": 1,
  "push_protocol_min_version": 1,
  "push_session": "psh_01j00000000000000000000000",
  "expires_at": "2026-05-24T00:10:00Z",
  "site": {
    "site_id": "remote-example",
    "identity_hash": "sha256:remote-identity",
    "home_url_hash": "sha256:...",
    "wp_version": "6.9.0",
    "table_prefix": "wp_",
    "multisite": false
  },
  "capabilities": {
    "hash_listing": true,
    "dry_run": true,
    "apply": true,
    "journal": true,
    "recovery": true,
    "db_transactions": true,
    "file_staging": true,
    "maintenance_mode": true,
    "coverage_manifest": true,
    "idempotency": true,
    "storage_guards": [
      "mysql-transaction-row-lock",
      "sqlite-immediate-guarded-update",
      "filesystem-compare-rename"
    ]
  },
  "limits": {
    "max_request_bytes": 8388608,
    "max_batch_mutations": 100,
    "max_batch_bytes": 4194304,
    "max_execution_seconds": 20
  },
  "journal": {
    "store": "database",
    "namespace": "reprint_push",
    "retention_days": 30
  },
  "auth": {
    "required": ["export-hmac", "canonical-push-hmac"],
    "idempotency_header": "X-Reprint-Push-Idempotency-Key",
    "nonce_window_seconds": 300
  }
}
```

The preflight response is not liveness proof for apply. It only proves that a
push session can start. It must reject when the requested push scope needs a
capability the remote cannot provide, when the supplied `remote_site_id` does
not match the current site, or when the server cannot persist nonce/session and
journal state for the session lifetime.

### `push_snapshot_hashes`

Purpose: list the live remote snapshot hashes used by the planner.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "cursor": null,
  "scope": {
    "files": ["wp-content/plugins", "wp-content/themes", "wp-content/uploads"],
    "tables": ["wp_options", "wp_posts", "wp_postmeta"],
    "plugins": true,
    "themes": true
  },
  "batch_size": 1000,
  "include_absent_for_base_keys": [
    "file:wp-content/plugins/forms/forms.php",
    "row:[\"wp_posts\",\"ID:1\"]"
  ]
}
```

Response body:

```json
{
  "ok": true,
  "snapshot_id": "snap_01j00000000000000000000000",
  "site_epoch": "epoch:remote-example:142",
  "coverage": {
    "coverage_id": "cov_01j00000000000000000000000",
    "coverage_hash": "sha256:remote-coverage",
    "scanner_version": "reprint-push-scanner/1",
    "hash_algorithm": "sha256",
    "complete": false,
    "scopes": {
      "files": ["wp-content/plugins", "wp-content/themes", "wp-content/uploads"],
      "tables": ["wp_options", "wp_posts", "wp_postmeta"],
      "plugins": "metadata-and-declared-drivers",
      "themes": "metadata-and-declared-drivers"
    },
    "excluded": [
      {
        "resource_key": "runtime:transients",
        "reason": "generated-cache"
      }
    ],
    "blocked": []
  },
  "cursor": "eyJwYWdlIjoyfQ==",
  "complete": false,
  "resources": [
    {
      "resource_key": "file:wp-content/plugins/forms/forms.php",
      "resource_type": "file",
      "hash": "sha256:0787...",
      "content_hash": "sha256:0787...",
      "size_bytes": 4096,
      "mtime": 1779571200,
      "owner": "forms",
      "capabilities": ["put", "delete", "stage"],
      "storage_guard": "filesystem-compare-rename"
    },
    {
      "resource_key": "row:[\"wp_posts\",\"ID:1\"]",
      "resource_type": "row",
      "hash": "sha256:f98a...",
      "owner": "core",
      "capabilities": ["put", "delete", "transaction"],
      "storage_guard": "mysql-transaction-row-lock"
    }
  ]
}
```

The client follows cursors until `complete` is true. The planner compares:

- saved pull base manifest
- local edited manifest
- live remote hash listing

The server may also expose `push_snapshot_hashes` for a narrow set of resource
keys during apply revalidation. That revalidation must read the live remote, not
reuse the earlier dry-run listing.

For paged listings, every page repeats the same `coverage_id` and the final page
sets both response `complete` and `coverage.complete` to true. A client must not
build a ready plan from an incomplete listing.

### `push_plan_dry_run`

Purpose: upload the client-computed plan so the remote validates it without
mutating the site.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "idempotency_key": "idem_dry_01j00000000000000000000",
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "plan_hash": "sha256:plan",
  "base_manifest_id": "pull-2026-05-24T00:00:00Z",
  "base_manifest_hash": "sha256:base-manifest",
  "remote_snapshot_id": "snap_01j00000000000000000000000",
  "remote_coverage_hash": "sha256:remote-coverage",
  "summary": {
    "mutations": 2,
    "conflicts": 0,
    "atomic_groups": 1
  },
  "preconditions": [
    {
      "resource_key": "file:index.php",
      "expected_remote_hash": "sha256:base-index",
      "base_hash": "sha256:base-index",
      "local_hash": "sha256:local-index",
      "storage_guard": "filesystem-compare-rename"
    }
  ],
  "mutations": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "action": "put",
      "body_hash": "sha256:local-index",
      "body_ref": "upload:body-1",
      "storage_guard": "filesystem-compare-rename",
      "atomic_group_id": null
    }
  ],
  "atomic_groups": []
}
```

Response body:

```json
{
  "ok": true,
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "plan_hash": "sha256:plan",
  "dry_run_id": "dry_01j00000000000000000000000",
  "status": "ready",
  "accepted_until": "2026-05-24T00:20:00Z",
  "server_checks": [
    "auth-scope",
    "plan-schema",
    "resource-addressability",
    "atomic-group-closure",
    "coverage-complete",
    "storage-guards-supported",
    "remote-precondition-readable",
    "journal-writable"
  ],
  "coverage": {
    "remote_coverage_hash": "sha256:remote-coverage",
    "status": "accepted"
  },
  "apply_requirements": {
    "must_revalidate": true,
    "must_revalidate_at_storage_boundary": true,
    "must_use_dry_run_id": true,
    "max_batch_mutations": 100
  },
  "idempotency": {
    "key": "idem_dry_01j00000000000000000000",
    "replayed": false,
    "request_hash": "sha256:dry-run-request"
  },
  "journal_cursor": "journal:dry_01j00000000000000000000000:1"
}
```

Dry-run validation must not write target resources. It may write a journal entry
recording the proposed plan, validation result, expiry, and client identity.

Dry-run statuses:

- `ready`: apply may be attempted.
- `blocked`: dependencies, permissions, or resource capabilities are missing.
- `conflict`: remote and local both changed one or more resources from base.
- `invalid`: malformed plan, bad hashes, unsupported resource type, or bad
  atomic group closure.

Dry-run validates that the proposed plan is well-formed and eligible to attempt.
It must not reserve resource values as if the remote were locked. Any remote
change after dry-run and before apply is expected to be caught by apply
revalidation and returned as `PRECONDITION_FAILED` or a more specific blocked
state.

### `push_batch_apply`

Purpose: apply one mutation batch from an accepted dry-run.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "idempotency_key": "idem_apply_01j000000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "plan_hash": "sha256:plan",
  "batch_id": "batch-1",
  "batch_index": 0,
  "last_batch": true,
  "dry_run_receipt_hash": "sha256:dry-run-receipt",
  "preconditions": [
    {
      "resource_key": "file:index.php",
      "expected_remote_hash": "sha256:base-index",
      "storage_guard": "filesystem-compare-rename"
    }
  ],
  "mutations": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "action": "put",
      "body_hash": "sha256:local-index",
      "storage_guard": "filesystem-compare-rename",
      "body": {
        "encoding": "base64",
        "data": "PD9waHAgZWNobyAibG9jYWwiOw=="
      }
    }
  ]
}
```

Required apply behavior:

1. Load the accepted dry-run by `dry_run_id`.
2. Reject if the dry-run expired, was superseded, or belongs to another push
   session.
3. Verify the batch body is an allowed, ordered subset of the accepted plan.
4. Revalidate every batch precondition against the live remote.
5. Revalidate atomic group dependencies and plugin/theme validators.
6. Open a journal entry before staging.
7. Stage all file and database changes for the batch.
8. Revalidate each target at its storage boundary immediately before write.
9. Commit the batch atomically when possible.
10. Record final hashes for every mutated resource.

The server must compare the apply request to the dry-run plan by canonical
`plan_hash`, `dry_run_receipt_hash`, mutation IDs, resource keys, body hashes,
precondition hashes, storage guards, and atomic group membership. An apply
request may be smaller than the full dry-run only when it is the next legal
batch. It may not introduce new resources, downgrade guards, omit required
preconditions, or reorder an atomic group that was not declared splittable.

Production storage-boundary guards must be coupled to the write primitive:

- Database updates use transactions and predicates or locks that compare the
  expected stored value in the same boundary that performs the update.
- File updates compare the live bytes or metadata immediately before a
  same-directory temp-file rename, and deletes compare immediately before
  unlink.
- Semantic plugin/theme drivers must declare every side effect they can cause
  and revalidate those resources before activation, migration, or generated
  output is allowed.
- If a guard cannot run for a target, that target is blocked before mutation.

The current Playground/REST lab apply path also re-hashes the specific target
resource immediately before calling the target write for each mutation. That
just-in-time check uses the mutation's own bound expected hash, not an earlier
batch snapshot, dry-run receipt, or accepted precondition list. If the live hash
differs, apply rejects with `PRECONDITION_FAILED` and stops before that
mutation write. Earlier landed mutations, if any, are recovery evidence for a
partial state; retry of the same DB idempotency key/body replays the rejection
or stays blocked with no fresh mutation work rather than continuing the batch.
This protects the lab path against the known window, but it is not
storage-level compare-and-swap, locking, transaction isolation, or a production
WordPress durability guarantee.

Response body:

```json
{
  "ok": true,
  "plan_id": "plan_2026-05-24T00:00:00Z_001",
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "status": "committed",
  "idempotency": {
    "key": "idem_apply_01j000000000000000000",
    "replayed": false,
    "request_hash": "sha256:apply-request"
  },
  "applied_mutations": ["mutation-1"],
  "final_hashes": [
    {
      "resource_key": "file:index.php",
      "hash": "sha256:local-index"
    }
  ],
  "storage_guards": [
    {
      "mutation_id": "mutation-1",
      "resource_key": "file:index.php",
      "guard": "filesystem-compare-rename",
      "expected_hash": "sha256:base-index",
      "observed_hash": "sha256:base-index",
      "outcome": "applied"
    }
  ],
  "journal_cursor": "journal:dry_01j00000000000000000000000:2"
}
```

Failure responses use stable error codes:

- `PRECONDITION_FAILED`: live remote hash no longer matches.
- `PLAN_NOT_READY`: dry-run status is not `ready`.
- `PLAN_EXPIRED`: accepted dry-run expired.
- `ATOMIC_GROUP_FAILED`: group dependency or validator failed.
- `BATCH_ALREADY_COMMITTED`: idempotency replay; return the original result.
- `RECOVERY_REQUIRED`: server cannot prove old or new state without recovery.

If any initial batch precondition fails before staging, no target resource in
that batch may be mutated. If a storage-boundary guard or other failure occurs
after staging or after earlier mutations, the journal must provide enough
evidence for recovery to finish, roll back, or block explicitly.

### `push_journal`

Purpose: inspect dry-runs, batches, and interrupted apply attempts.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "cursor": null,
  "include_artifacts": false
}
```

Response body:

```json
{
  "ok": true,
  "cursor": null,
  "complete": true,
  "entries": [
    {
      "journal_id": "jrnl_01j00000000000000000000000",
      "dry_run_id": "dry_01j00000000000000000000000",
      "plan_id": "plan_2026-05-24T00:00:00Z_001",
      "batch_id": "batch-1",
      "idempotency_key": "idem_apply_01j000000000000000000",
      "request_hash": "sha256:apply-request",
      "state": "committed",
      "created_at": "2026-05-24T00:00:05Z",
      "updated_at": "2026-05-24T00:00:06Z",
      "resources": [
        {
          "resource_key": "file:index.php",
          "before_hash": "sha256:base-index",
          "staged_hash": "sha256:local-index",
          "after_hash": "sha256:local-index"
        }
      ],
      "storage_guards": [
        {
          "resource_key": "file:index.php",
          "guard": "filesystem-compare-rename",
          "expected_hash": "sha256:base-index",
          "observed_hash": "sha256:base-index",
          "outcome": "applied"
        }
      ],
      "artifacts": []
    }
  ]
}
```

Journal states:

- `dry_run_received`
- `dry_run_ready`
- `dry_run_blocked`
- `batch_opened`
- `batch_staged`
- `batch_committing`
- `committed`
- `rolled_back`
- `recovery_required`
- `blocked`

The journal is append-only for audit events. A compact current-state index may
exist for lookup speed, but recovery decisions must be reconstructable from the
append-only records and artifacts.

`push_journal` is the required first step after an apply timeout, process crash,
lost HTTP response, or `RECOVERY_REQUIRED` result. It is read-only: it may
advance cursors or mark an inspection timestamp, but it must not mutate target
resources or finalize recovery. Artifact bodies are not returned unless the
server explicitly supports artifact export and the caller requests it; the
default journal response is hash-only.

### `push_recover`

Purpose: resume or repair an interrupted dry-run or batch.

Method: `POST`

Request body:

```json
{
  "push_session": "psh_01j00000000000000000000000",
  "idempotency_key": "idem_recover_01j0000000000000000",
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "mode": "auto"
}
```

Recovery modes:

- `inspect`: report what can be proven, mutate nothing.
- `auto`: finish or roll back only when the journal and live hashes prove the
  correct action.
- `finish`: complete a staged batch only when all preconditions and staged
  artifacts match the accepted plan.
- `rollback`: restore before-state only when before artifacts are complete and
  the live site still matches the staged or partial state.

Response body:

```json
{
  "ok": true,
  "dry_run_id": "dry_01j00000000000000000000000",
  "batch_id": "batch-1",
  "state": "committed",
  "proof": "all-final-hashes-match-plan",
  "target_state_counts": {
    "old": 0,
    "new": 1,
    "blocked": 0,
    "unknown": 0
  },
  "actions": ["inspected-live-hashes", "finalized-journal"],
  "next": null
}
```

Recovery must never invent success. If the server cannot prove a safe action, it
returns `RECOVERY_BLOCKED` with the resource keys, observed hashes, and artifact
references needed for manual repair.

`push_recover` uses the same idempotency rules as apply. Mutating modes
(`auto`, `finish`, and `rollback`) require canonical push HMAC, a fresh
idempotency key, and live revalidation before any target resource is changed.
`inspect` is read-only and may share the authentication rules used by
`push_journal`, but it must still be bound to the push session and dry-run.

For the executor, the journal inspection step is mandatory whenever the HTTP
response to apply is ambiguous. Recovery must never be inferred from the local
attempt state alone; it needs journal evidence and fresh live hashes.

## Planner Contract

The client planner creates a plan from:

- `base`: manifest and optional content from the last successful pull.
- `local`: current edited local site.
- `remote`: live remote hashes from `push_snapshot_hashes`.

Planner decisions:

- Local equals base and remote equals base: no-op.
- Local equals base and remote changed: keep remote.
- Local changed and remote equals base: mutation candidate.
- Local equals remote: already in sync.
- Local changed and remote changed differently: conflict.

A reviewed conflict resolution is a new plan, not a flag on an old plan. The
resolution artifact records the base hash, local hash, remote hash, chosen
value hash, reviewer identity, and reason. The executor must fetch a fresh
remote hash listing and rebuild the plan after the review. Apply never accepts a
stale manual approval that bypasses current remote preconditions.

Atomic groups are required for resource sets that must move together, including:

- plugin/theme install, update, activation, or deletion
- plugin-owned database rows plus plugin files
- schema changes plus dependent rows
- upload files plus attachment rows and metadata
- URL/domain rewrites across multiple tables

Every mutation candidate includes a remote precondition. A plan without
preconditions is invalid for apply unless it contains no mutations.

Environment-specific resources are denied by default, including `siteurl`,
`home`, salts, secrets, SMTP credentials, local-only object-cache configuration,
absolute paths, and runtime-only cron/cache/transient data. A semantic driver
may transform or allow a resource only when it can prove the source-site value
and side effects remain valid after push.

## Hashing Rules

File resources:

- Hash the exact bytes after resolving the canonical site-relative path.
- Reject paths outside allowed WordPress roots.
- Include symlink metadata separately; do not follow a symlink during mutation
  unless preflight advertised that capability.

Database row resources:

- Hash a canonical JSON object built from selected columns.
- Sort object keys.
- Preserve exact scalar types where the database driver can provide them.
- Include primary key shape and table name outside the value payload.
- For serialized PHP values, either hash the raw stored string or use a
  plugin/theme semantic driver. Do not generic-merge unknown serialized data.

Schema resources:

- Hash normalized `CREATE TABLE` details, indexes, collation, engine, and
  relevant WordPress table-prefix mapping.

Plugin/theme resources:

- Hash activation state, version, dependency declarations, and package files.
- Include semantic validator output when a plugin driver is installed.

## Error Envelope

Errors are JSON:

```json
{
  "ok": false,
  "code": "PRECONDITION_FAILED",
  "message": "Remote changed since dry-run for file:index.php.",
  "details": {
    "resource_key": "file:index.php",
    "expected_hash": "sha256:base-index",
    "actual_hash": "sha256:remote-edited-index"
  },
  "journal_cursor": "journal:dry_01j00000000000000000000000:2"
}
```

Clients must treat unknown error codes as fatal and inspect the journal before
retrying an apply batch.

Stable production error codes include:

- `AUTH_REQUIRED`, `AUTH_SCOPE_DENIED`, `SIGNATURE_INVALID`,
  `NONCE_REPLAYED`
- `SITE_IDENTITY_MISMATCH`, `BASE_MANIFEST_MISMATCH`
- `COVERAGE_INCOMPLETE`, `RESOURCE_UNSUPPORTED`, `STORAGE_GUARD_UNSUPPORTED`
- `PLAN_NOT_READY`, `PLAN_EXPIRED`, `PLAN_INVALID`
- `PRECONDITION_FAILED`, `ATOMIC_GROUP_FAILED`, `VALIDATOR_FAILED`
- `IDEMPOTENCY_KEY_CONFLICT`, `BATCH_ALREADY_COMMITTED`
- `RECOVERY_REQUIRED`, `RECOVERY_BLOCKED`

## Compatibility

The push extension has its own version pair:

- `push_protocol_version`
- `push_protocol_min_version`

These are independent of the current export `protocol_version` because push can
change mutating semantics without breaking pull clients. Pull preflight may
advertise push support, but mutating push endpoints must still require
`push_preflight` and push-scoped authentication.

## Test Topology

The production proof for push should be exercised on one remote source site and
one local edited site:

- `remote_base`: the source site that produced the persisted pull base package.
- `local_edited`: the imported local site with user changes.
- `remote_changed`: the same remote site observed later after independent drift.

The executor must keep the remote base and remote changed identities equal and
change only the live remote state between the preflight, snapshot-hash,
dry-run, apply, journal, and recovery phases. That topology proves the dry-run
receipt is not a lock, apply still revalidates fresh live state, and recovery
still begins with inspect.

The inspect-first recovery fence is part of the same proof:

- `push_journal` records claim ownership, generation, lease expiry, and the
  storage-boundary evidence that survives an interrupted apply.
- `push_recover inspect` reads that journal and the live hashes before any
  finish, rollback, or auto step.
- `push_recover auto|finish|rollback` mutates only when the journal row and
  fresh live hashes still agree.
- a stale dry-run receipt never becomes recovery authority.

For the sandboxed proof, the only exposed HTTP ingress is the sandbox-provided
`8080` port, and any browser-visible inspection must stay on a local-only
proxy. Remote tunnels are disallowed.
