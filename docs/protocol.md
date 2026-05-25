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
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority. It may page through
   large sites, but it never becomes a lock, a lease, or apply authority.
   This is the remote snapshot hash listing stage, and it stays read-only.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an
   eligibility receipt, not a lock. The receipt proves planning eligibility
   only and cannot be reused as write authority.
4. `push_batch_apply` is the first mutation stage. It must revalidate fresh
   live evidence before every batch and again at the storage boundary. Dry-run
   and apply are separate remote operations, and apply must not trust the
   dry-run receipt as a lock, a lease, or a substitute for fresh live
   evidence. Apply-time revalidation is mandatory.
5. `push_journal` records durable evidence and never authorizes a write.
6. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair. Inspect is read-only and does not authorize mutation.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the action safe with fresh live evidence and the same auth floor as the
   write path.

The pull-to-push handoff is explicit in the machine-readable proof:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `persisted_pull_base_package` is the immutable object the push executor
  consumes after importer persistence
- preflight is the first live binding after that immutable handoff
- snapshot hash listing stays planning-only
- dry-run uploads the canonical plan and returns an eligibility receipt
- apply is a separate remote operation that revalidates before every batch
  and at the storage boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

The stage contract is intentionally simple:

| Stage | What it does | What it does not do |
| --- | --- | --- |
| `push_preflight` | Binds the imported pull base package to one live remote identity and one short-lived push session. | It does not authorize mutation. |
| `push_snapshot_hashes` | Lists the live remote comparison surface for planning. | It does not become write authority or a lock. |
| `push_plan_dry_run` | Uploads the canonical dry-run plan and returns an eligibility receipt. | It does not authorize apply. |
| `push_batch_apply` | Applies the mutation plan in batches after fresh live revalidation. | It does not reuse the dry-run receipt as a lock. |
| `push_journal` | Records durable evidence for inspect and recovery. | It does not authorize mutation. |
| `push_recover inspect` | Reads the journal and fresh live hashes before any repair. | It does not mutate. |
| `push_recover auto|finish|rollback` | Mutates only when inspect proves the branch safe. | It does not skip inspect or lower the auth floor. |

The auth floor is never relaxed for push:

- push authentication must be at least as strict as current Reprint HMAC
  usage
- dry-run, apply, journal inspect, and recovery all stay under that floor
- stronger session material is allowed only when it does not weaken the write
  path or the inspect-first recovery path

The pull/export/import pipeline is the only source of immutable push
provenance, and push consumes that provenance as immutable input:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` performs the remote snapshot hash listing for
  planning only and may page large sites, but it never becomes write
  authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` is a separate remote operation that revalidates fresh
  live evidence before every batch and again at the storage boundary
- `push_journal` is durable evidence only and never authorizes mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch

The same pull-to-push bridge is exercised in Docker and Playground:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` binds that persisted package to one live remote identity
  and one short-lived push session
- `push_snapshot_hashes` stays planning-only and never becomes write
  authority
- `push_plan_dry_run` uploads the canonical dry-run plan and returns a
  receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` stays read-only
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair

The production topology is fixed to one remote source, one imported local
site, and one drift witness:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or recover
- Docker uses one private network for those four roles
- Playground uses separate disposable blueprints with the same route names
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed
- `push_recover auto|finish|rollback` may mutate only after inspect proves
  the branch safe with the same auth floor as the write path

The test topology is fixed across both Docker and Playground:

- `remote-base` is the source site at pull time and seeds the persisted pull
  base package
- `local-edited` is the imported local edit site that carries the candidate
  changes
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or recover
- Docker uses one private network for those four roles
- Playground uses separate disposable blueprints with the same role split
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The compact auth/session proof is `push-production-auth-session-journal-recovery-inspect-contract.json`:

- it binds the persisted pull base package to one short-lived push session and the same remote identity
- it keeps the auth floor at least as strict as current Reprint HMAC usage
- it records claim generation, lease expiry, and the storage fence in the journal row
- it keeps recovery inspect read-only and classification-only before any mutating repair

Put differently, the exporter/importer handoff stays authoritative for the
base package, and push only consumes that immutable package in the order
above:

1. exporter scans the merge base and coverage evidence
2. importer persists the base package as immutable provenance
3. `push_preflight` is the first live binding after importer persistence
4. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and never becomes write authority
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary
7. `push_journal` records durable evidence without authorizing mutation
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe with the same auth floor as the write path

