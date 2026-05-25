# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote site and one local site.

Scope:

- one persisted pull base package
- one live remote identity observed twice, before and after drift
- one edited local clone derived from that base
- one runner process that owns preflight, planning, apply, journal inspect,
  and recovery

The production sequence is fixed:

1. `push_preflight` binds the persisted pull base to a live remote identity
   and a short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison set for planning.
   Large sites may require cursoring, but every page remains planning-only and
   never becomes a lock.
3. The local planner builds the canonical three-way plan from base, local, and
   live remote evidence.
4. `push_plan_dry_run` uploads that canonical plan as eligibility evidence
   only and returns a receipt, not a lock.
5. `push_batch_apply` revalidates the live remote before every batch and again
   at the storage boundary.
6. `push_journal` resolves lost responses and ambiguity without authorizing a
   write.
7. `push_recover inspect` runs before any mutating recovery mode, and mutating
   recovery only proceeds when journal rows plus fresh live hashes prove the
   action.

That sequence is the runtime form of the pull pipeline handoff:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that package to the live remote identity and session
- snapshot hashes capture live comparison evidence for planning only
- dry-run uploads the canonical plan as an eligibility receipt
- apply revalidates fresh live evidence before every batch and at the storage boundary
- journal inspect and recovery inspect read durable evidence before any mutating repair

Dry-run and apply are therefore separate remote calls. A valid dry-run receipt
is not a lock, and a later apply must still fail if the remote changed after
the snapshot listing or after the plan was accepted.

The executor also preserves the pull/export/import boundary instead of
recomputing provenance locally:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. preflight binds the persisted base to a live remote identity and session
4. snapshot hashes provide a fresh planning-only comparison set
5. dry-run uploads the canonical three-way plan as an eligibility receipt
6. apply revalidates the live remote before every batch and at the storage boundary
7. journal and recover inspect durable evidence first, then permit mutating
   recovery only when fresh live hashes prove the action

That mapping is intentionally one-way:

- exporter/importer create the immutable pull base package
- preflight binds that package to one remote identity and one short-lived
  push session
- snapshot hashes are planning-only live evidence
- dry-run uploads the canonical plan as eligibility evidence only
- apply revalidates the live remote before every batch and at the storage
  boundary
- journal inspection and recovery inspection read durable evidence first
- mutating recovery only proceeds when the journal and fresh live hashes prove
  the action

In runtime terms, the pull pipeline contributes immutable provenance and the
push pipeline consumes it in order:

1. exporter produces the merge-base evidence and coverage hash
2. importer persists that base package as immutable provenance
3. push preflight binds the stored base package to the live remote identity
   and a short-lived session
4. snapshot hashes enumerate live remote comparison evidence for planning only
5. dry-run uploads the canonical plan and returns an eligibility receipt
6. apply revalidates fresh live hashes before every batch and again at the
   storage boundary
7. journal inspect and recovery inspect read durable evidence before any
   mutating recovery step

The test topology follows the same split:

- `remote-base` seeds the persisted pull base
- `local-edited` is the user-edited imported clone
- `remote-changed` is the same remote identity seen later after drift
- `runner` is the only actor that may preflight, plan, upload, inspect, and recover
- Docker and Playground must prove the same identity twice, not two different sites
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed

## Executor Responsibilities

The executor is the client-side orchestrator. It runs after a site was pulled,
edited locally, and the user asks to push changes back to the original source.

Responsibilities:

- Load the saved pull base manifest and verify it belongs to the remote.
- Run `push_preflight` and negotiate protocol, limits, auth scope, and push session.
- List the live remote hashes with `push_snapshot_hashes`.
- Verify the remote coverage manifest is complete for the requested push scope and persist the fresh coverage hash.
- Build a three-way plan from base, local, and live remote.
- Upload the plan with `push_plan_dry_run`.
- Apply ready plans in bounded `push_batch_apply` calls.
- Inspect `push_journal` after any timeout, process crash, or ambiguous error.
- Run `push_recover` in `inspect` mode first, then in a mutating mode only when the journal says recovery is required and the live remote can prove the action.

The executor must not mutate the remote during planning. It may fetch remote
content for conflict display, but mutation starts only at `push_batch_apply`.
Dry-run success is a permission and eligibility receipt, not a liveness lock.
The executor must expect apply to fail if the remote changes between dry-run and
the storage-boundary guard, and it must treat the dry-run response as stale as
soon as a fresh remote listing shows new live state. Apply-time revalidation is
therefore mandatory before every batch, even when the dry-run receipt is still
present.

The executor treats the push protocol as a three-sided merge:

- local edited site
- persisted pull base
- live remote hash listing

It must never use the remote listing as a replacement for the pull base, and it
must never treat a dry-run receipt as proof that apply is still safe. The
executor must refresh live evidence before every batch, even if the dry-run
response is still valid.
It also must not treat journal inspection as authorization to mutate; recovery
only becomes mutating when the journal and fresh live hashes both prove the
same action.

The executor also treats the pushed session as bounded provenance:

- the session is minted by `push_preflight`
- the session is tied to one remote identity, one base manifest lineage, and
  one requested scope
- the session expires instead of acting like a write lock
- any scope or identity change requires a fresh preflight rather than a reused
  session

The production test topology is intentionally one remote source site, one
local edited site, and one drift witness:

- `remote-base` seeds the persisted pull base and the live source identity
- `local-edited` is the imported site after user edits
- `remote-changed` is the same logical remote as `remote-base`, observed later
  after independent drift between dry-run and apply
- `runner` is the only process that may run preflight, snapshot listing,
  dry-run, apply, journal inspection, and recovery

That proof must hold in both Docker and Playground:

- Docker keeps the roles on one private network and uses the sandbox-provided
  `8080` ingress with a local-only proxy for browser-visible inspection.
- Playground uses separate disposable blueprints for the same `remote-base`,
  `local-edited`, `remote-changed`, and `runner` roles.
- Remote tunnels are disallowed in both modes.
- `remote-base` and `remote-changed` must be the same remote identity observed
  at two different times.

That topology is the implementation contract, not just an example. The same
shape must be represented in Docker and Playground, and the browser-visible
inspection path must stay on the sandbox-provided `8080` ingress through a
local-only proxy.

The same shape is what the Docker and Playground proofs must implement:

| Role | Docker | Playground | Why it exists |
| --- | --- | --- | --- |
| `remote-base` | Source-site container on the private network | Loopback Playground source site | Produces the persisted pull base and live remote identity. |
| `local-edited` | Imported edited-site container on the same private network | Separate loopback Playground instance | Holds the user edits that the planner will compare against the base. |
| `remote-changed` | Same remote site observed later after drift | Same Playground site after a later mutation | Proves apply revalidates live state instead of replaying dry-run evidence. |
| `runner` | Client container or host process | Client process | Signs requests, uploads plans, reads journals, and drives recovery. |

This is the topology contract the executor must satisfy in both packaging
modes:

- `remote-base` and `remote-changed` are the same remote identity observed at
  different times.
- `local-edited` is a separate imported clone with user edits.
- `runner` is the only actor that may compare, upload, inspect, or recover.
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy.
- remote tunnels are disallowed in both Docker and Playground.

