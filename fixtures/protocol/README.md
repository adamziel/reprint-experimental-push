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
16. `push-topology.json`

Failure and recovery examples:

- `push-precondition-failed-response.json` shows apply-time liveness
  revalidation rejecting a stale target.
- `push-journal-request.json` and `push-journal-response.json` show the
  read-only inspection step used before any lost-response retry or recovery
  decision.
- `push-journal-open-response.json` shows an in-progress claim with fenced
  writer evidence, which is the proof the executor needs before it retries or
  recovers an interrupted apply.
- `push-recovery-request.json` and `push-recovery-response.json` show a
  successful recovery finalization after a read-only inspect step.
- `push-recovery-inspect-request.json` and `push-recovery-inspect-response.json`
  show the read-only evidence lookup used before any mutating recovery mode.
- `push-recovery-blocked-response.json` shows the evidence returned when the
  remote cannot prove a safe finish or rollback.
- `push-auth-headers.json` shows the required authentication header families
  and versioned canonical push signature parts for dry-run, apply, and mutating
  recovery requests.
- `push-topology.json` gives a machine-readable one-remote, one-local proof
  shape for Docker and Playground test harnesses.

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

`push_journal` is the ambiguity resolver after a timeout or crash.
`push_recover` `mode: "inspect"` is the evidence reader that decides whether
the next safe step is finish, rollback, retry, or block. Neither call should
be treated as a live write lock.

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

The topology proof is intentionally asymmetric:

- `remote-base` is the source site that produced the persisted pull base.
- `local-edited` is the imported local clone after user edits.
- `remote-changed` is a separate live instance that drifts after dry-run.
- the runner is the only process that can compare, upload, inspect, or
  recover.

The test only proves the production rule if `remote-base` and
`remote-changed` are different live instances. Reusing one remote for both
roles turns the drift case into a stale snapshot replay and weakens the proof
that apply revalidates live state.

For integration tests, the fixtures are meant to be exercised in the same
one-remote, one-local topology described in the executor docs:

- `remote-base` is the remote source site that produced the pull base package.
- `local-edited` is the locally edited site used to build the candidate plan.
- `remote-changed` is the live drift case used to prove apply-time
  revalidation, journal inspection, and recovery are distinct from dry-run.

That topology is the minimal production-shaped test setup because it keeps the
planning remote and the drift remote separate while the runner remains the
only process that can compare, upload, and recover.

Docker harnesses should wire this as one private network with a remote site
pair, a local site pair, and one runner container. Playground harnesses
should mirror the same role split with separate disposable blueprints for the
remote base, local edited site, and remote changed drift case. In both
topologies, browser-visible inspection must use only the sandbox-provided
`8080` ingress through a local-only proxy, never a tunnel.

The test harness for these fixtures should use the same one-remote, one-local
shape described in the executor docs:

- `remote-base` supplies the pulled merge base and the persisted push base
  package.
- `local-edited` supplies the edited local state that becomes the candidate
  dry-run plan.
- `remote-changed` supplies the live drift case that must fail apply-time
  revalidation.

The topology is asymmetric on purpose:

- `remote-base` is the pulled merge base and the persisted push provenance.
- `local-edited` is the edited local source used to build the candidate plan.
- `remote-changed` is the independent live remote that proves apply-time
  revalidation, journal inspection, and recovery are separate from dry-run.

For Docker verification, mirror the same shape with one source-site container,
one edited local-site container, and one runner container that holds the
persisted pull base package. For Playground verification, mirror it with one
`playground-remote` server, one `playground-local` server, and the same runner
process. In both cases, keep the live drift state separate from the planning
remote so stale-apply tests prove a fresh revalidation boundary instead of a
reused dry-run receipt.

The same topology is captured in `push-topology.json` so focused tests can
assert the intended role split without re-encoding prose assumptions.

The fixture contract is intentionally one remote, one local, one runner:

- `remote_base` is the persisted pull source of truth.
- `local_edited` is the imported and edited local site.
- `remote_changed` is the live drift target that forces apply-time
  revalidation.
- `runner` is the only actor that may compare, upload, inspect, or recover.