The persisted pull base package is the concrete provenance object that push
consumes:

- `base_manifest_id` identifies the imported pull base package
- `base_manifest_hash` pins the immutable manifest content
- `base_coverage_hash` pins the coverage evidence that supported import
- `remote_site_id` ties that package back to the source remote identity

The write path is deliberately one-way:

- pull discovers and persists the immutable base package
- push consumes that persisted package and never turns it back into a mutable
  snapshot cache
- preflight is the first live binding after importer persistence
- snapshot hash listing is read-only planning evidence
- dry-run is an eligibility receipt, not write authority
- apply is a separate remote operation that must revalidate fresh live
  evidence before every batch and again at the storage boundary
- journal inspect is read-only evidence gathering
- recovery starts with inspect before any mutating repair

The recovery proof chain is also one-way:

- journal rows carry claim ownership, generation, lease expiry, and the
  recovery fence that prevents stale reuse
- inspect reads the journal row, the recovery fence, and fresh live hashes
  before any repair
- finish, rollback, retry, and block are the only recovery classifications
- mutating recovery may proceed only when the journal row, recovery fence,
  and fresh live hashes prove the branch safe
- stale dry-run evidence never becomes recovery authority

The inspect-first recovery path is intentionally stricter than planning:

- recovery inspect is read-only and never substitutes for a push session
- journal rows must prove the claim owner, claim generation, and lease
  expiry before any mutating branch starts
- the recovery fence must still match the same remote identity and the same
  persisted pull base package
- finish, rollback, retry, and block are the only allowed recovery outcomes
- mutating recovery must still recheck fresh live hashes after inspect and
  before any repair writes

For implementation and review, the bridge should be read in the same order as
the production executor:

1. exporter discovers the merge base and coverage evidence.
2. importer persists the base package as immutable provenance.
3. `push_preflight` binds that persisted package to one live remote identity.
4. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and may page through the live comparison surface.
5. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
6. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
7. `push_journal` stays read-only.
8. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
9. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe with the same auth floor as the write path.

The ladder maps directly to the pull pipeline:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight is the first live binding after importer persistence
- snapshot hash listing is planning evidence only and may page large sites,
  but it never becomes write authority
- dry-run is an eligibility receipt, not a lock, and never authorizes apply
- batch apply is a separate remote operation that revalidates before every
  batch and again at the storage boundary
- journal inspect is read-only
- recovery starts with inspect and only mutates when journal evidence and
  fresh live hashes still prove the branch safe

That bridge is one-way:

- exporter/importer provenance is the immutable base that push consumes
- push never turns the persisted pull base package back into a mutable
  snapshot cache
- preflight binds that persisted package to one live remote identity and one
  short-lived push session
- dry-run and apply remain separate remote operations
- journal inspect is read-only evidence gathering
- recovery starts with inspect before any mutating repair

The canonical production ladder bundle is `push-protocol-extension-contract.json`:

- it binds the immutable pull base package to preflight, remote snapshot hash listing, dry-run plan upload, batched apply, journal inspect, and inspect-first recovery
- it keeps dry-run and apply separate while apply revalidates fresh live evidence before every batch and at the storage boundary
- it carries the one-remote, one-local, one-drift topology in both Docker and Playground
- it keeps the sandbox-provided `8080` ingress rule and local-only proxy policy explicit
- it is the canonical machine-readable bridge from the exporter/importer pull pipeline into the push write path
- it preserves the one-way rule that pull provenance is immutable push input, not a mutable snapshot cache
- it is the umbrella contract that pairs with `push-deployment-topology-contract.json` and `push-remote-liveness-topology-contract.json` so the one remote source, one imported local edit site, and one later drift observation stay explicit in both harnesses

The production proof is also split into smaller reviewable fixtures:

- `push-production-pull-bridge-contract.json` proves the exporter/importer handoff becomes immutable push provenance.
- `push-production-revalidation-contract.json` proves preflight, planning-only snapshot hashes, dry-run eligibility, apply-time revalidation, durable journal evidence, and inspect-first recovery stay on separate liveness boundaries.
- `push-production-auth-session-journal-recovery-inspect-contract.json` proves the auth floor, push-session minting, journal rows, lease fencing, and read-only recovery inspect stay aligned with the write path.
- `push-production-topology-contract.json` proves the one-remote, one-local, one-drift harness shape in both Docker and Playground.
- `push-remote-liveness-topology-contract.json` proves dry-run and apply stay separate while apply revalidates fresh live evidence before every batch and at the storage boundary.
- `push-deployment-topology-contract.json` proves the sandbox-provided `8080` ingress, local-only proxying, and no-tunnel rule for the topology harness.

