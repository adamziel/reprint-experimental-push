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
11. `push-recovery-request.json`
12. `push-recovery-response.json`

Failure and recovery examples:

- `push-precondition-failed-response.json` shows apply-time liveness
  revalidation rejecting a stale target.
- `push-recovery-request.json` and `push-recovery-response.json` show a
  successful recovery finalization after a read-only inspect step.
- `push-recovery-blocked-response.json` shows the evidence returned when the
  remote cannot prove a safe finish or rollback.
- `push-auth-headers.json` shows the required authentication header families
  and versioned canonical push signature parts for dry-run, apply, and mutating
  recovery requests.

Journal inspection is read-only evidence, not permission to apply. The
executor uses `push-journal-request.json` and `push-journal-response.json` to
resolve lost responses, replay decisions, and recovery ambiguity before any
new mutation request is retried.

Fixture values such as `sha256:plan` are placeholders. Tests that execute the
protocol should replace them with canonical hashes generated from the exact
request bodies and should verify idempotency with byte-identical replays.

Dry-run and apply are intentionally separate fixtures. A test must not treat
`push-dry-run-response.json` as permission to skip the live preconditions in
`push-apply-batch-request.json`; apply revalidates the remote and can still
return `push-precondition-failed-response.json`.

Recovery fixtures model three outcomes:

- `push-recovery-response.json` proves a batch can be finalized when the live
  hashes and journal artifacts align.
- `push-recovery-blocked-response.json` proves the remote can return blocked
  evidence when a safe finish or rollback cannot be proven.
- `push-journal-response.json` proves the executor can inspect durable state
  before deciding whether recovery is needed at all.

Recovery examples use `mode: "auto"` for a mutating repair attempt. A pure
inspection call uses the same `push_recover` endpoint with `mode: "inspect"`
and omits the mutating recovery idempotency key unless the implementation
requires idempotency for all recovery requests.