The compact end-to-end fixture at
[`fixtures/protocol/push-production-ladder-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-production-ladder-contract.json)
encodes the same proof as one machine-readable ladder: preflight, snapshot
listing, dry-run, apply, journal inspect, and inspect-first recovery all stay
separate while the topology keeps the same one-remote, one-local, one-runner
shape.

## Topology

The topology proof is the simplest possible production-shaped setup that still
separates liveness from eligibility:

| Role | Docker | Playground |
| --- | --- | --- |
| `remote-base` | source-site container on the private network | source-site blueprint that seeds the persisted pull base |
| `local-edited` | imported clone on the same private network | separate disposable blueprint with local edits |
| `remote-changed` | the same remote container after live drift | the same remote blueprint after a later mutation |
| `runner` | client container or host process | local test process |

The proof only holds if `remote-base` and `remote-changed` are the same remote
identity at different times. If they are different sites, the test no longer
demonstrates apply-time revalidation.

Browser-visible inspection must use only the sandbox-provided `8080` ingress
through a local-only proxy. Remote tunnels are disallowed.

The topology matrix fixture is the shortest machine-readable version of the
same proof:

[`fixtures/protocol/push-executor-topology-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-executor-topology-proof.json)
keeps the executor-focused version of the same proof in one place: pull
provenance, preflight, snapshot listing, dry-run, apply, journal inspect, and
inspect-first recovery all share the same one-remote, one-local, one-runner
shape.

- Docker uses one private network and keeps `remote-base`, `local-edited`,
  `remote-changed`, and `runner` distinct.
- Playground uses separate disposable blueprints with the same remote identity
  observed twice.
- Both modes prove that dry-run and apply stay separate and that apply
  revalidates live remote state before every batch and at the storage
  boundary.
- Both modes keep `push_journal` and `push_recover inspect` read-only until the
  journal plus fresh live hashes prove a safe mutating recovery path.

## Restart Proof

The executor proof is only complete when both packaging modes show the same
remote identity twice:

- `remote-base` and `remote-changed` must be the same remote site observed at
  two different times
- `local-edited` must remain a separate imported clone
- `runner` must remain the only actor that can compare, upload, inspect, and
  recover
- `push_batch_apply` must still revalidate fresh live evidence before every
  batch and at the storage boundary after dry-run succeeds
- mutating requests must remain at least as strict as the current Reprint HMAC
  floor plus the push session and canonical push signature

The pull/export/import handoff is the provenance boundary that push consumes:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that package to the live remote identity and session
- snapshot hashing produces fresh planning evidence only
- dry-run uploads the canonical plan as eligibility evidence only
- batch apply revalidates the live remote before every batch and at the storage boundary
- journal inspection and recovery inspection read durable evidence before any mutating recovery mode can proceed

The machine-readable companion for that handoff is
[`fixtures/protocol/push-pull-mapping.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-pull-mapping.json).
It records the immutable pull package, the push bindings layered on top of it,
and the restart-proof invariants that keep dry-run, apply, and recovery
separate.
The topology companion at
[`fixtures/protocol/push-topology-matrix.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-topology-matrix.json)
adds the explicit `push_pipeline` stage map plus apply-revalidation and
inspect-first recovery evidence so Docker and Playground tests can assert the
same preflight, snapshot listing, dry-run, apply, journal, and recovery split
without relying on prose only.
It mirrors the one-remote, one-local, one-drift-witness test shape and the
`8080` ingress rule in compact form.

Shared harness rules:

- Browser-visible inspection may use only the sandbox-provided `8080` ingress
  through a local-only proxy.
- Remote tunnels are disallowed.
- `remote-base` and `remote-changed` must be the same remote identity observed
  at different times, not two different sites.
- Dry-run and apply remain separate remote calls even when the same runner
  executes both.
- `push_journal` and `push_recover inspect` explain ambiguity but do not
  authorize a write.

Docker and Playground use the same proof boundary:

- `remote-base` seeds the persisted pull base and the live source identity.
- `local-edited` is the imported local clone after user edits.
- `remote-changed` is the same remote site after live drift and must fail any
  stale apply attempt.
- `runner` is the only process that may compare, upload, inspect, or recover.

The only networking rule that matters for the test harness is that browser
inspection stays on the sandbox-provided `8080` ingress through a local-only
proxy. No remote tunnel is allowed, because the proof depends on keeping the
remote and local roles inside the sandbox boundary.

For Docker, keep those roles on one private network and expose browser-visible
inspection only through the sandbox-provided `8080` ingress via a local-only
proxy. For Playground, use the same role split with separate disposable
blueprints and the same no-tunnel rule.

The machine-readable companion for this topology is
[`fixtures/protocol/push-contract.json`](../fixtures/protocol/push-contract.json).
It records the same remote identity across `remote-base` and `remote-changed`,
keeps the runner as the only actor that may compare, upload, inspect, or
recover, and binds the auth/session/journal proof fixtures into one contract.
Its `push_guards` fields mirror the executor rules: preflight binds the
persisted base, snapshot listing is planning-only, dry-run is a receipt, apply
revalidates before each batch and at the storage boundary, and inspect-first
recovery is mandatory before any mutating repair.
The separate
[`fixtures/protocol/push-pull-mapping.json`](../fixtures/protocol/push-pull-mapping.json)
fixture is the provenance bridge from the pull exporter/importer pipeline into
push: exporter/importer create the immutable base package, preflight binds that
package to the live remote identity, snapshot listing is planning evidence,
dry-run is a receipt, apply revalidates fresh live evidence, and journal plus
recovery inspection remain read-only until live proof allows a mutating repair.
The narrowest proof for the dry-run/apply boundary is
[`fixtures/protocol/push-dry-run-apply-revalidation-contract.json`](../fixtures/protocol/push-dry-run-apply-revalidation-contract.json).
It records the pull handoff, the planning bindings, the apply-time
revalidation rules, and the one-remote/one-local topology in a form tests can
assert directly.
The compact recovery companion at
[`fixtures/protocol/push-recovery-inspect-contract.json`](../fixtures/protocol/push-recovery-inspect-contract.json)
adds the session, journal row, live-drift evidence, and read-only inspect
decision that the executor must preserve before any mutating recovery mode.

The important part of the topology is not the container count. It is the
proof boundary: `remote-base` and `remote-changed` must be the same remote
identity at two different moments, so stale dry-run apply attempts fail for
the right reason instead of due to an identity mix-up.

The executor should treat the remote snapshot hash listing as the planning
boundary and the dry-run receipt as a one-way eligibility proof. Neither one
is a lock. The only place where live remote liveness is rechecked for
authority is `push_batch_apply`, and that call must refresh remote evidence
before every batch and again at the storage boundary.

The mapping to the existing pull pipeline is one-way:

- pull exporter and importer create the persisted base package
- push preflight binds that package to the live remote identity and session
- push snapshot hashes list the live remote comparison set for planning
- push dry-run uploads the canonical three-way plan
- push batch apply revalidates the live remote before every batch and at the
  storage boundary
- push journal and push recover inspect read durable evidence first; mutating
  recovery only proceeds when fresh live hashes prove the action

That mapping is the production handoff boundary. Pull proves the merge base
and coverage. Push consumes that immutable package, binds it to the live
remote identity, and then proves liveness again at apply time instead of
trusting the earlier snapshot hash listing.

The executor should preserve this pull-to-push provenance boundary:

- the exporter/importer create the immutable base package
- preflight binds that package to the live remote identity and a short-lived
  push session
- snapshot hashing provides fresh planning evidence only
- dry-run uploads the canonical plan and records eligibility only
- apply revalidates the live remote before every batch and at the storage
  boundary
- journal inspection and recovery inspection read durable evidence first and
  only mutating recovery can change state

The executor should persist the following proof tuple so a restart can
distinguish fresh planning evidence from replay evidence:

- `base_manifest_id`, `base_manifest_hash`, and `base_coverage_hash` from the
  persisted pull package
- `push_session`, `remote_site_id`, and `identity_hash` from preflight
- `snapshot_id`, `coverage_hash`, and `site_epoch` from the live hash listing
- `plan_id`, `plan_hash`, and the accepted dry-run receipt hash
- `journal_cursor`, claim generation, and lease expiry from apply or journal
- the last recovery `mode`, `proof`, and `state`