For review and test planning, the production proof stack is:

1. `push-protocol-extension-contract.json` for the full production ladder.
2. `push-production-pull-bridge-contract.json` for the immutable pull-to-push provenance bridge.
3. `push-remote-liveness-topology-contract.json` for the one-remote, one-local, one-drift topology plus dry-run/apply separation.
4. `push-production-topology-contract.json` for the compact topology and provenance bundle.

Those four proofs are the canonical production sequence:

- the protocol extension contract defines the stage order and recovery guards
- the pull bridge contract proves the immutable exporter/importer handoff into push
- the remote liveness topology contract proves dry-run/apply separation on one remote source, one imported local edit site, and one drift witness
- the production topology contract bundles the same topology with the pull provenance and apply-time revalidation proof
The bridge is machine-readable and stage-ordered:

1. `push_preflight` binds the imported pull base package to one live remote identity and one short-lived push session.
2. `push_snapshot_hashes` performs the remote snapshot hash listing for
   planning only and may page large sites.
3. `push_plan_dry_run` uploads the canonical dry-run plan and returns an eligibility receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary.
5. `push_journal` records durable evidence without authorizing mutation.
6. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe with the same auth floor as the write path.

The bridge is exactly:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` remains planning-only evidence and never becomes write authority
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any mutating repair
- `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe with the same auth floor as the write path

That bridge is the production contract the tests should exercise:

- one remote source site seeds the persisted pull base package
- one imported local edited site carries the candidate changes
- one later observation of the same remote identity proves live drift handling
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The Docker and Playground topology contract is intentionally one remote, one
local, one drift witness:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns the protocol calls
- both harnesses keep browser-visible inspection on the sandbox-provided
  `8080` ingress through a local-only proxy
- remote tunnels are disallowed

The same topology should be exercised in both harnesses:

- Docker uses one private network around `remote-base`, `local-edited`,
  `remote-changed`, and `runner`
- Playground uses separate disposable blueprints with the same role names
- both harnesses keep dry-run and apply separate
- both harnesses require apply-time revalidation against fresh live hashes
- both harnesses keep recovery inspect-first and read-only until the branch is
  proven safe

The operator-facing test shape is therefore one remote source, one imported
local edit site, and one later drift witness of the same remote identity:

- `remote-base` is the remote source site
- `local-edited` is the imported local edited site
- `remote-changed` is the later drift witness for the same remote identity
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The topology proof is the same in both harnesses:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor allowed to preflight, list hashes, upload the
  dry-run plan, apply batches, inspect the journal, or run recovery
- Docker and Playground both keep browser-visible inspection on the
  sandbox-provided `8080` ingress through a local-only proxy
- remote tunnels are disallowed in both harnesses
- `push-deployment-topology-contract.json` proves the topology-only shape
- `push-remote-liveness-topology-contract.json` proves the topology plus the
  dry-run/apply liveness split and apply-time revalidation
- `push-protocol-extension-contract.json` is the umbrella proof that binds the
  topology to the production ladder

For review, the canonical one-remote, one-local test topology is:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery
- the browser-visible path stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- the pull exporter/importer pipeline remains the provenance source for all
  push stages

The same topology is used to prove live drift handling:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits used to build the canonical plan
- `remote-changed` is the same remote identity observed later after drift
- `runner` keeps dry-run and apply separate and revalidates before mutation
- `push_recover inspect` stays read-only before any mutating recovery branch

The same topology is reused in both harnesses:

- `remote-base` is the source site that seeds the persisted pull base package
- `local-edited` is the imported local site carrying candidate edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery
- the browser-facing path stays on the sandbox-provided `8080` ingress through a local-only proxy

For the harness shape, keep the topology pair together:

- `push-deployment-topology-contract.json` is the smallest topology-only
  proof for one remote source site, one imported local edited site, and one
  later drift observation of the same remote identity, with the sandbox-only
  `8080` ingress policy spelled out
- `push-remote-liveness-topology-contract.json` adds the dry-run/apply
  liveness split to the same one-remote, one-local, one-drift harness
  and keeps apply-time revalidation separate from the dry-run receipt

The same topology is mirrored in the fixtures:

- `push-deployment-topology-contract.json` is the smallest Docker and
  Playground topology-only proof, with the sandbox-provided `8080` ingress
  rule, the local-only proxy policy, and the no-tunnel rule spelled out
- `push-remote-liveness-topology-contract.json` combines that topology with
  the dry-run/apply split so liveness stays separate from write authority
- `push-topology-matrix.json` keeps the Docker and Playground stage matrix in
  machine-readable form
- `push-protocol-extension-contract.json` is the most complete production
  bridge because it combines the pull provenance mapping, the push stage
  ladder, the recovery chain, and the one-remote, one-local, one-drift test
  topology in one contract
- `push-executor-topology-proof.json` keeps the pull provenance, push ladder,
  and 8080 topology aligned in one compact production-shaped fixture

The machine-readable bridge is split across the fixtures:

- `push-preflight-contract.json` captures the first live binding between the
  importer-owned base package, the live remote identity, and the short-lived
  push session.
- `push-remote-snapshot-listing-contract.json` and
  `push-snapshot-hashes-page-contract.json` keep the remote hash listing
  cursorable while still treating it as planning-only evidence.
- `push-pull-mapping.json` and `push-pull-to-topology-contract.json` map the
  immutable pull provenance into the push stages without turning it into
  write authority.
- `push-dry-run-apply-revalidation-contract.json` keeps dry-run and apply
  separate while proving the live remote is revalidated before each batch and
  again at the storage boundary.
- `push-journal-inspect-contract.json` and the recovery contracts keep
  journal inspection read-only before any mutating repair.
- `push-auth-session-journal-recovery-contract.json` and
  `push-production-push-recovery-contract.json` bind the auth floor, minted
  push session, journal rows, lease fencing, and inspect-first recovery into
  one production-shaped proof.
- `push-production-ladder-contract.json` captures the same one-remote,
  one-local ladder in a shorter stage-by-stage proof with the pull base,
  session minting, dry-run receipt, apply-time revalidation, journal
  inspection, and inspect-first recovery all pinned together.
- `push-production-recovery-inspect-contract.json` captures the compact
  inspect-first recovery proof with the auth floor, live evidence, lease
  fencing, and `8080` topology in one place.
- `push-production-auth-session-journal-recovery-inspect-contract.json`
  captures the compact production auth/session/journal/lease/recovery-inspect
  proof on the same remote identity and local edit site.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the minimum production proof to cite when you need auth floor, push session
  minting, journal rows, lease fencing, and read-only recovery inspect on the
  same remote identity.
- `push-recovery-boundary-contract.json` captures the compact inspect-first
  recovery boundary with the auth floor and Docker/Playground topology in one
  place.
- `push-auth-session-journal-recovery-inspect-contract.json` and
  `push-recovery-inspect-contract.json` keep the read-only inspect gate
  explicit before any mutating repair can run.
- `push-topology-matrix.json`, `push-deployment-topology-contract.json`, and
  `push-remote-liveness-topology-contract.json` define the Docker and
  Playground test topology with one remote source, one imported local site,
  one later drift observation of that same remote identity, the
  sandbox-provided `8080` ingress rule, and the local-only proxy policy.
- `push-remote-liveness-topology-contract.json` also proves that dry-run and
  apply are separate remote calls and that apply revalidates fresh live
  evidence before every batch and at the storage boundary.
- `push-protocol-extension-contract.json` is the canonical production ladder
  bundle. It ties the persisted pull base to preflight, remote snapshot hash
  listing, dry-run plan upload, batched apply, journal inspect, and
  inspect-first recovery in one object.
- `push-production-topology-contract.json` is the compact production topology
  proof for the same one-remote, one-local, one-drift harness and keeps the
  full push stage sequence in one compact production object.
- `push-executor-topology-proof.json` is the compact executor proof that ties
  the pull provenance, push ladder, and topology together for the same
  one-remote, one-local, one-drift harness.
- `push-production-revalidation-contract.json` is the compact production proof
  that binds auth, push sessions, journal rows, lease fencing, and inspect-
  first recovery to the same one-remote, one-local topology.
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` are the production-shaped
  proof pair for auth, session minting, journal rows, lease fencing, apply
  revalidation, and inspect-first recovery on the same remote identity.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the compact proof that binds auth floor, push session minting, journal
  rows, lease fencing, and read-only recovery inspect to the same remote
  identity and local edit site.
- `push-protocol-extension-contract.json` is the canonical production ladder
  bundle. It binds the immutable pull base package to preflight, remote
  snapshot hash listing, dry-run plan upload, batched apply, journal inspect,
  and inspect-first recovery on the same one-remote, one-local, one-drift
  topology.

For review and implementation work, the canonical production push chain is:

1. pull exporter/importer create the immutable base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` lists live remote hashes for planning only.
4. `push_plan_dry_run` uploads the canonical plan and returns a receipt, not
   a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live evidence before
   any mutating recovery branch.
