# RPP-0709 chunk replay idempotency evidence

Date: 2026-05-30
Scope: local/lab guarded-executor benchmark only. Final release status remains
NO-GO because production storage receipts, production row batching, and
production atomic group commit remain blocked.

## Implementation summary

RPP-0709 adds chunk replay idempotency evidence to the guarded transfer path.
Chunk receipts now carry the local resource hash in addition to plan id,
resource key, chunk index, byte range, chunk digest, receipt key, and
idempotency key.

Replay rules:

- exact replay returns the existing durable receipt;
- missing receipt requires upload and cannot be inferred from staging bytes;
- same idempotency key with different chunk bytes or range blocks as a conflict;
- replay creates zero duplicate receipt records, writes zero duplicate chunk
  bytes, and performs zero mutation work.

The documented lab budgets live in
`DEFAULT_CHUNK_REPLAY_BUDGETS` in `src/chunk-replay-idempotency.js`.

## Focused large-site lab run

Command:

```sh
node scripts/bench/guarded-executor-benchmark.js \
  --profile=ci \
  --file-bytes=67108864 \
  --chunk-size-bytes=1048576 \
  --row-count=256 \
  --row-payload-bytes=512
```

Observed summary:

- Shape: 67,108,864 bytes, 1,048,576-byte chunks, 64 chunk receipts,
  256 benchmark rows, 266 planned mutations.
- Timings: total 82,033.29 ms, staging 2,228.27 ms, planning 134.70 ms,
  apply 59,650.27 ms, replay decision 12.08 ms.
- Budget: `ci` total runtime 82,033.29 / 180,000 ms; replay decision
  12.08 / 2,500 ms.
- Replay status: 64 exact replays returned receipts; 0 duplicate chunk bytes;
  0 duplicate receipt records; 0 duplicate mutation work.
- Fail-closed probes: missing receipt returned `upload-required`; mismatched
  idempotency replay returned `blocked`.
- Rollout safety gates: 8 lab gates, 3 production blockers. Production
  throughput remains `not-claimed`.

## Validation notes

Focused coverage:

- `test/chunk-replay-idempotency.test.js` covers exact replay, conflict replay,
  missing receipt behavior, budget success, and budget fail-closed behavior.
- `test/guarded-executor-benchmark.test.js` carries RPP-0709 through the guarded
  executor report and rollout safety gates.

Residual production gaps are unchanged: production storage-backed chunk
receipts, production batched row compare-and-swap execution, and production
atomic group commit evidence are still required before release throughput can be
claimed.