That tuple is the minimum restart evidence, not a lock. If any live evidence
is stale, the executor must discard the old apply authority and fetch fresh
remote hashes before resuming.

That tuple is not a lock. It is only the minimum restart evidence that lets
the executor decide whether to resume, re-list the remote, or stop and
inspect. If any of the live evidence is stale, the executor must discard the
old apply authority and rebuild from a fresh `push_snapshot_hashes` call.

Acceptance criteria for the reliable executor:

- It never calls `push_batch_apply` without a persisted pull base, completed
  remote hash listing, ready local plan, accepted dry-run receipt, and active
  push session.
- It treats `dry_run_id`, `snapshot_id`, and `coverage_hash` as evidence, not as
  locks.
- It persists the coverage hash and journal cursor alongside the recovery proof
  so a restart can distinguish accepted, committed, and blocked outcomes.
- It reuses idempotency keys only with byte-identical request bodies.
- It stops on `PRECONDITION_FAILED` and replans from a fresh remote listing.
- It asks `push_journal` before retrying any apply whose HTTP response was lost.
- It marks a push complete only after journal confirmation proves all batches
  committed.
- It refuses to run against a remote that only has read-only export HMAC scope.
- It keeps `push_journal` and `push_recover inspect` read-only and only allows
  mutating recovery when the journal plus fresh live hashes prove the action.
- It uses the same pull/export/import provenance package for both Docker and
  Playground proofs.

Executor gates:

| Gate | Next remote call allowed | Pass condition | Fail action |
| --- | --- | --- | --- |
| Base loaded | `push_preflight` | Base manifest, coverage hash, remote site identity, and resource hashes are present and match the selected remote. | Stop and require a fresh pull. |
| Preflight accepted | `push_snapshot_hashes` | Push-scoped HMAC credential, active session, journal support, hash listing, idempotency, and required storage guards are advertised. | Stop before planning. |
| Remote listing complete | `push_plan_dry_run` | All requested scopes are complete, blocked resources are absent or irrelevant, and the coverage hash is persisted as fresh planning evidence. | Mark blocked; do not upload a ready plan. |
| Local plan ready | `push_plan_dry_run` | Every mutation has base, local, and live remote hashes plus a storage guard or semantic driver. | Report conflict or blocker. |
| Dry-run ready | `push_batch_apply` | Remote accepted the same canonical plan hash and returned a ready dry-run receipt. | Stop unless status is `ready`; re-read live hashes before each batch. |
| Apply ambiguous | `push_journal` | Any timeout, closed connection, process restart, or `RECOVERY_REQUIRED` happens before a committed receipt is persisted. | Inspect journal before retrying. |
| Journal complete | none | Every planned batch is committed and final hashes match the plan. | Mark the local attempt complete. |

## State Machine

```text
idle
  -> preflight
  -> remote-hash-list
  -> coverage-verified
  -> local-scan
  -> plan
  -> dry-run-upload
  -> ready | blocked | conflict
  -> apply-batches
  -> journal-confirm
  -> complete
```

Failure states:

```text
dry-run-upload -> blocked | conflict | invalid
apply-batches -> precondition-failed | recovery-required | failed
recovery-required -> recovered | recovery-blocked
```

The executor persists its state after every remote response. Re-running the same
push resumes from the last safe state:

- If only planning completed, rebuild or re-upload dry-run.
- If dry-run was accepted, inspect its journal before applying.
- If a batch response was lost, call `push_journal` first and retry only if the journal still proves the same request is open.
- If the server reports `RECOVERY_REQUIRED`, inspect then recover.

Persisted push state should include, at minimum:

- the loaded base manifest id and hash
- the remote site identity hash and base coverage hash
- the last `snapshot_id` and `coverage_hash`
- the accepted `dry_run_id` and `plan_hash`
- the latest `journal_cursor`
- the last recovery `mode` and `proof`
- the idempotency key and request hash for every mutating request

That state is what lets the executor distinguish a lost response from a stale
plan. It is not a substitute for fresh live evidence.

On any ambiguous stop, the executor must prefer the freshest evidence path:

1. Read `push_journal` first.
2. If the journal says a claim is open, check claim generation and lease expiry
   before retrying.
3. If the journal says recovery is required, run `push_recover` in `inspect`
   mode before any mutating recovery call.
4. If live hashes diverge from the recorded dry-run or apply evidence, discard
   the old receipt and rebuild from a fresh remote listing.

Resume decisions are conservative:

| Persisted state | First action on restart | Reason |
| --- | --- | --- |
| `preflight` only | Re-run preflight. | Sessions expire and carry no liveness proof. |
| Complete remote hashes, no dry-run | Re-list remote hashes, then rebuild the plan. | Hash listings are snapshots, not locks. |
| Dry-run ready, no apply receipts | Call `push_journal`, then apply only if the dry-run is still ready and no batch is open. | A prior process may have applied after persisting the dry-run. |
| Batch request persisted, no response | Call `push_journal` before replay. | The HTTP response may have been lost after mutation. |
| `PRECONDITION_FAILED` persisted | Start a new attempt from fresh remote hashes. | Editing the old batch would break idempotency and stale liveness evidence. |
| `RECOVERY_REQUIRED` persisted | Call `push_journal`, then `push_recover` in `inspect` mode before any mutating recovery mode. | Recovery needs journal artifacts and live hashes, not local guesses. |

The executor also persists the last seen journal cursor and recovery proof so a
restart can distinguish "lost HTTP response" from "server committed but client
did not observe it". This is the boundary that prevents accidental double
mutation when the process crashes mid-apply. If the journal shows an open
claim, the executor treats claim generation and lease expiry as fencing
evidence and never assumes that the old worker still owns the batch.

The journal evidence is only useful when it is read in the right order:

1. Read the open or committed journal row.
2. Check the claim generation and lease expiry.
3. Compare the resource-level before, staged, and after hashes.
4. Re-read live hashes before any retry or recovery mutation.

That sequence keeps recovery from turning a stale journal row into an implied
write lock.

The journal rows are part of the proof surface, not just a diagnostic trace.
When the executor reads them, it is looking for claim ownership, claim
generation, lease expiry, batch status, and the resource-level before/staged/
after hashes that prove whether finish, rollback, or block is safe.

## Mapping To Existing Reprint Pull

The existing pull command already knows how to run stages, save state, retry
timeouts, and resume after interruption. Push should reuse that orchestration
style with different stage semantics. The pull exporter/importer still owns
the persisted merge base; push only layers live remote proof, dry-run receipt,
batch receipts, and journal/recovery evidence on top of that immutable base.

| Pull concept | Push executor equivalent |
| --- | --- |
| `run_preflight()` | `run_push_preflight()` stores push capabilities and session. |
| `run_files_sync()` | `run_remote_hash_listing()` lists remote file hashes instead of fetching file bodies. |
| `run_db_sync()` | `run_remote_hash_listing()` lists row/schema hashes instead of streaming SQL chunks. |
| local `db-apply` | `run_local_scan()` and `createPushPlan()` compare base/local/remote. |
| pull retry on timeout | Push retries only idempotent stages automatically; apply retry first checks journal. |
| pull state directory | Push state directory stores base manifest, live hash listing, plan, dry-run receipt, batch receipts, and journal cursors. |

The push executor should not reuse the pull streaming SQL dump as a mutation
format. SQL replay is too coarse for a live remote. It can reuse pull transport,
budgeting, cursoring, multipart handling, and HMAC helpers, but only as
transport and auth primitives, not as proof of liveness.

The persisted pull base package is the executor's provenance anchor, not a
remote lock:

- `base_manifest_id` and `base_manifest_hash` identify the lineage that was
  pulled.
- `base_coverage_hash` proves the exported scope was complete enough for a
  later push.
- `remote_site_id` and the base resource hashes bind the plan to one source
  site identity.
