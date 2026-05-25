# Reliable Push Executor

This document describes how a production Reprint push executor should run the
protocol in [protocol.md](protocol.md), how it maps onto the existing pull
pipeline, and how to test one remote site and one local site.

## Production Shape

The production proof is one remote source site, one imported local edit site,
and one later observation of the same remote identity after drift. In both
Docker and Playground, that proof keeps browser-visible inspection on the
sandbox-provided `8080` ingress through a local-only proxy.

The concrete lab roles are:

- `remote-base`: the source site that seeds the persisted pull base package
- `local-edited`: the imported local site that carries the candidate edits
- `remote-changed`: the same remote identity observed later after drift
- `runner`: the only actor allowed to preflight, list hashes, upload the dry-
  run plan, apply batches, inspect the journal, or run recovery

The canonical push ladder is:

| Stage | Purpose | Boundary rule |
| --- | --- | --- |
| `push_preflight` | Bind the persisted pull base package to one live remote identity and one short-lived push session. | First live binding after importer persistence. |
| `push_snapshot_hashes` | List the live remote comparison surface for planning only. | Read-only; never becomes write authority. |
| `push_plan_dry_run` | Upload the canonical dry-run plan and get an eligibility receipt. | Receipt only; not a lock or lease. |
| `push_batch_apply` | Mutate in batches after fresh validation. | Revalidate before every batch and again at the storage boundary. |
| `push_journal` | Record durable evidence. | Read-only. |
| `push_recover inspect` | Classify finish, rollback, retry, or block before repair. | Inspect first; read-only. |
| `push_recover auto|finish|rollback` | Perform a recovery branch only when inspect proves it safe. | Same auth floor as the write path. |

The pull-to-push bridge is one-way:

| Pull provenance | Push use | Boundary rule |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the immutable base package to one live remote identity and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use it as planning provenance only. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan as an eligibility receipt. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only. |
| Coverage and lineage replay | `push_recover inspect` | Classify recovery before any mutating repair. |

The pull pipeline remains the source of immutable push provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning-only evidence
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any mutating repair

The canonical production proof bundle is `push-protocol-extension-contract.json`:

- it ties exporter/importer provenance to preflight, snapshot hash listing, dry-run upload, batched apply, journal inspect, and inspect-first recovery
- it keeps dry-run and apply separate while apply revalidates fresh live evidence before every batch and at the storage boundary
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit
- it is the canonical bridge from the persisted pull base package into the production push executor
- it preserves the one-way mapping from immutable pull provenance to mutable push execution

The executor consumes that bridge in the same order:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` binds the persisted base package to one live remote identity and one short-lived push session
- `push_snapshot_hashes` stays planning-only and never upgrades into write authority
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary
- `push_journal` stays read-only
- `push_recover inspect` classifies finish, rollback, retry, or block before any mutating recovery
- `push_recover auto|finish|rollback` mutates only when inspect proves the branch safe and the auth floor still holds

The executor follows the same ordered stages defined in the protocol:

1. `push_preflight` binds the imported pull base package to one live remote
   identity and one short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only and may page large sites. It is the remote snapshot hash
   listing step and never becomes mutation authority.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock. The dry-run receipt never substitutes for
   a live revalidation.
4. `push_batch_apply` is a separate remote call that revalidates fresh live
   evidence before every batch and again at the storage boundary. Apply must
   not reuse the dry-run receipt as authority, as a lease, or as a session
   substitute.
5. `push_journal` stays read-only.
6. `push_recover inspect` classifies finish, rollback, retry, or block before
   any mutating recovery and keeps the same auth floor as the write path.
   Inspect is read-only.
7. `push_recover auto|finish|rollback` mutates only when inspect proves the
   branch safe and the auth floor still holds.

The executor boundary is intentionally production-shaped:

- exporter/importer are the immutable provenance source
- preflight is the first live binding after importer persistence
- remote snapshot hash listing is planning evidence only
- dry-run is a receipt, not a lock
- apply is a separate remote call that revalidates before every batch and at
  the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

Dry-run and apply remain separate remote operations, and apply must
revalidate fresh live evidence before each batch and again at the storage
boundary.

The pull/export/import handoff remains the provenance source for every push
stage:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote call that revalidates before every batch and at
  the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

The same topology proof stays fixed in both Docker and Playground:

- `remote-base` seeds the persisted pull base package.
- `local-edited` carries the imported local edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery.
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy.
- remote tunnels are disallowed.

That handoff is intentionally one-way:

- exporter/importer produce the immutable base package that push consumes
- push never rewrites the persisted pull base package or treats it like a
  mutable snapshot cache
- preflight is the first live binding after importer persistence
- dry-run and apply remain separate remote operations
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspection stays read-only
- recovery starts with inspect before any mutating repair

That same bridge is the executor contract:

- exporter/importer produce the immutable base package that push consumes
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` stays planning-only and never upgrades into write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns a receipt, not a
  lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch

The canonical production proof bundle is `push-protocol-extension-contract.json`:

- it ties exporter/importer provenance to preflight, snapshot hash listing, dry-run upload, batched apply, journal inspect, and inspect-first recovery
- it keeps dry-run and apply separate while apply revalidates fresh live evidence before every batch and at the storage boundary
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit

The auth floor is not relaxed for the executor:

- push auth must be at least as strict as current Reprint HMAC usage
- stronger session material is allowed, but it may not weaken that floor
- journal inspect and recovery use the same auth floor as the write path

That means the executor can rely on the imported pull base package, but it
must still rebind the live remote identity before any mutating stage and must
revalidate the live remote again at apply time.

For reviewers, the shortest proof chain is:

1. exporter discovers the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. preflight binds that persisted base to one live remote identity
4. snapshot hash listing stays planning-only
5. dry-run uploads the canonical plan and returns a receipt, not a lock
6. apply revalidates fresh live evidence before every batch and at the
   storage boundary
7. journal inspect stays read-only
8. recovery starts with inspect and only mutates when the journal plus fresh
   live hashes prove the branch safe

That means the executor is not a general remote write loop. It is the
production write path for one imported base package, one edited local site,
and one live remote identity that must be revalidated at apply time.

The same pull-to-push bridge applies here:

- exporter/importer provenance produces the immutable pull base package.
- importer persistence is the only source of the base package that push may
  bind to, so push never reads from a mutable snapshot cache.
- preflight binds that package to one live remote identity and one short-lived
  push session.
- remote snapshot hash listing stays planning-only and may page through the
  live remote comparison surface without upgrading into write authority.
- dry-run uploads a canonical plan receipt and never becomes a lock.
- batched apply is a separate remote operation from dry-run, revalidates
  fresh live evidence before every batch and again at the storage boundary,
  and rechecks the auth floor before mutation.
- journal inspection stays read-only.
- inspect-first recovery is the only safe starting point for mutating
  recovery.

The production harness is the same in Docker and Playground:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The imported pull base package is the anchor point for the executor:

| Imported field | Why it matters |
| --- | --- |
| `base_manifest_id` | Names the persisted pull package that preflight must bind. |
| `base_manifest_hash` | Pins the immutable manifest content used for planning. |
| `base_coverage_hash` | Pins the coverage evidence that justified the import. |
| `remote_site_id` | Binds the package back to the source remote identity. |

The executor treats those fields as immutable provenance, not a reusable
snapshot cache:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` may page the live comparison surface, but it stays
  planning-only
- `push_plan_dry_run` returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and live hashes before any
  mutating repair

Recovery stays inspect-first even when the journal is present:

1. read the journal
2. inspect live hashes
3. classify finish, rollback, retry, or block
4. mutate only when the journal and fresh live evidence still prove the
   branch safe

The pull pipeline is the provenance source for the executor ladder:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote call that revalidates fresh live evidence before
  every batch and again at the storage boundary
- journal inspect reads durable evidence without authorizing mutation
- inspect-first recovery may mutate only when the journal row, lease fence,
  and fresh live hashes still prove the action safe

That mapping is the executor contract, not just an implementation note:

- `push_preflight` is the first live binding after importer provenance exists.
- `push_snapshot_hashes` is planning-only evidence and may page large sites,
  but it never becomes write authority.
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt that cannot be reused as a lock.
- `push_batch_apply` must revalidate before every batch and again at the
  storage boundary, so drift between dry-run and apply is observable.
- `push_journal` is durable evidence only and never authorizes mutation.
- `push_recover inspect` is read-only and must precede any mutating repair.
- `push_recover auto|finish|rollback` may mutate only when inspect plus fresh
  live hashes prove the branch safe.

The production test topology is fixed to the same three site roles in both
Docker and Playground:

| Role | Meaning |
| --- | --- |
| `remote-base` | Source site that seeds the persisted pull base package. |
| `local-edited` | Imported local site that carries the candidate edits. |
| `remote-changed` | Later observation of the same remote identity after drift. |
| `runner` | Only actor that may preflight, list hashes, dry-run, apply, inspect, or recover. |

Both harnesses keep browser-visible inspection on the sandbox-provided `8080`
ingress through a local-only proxy, and remote tunnels remain disallowed.

The same mapping is what the Docker and Playground proofs must exercise:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner that owns the protocol calls
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

The production proof topology is intentionally minimal and repeated across
both harnesses:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- both harnesses keep the same route names for preflight, dry-run, apply,
  journal inspect, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

The harness contracts that pin that shape are:

- `push-deployment-topology-contract.json` for the smallest topology-only
  proof with the `8080` ingress rule and the no-tunnel policy
- `push-remote-liveness-topology-contract.json` for the topology plus
  dry-run/apply liveness split
- `push-production-topology-contract.json` for the compact production bundle
  that keeps the pull provenance, push stage sequence, and topology aligned
- `push-production-revalidation-contract.json` for the auth, session, journal,
  lease, and fencing proof that still requires inspect-first recovery
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` for the production auth,
  session, journal, lease, and inspect-first recovery pair

