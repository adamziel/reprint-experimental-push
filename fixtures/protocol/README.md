# Push Protocol Fixtures

These fixtures are wire-contract examples for the production Reprint push
extension. They intentionally show request and response shape, not full site
exports or executable WordPress state.

The normal sequence is:

1. `push-preflight-request.json`
2. `push-preflight-response.json`
3. `push-snapshot-hashes-request.json`
4. `push-snapshot-hashes-response.json`
5. `push-dry-run-request.json`
6. `push-dry-run-response.json`
7. `push-apply-batch-request.json`
8. `push-apply-batch-response.json`
9. `push-journal-request.json`
10. `push-journal-response.json`
11. `push-journal-open-response.json`
12. `push-recovery-request.json`
13. `push-recovery-response.json`
14. `push-recovery-inspect-request.json`
15. `push-recovery-inspect-response.json`
16. `push-recovery-inspect-blocked-response.json`
17. `push-topology.json`
18. `push-flow.json`
19. `push-recovery-decision.json`
20. `push-session-journal-proof.json`
21. `push-auth-session-journal-proof.json`
22. `push-auth-session-fencing-contract.json`
23. `push-auth-session-recovery-contract.json`
24. `push-pull-mapping.json`
25. `push-contract.json`
26. `push-topology-matrix.json`
27. `push-production-ladder-contract.json`
28. `push-executor-topology-proof.json`
29. `push-recovery-path.json`
30. `push-recovery-inspect-contract.json`
31. `push-snapshot-hashes-page-contract.json`
32. `push-dry-run-apply-revalidation-contract.json`
33. `push-remote-liveness-contract.json`
34. `push-deployment-topology-contract.json`
35. `push-protocol-extension-contract.json`

The production proof bundle is intentionally layered:

- `push-pull-mapping.json` and `push-contract.json` map the immutable pull
  provenance into the push protocol.
- `push-remote-liveness-contract.json`, `push-dry-run-apply-revalidation-contract.json`,
  and `push-recovery-revalidation-contract.json` keep the liveness split and
  inspect-first recovery rules explicit.
- `push-snapshot-hashes-request.json`, `push-snapshot-hashes-response.json`,
  and `push-snapshot-hashes-page-contract.json` keep the live remote hash
  listing clearly in the planning-only lane.
- `push-auth-headers.json`, `push-auth-session-journal-proof.json`, and
  `push-auth-session-fencing-contract.json` show the auth floor that is at
  least as strict as current Reprint HMAC usage and keep the session, lease
  fence, and inspect-first recovery proof together.
- `push-auth-session-recovery-contract.json` keeps the stronger auth floor and
  the recovery fence together when a test wants to prove the claim is still
  fenced at recovery time.
- `push-recovery-inspect-contract.json` is the compact inspect-first proof to
  cite when a test needs the minted session, the journal row, the fresh-live
  hash classification, and the read-only recovery boundary in one object.
- `push-topology.json`, `push-topology-matrix.json`, and
  `push-deployment-topology-contract.json` prove the one-remote, one-local,
  one-drift-witness topology in both Docker and Playground.

Failure and recovery examples:

- `push-precondition-failed-response.json` shows apply-time liveness
  revalidation rejecting a stale target.
- `push-journal-request.json` and `push-journal-response.json` show the
  read-only inspection step used before any lost-response retry or recovery
  decision.
- `push-journal-open-response.json` shows an in-progress claim with fenced
  writer evidence, including claim generation and lease expiry, which is the
  proof the executor needs before it retries or recovers an interrupted apply.
- `push-recovery-request.json` and `push-recovery-response.json` show a
  successful recovery finalization after a read-only inspect step.
- `push-recovery-inspect-request.json` and `push-recovery-inspect-response.json`
  show the read-only evidence lookup used before any mutating recovery mode.
- `push-recovery-inspect-blocked-response.json` shows the same inspect step
  when the remote can prove that finish or rollback is not safe.