- `push_snapshot_hashes` is the live planning view.
- `push_plan_dry_run` is only an eligibility receipt.
- `push_batch_apply` must revalidate the live remote before every batch and at
  the storage boundary.
- `push_journal` and `push_recover inspect` are evidence readers, not write
  permissions.
- `push_recover inspect` must happen before any mutating recovery mode.

Mapping summary:

- pull preflight becomes push preflight plus capability negotiation for write
  paths
- pull listing stages become remote hash listing instead of body fetches
- pull apply becomes the local three-way planner that builds a dry-run plan
- pull state persistence becomes the push attempt state directory and journal
- pull retry semantics remain for read-only stages, while apply retries are
  gated by journal inspection and idempotency proof

Production push is therefore a two-site proof flow:

- one remote site supplies the live identity, snapshot hashes, dry-run
  eligibility checks, apply revalidation, journal evidence, and recovery state
- one local edited site supplies the pulled base plus user changes that become
  the candidate plan
- the runner owns the protocol flow and is the only actor allowed to compare,
  upload, inspect, or recover

The production test topology must keep those roles separated and observable:

- `remote-base` is the authoritative source-site container or blueprint that
  seeds the persisted pull base package.
- `local-edited` is the imported local container or blueprint that carries the
  user edits and never becomes the live remote target.
- `remote-changed` is the same remote site after independent drift, and it
  exists specifically to prove that dry-run and apply are separate.
- `runner` is the only process allowed to run preflight, snapshot listing,
  dry-run, apply, journal inspection, and recovery.

That topology is valid only if `remote-base` and `remote-changed` are the same
remote identity observed at two different times. If they are different sites,
the proof no longer demonstrates apply-time revalidation; it only demonstrates
two unrelated environments.

The Docker and Playground proofs use the same logical identity split:

- `remote-base` is the source-site identity that produced the persisted pull
  base package.
- `remote-changed` is the same remote identity observed later after drift.
- `local-edited` is the imported local clone derived from that pull base.
- the runner must keep browser-visible inspection behind the sandbox-provided
  `8080` ingress and never use a remote tunnel.

For Docker, keep the three site roles on one private network and expose only
the sandbox-provided `8080` ingress through a local-only proxy when a browser
needs to inspect state. For Playground, use the same role split with separate
disposable blueprints and the same no-tunnel rule.

The implementation test topology should mirror that shape exactly:

- `remote-base` is the original remote source site and the persisted pull base
- `local-edited` is the imported local clone after user edits
- `remote-changed` is the same remote site after independent drift between
  dry-run and apply
- `runner` is the only process that can run preflight, snapshot listing,
  dry-run, apply, journal inspection, and recovery

For Docker, keep those roles in separate containers on one private network and
drive browser-visible inspection only through the sandbox-provided `8080`
ingress with a local-only proxy. For Playground, use the same logical roles as
three disposable blueprints plus the runner process. In both cases, the point
of `remote-changed` is to prove that dry-run and apply are separate remote
operations and that apply revalidates the live remote after the plan is
already accepted.

Concrete test topology:

| Role | Docker shape | Playground shape |
| --- | --- | --- |
| Remote source site | `remote-base` container, exporter and push extension enabled | `remote-base` blueprint, source-site truth |
| Local edited site | `local-edited` container restored from the pulled base and edited independently | `local-edited` blueprint, imported clone with local edits |
| Drift witness | `remote-changed` container or state mutation against the same remote after dry-run | `remote-changed` blueprint or state mutation after snapshot listing |
| Runner | `runner` container or host process that signs requests and drives protocol calls | Same runner process, attached only to the private network |

The topology must stay small enough to prove one remote and one local site
without hiding the freshness check. `remote-base` is the authoritative source,
`local-edited` is the pulled-and-edited clone, and `remote-changed` is the same
remote observed later so stale apply can be rejected on revalidation.

The test topology should stay minimal but complete:

- one remote source site that seeds the persisted pull base
- one local edited site that produces the candidate plan
- one drift witness that mutates the same remote after dry-run
- one runner that alone is allowed to compare, upload, inspect, and recover

The machine-checked topology proof should assert the same four roles directly:

- `remote-base` is the authoritative source-site role that seeds the persisted
  pull base package.
- `local-edited` is the imported local site that holds the edits.
- `remote-changed` is the same source site after drift and must fail stale
  apply-time proof.
- `runner` is the only process allowed to run preflight, snapshot listing,
  dry-run, apply, journal inspection, and recovery.

For both Docker and Playground, the test harness should prove three facts:

1. one remote source site and one local edited site are separate roles
2. dry-run and apply are separated by live drift on the remote
3. browser-visible inspection uses only the sandbox-provided `8080` ingress
   through a local-only proxy, never a remote tunnel

The pull importer must persist a push base package so later pushes can prove
the merge base, and it must also preserve the additional pull evidence needed
for later recovery decisions:

```text
push-base/
  base-manifest.json        remote identity, paths, table prefix, multisite map
  base-coverage.json        pull scanner coverage and excluded resources
  resources.jsonl           resource keys and base hashes
  schema-fingerprints.json  normalized table/schema hashes
  bodies/                   optional base bodies needed for merge drivers
```

The executor treats this package as read-only evidence. If it is missing,
corrupt, or from a different remote identity, push planning stops before
preflight can become a mutation path. If the remote drifts between dry-run
and apply, the executor must discard the old listing and repopulate live proof
before resuming.
It may only read the package back as immutable provenance when building the
push session, remote hash listing, and dry-run plan.

The recovery proof still follows the same order on replay: inspect the journal
first, inspect live hashes second, and only then decide whether the safe next
step is finish, rollback, retry, or block. That keeps journal rows and live
state aligned instead of letting old proof turn into permission.
The compact auth-and-session recovery proof at
[`fixtures/protocol/push-auth-session-recovery-contract.json`](../fixtures/protocol/push-auth-session-recovery-contract.json)
captures that same inspect-first boundary in a machine-readable form: it binds
the push HMAC floor, the minted session, the fenced journal row, and the
blocked-or-safe recovery decision into one recovery proof.

The executor must also respect the pull-to-push provenance boundary:

- pull exporter/importer creates the immutable merge base
- push preflight binds that base to the live remote identity
- push snapshot hashes record the current live comparison set
- push dry-run proves the uploaded plan is eligible, not that it remains live
- push apply revalidates at the batch and storage boundary
- push journal and recovery inspect explain state transitions without granting
  mutation permission
- the persisted pull base package is never rewritten to make a stale plan look
  current

That handoff is one-way: exporter/importer creates the immutable base package,
push preflight binds it to the live remote identity, snapshot hashes provide
the planning view, dry-run proves eligibility, apply performs fresh
revalidation, and journal or recovery inspection explain ambiguity without
rewriting the persisted base.

The production test topology is fixed to one remote source site, one local
edited site, one drift witness, and one runner:

- `remote-base` seeds the persisted pull base package.
- `local-edited` is the imported site after local edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor allowed to compare, upload, inspect, and recover.

Docker and Playground share the same proof shape. The packaging differs, but
the logic does not: one remote identity is observed twice (`remote-base` then
`remote-changed`), one local clone supplies edits, and the runner alone drives
preflight, snapshot listing, dry-run, apply, journal inspection, and recovery.
Browser-visible inspection, when needed, must stay behind the
sandbox-provided `8080` ingress through a local-only proxy. Remote tunnels are
disallowed.

## One-Remote, One-Local Test Topology