Use `push-deployment-topology-contract.json` for the smallest topology proof
and `push-remote-liveness-topology-contract.json` when you need the dry-run
and apply liveness split in the same harness.

The same topology is mirrored in both harnesses:

- Docker uses one private network
- Playground uses separate disposable blueprints
- both harnesses use the same route names for preflight, dry-run, apply,
  journal inspection, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

This keeps the exporter/importer pipeline authoritative for the base package
while making push a separate production write path that can only consume that
persisted provenance.

For review, the canonical executor chain is:

1. exporter/importer create the immutable pull base package.
2. `push_preflight` binds that package to the live remote identity and a
   short-lived push session.
3. `push_snapshot_hashes` stays planning-only.
4. `push_plan_dry_run` returns a receipt, not a lock.
5. `push_batch_apply` revalidates before every batch and again at the storage
   boundary.
6. `push_journal` remains read-only.
7. `push_recover inspect` classifies recovery before any mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe.

In runbook form, the executor keeps the same order and boundary discipline:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after that persistence boundary
- snapshot hash listing is planning-only evidence and may page, but never
  becomes write authority
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote call that revalidates fresh live evidence before
  every batch and again at the storage boundary
- apply-time revalidation is the boundary that keeps the dry-run receipt from
  becoming remote write authority
- journal inspection stays read-only
- recovery starts with inspect and only mutates when the journal plus fresh
  live hashes prove the branch safe

The production test topology is the same in Docker and Playground:

- one remote source site (`remote-base`)
- one imported local edited site (`local-edited`)
- one later observation of the same remote identity after drift
  (`remote-changed`)
- one runner process that owns all push protocol calls
- browser-visible inspection only through the sandbox-provided `8080` ingress
  and a local-only proxy

The topology roles stay fixed:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery

The minimal site split is always the same:

- `remote-base` seeds the persisted pull base package.
- `local-edited` holds the imported local changes.
- `remote-changed` is the same remote identity observed later after drift.

That gives the minimal remote/local pair the task asks for:

- `remote-base` is the remote site under observation.
- `local-edited` is the imported local site carrying the candidate changes.
- `remote-changed` is the same remote site observed later after drift.
- the runner proves dry-run and apply are separate by taking a fresh snapshot
  listing, uploading a dry-run plan, and then applying only after live
  revalidation succeeds.

`push-topology-matrix.json`, `push-deployment-topology-contract.json`, and
`push-remote-liveness-topology-contract.json` are the fixtures that pin that
shared topology. Use the deployment contract when you need the smallest
topology-only proof, and the liveness-topology contract when you need the same
one-remote, one-local, one-drift harness plus the dry-run/apply split.
Use `push-production-topology-contract.json` when you need the compact
production bundle that keeps the pull provenance, push stage sequence, and
topology proof together in one object.

For the compact bridge between the pull pipeline and that topology, cite
`push-pull-to-topology-contract.json`. For the smallest topology-only proof,
cite `push-deployment-topology-contract.json`. For the strongest liveness
boundary proof, cite `push-remote-liveness-topology-contract.json`.
For the shortest stage-by-stage production proof, cite
`push-production-ladder-contract.json`.