- `push-recovery-blocked-response.json` shows the evidence returned when the
  remote cannot prove a safe finish or rollback.
- `push-pull-mapping.json` shows how the persisted pull base package becomes
  immutable provenance for push preflight, snapshot listing, dry-run upload,
  batched apply, journal inspection, and recovery.
- `push-production-ladder-contract.json` shows the production stage order and
  the liveness split: preflight, snapshot listing, dry-run, apply, journal
  inspect, and inspect-first recovery stay separate.
- `push-session-journal-proof.json` shows the restart-proof tuple that binds
  the minted push session to the journal claim, lease fence, and inspect-first
  recovery path.
- `push-auth-session-journal-proof.json` shows the stronger production proof
  that keeps push auth at least as strict as the export HMAC family while
  binding the session, journal row, lease fence, and inspect-first recovery
  path together.
- `push-auth-headers.json` shows the authentication floor for read-only
  inspection versus mutating push requests: inspect stays on the existing HMAC
  family, while dry-run, apply, and mutating recovery require the push
  session, idempotency key, and canonical push signature.
- `push-auth-session-recovery-contract.json` is the compact contract that
  binds push auth, the minted session, the journal fence, and inspect-only
  recovery in one place.
- `push-flow.json` shows the ordered push stages from preflight through
  inspect-first recovery and makes the dry-run/apply split explicit.
- `push-topology.json` shows the one-remote, one-local, one-drift-witness
  proof shape and the sandbox-only `8080` browser ingress rule.
- `push-auth-headers.json` shows the required authentication header families
  and versioned canonical push signature parts for dry-run, apply, and mutating
  recovery requests.
- `push-topology.json` gives a machine-readable one-remote, one-local proof
  shape for Docker and Playground test harnesses, including the same remote site
  after independent drift between dry-run and apply. It also records the
  remote identity binding that makes `remote-base` and `remote-changed` two
  observations of the same site rather than different sites.
- `push-recovery-decision.json` gives the inspect-first recovery decision
  matrix that keeps `inspect` read-only and requires fresh live proof before
  any mutating recovery mode.
- `push-recovery-path.json` gives the machine-readable inspect-first recovery
  classification used when a batch response is ambiguous and the executor must
  distinguish old, new, blocked, and open outcomes from journal plus live
  evidence.
- `push-recovery-inspect-contract.json` ties the minted session, journal row,
  live drift evidence, and inspect-first recovery rules into one compact
  contract for recovery proofs.
- `push-recovery-blocked-response.json` shows the inspect-first blocked case
  when the remote cannot prove a safe finish or rollback and returns
  `RECOVERY_BLOCKED` instead of mutating.
- `push-contract.json` gives the compact production contract that ties the
  exporter/importer handoff, push stages, auth/session proofs, and
  Docker/Playground topology into a single fixture.
- `push-topology-matrix.json` gives the shortest machine-readable proof of the
  one-remote, one-local, one-drift-witness topology used by both Docker and
  Playground test harnesses. It now carries the persisted pull base package
  plus the explicit preflight, snapshot listing, dry-run, apply, journal, and
  recovery boundaries so the topology proof stays tied to exporter/importer
  provenance and the production push sequence.
- `push-snapshot-hashes-page-contract.json` gives the compact cursoring proof
  for large remote sites and keeps partial snapshot listings clearly in the
  planning-only lane.
- `push-dry-run-apply-revalidation-contract.json` gives the compact proof that
  snapshot planning, dry-run eligibility, apply-time revalidation, and
  storage-boundary guards stay separate even when the remote drifts between
  dry-run and apply.
- `push-remote-liveness-contract.json` gives the compact proof that
  preflight, remote snapshot hash listing, dry-run receipt, batched apply,
  journal inspect, and inspect-first recovery stay on separate liveness
  boundaries.