The recommended production-shaped topology is one remote source, one edited
local site, and one runner. The machine-readable version lives in
[`fixtures/protocol/push-topology.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-topology.json):

- `remote-base` is the pulled source of truth and persists the base package.
- `local-edited` is the imported site after user edits.
- `remote-changed` is the same remote after independent drift between dry-run
  and apply. It is the live drift witness for the same remote identity, not a
  second source site.
- `runner` is the only process that may compare, upload, inspect, or recover.

For Docker, keep the remote and local databases isolated so drift is visible
without contaminating the local edit history. No WordPress container should
publish a public port. If browser-visible inspection is needed, use only the
sandbox-provided `8080` ingress through a local-only proxy inside the sandbox,
and never a tunnel service.

For Playground, use separate disposable blueprints for `remote-base`,
`local-edited`, and `remote-changed`, and keep the same `8080` ingress rule
for browser-visible inspection. The important proof is that apply revalidates
fresh live state after dry-run, not that the same snapshot happened to persist.

The topology is not just a packaging choice. It is the proof shape that shows
the same remote identity at two different times:

- `remote-base` seeds the persisted pull base and the preflight identity bind.
- `local-edited` stays isolated as the edited local clone used to plan.
- `remote-changed` is the same remote observed later and must be able to make
  stale dry-run apply fail.
- `runner` is the only actor allowed to call preflight, snapshot listing,
  dry-run, apply, journal inspect, and recovery.

For both Docker and Playground, the topology proof is a four-role matrix:

| Role | Docker example | Playground example | Proof purpose |
| --- | --- | --- | --- |
| `remote-base` | `remote-base` | `remote-base` | Seeds the persisted pull base and live source identity. |
| `local-edited` | `local-edited` | `local-edited` | Carries the imported local edits that become the candidate plan. |
| `remote-changed` | `remote-changed` | `remote-changed` | Proves apply-time revalidation against the same remote after drift. |
| `runner` | `runner` | local test process | Is the only actor allowed to compare, upload, inspect, and recover. |

Suggested Docker wiring:

- remote site uses a dedicated WordPress + DB pair and serves as the source of
  truth for `push_preflight`, `push_snapshot_hashes`, `push_plan_dry_run`,
  `push_batch_apply`, `push_journal`, and `push_recover`
- local site uses a separate WordPress + DB pair imported from the pull base
  and represents the edited source material used to build the plan
- the runner attaches to both container networks, performs the pull/export,
  computes the three-way plan, uploads the dry-run, and drives apply/recovery
- no service outside the sandbox should be reachable; if a browser is needed,
  the optional proxy binds to `127.0.0.1:8080` only
- `remote-changed` must be the same logical remote as `remote-base`, started
  later with independent drift so stale-dry-run apply attempts fail for the
  right reason

### Playground Topology

Use WordPress Playground when Docker or WP-CLI is unavailable in the sandbox.
The local and remote sites can be represented by separate disposable blueprint
runs:

| Site | Blueprint | Role |
| --- | --- | --- |
| Remote base | `fixtures/playground/remote-base.blueprint.json` | Pulled source base and push source of truth. |
| Local edited | `fixtures/playground/local-edited.blueprint.json` | Pulled local site after local edits. |
| Remote changed | `fixtures/playground/remote-changed.blueprint.json` | Live remote after independent edits. |

The runner executes the blueprints without opening a network port, exports the
base manifest from `remote-base`, builds the local plan from `local-edited`,
and uses `remote-changed` as the liveness drift case for `PRECONDITION_FAILED`
and recovery coverage. This topology proves the one-remote, one-local shape
without requiring external network exposure.
The Playground harness should keep the same role split as Docker:

- `remote-base` seeds the pull base and push identity evidence.
- `local-edited` produces the local delta and the candidate dry-run plan.
- `remote-changed` simulates live remote drift between dry-run and apply.
- the runner remains the only actor allowed to compare, upload, and recover.
Use only the sandbox-provided `8080` ingress if a browser-visible proxy is
needed for inspection, and keep the WordPress blueprints isolated from each
other.

The preferred Playground topology keeps the same role split:

- remote base blueprint is the source truth used to create the pull base
- local edited blueprint is the imported site after user modifications
- remote changed blueprint is a separately booted live remote that exercises
  stale plan rejection, journal inspection, and recovery outcomes

The runner should treat these as three snapshots of one logical site lineage,
not as three independent targets. The important proof is that apply revalidates
against the live remote, not that dry-run and apply see the same snapshot.

For both Docker and Playground, the remote drift target must be distinct from
the persisted base source, and the runner must compare against the live drift
instance before apply, or the executor cannot prove that apply revalidated a
live remote rather than replaying a stale snapshot.

For production-facing checks, keep the topology constrained to a single remote
source, a single edited local clone, and a single executor process. That keeps
the base binding, snapshot listing, dry-run receipt, apply revalidation, and
recovery journal path observable end to end.

## Durable Push State

Each push attempt gets its own state directory next to the saved pull state.
The directory is append-only except for a small current-state pointer:

```text
push-state/<attempt-id>/
  base-ref.json                 copied hashes and identifiers from push-base
  preflight-response.json       push session, capability, limits, auth scope
  remote-hashes.jsonl           complete paged hash listing
  remote-coverage.json          accepted coverage manifest
  local-scan.jsonl              normalized local resource hashes
  plan.json                     canonical plan uploaded to dry-run
  dry-run-response.json         accepted, blocked, conflict, or invalid
  batches/<batch-id>.json       exact apply request body for each batch
  receipts/<batch-id>.json      apply responses and idempotency evidence
  journal.jsonl                 inspected remote journal pages
  recovery.jsonl                recovery inspections or repair attempts
  state.json                    latest resumable executor state
```

The executor never rewrites an apply batch after assigning its idempotency key.
If the remote returns `PRECONDITION_FAILED`, the executor creates a new push
attempt after refreshing remote hashes and replanning. If the response is lost,
the executor first calls `push_journal`; only a journal state that proves the
same request is still open may be retried with the same key and body.

Recovery handling:

- `inspect` is always the first recovery call after an ambiguous apply state
- `finish` is only allowed when the journal proves the batch already committed
- `rollback` is only allowed when the journal and live hashes prove the remote
  can be restored to a safe pre-batch state
- `auto` is a server-side choice between finish, rollback, or block; the
  executor still records the proof it received

The state directory is also the audit boundary between the existing pull
pipeline and push. Pull may refresh or replace `push-base/` only after a
successful pull. A push attempt may copy hashes and identifiers from
`push-base/`, but it must not rewrite the base package to make a stale plan
look current. A conflict resolution, URL retarget confirmation, or recovery
action creates a new attempt record with its own plan and request hashes.

## Execution Flow

### 1. Load Base

Read the manifest created by the successful pull:

- remote URL and site identity
- base manifest hash and scanner coverage hash
- export protocol metadata
- WordPress version, paths, table prefix, multisite state
- resource keys and base hashes
- optional base bodies for files/rows needed by merge drivers

Abort if the base manifest is missing. A push without a base is a blind
overwrite risk. Abort if the manifest predates push-compatible scanner
coverage; the user must pull again to create a base that can participate in
three-way planning.

### 2. Preflight

Call `push_preflight` with the requested scopes. Store:

- `push_session`
- expiry
- remote identity hash and server clock skew estimate
- limits
- journal capabilities
- hash listing capabilities
- database and filesystem mutation capabilities
- storage guards and semantic driver versions

Abort if push auth is not scoped for mutation or the server cannot write a
journal. Abort on `SITE_IDENTITY_MISMATCH`; the executor may ask the user to
confirm a remote URL change, but confirmation must result in a fresh preflight
against the same `site_id`.

When apply later becomes ambiguous, do not infer recovery from stale dry-run
evidence. Use the inspect-first recovery path instead; the machine-readable
fixture at
[`fixtures/protocol/push-recovery-path.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-path.json)
captures the old/new/blocked/open classification after the journal is read and
live hashes are refreshed.

