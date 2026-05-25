# Durable Journal Contract

This lane treats recovery evidence in two different categories:

1. Lab evidence
2. Durable production evidence

Lab evidence is useful for model tests and local inspection. It can live entirely in JSON artifacts, in-memory fixtures, or test-only journals. That evidence proves the state machine, but it does not prove crash safety.

Production recovery needs durable artifacts that survive interruption:

- Journal rows or records written to persistent storage
- `fsync` or equivalent flush semantics for file-backed journals
- Plugin or worker activation state recorded durably
- Lease or fencing checks that reject stale workers before mutation
- Recovery inspection that can classify a remote as `old-remote`, `fully-updated-remote`, or `blocked-recovery`

Acceptable post-failure states are narrow by design:

- `old-remote` means nothing observable escaped the pre-mutation boundary
- `fully-updated-remote` means all planned mutations are committed and replay is inert
- `blocked-recovery` means the remote may be partially changed, but durable artifacts exist so the operator can inspect and recover safely

The inspectable recovery contract must be able to classify a plan into exactly one of those states after restart. If the journal cannot support that classification, the result is blocked recovery, not a best-effort guess.

Anything that leaves a partially mutated remote without recovery artifacts is a release blocker.

Retry safety rules:

- Retries must not duplicate inserts
- Retries must not resurrect stale local data
- Partial writes without durable artifacts must not be treated as safe replay

The code and tests in this lane should continue to prove the above contract at every new recovery boundary.