8. `push_recover auto|finish|rollback` may mutate only when inspect proves
   the branch safe with the same auth floor as the write path.

The wire contract is intentionally split into request classes so the executor
can keep liveness boundaries narrow:

| Request class | Example stage | Mutates | Reuses prior authority |
| --- | --- | --- | --- |
| Preflight binding | `push_preflight` | No | No |
| Remote hash listing | `push_snapshot_hashes` | No | No |
| Dry-run upload | `push_plan_dry_run` | No | No |
| Batched apply | `push_batch_apply` | Yes | No; it revalidates fresh live evidence before each batch and at the storage boundary |
| Journal inspect | `push_journal` | No | No |
| Recovery inspect | `push_recover inspect` | No | No |
| Recovery mutate | `push_recover auto|finish|rollback` | Yes | No; it must pass inspect first and keep the same auth floor as the write path |

Recovery is therefore a two-step loop:

1. Inspect the journal and fresh live hashes.
2. Mutate only if the journal, fence, and live evidence still agree.

The reviewable bridge is the same chain rendered as fixture evidence:

- `push-protocol-extension-contract.json` ties the pull pipeline, the push
  sequence, the auth floor, and the one-remote, one-local topology into one
  production object
- `push-remote-liveness-topology-contract.json` keeps dry-run and apply
  separate while proving apply-time revalidation
- `push-deployment-topology-contract.json` keeps the `8080` ingress rule and
  local-only proxy policy explicit
- `push-pull-to-topology-contract.json` maps immutable pull provenance into
  the production harness without turning it back into write authority

The compact proof chain is intentionally one-way:

- pull exporter/importer produce the immutable base package that push consumes
- `push_preflight` binds that immutable provenance to one live remote
  identity and one short-lived push session
- remote snapshot hash listing stays planning-only
- dry-run is a receipt, not a lock
- apply is a separate remote operation that revalidates fresh live evidence
  before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect before any mutating repair

The compact production proof stack is:

- `push-pull-to-topology-contract.json` for the immutable pull provenance
  bridge into the one-remote, one-local topology
- `push-deployment-topology-contract.json` for the smallest Docker and
  Playground topology contract with the `8080` ingress rule
- `push-remote-liveness-topology-contract.json` for the liveness split that
  keeps dry-run and apply separate while apply revalidates fresh live hashes