Current lab note: `npm run test:playground:authenticated-http-push` verifies a
local Playground preflight at
`/wp-json/reprint-push-lab/v1/authenticated/preflight`. It returns identity,
`manage_options`, scope, session, expiry, idempotency, and journal evidence, and
the matching authenticated dry-run/apply routes bind receipts to auth/session
and request data before DB idempotency claim/mutation. The signed-request lab
requires HMAC signatures on `/authenticated/preflight`,
`/authenticated/dry-run`, and `/authenticated/apply`; it verifies
`X-Auth-Content-Hash` as SHA-256 over the raw request body bytes and rejects bad
signatures before JSON parsing, receipt checks, idempotency lookup, journal
write, or mutation. Dry-run/apply also bind `X-Reprint-Push-Signature` to the
lab domain separator, method, actual path, canonical query, content hash, lab
session, and idempotency key. This is authenticated local Playground
source-site mutation evidence only. Playground fallback caveat: the lab
verifier validates stored hashed app-password entries and sets the current user
because local Playground core did not establish `/wp-json/wp/v2/users/me`; it
is not production Reprint auth or production Application Password integration.

Current production-shaped route note:
`npm run test:playground:production-shaped-push` verifies signed
preflight/dry-run/apply plus authenticated snapshot, replay, DB journal, and
recovery inspect through `/wp-json/reprint/v1/push/*`. The CLI can target that
profile with `--route-profile production-shaped`. This proves route shape and
request binding over a real local Playground source site, including guarded
DB/file mutations, same-key different-body conflict refusal, and unmodified
cross-route receipt refusal before mutation. It is still lab-backed route-shape
evidence: the route is mounted by the Playground mu-plugin, uses the lab
signing key derivation, and does not prove tamper-resistant production receipt
security, credential lifecycle, production nonce/replay retention, durable
production journal storage, leases/fencing, WordPress graph identity, or
arbitrary plugin drivers.

Current packaged-plugin note:
`npm run test:playground:production-plugin-package` builds a temporary
`reprint-push` plugin package from [plugins/reprint-push](../plugins/reprint-push),
mounts it as a normal plugin, activates it through a Blueprint step, confirms
the public `reprint-push-lab/v1` namespace is disabled, and applies seven
graph-safe fixture mutations through `/wp-json/reprint/v1/push/*`. The package
sets `REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP` by default, so the smoke explicitly
provisions only the primary push-scoped Application Password fixture and
verifies both an unprovisioned alternate credential and an unscoped
administrator Application Password are rejected with `401`. It also seeds
expired and unexpired signed session/nonce option artifacts and proves preflight
deletes the expired artifacts while retaining unexpired ones. This improves the
packaging, scoped-credential, and signed-store hygiene proof but is still not
production readiness: the endpoint internals remain lab-backed until production
auth, credential lifecycle, durable journal storage, leases/fencing, WordPress
graph identity, and plugin drivers replace the fixture implementation.

### 3. Remote Snapshot Hash Listing

Call `push_snapshot_hashes` until complete. Include base resource keys so
deletions on the remote are represented as absent resources.

Store the full listing, `snapshot_id`, `coverage_id`, and `coverage_hash`, but
do not treat them as an apply lock. The remote remains live. If any requested
scope has incomplete coverage, unknown plugin-owned data, unsupported custom
tables, or unguarded resources that the local changes depend on, the executor
marks the plan blocked instead of building a ready mutation.

### 4. Local Scan

Scan the local site into the same resource model. The scan must use the current
local paths, table prefix, plugin state, and WordPress constants, then normalize
them back to the base manifest's resource keys.

Generated caches, object-cache data, transients, and runtime artifacts should be
excluded unless a plugin/theme driver explicitly declares them pushable.

### 5. Plan

Create the three-way plan:

```text
base manifest + local scan + remote hash listing -> push plan
```

Plan statuses:

- `ready`: safe to ask the remote for a dry-run receipt.
- `blocked`: executor must stop until dependencies or capabilities exist.
- `conflict`: executor must preserve remote and require user resolution.

Ready means "ready for dry-run upload", not "guaranteed to apply". The apply
stage still revalidates live remote hashes.

Conflict resolution creates a new auditable plan. The executor records the
base/local/remote hashes and reviewed choice, refreshes the remote hash listing,
then replans. It must not attach a manual approval to an older dry-run receipt
to skip current remote preconditions.

### 6. Dry-Run Upload

Upload the plan to `push_plan_dry_run`. The remote validates:

- auth scope
- plan schema
- base manifest and remote identity binding
- remote coverage hash from the completed hash listing
- resource addressability
- every mutation has a precondition
- every mutation has a supported storage guard or semantic driver
- atomic group closure
- plugin/theme validators
- journal writeability
- request and batch size limits

The remote may return `ready`, `blocked`, `conflict`, or `invalid`. The executor
must persist the response and stop unless it is `ready`.

Current lab note: `npm run test:playground:plugin-atomic-install` proves a
hard-coded fixture plugin install atomicity path where JavaScript and PHP both
validate fixture atomic dependency closure before mutation/preconditions where
relevant. Forged ready plans that omit the dependency mutation, omit
`atomicGroups`, omit dependency requirements, use stale live-remote dependency
evidence, or try a row-only plugin-owned data bypass reject before mutation.
The row-only bypass is classified as `ATOMIC_GROUP_DEPENDENCY_UNDECLARED`.
This is exact fixture plugin allowlist evidence only; arbitrary plugin files,
direct `active_plugins` row mutation, custom tables outside the exact forms lab
driver, and arbitrary plugin-owned data remain blocked. The one current
custom-table exception is the fixture-only `wp_reprint_push_forms_lab` semantic
driver `fixture-forms-lab-table`: owner `forms`, positive `id:N`, explicit
policy, unchanged active `reprint-push-forms-fixture` evidence, live
precondition hashes, exact PHP table/column/payload validation, delete blocked,
idempotent replay with zero fresh mutation work, and redacted hash-only
journal/recovery evidence.

### 7. Apply Batches

Split mutations into batches within remote limits. Atomic groups must not be
split unless the group declares explicit safe sub-batches.

For each batch:

1. Send `push_batch_apply` with the accepted `dry_run_id`.
2. Include all live preconditions for the batch.
3. Include the same idempotency key when retrying after a lost response.
4. Persist the response before starting the next batch.
5. On `PRECONDITION_FAILED`, stop and report the changed resource keys.
6. On timeout or connection loss, inspect `push_journal` before retrying.

The executor never assumes that a missing HTTP response means failure. It asks
the journal.

Apply requests are single-use by body hash and idempotency key. If a batch must
be retried after `PRECONDITION_FAILED`, the executor discards the dry-run
receipt, refreshes the remote hash listing, and replans. It never edits the
batch body under the same idempotency key.

Retry policy:

- `5xx`, network close, timeout before response body: inspect `push_journal`,
  then retry only if the same request is open or absent.
- `BATCH_ALREADY_COMMITTED`: persist the replay receipt and continue with the
  next batch after journal confirmation.
- `PRECONDITION_FAILED`: stop, preserve the remote, and replan from a fresh
  hash listing.
- `RECOVERY_REQUIRED`: call `push_journal`, then `push_recover` in `inspect`
  or `auto` mode according to the user's recovery policy.
- `IDEMPOTENCY_KEY_CONFLICT`: stop; this means the local state directory no
  longer matches the remote idempotency record.

### 8. Journal Confirm

After the last batch, call `push_journal` and verify:

- every batch is `committed`
- final hashes match the plan
- no entry is `recovery_required` or `blocked`
- the dry-run is marked complete

Only then mark local push state complete.

## Remote Apply Semantics

The remote executor should apply each batch with this order:

1. Authenticate and authorize.
2. Load accepted dry-run and idempotency record.
3. Verify the request hash matches any prior idempotency claim.
4. Recompute live hashes for every batch precondition.
5. Reject without mutation on any mismatch.
6. Open journal entry with before hashes and artifact references.
7. Stage file writes under a private temp directory.
8. Start database transaction or acquire the advertised write lock.
9. Recheck each target at its storage boundary under the advertised guard.
10. Perform database mutations.
11. Move staged files into place through compare-and-rename/unlink guards.
12. Run plugin/theme validators and activation hooks that are part of the plan.
13. Compute final hashes.
14. Commit transaction or finalize the durable batch marker.
15. Mark journal committed.

MySQL row mutations should use transactions and row locks when possible. SQLite
sites should use `BEGIN IMMEDIATE` for database batches. File mutations should
write temp files, fsync where available, then rename. File and database changes
cannot be a single native transaction on typical WordPress hosts, so the journal
and recovery artifacts are mandatory.

If plugin/theme code can run during apply, the driver must declare side effects
as resources in the same atomic group. Activation or migration hooks that may
write undeclared options, tables, files, roles, cron, rewrite rules, or caches
block the group until a semantic driver can validate them.

## Journal And Recovery

The journal must let the executor answer one question after a crash:

```text
Is each resource definitely old, definitely new, or blocked with evidence?
```

Journal entries include:

- dry-run ID and plan ID
- batch ID and idempotency key
- canonical request hash and authenticated identity
- before hashes
- staged artifact hashes and locations
- after hashes
- storage guard observations
- current state
- error code and details

Recovery rules:

- If no target resource changed and before hashes still match, mark rolled back.
- If all final hashes match the plan, mark committed.
- If staged artifacts exist and live hashes still satisfy preconditions, finish
  only when `push_recover` mode allows it.
- If live hashes are mixed or unexpected, mark `recovery_blocked` and return
  exact evidence.

Recovery must never silently discard a remote edit made after the dry-run. It
must revalidate live hashes just like apply.

## Conflict And Blocker Policy

The reliable executor preserves remote changes by default.

Stop conditions:

- local and remote changed the same resource differently
- unknown plugin-owned serialized data changed
- plugin/theme dependency is missing
- schema driver is missing for a schema mutation
- remote journal cannot be written
- remote cannot revalidate a resource precondition
- batch would exceed remote request limits and cannot be split safely

The executor may offer conflict artifacts for review, but it must not auto-merge
plugin-owned data unless a plugin driver returns a deterministic resolution.

## Test Topology

The minimum integration topology has one remote WordPress site, one local
WordPress site, and a runner. No remote tunneling service is used.

```text
docker network: reprint-push

remote-db      MySQL or MariaDB for the source site
remote-base    WordPress with Reprint exporter and push extension
local-db       MySQL, MariaDB, or SQLite for the edited local site
local-edited   WordPress created from a Reprint pull of remote-base
runner         Node/PHP test runner with Reprint importer and push client
proxy-8080     Optional local-only reverse proxy for browser inspection
```

Port rules:

- Publish only `127.0.0.1:8080` from `proxy-8080` when browser inspection is
  needed.
- Keep `remote-base`, `local-edited`, and databases on the Docker network only.
- The runner should be the only container that talks to both sites.

### Playground Topology

Use Playground when the test environment needs a disposable local-only pair of
sites. Keep the same one-remote, one-local shape and represent live remote
drift with a third disposable snapshot:

| Site | Blueprint role | Purpose |
| --- | --- | --- |
| Remote site | `fixtures/playground/remote-base.blueprint.json` | Pulled source truth that the push session was derived from. |
| Local site | `fixtures/playground/local-edited.blueprint.json` | Edited local site that produced the push plan. |
| Drift site | `fixtures/playground/remote-changed.blueprint.json` | Independent live-remote edit used to prove apply-time revalidation and recovery. |

The runner launches the blueprints separately, exports the remote base
manifest, imports it into the local site, applies local edits, and then compares
the local plan against the drift site for `PRECONDITION_FAILED` and recovery
coverage. The remote and local sites must stay distinct throughout the test:
the remote is never repurposed as the edited site, and the edited site never
becomes the source of truth. The drift site exists only to prove that a live
remote can change after dry-run and before apply.
In the Docker topology, the runner calls `http://remote-base/` and
`http://local-edited/` by service name, and the environment must not use ngrok,
cloudflared tunnels, localtunnel, serveo, localhost.run, Tailscale Funnel, or
equivalent remote tunnel services.

The same shape can also be expressed with WordPress Playground when Docker or
WP-CLI is unavailable in the sandbox. In both cases, the remote and local
sites stay distinct: one remote source of truth, one edited local pull target,
and one separate drift witness.

The push executor maps directly onto the existing pull pipeline:

1. Pull exporter/importer creates the immutable base package and coverage
   evidence.
2. Push preflight binds that package to the live remote identity, write scope,
   and a short-lived push session.
3. Push snapshot hashes record the live comparison set and scope-completion
   proof used for planning.
4. Push dry-run uploads the canonical three-way plan without mutating state
   and without reserving liveness.
5. Push apply revalidates the live remote before each batch and again at the
   storage boundary.
6. Push journal and recover inspect read durable evidence only until the
   journal proves a safe finish, rollback, or block.

That mapping is one-way. Pull establishes the persisted base package and the
coverage proof; push consumes those artifacts as immutable provenance and
never rewrites them to make a stale remote look current. The live remote hash
listing is a planning snapshot only, and the dry-run receipt is a receipt of
eligibility only. Apply must fetch fresh live evidence again before every
batch.

The machine-readable topology fixture
[`fixtures/protocol/push-topology.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-topology.json)
captures the same one-remote, one-local, one-drift-witness split for focused
test code, and [`fixtures/protocol/push-pull-mapping.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-pull-mapping.json)
captures the pull-to-push handoff that the executor must preserve.
[`fixtures/protocol/push-executor-topology-proof.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-executor-topology-proof.json)
is the compact executor proof that ties the pull pipeline, the production
push ladder, and the sandbox ingress rules together.
[`fixtures/protocol/push-production-ladder-contract.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-production-ladder-contract.json)
ties the production ladder together: preflight, snapshot listing, dry-run,
batch apply, journal inspect, and inspect-first recovery all stay separate.
[`fixtures/protocol/push-recovery-decision.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-recovery-decision.json)
captures the inspect-first recovery gate that keeps mutating repair behind
fresh live proof.
[`fixtures/protocol/push-flow.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-1/reliable-executor/fixtures/protocol/push-flow.json)
captures the exact stage order and recovery boundary for focused tests.

The fixtures are intentionally narrow:

- `push-flow.json` asserts the ordered endpoint sequence and fresh-live
  revalidation before apply.
- `push-pull-mapping.json` asserts that the persisted pull base stays
  read-only provenance.
- `push-topology.json` asserts the one-remote, one-local, one-drift-witness
  shape for Docker and Playground, plus the sandbox-only 8080 ingress rule.
- `push-executor-topology-proof.json` compresses the same proof into the
  executor-facing contract that also names the push ladder.

Minimal Compose shape:

```yaml
services:
  remote-db:
    image: mariadb:11
    networks: [reprint-push]
  remote-base:
    image: wordpress:php8.3-apache
    depends_on: [remote-db]
    networks: [reprint-push]
    volumes:
      - ./plugins/reprint-push:/var/www/html/wp-content/plugins/reprint-push:ro
  local-db:
    image: mariadb:11
    networks: [reprint-push]
  local-edited:
    image: wordpress:php8.3-apache
    depends_on: [local-db]
    networks: [reprint-push]
  runner:
    image: node:22-bookworm
    working_dir: /workspace
    networks: [reprint-push]
    volumes:
      - .:/workspace
    command: ["sleep", "infinity"]
  proxy-8080:
    image: caddy:2
    networks: [reprint-push]
    ports:
      - "127.0.0.1:8080:8080"

networks:
  reprint-push: {}
```