- `push-protocol-extension-contract.json` gives the shortest end-to-end proof
  that the production push extension maps the pull exporter/importer
  provenance into preflight, snapshot listing, dry-run upload, batched apply,
  journal inspection, and inspect-first recovery while keeping the one-remote,
  one-local, one-drift topology explicit.
- `push-recovery-revalidation-contract.json` gives the compact proof that the
  same drift case still requires fresh live hashes before each apply batch and
  before any mutating recovery path.
- `push-production-ladder-contract.json` gives the compact end-to-end proof
  that preflight, snapshot listing, dry-run, apply, journal inspect, and
  recovery all stay on the production push ladder while Docker and Playground
  use the same one-remote, one-local topology.
- `push-executor-topology-proof.json` gives the shortest proof that the
  executor keeps the pull provenance, push staging, and browser ingress on one
  production-shaped topology. It is the canonical fixture to cite when a test
  needs to prove that Docker and Playground both reuse the same remote identity
  twice, keep `remote-base` and `remote-changed` as two observations of that
  one site, and keep browser-visible inspection on the sandbox-provided `8080`
  ingress with a local-only proxy.
- `push-deployment-topology-contract.json` gives the smallest topology-only
  contract for Docker and Playground. It isolates the one-remote, one-local,
  one-drift-witness shape and keeps the pull-to-push mapping and ingress rules
  visible in one compact object. Use it when a test needs to prove the
  production push ladder end to end in a small form: exporter/importer feed
  preflight, snapshot-hash listing stays planning-only, dry-run returns a
  receipt, apply revalidates before every batch and at the storage boundary,
  journal inspect stays read-only, and recovery must start with inspect before
  any mutating repair.

The recovery proof fixtures are intentionally split so the auth fence and the
inspect fence can be asserted independently or together:

- `push-auth-session-journal-proof.json` binds push auth, session minting,
  claim generation, lease expiry, and inspect-first recovery to the same
  journal row.
- `push-auth-session-fencing-contract.json` keeps the same auth/session proof
  in a compact form when a test wants one fixture that ties the journal row,
  lease fence, and inspect-first recovery boundary together.
- `push-auth-session-recovery-contract.json` keeps the stronger auth floor and
  the recovery fence together when a test wants to prove the claim is still
  fenced at recovery time.
- `push-recovery-inspect-contract.json` keeps the inspect-only recovery step
  explicit when a test only needs the session, journal row, and live hash
  classification.
- `push-recovery-revalidation-contract.json` shows the same drift case still
  requires fresh live hashes before apply or mutating recovery.

Fixture values such as `sha256:plan` are placeholders. Tests that execute the
protocol should replace them with canonical hashes generated from the exact
request bodies and should verify idempotency with byte-identical replays.

Dry-run and apply are intentionally separate fixtures. A test must not treat
`push-dry-run-response.json` as permission to skip the live preconditions in
`push-apply-batch-request.json`; apply revalidates the remote and can still
return `push-precondition-failed-response.json`.

The journal and recovery fixtures show how a client resolves ambiguity after
timeouts or crashes:

- `push-journal-response.json` reports the evidence needed to decide whether a
  request was only accepted, already committed, or still replayable.
- `push-recovery-response.json` shows the proof-oriented repair path.
- `push-recovery-blocked-response.json` shows the case where the server cannot
  prove that finish or rollback is safe.
- `push-recovery-request.json` also covers the read-only `mode: "inspect"`
  call used to read evidence before any mutating recovery mode.

Recovery examples use `mode: "auto"` for a mutating repair attempt. A pure
inspection call uses the same `push_recover` endpoint with `mode: "inspect"`
and omits the mutating recovery idempotency key unless the implementation
requires idempotency for all recovery requests.