- `push-protocol-extension-contract.json` for the full production ladder from
  preflight through inspect-first recovery, including the pull/export/import
  bridge and the one-remote-one-local test topology
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` for the production auth,
  session, journal, lease, and recovery proof pair
- `push-production-auth-session-journal-recovery-inspect-contract.json` for
  the compact auth/session/journal/lease/recovery-inspect proof on the same
  remote identity

The pull-to-push bridge is one-way:

- exporter/importer produce the immutable base package that push consumes
- push never turns that base package back into a mutable snapshot cache
- dry-run is a receipt, not a lock
- apply must revalidate fresh live evidence before every batch and at the
  storage boundary
- journal inspect stays read-only
- recovery starts with inspect before any mutating repair

The production proof order is also one-way:

- exporter scans the merge base and coverage evidence
- importer persists the base package as immutable provenance
- preflight binds that persisted package to one live remote identity and one
  short-lived session
- remote snapshot hash listing stays planning-only and never becomes write
  authority
- dry-run uploads the canonical plan and returns an eligibility receipt
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary
- journal inspect remains read-only
- recovery starts with inspect and only mutates when the journal plus fresh
  live hashes prove the action safe

That bridge also defines the recovery floor:

- journal inspection is read-only evidence gathering, not a mutation gate
- inspect must happen before any mutating recovery branch
- finish, rollback, retry, and block are the only recovery classifications
- mutating recovery must still satisfy the same auth floor as the write path
- stale dry-run evidence never becomes recovery authority

The topology model is deliberately minimal:

- `remote-base` is the source site that seeds the persisted pull base.
- `local-edited` is the imported local site that carries the candidate edits.
- `remote-changed` is the same remote identity observed later after drift.
- `runner` is the only actor that may preflight, list hashes, dry-run,
  apply, inspect the journal, or recover.
- `push_preflight` is the first live binding after importer persistence.
- `push_snapshot_hashes` is planning-only and never becomes write authority.
- `push_plan_dry_run` returns an eligibility receipt, not a lock.
- `push_batch_apply` revalidates before every batch and at the storage
  boundary.
- `push_journal` is read-only durable evidence.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch.
- journal inspection remains read-only and recovery must begin with inspect
  before any mutating repair.

The deployment test topology is the same in Docker and Playground:

- one remote source site, `remote-base`
- one imported local edited site, `local-edited`
- one later drift observation of the same remote identity, `remote-changed`
- one runner that owns all push protocol calls
- browser-visible inspection only through the sandbox-provided `8080`
  ingress and a local-only proxy
- Docker uses one private network; Playground uses separate disposable
  blueprints.
- both harnesses keep the same route names and the same dry-run/apply split.
- remote tunnels are disallowed.

The topology is captured in these fixtures:

- `push-deployment-topology-contract.json` for the smallest topology-only
  proof
- `push-remote-liveness-topology-contract.json` for the dry-run/apply split
  that proves liveness stays separate from write authority
- `push-production-topology-contract.json` for the compact production bundle
  that includes the pull provenance, push stage sequence, and topology proof

Those fixtures map the bridge in one direction only:

- exporter/importer discover and persist immutable provenance
- `push_preflight` is the first live binding after importer persistence
- remote snapshot hash listing is planning-only evidence
- dry-run returns a receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage
  boundary
- journal inspect is read-only
- recovery starts with inspect before any mutating repair

Docker and Playground use the same topology labels and the same ingress
policy:

- `remote-base`, `local-edited`, `remote-changed`, and `runner` mean the same
  thing in both harnesses
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- tunnels are disallowed
- Docker uses one private network
- Playground uses separate disposable blueprints

## Stage Semantics

Each stage has one job and one boundary:

- `push_preflight` proves the imported provenance and the current remote
  target are the same logical site before planning begins. It is the first
  live binding after importer persistence.
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

The reviewable bridge from pull to push is intentionally linear:

| Pull provenance | Push stage | Why it exists |
| --- | --- | --- |
| Exporter merge-base scan | `push_preflight` | Bind the imported base package to one live remote identity and one short-lived session. |
| Importer persisted base package | `push_snapshot_hashes` | Use the imported package only as planning provenance for the live hash listing. |
| Coverage evidence | `push_plan_dry_run` | Upload the canonical plan as eligibility evidence, not write authority. |
| Canonical pull manifest | `push_batch_apply` | Revalidate fresh live evidence before every batch and again at the storage boundary. |
| Persisted provenance checksum | `push_journal` | Read durable evidence only; never turn it into write authority. |
| Coverage and lineage replay | `push_recover inspect` | Classify finish, rollback, retry, or block before any mutating repair. |

That table is the contract boundary: pull discovers and persists immutable
provenance, and push consumes that provenance without ever rewriting it.

The production executor therefore has one source of truth for provenance and
one source of truth for live state:

- exporter/importer own the immutable pull base package
- preflight binds that package to one live remote identity and one
  short-lived push session
- snapshot hash listing is planning evidence only
- dry-run uploads the canonical plan and returns a receipt, not a lock
- batch apply is the only mutation stage and must revalidate fresh live
  evidence before every batch and at the storage boundary
- journal inspect is read-only evidence gathering
- recovery must begin with inspect before any mutating repair

The auth floor is explicit:

- push auth must be at least as strict as current Reprint HMAC usage
- stronger session material is allowed, but it may not weaken that HMAC floor
- journal inspect and recovery keep the same auth floor as the write path

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

- exporter discovers the merge base and coverage evidence.
- importer persists the base package as immutable provenance.
- preflight binds that persisted package to one live remote identity, one
  requested scope, and one short-lived push session.
- snapshot hash listing reads the live remote comparison surface for planning
  only and can page through large sites without becoming write authority.
- dry-run uploads the canonical plan and returns a receipt, not a lock.
- apply revalidates fresh live evidence before every batch and again at the
  storage boundary, and it is a separate remote operation from dry-run.
- journal inspect stays read-only.
- recovery starts with inspect and only mutates when the journal and fresh
  live hashes still prove the branch safe.
