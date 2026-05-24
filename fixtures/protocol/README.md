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

Failure and recovery examples:

- `push-precondition-failed-response.json` shows apply-time liveness
  revalidation rejecting a stale target.
- `push-recovery-request.json` and `push-recovery-response.json` show a
  successful recovery finalization.
- `push-recovery-blocked-response.json` shows the evidence returned when the
  remote cannot prove a safe finish or rollback.
- `push-auth-headers.json` shows the required authentication header families
  for dry-run, apply, and mutating recovery requests.

Fixture values such as `sha256:plan` are placeholders. Tests that execute the
protocol should replace them with canonical hashes generated from the exact
request bodies and should verify idempotency with byte-identical replays.