The topology story is intentionally small:

- `remote-base` seeds the persisted pull base package.
- `local-edited` is the imported local site that carries the candidate plan.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or run recovery.

The executor is therefore not a general remote write loop. It is the
production write path for one imported base package, one edited local site,
and one live remote identity that must be revalidated at apply time.

## Stage Semantics

The executor needs the same boundary discipline as the protocol:

- preflight is the first live binding after importer provenance exists
- remote snapshot hash listing is planning evidence only and never a write
  precondition by itself
- dry-run uploads the canonical plan and returns a receipt, not a lock
- apply is a separate remote operation that revalidates fresh live evidence
  before every batch and again at the storage boundary, and does not reuse
  the dry-run receipt as a lock
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

That mapping is intentionally one-way:

- the exporter/importer pipeline discovers and persists immutable provenance
- push consumes that provenance and never rewrites the pull base package
- preflight is the first live binding after importer persistence
- snapshot hashes are planning evidence only
- dry-run is a receipt, not a lock, and cannot authorize apply
- apply revalidates before every batch and again at the storage boundary
- journal inspect stays read-only
- mutating recovery only happens after inspect proves the branch safe

## Topology

The executor uses the same production topology in Docker and Playground:

| Role | Docker | Playground |
| --- | --- | --- |
| Remote source | `remote-base` | `remote-base` |
| Local edited site | `local-edited` | `local-edited` |
| Drift witness | `remote-changed` | `remote-changed` |
| Runner | `runner` | local test process |

The test topology is the same in both harnesses:

- one remote source site
- one imported local edited site
- one later drift witness of the same remote identity
- one runner process that owns all push protocol calls
- one browser-visible inspection path on the sandbox-provided `8080`
  ingress via a local-only proxy

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
- both harnesses keep `remote-base` and `remote-changed` as two observations
  of the same remote identity, not two different sites
- both harnesses require journal inspection before any mutating recovery

Both harnesses also enforce the same ingress rule:

- no remote tunnels
- local-only proxying for browser-visible inspection
- the only exposed port is sandbox-provided `8080`

## Canonical Proofs

The canonical proof stack for that executor story is the same one named in
[protocol.md](protocol.md):

- `push-protocol-extension-contract.json` for the canonical machine-readable
  production ladder from preflight through inspect-first recovery
- `push-pull-to-topology-contract.json` for the compact bridge from pull
  provenance into the production push topology
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
  first recovery into one reviewable object, with `remote-base` and
  `remote-changed` proving the same remote identity before and after drift
  and with apply-time revalidation kept separate from dry-run
- `push-auth-session-journal-recovery-contract.json` for the compact auth,
  session, journal-row, lease-fence, and inspect-first recovery proof
- `push-production-auth-session-journal-recovery-inspect-contract.json` for
  the compact production proof that keeps the auth floor, minted push
  session, journal row, lease fence, and read-only recovery inspect together
- `push-recovery-boundary-contract.json` for the compact inspect-first
  recovery boundary proof that keeps the auth floor and Docker/Playground
  topology together
- `push-auth-session-journal-recovery-inspect-contract.json` for the compact
  proof that binds auth, session minting, journal rows, lease fencing, live
  drift, and inspect-first recovery into one object
- `push-recovery-inspect-contract.json` for the read-only inspect gate that
  must classify recovery before any mutation can proceed
- `push-deployment-topology-contract.json` for the smallest topology-only
  contract that still proves the same remote identity twice, the imported
  local site, and the sandbox-provided `8080` ingress rule
- `push-journal-inspect-contract.json` for the read-only journal boundary
- `push-remote-liveness-topology-contract.json` for the compact liveness plus
  one-remote, one-local, one-drift harness proof
- `push-production-ladder-contract.json` for the shortest stage-by-stage
  production proof that still keeps the pull base, dry-run receipt,
  apply-time revalidation, journal inspection, and inspect-first recovery
  explicit
- `push-topology-matrix.json` for the canonical Docker/Playground stage
  matrix proving one remote source, one local edited site, and one drift
  witness
- `push-production-push-recovery-contract.json` for the canonical end-to-end
  proof that ties the pull provenance, the production push ladder, and the
  one-remote, one-local topology into one reviewable object while proving the
  same remote identity before and after drift, and keeps the shared
  auth/session floor, journal rows, lease fencing, and inspect-first recovery
  path explicit

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