The sketch intentionally omits public ports on both WordPress containers. The
runner and optional proxy are the only cross-service entry points; the proxy is
local-only and exists only for inspection.

Test sequence:

1. Start remote WordPress and install the exporter/push extension.
2. Pull remote into local WordPress and save the base manifest.
3. Edit local content and files.
4. Optionally edit a different remote resource to prove remote-only changes are
   preserved.
5. Run push preflight, hash listing, plan, dry-run upload, apply, and journal
   confirm.
6. Assert remote contains local non-conflicting changes and remote-only changes.
7. Repeat with a remote edit between dry-run and apply; expect
   `PRECONDITION_FAILED`.
8. Inject a process kill after staging; run `push_journal` and `push_recover`.

Suggested assertions:

- Preflight rejects a read-only export secret and accepts only push-scoped HMAC.
- Hash listing returns complete coverage or the plan is blocked.
- Dry-run does not mutate remote files or database rows.
- Apply revalidates live remote hashes.
- Apply proves storage-boundary guards for one row and one file.
- A direct conflict leaves the remote unchanged.
- Atomic plugin install cannot partially apply.
- Lost HTTP response is resolved by idempotency plus journal inspect.
- Recovery must start with `push_recover` in `inspect` mode and only then may
  advance to `auto`, `finish`, or `rollback` when the journal proves the state.
- Recovery can prove committed, rolled back, or blocked.
- Recovery cannot silently turn stale evidence into permission; it must fetch
  fresh live hashes before any mutating recovery mode.

Minimum topology matrix:

| Case | Remote action | Expected result |
| --- | --- | --- |
| Clean push | Remote unchanged since pull | Dry-run ready, apply committed, journal complete. |
| Remote-only edit | Remote changed a different resource | Planner keeps remote edit and applies local non-conflicting edits. |
| Direct conflict | Remote changed the same resource differently | Planner reports conflict; no dry-run apply path. |
| Drift after dry-run | Remote changes a planned target before apply | Apply returns `PRECONDITION_FAILED`; remote edit survives. |
| Lost apply response | Runner drops connection after request | Executor inspects journal first, then replays or resumes by idempotency only if the journal shows the same request is still open. |
| Interrupted batch | Server exits after staging or partial write | Recovery reports committed, rolled back, or blocked with resource evidence. |
| Read-only credential | Export secret lacks push scope | Preflight or dry-run rejects before mutation. |

For the production-shaped push lane, keep the test topology deliberately small
and constrained to one remote source, one local edited site, and one drift
witness:

| Role | Docker topology | Playground topology |
| --- | --- | --- |
| Remote source site | `remote-base` container with the pull base and live drift injection hooks | `remote-base` loopback server with the source-site plugin/theme state |
| Local edited site | `local-edited` container holding the imported base plus local edits | `local-edited` loopback server holding the imported base plus local edits |
| Runner | `push-runner` container or host process that signs requests, uploads dry-run plans, and reads journals | Same runner process, bound to the sandbox-provided `8080` ingress only when browser inspection is needed |
| Drift witness | `remote-changed` mutation against the remote site after snapshot listing | `remote-changed` Playground state change after snapshot listing |

In both topologies, `remote-base` and `remote-changed` must represent the same
remote identity observed at different times. That is the proof that dry-run
and apply are separate and that apply revalidates live state instead of
reusing stale planning evidence.

The executor should treat the protocol as six ordered checks on that single
remote identity:

1. preflight binds the persisted pull base to the live remote
2. remote snapshot hash listing stays planning-only
3. dry-run plan upload returns a receipt, not a lock
4. mutation batch apply revalidates before every batch and at the storage boundary
5. journal inspect resolves lost-response ambiguity without mutating state
6. recovery begins with inspect and only then may finish, roll back, or auto-advance

Use the topology to prove the remote and local roles are separate and that
the pull package remains immutable provenance:

- `remote-base` is the authoritative live remote for preflight, snapshot listing, dry-run eligibility, apply-time revalidation, journal inspection, and recovery.
- `local-edited` is the edited local mirror that feeds the planner.
- A separate `remote-changed` state is required for the stale-apply case so dry-run and apply are not conflated.
- Apply must revalidate against the live remote again even when the dry-run receipt is valid.
- The local site is derived from a pull of the remote base, so the persisted
  pull package is the planning base for later push attempts.
- Journal inspection must return fenced ownership details, including claim
  generation and lease expiry, so lost-response retries can tell whether a
  claim is still open or already resolved.

The pull/export/import pipeline is the provenance source for every push run:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. `push_preflight` binds that package to the live remote identity and a
   short-lived push session
4. `push_snapshot_hashes` lists the live remote comparison set for planning
   only
5. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
   lock
6. `push_batch_apply` revalidates the live remote before every batch and at
   the storage boundary
7. `push_journal` and `push_recover inspect` read durable evidence first and
   never turn old proof into current authority

That mapping is one-way on purpose. The pull package never becomes a lock,
and a later remote drift is valid evidence that apply must revalidate rather
than reuse stale dry-run state.

Recovery should always begin with `push_journal` or `push_recover` in
`inspect` mode before any mutating retry. If the remote cannot prove the same
claim, session, and live hashes that were present when the batch opened, the
executor must treat the attempt as blocked and stop rather than replaying a
stale dry-run receipt.
The inspect call can itself return a blocked result; that is the proof that
the executor must not advance to `finish`, `rollback`, or `auto` without new
evidence.

## Playground Test Topology

WordPress Playground can run the same shape with faster setup:

```text
remote-base    local-only Playground server for the source site
local-edited   local-only Playground server for the edited pulled site
remote-changed local-only Playground server for the drift witness
runner         push protocol test runner
proxy-8080     optional local-only ingress to inspect either site
```

Recommended usage:

- Mount the Reprint exporter/push extension into `remote-base`.
- Pull from `remote-base` into `local-edited`.
- Store the base manifest in the runner workspace.
- Bind Playground servers to loopback or container-internal addresses.
- Route browser access through the single local 8080 proxy if needed; do not
  introduce any remote tunnel.
- Run signed preflight/dry-run/apply plus authenticated snapshot, journal, and
  recovery inspect through the production route names even when the backing
  implementation is a Playground fixture.
- Treat `remote-changed` as the authoritative live-remote liveness witness:
  if it diverges after dry-run, the executor must revalidate before apply.
- The production route names are the same in Docker and Playground; only the
  backing site implementation changes.

The test topology is therefore fixed:

- one remote base site seeds the pull package
- one local edited site produces the candidate plan
- one remote-changed site proves live drift between dry-run and apply
- one runner signs requests, uploads the dry-run plan, inspects the journal,
  and performs recovery
- only the sandbox-provided `8080` ingress may be used for browser-visible
  inspection

Playground is best for protocol, planner, and recovery fixtures. Docker with
MySQL/MariaDB remains necessary for transaction, lock, and fencing behavior
that differs from SQLite. Use Docker when you need to prove journal rows,
lease expiry, or apply-time revalidation against a production-shaped database
boundary; use Playground when you need fast, repeatable protocol and recovery
smokes against the same one-remote, one-local shape.

## Test Fixtures

Protocol fixtures live under `fixtures/protocol/`.

They are not complete site exports. They are wire-contract examples for:

- required auth header families and signature inputs
- preflight request and response shape
- remote hash listing request and response
- dry-run upload and receipt
- apply batch request and response
- journal inspect request and response
- recovery request and committed or blocked recovery states

Executable integration tests should use these fixtures as schema examples, then
run against real Docker or Playground sites for filesystem and database
semantics.
