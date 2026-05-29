# RPP-0703 transaction boundary policy evidence

Evidence for RPP-0703. This slice adds a guarded-executor transaction boundary
policy for chunked file transfer: chunk transfer may resume from exact durable
receipts, but mutation apply work is a later transaction that opens only after
complete chunk receipts, a finalized chunk manifest, and a finalized staged file.

## Policy behavior

The benchmark report now emits `evidence.transactionBoundaryPolicy` with:

- policy id: `rpp-0703-transaction-boundary-policy`
- variant: `1`
- boundary order: chunk transfer transaction, file staging finalize boundary,
  apply mutation transaction
- transfer completion rule: complete after durable chunk receipts and finalized
  staging
- resume rule: skip chunks only when the durable receipt exactly matches the
  plan, resource, chunk index, byte range, chunk digest, receipt key, and
  idempotency key
- apply rule: mutation work is not allowed during transfer resume, and the
  apply transaction opens after `file-staging-finalized`

## Focused validation

Command:

- `umask 0022; node --test --test-name-pattern RPP-0703 test/guarded-executor-benchmark.test.js`

Result:

- 1 test, 1 ok, 0 failed

Observed focused evidence from the guarded executor benchmark:

- transfer complete: true
- exact chunk receipt matches: 4 of 4
- missing receipt blocks skip: true
- mismatched receipt blocks skip: true
- chunks skipped by receipt on resume: 4
- chunks to upload on resume: 0
- bytes to upload on resume: 0
- duplicate chunk bytes: 0
- duplicate mutation work during transfer resume: 0
- mutation work replayed before transfer finalization: 0
- apply opened after transfer finalization: true

## Limits

This is lab guarded-executor policy evidence. It does not claim production
storage receipts, production row batching, production atomic group commit,
database rollback, or generic storage transaction durability.

## Redaction posture

Transaction boundary evidence is hash-and-count only: receipt keys are recorded
as SHA-256 hashes in the policy projection, and raw row payloads, file bytes,
plugin payloads, and private site values are not included.
