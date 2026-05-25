# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote site and one local site.

The pull-to-push mapping is one-way: exporter/importer establish immutable
provenance, and push consumes it without rewriting it. The imported pull base
package is the only starting point for push planning, and preflight binds that
package to one live remote identity plus one short-lived session.

That handoff is the same one defined in [protocol.md](protocol.md):

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted base package to the live remote identity and
  requested scope
- snapshot hash listing is planning-only
- dry-run uploads a receipt, not a lock
- batch apply revalidates fresh live evidence before every batch and at the
  storage boundary
- journal inspect stays read-only
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the action safe

The production proof for that mapping is a one-remote, one-local topology:

- `remote-example` is the remote source identity
- `local-dev-site` is the imported local edit site
- `remote-base` and `remote-changed` are the same remote identity observed at
  different times
- `runner` is the only actor that may preflight, list hashes, upload the dry
  run plan, apply batches, inspect the journal, or start recovery

Docker and Playground both use the same route names, the same `8080` ingress
rule for browser-visible inspection, and the same live-drift story: the remote
is observed once as the seeded base site and again as the drift witness after
the dry-run receipt exists.

## Executor Contract

The executor has one production shape:

- it starts from a persisted pull base package
- it binds that package to one live remote identity and requested scope in
  `push_preflight`
- it treats `push_snapshot_hashes` as the remote snapshot hash listing for
  planning only
- it uploads a canonical dry-run plan as eligibility evidence only
- it applies in batches with live revalidation before every batch and at the
  storage boundary
- it inspects the journal before any mutating recovery
- it never uses dry-run as a lock or snapshot listing as write authority

The production ladder is fixed and the executor follows it exactly:

1. `push_preflight` binds the persisted pull base to one live remote identity,
   one requested scope, and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and
   at the storage boundary.
5. `push_journal` reads durable evidence without authorizing mutation.
6. `push_recover inspect` classifies finish, rollback, retry, or block before
   any mutating repair.
7. `push_recover auto|finish|rollback` mutates only after inspect and fresh
   live hashes prove the action safe.

## Auth And Recovery

The auth and session boundary is part of the production shape:

- preflight must mint one short-lived push session bound to the persisted pull
  base, live remote identity, and requested scope.
- read-only inspection may stay on the existing HMAC family.
- dry-run, apply, and mutating recovery must use the push session plus the
  canonical push signature and idempotency key.
- the push session scopes the write path, but it does not reserve remote state.

Recovery uses a separate read-only inspection step from the durable journal
readback:

- `push_journal` reads claim, lease, and fencing evidence for interrupted or
  ambiguous applies.
- `push_recover inspect` classifies finish, rollback, retry, or block before
  any mutating repair.
- `push_recover auto|finish|rollback` may mutate only after inspect and fresh
  live hashes prove the action safe.

The journal and recovery split is intentionally narrow:

- `push_journal` is durable evidence readback only.
- `push_recover inspect` is a read-only classifier over journal rows and live
  hashes.
- `push_recover auto|finish|rollback` is the only mutating recovery path.

The executor never upgrades planning evidence into write authority:

- `push_snapshot_hashes` can be paginated, but every page remains planning-only
  and must never be treated as a lock.
- `push_plan_dry_run` is a receipt-producing upload, not a reservation.
- `push_batch_apply` must revalidate the live remote before every batch and at
  the storage boundary.
- `push_journal` is durable readback only.
- `push_recover inspect` must run before any mutating recovery branch.

That split is the production liveness rule:

- snapshot hashes are planning evidence only
- dry-run is an eligibility receipt, not a lock
- apply must revalidate fresh live evidence before every batch and at the
  storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

## Scope

- one persisted pull base package
- one live remote identity observed twice, before and after drift
- one edited local clone derived from that base
- one runner process that owns preflight, planning, apply, journal inspect,
  and recovery

## Proof Stack

The canonical proof stack for that scope is:

| Proof | What it pins down |
| --- | --- |
| [`fixtures/protocol/push-pull-mapping.json`](../fixtures/protocol/push-pull-mapping.json) | The one-way bridge from exporter/importer provenance into the push ladder. |
| [`fixtures/protocol/push-preflight-contract.json`](../fixtures/protocol/push-preflight-contract.json) | The preflight binding between the imported pull base, the live remote identity, the requested scope, and the short-lived push session. |
| [`fixtures/protocol/push-protocol-extension-contract.json`](../fixtures/protocol/push-protocol-extension-contract.json) | The full push ladder: preflight, snapshot hash listing, dry-run upload, batched apply, journal inspect, and inspect-first recovery. |
| [`fixtures/protocol/push-remote-liveness-contract.json`](../fixtures/protocol/push-remote-liveness-contract.json) | The compact proof that dry-run and apply stay separate remote operations and that apply revalidates fresh live evidence. |
| [`fixtures/protocol/push-deployment-topology-contract.json`](../fixtures/protocol/push-deployment-topology-contract.json) | The one-remote, one-local, one-drift topology in Docker and Playground. |
| [`fixtures/protocol/push-executor-topology-proof.json`](../fixtures/protocol/push-executor-topology-proof.json) | The compact executor proof for the same remote identity observed twice, the same route names in both harnesses, and the sandbox-provided `8080` ingress rule. |
| [`fixtures/protocol/push-topology-matrix.json`](../fixtures/protocol/push-topology-matrix.json) | The stage-level Docker/Playground proof with liveness, recovery, and apply revalidation rules. |
| [`fixtures/protocol/push-remote-liveness-contract.json`](../fixtures/protocol/push-remote-liveness-contract.json) | The dry-run/apply split and apply-time revalidation rule for the live remote. |
| [`fixtures/protocol/push-auth-session-fencing-contract.json`](../fixtures/protocol/push-auth-session-fencing-contract.json) | The push-session boundary, journal-row fence, and read-only recovery inspect rule. |
| [`fixtures/protocol/push-auth-session-recovery-contract.json`](../fixtures/protocol/push-auth-session-recovery-contract.json) | The same fence when recovery needs to prove finish, rollback, or block before mutating. |
| [`fixtures/protocol/push-recovery-inspect-contract.json`](../fixtures/protocol/push-recovery-inspect-contract.json) | Inspect reads the journal row and fresh live hashes before classifying finish, rollback, retry, or block. |
| [`fixtures/protocol/push-recovery-revalidation-contract.json`](../fixtures/protocol/push-recovery-revalidation-contract.json) | Mutating recovery still requires fresh live hashes plus journal evidence after inspect proves the branch is safe. |

If a review needs the finer-grained auth and restart proof, add:

| Fixture | What it proves |
| --- | --- |
| [`fixtures/protocol/push-auth-headers.json`](../fixtures/protocol/push-auth-headers.json) | Mutating requests must carry push-scoped HMAC headers at or above the current Reprint floor. |
| [`fixtures/protocol/push-session-journal-proof.json`](../fixtures/protocol/push-session-journal-proof.json) | The minted session survives an interrupted apply only when the journal row and lease fence still prove the same claim. |

## Production Sequence

The production sequence is fixed:

1. `push_preflight` binds the persisted pull base to a live remote identity
   and a short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison set for planning.
   Large sites may require cursoring, but every page remains planning-only and
   never becomes a lock or a write permit.
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
8. `push_recover auto|finish|rollback` still requires the same journal fence
   and fresh live hashes before it can mutate.

The remote API is split by evidence class, not just by route name:

- `push_preflight` binds the persisted pull base to one live remote identity
  and one short-lived push session.
- `push_snapshot_hashes` is cursorable planning evidence only and never
  becomes write authority.
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock.
- `push_batch_apply` is the first write stage and must revalidate live remote
  evidence before every batch and again at the storage boundary.
- `push_journal` is read-only.
- `push_recover inspect` starts before any mutating recovery and may block
  until fresh live hashes prove the repair path.
- `push_recover auto|finish|rollback` only mutates when journal evidence and
  fresh live hashes still prove the path safe.

## Topology

The executor topology proof is intentionally narrow:

- one remote source site seeds the persisted pull base
- one local edited site produces the candidate plan
- one later observation of the same remote identity proves drift
- one runner process owns preflight, remote snapshot hash listing, dry-run
  plan upload, batch apply, journal inspect, and recovery
- the Docker and Playground proofs keep the same route names and the same
  `8080`-only browser ingress rule

The lab identities behind that shape are `remote-example` for the remote
source site and `local-dev-site` for the imported local edit site. Docker and
Playground both prove the same remote identity twice, once as the seeded base
site and again as the drift witness, so the executor never needs to infer a
second remote from the test topology.

The harness shape is fixed:

- Docker uses one private network with the three site roles and the runner
- Playground uses separate disposable blueprints with the same route names
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy

The intended one-remote, one-local topology is:

| Environment | Remote source | Local edited site | Drift witness | Runner |
| --- | --- | --- | --- | --- |
| Docker | `remote-base` | `local-edited` | `remote-changed` | `runner` |
| Playground | `remote-base` | `local-edited` | `remote-changed` | local test process |

Both harnesses preserve the same remote identity across the base and drift
observations, and both keep browser-visible inspection on the sandbox-provided
`8080` ingress through a local-only proxy.

The lab identities are fixed to the same proof map used by the protocol
contract:

- `remote-base` and `remote-changed` are the Docker and Playground aliases
  for `remote-example`
- `local-edited` is the Docker and Playground alias for `local-dev-site`
- the runner owns preflight, snapshot listing, dry-run upload, batched apply,
  journal inspect, and recovery

Use the same shape in both harnesses:

| Role | Docker | Playground |
| --- | --- | --- |
| `remote-base` | `remote-base` | `remote-base` |
| `local-edited` | `local-edited` | `local-edited` |
| `remote-changed` | `remote-changed` | `remote-changed` |
| `runner` | `runner` | local test process |

The lab identities for that proof are `remote-example` and `local-dev-site`.
They let the executor point at one remote source, one imported local edit
site, and the same remote identity again after drift.

## Pull Handoff

The pull-to-push handoff stays one-way:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- push preflight binds that package to the live remote identity and a
  short-lived session
- push snapshot hashes stay planning-only
- push dry-run uploads a receipt, not a lock
- push batch apply revalidates before every batch and at the storage boundary
- push journal and push recover inspect read durable evidence first

This is the operational bridge to the existing pull pipeline:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. push preflight binds that provenance to one live remote identity and one
   short-lived push session
4. push snapshot hashes remain planning-only
5. push dry-run uploads the canonical plan as a receipt
6. push batch apply revalidates before every batch and at the storage boundary
7. push journal stays read-only
8. push recovery starts with inspect and only mutates when the journal plus
   fresh live hashes still prove the action safe

The proof stack is the canonical review order:

1. `push-pull-mapping.json`
2. `push-protocol-extension-contract.json`
3. `push-remote-liveness-contract.json`
4. `push-deployment-topology-contract.json`
5. `push-topology-matrix.json`
6. `push-auth-session-fencing-contract.json`
7. `push-auth-session-recovery-contract.json`
8. `push-recovery-inspect-contract.json`
9. `push-recovery-revalidation-contract.json`
10. `push-snapshot-hashes-page-contract.json`
11. `push-dry-run-apply-revalidation-contract.json`

The pull-to-push bridge is easiest to review through the fixtures:

- `push-pull-mapping.json`, `push-protocol-extension-contract.json`, and
  `push-remote-liveness-contract.json` prove the pull provenance, stage order,
  dry-run/apply split, and recovery boundary.
- `push-snapshot-hashes-page-contract.json` and
  `push-dry-run-apply-revalidation-contract.json` prove the live remote hash
  listing stays cursorable and planning-only, and that a stale dry-run receipt
  never skips apply-time revalidation.
- `push-deployment-topology-contract.json` and
  `push-executor-topology-proof.json` prove the Docker and Playground
  topology, the same remote identity observed before and after drift, the
  same route names in both harnesses, and the sandbox-provided `8080` ingress
  rule.
- `push-auth-session-fencing-contract.json`,
  `push-auth-session-recovery-contract.json`, and
  `push-recovery-inspect-contract.json` prove the session fence, journal row
  fence, and inspect-first recovery boundary.
- `push-recovery-revalidation-contract.json` shows the same drift case still
  requires fresh live hashes plus journal evidence before mutating repair.

## Recovery States

Recovery classifies the attempt into the same four states used by the protocol
contract:

- `old`: the journal proves the prior write already committed.
- `new`: the remote advanced independently and the stale attempt must be
  discarded or replanned from fresh evidence.
- `open`: the attempt is still in flight and inspect-first recovery must
  continue.
- `blocked`: the journal or fresh live hashes prove finish or rollback would
  be unsafe.

## Harness Rules

The executor keeps the same security envelope in Docker and Playground:

- the sandbox-provided `8080` ingress is the only browser-visible path
- local-only proxies are allowed
- remote tunnels are disallowed
- the pull exporter/importer produce immutable provenance before push starts
- dry-run and apply remain separate remote operations
- apply-time revalidation must still happen before every batch and at the
  storage boundary

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
