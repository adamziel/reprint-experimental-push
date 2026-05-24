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
- `push-flow.json` shows the ordered push stages from preflight through
  inspect-first recovery and makes the dry-run/apply split explicit.
- `push-auth-headers.json` shows the required authentication header families
  and versioned canonical push signature parts for dry-run, apply, and mutating
  recovery requests.
- `push-topology.json` gives a machine-readable one-remote, one-local proof
  shape for Docker and Playground test harnesses, including the same remote site
  after independent drift between dry-run and apply.
- `push-recovery-decision.json` gives the inspect-first recovery decision
  matrix that keeps `inspect` read-only and requires fresh live proof before
  any mutating recovery mode.

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