`push_journal` is the ambiguity resolver after a timeout or crash. It reads
durable journal rows that carry claim ownership, claim generation, lease
expiry, and resource-level before/staged/after hashes.
`push_recover` `mode: "inspect"` is the evidence reader that decides whether
the next safe step is finish, rollback, retry, or block. Neither call should
be treated as a live write lock.
`push_recover` `mode: "inspect"` must happen before any mutating recovery
mode, and the blocked inspect fixture proves that the read-only path can
return a definitive stop without authorizing repair.

The open-journal and inspect fixtures intentionally keep the proof surface
small but explicit:

- `push-journal-open-response.json` shows a claim owner, claim generation,
  lease expiry, and per-resource guard outcomes so fenced ownership is visible.
- `push-recovery-inspect-response.json` reports the journal and live-hash
  review result without authorizing a mutation.
- `push-recovery-response.json` is only the committed case after the inspect
  evidence proves the batch can be finalized safely.

The fixtures are intentionally paired so tests can verify the full sequence:
preflight, remote snapshot hash listing, dry-run upload, batched apply,
journal inspection, and recovery. They should be treated as wire-contract
examples only; the production executor must still revalidate the live remote
between dry-run and every apply batch.

The hash-listing fixture is the planning boundary:

- `push-snapshot-hashes-request.json` binds the live remote scope used for
  planning.
- `push-snapshot-hashes-response.json` proves the remote returned a complete
  cursorable hash view for the requested scopes.
- dry-run may only consume that listing as evidence; it is never the write
  lock.
- apply must fetch fresh live evidence again before each batch.

The topology proof is intentionally asymmetric and mirrors the production
sequence exactly:

- `remote-base` is the source site that produced the persisted pull base.
- `local-edited` is the imported local clone after user edits.
- `remote-changed` is the same remote site after it drifts between dry-run and apply.
- the runner is the only process that can compare, upload, inspect, or
  recover.

The test only proves the production rule if the remote changes after dry-run
and before `push_batch_apply`.
Reusing a stale snapshot as the apply target turns the drift case into a
replay of old state and weakens the proof that apply revalidates live state.

For integration tests, the fixtures are meant to be exercised in the same
one-remote, one-local topology described in the executor docs:

- `remote-base` is the remote source site that produced the pull base package.
- `local-edited` is the locally edited site used to build the candidate plan.
- `remote-changed` is the same remote after live drift and is used to prove
  apply-time revalidation, journal inspection, and recovery are distinct from
  dry-run.

That topology is the minimal production-shaped test setup because it keeps the
planning remote and the drift remote separate while the runner remains the
only process that can compare, upload, and recover.

The fixture topology encodes the exact proof order the executor must preserve:

1. `push_preflight` authenticates a push-scoped session against the live remote.
2. `push_snapshot_hashes` records the current remote comparison set and coverage.
3. `push_plan_dry_run` uploads the canonical plan without mutating anything.
4. `push_batch_apply` revalidates the live remote again before every batch and at the storage boundary.
5. `push_journal` resolves lost responses and crash ambiguity without authorizing a write.
6. `push_recover inspect` reads evidence first, and mutating recovery modes only proceed when the journal and live hashes prove the action.

The fixture set is meant to be read as one production contract:

- `push-preflight-*` fixtures bind the persisted pull base to the live remote
  identity and a short-lived push session.
- `push-snapshot-hashes-*` fixtures show the cursorable live planning view and
  the coverage proof for the requested scope.
- `push-snapshot-hashes-page-contract.json` makes the partial-listing boundary
  explicit so tests can prove cursorable planning without treating a page as a
  lock.
- `push-dry-run-*` fixtures show the canonical plan upload and the resulting
  eligibility receipt, not a lock.
- `push-apply-batch-*` fixtures prove apply-time live revalidation on a batch
  boundary.
- `push-journal-*` fixtures expose durable claim, lease, and fencing evidence
  for lost-response recovery.
- `push-recovery-*` fixtures keep `inspect` read-only and require fresh live
  proof before any mutating repair.

The harness topology is the same proof in two packaging styles:

- Docker uses one private network with `remote-base`, `local-edited`,
  `remote-changed`, and `runner`.
- Playground uses the same role split with disposable blueprints instead of
  long-lived containers.
- In both harnesses, browser-visible inspection must go through the sandbox
  `8080` ingress and a local-only proxy, never through a remote tunnel.
- `remote-base` and `remote-changed` must be the same remote identity at
  different times so the stale-apply rejection proves live revalidation.

The pull handoff is equally explicit:

- exporter and importer create the immutable base package that push preflight
  binds to the live remote identity
- push snapshot hashes list live remote state for planning only
- push dry-run uploads the canonical plan as eligibility evidence only
- push batch apply revalidates the live remote before every batch and at the
  storage boundary
- push journal and push recover inspect read durable evidence before any
  mutating recovery mode can proceed

The auth proof is intentionally strict:

- read-only inspection uses the existing HMAC auth header family only
- dry-run, apply, and mutating recovery require the push session, idempotency key, and canonical push signature
- inspect stays read-only and must not be treated as a hidden mutation grant

Docker harnesses should wire this as one private network with a remote site
pair, a local site pair, and one runner container. Playground harnesses
should mirror the same role split with separate disposable blueprints for
`remote-base`, `local-edited`, and `remote-changed`. In both topologies,
browser-visible inspection must use only the sandbox-provided `8080` ingress
through a local-only proxy, never a tunnel.

The runtime split is intentionally narrow:

- `remote-base` is the remote source site that produced the persisted pull
  package.
- `local-edited` is the imported site after local edits are applied.
- `remote-changed` is the same remote after independent drift and exists only
  to prove that dry-run and apply are separate.
- the runner is the only actor allowed to compare, upload, inspect, or
  recover.

The test harness for these fixtures should use the same one-remote, one-local
shape described in the executor docs:

- `remote-base` supplies the pulled merge base and the persisted push base
  package.
- `local-edited` supplies the edited local state that becomes the candidate
  dry-run plan.
- `remote-changed` supplies the same remote after drift and must fail
  apply-time revalidation.

The topology is asymmetric on purpose:

- `remote-base` is the pulled merge base and the persisted push provenance.
- `local-edited` is the edited local source used to build the candidate plan.
- `remote-changed` is the same remote after drift that proves apply-time
  revalidation, journal inspection, and recovery are separate from dry-run.

For Docker verification, mirror the same shape with one source-site container,
one edited local container, and one runner container that holds the
persisted pull base package. For Playground verification, mirror it with one
`remote-base` server, one `local-edited` server, and the same runner process.
In both cases, keep the live drift state on the same remote site so stale-apply
tests prove a fresh revalidation boundary instead of a reused dry-run receipt.
`push_journal` and `push_recover inspect` are evidence reads only; any
mutating recovery step must still prove fresh live state before it can act.

The same topology is captured in `push-topology.json` so focused tests can
assert the intended role split without re-encoding prose assumptions.

The machine-checked topology proof should assert all four roles directly:

- `remote_base` seeds the persisted pull package and the live source identity
- `local_edited` carries the locally edited clone used for planning
- `remote_changed` is the same source site after drift and must fail stale
  apply revalidation
- `runner` is the only actor that may compare, upload, inspect, or recover

That check is what keeps the docs honest about the production topology instead
of leaving the one-remote, one-local proof in prose only.

The fixture contract is intentionally one remote, one local, one runner:

- `remote_base` is the persisted pull source of truth.
- `local_edited` is the imported and edited local site.
- `remote_changed` is the same remote site after drift and forces apply-time
  revalidation.
- `runner` is the only actor that may compare, upload, inspect, or recover.

`push-pull-mapping.json` is the compact handoff contract between the pull
exporter/importer pipeline and the push executor. It exists so tests can assert
that the stored pull base package is read-only provenance, not a hidden lock or
second export format.
