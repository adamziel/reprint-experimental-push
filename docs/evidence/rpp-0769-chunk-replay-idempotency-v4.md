# RPP-0769 chunk replay idempotency variant 4 evidence

Evidence for RPP-0769. This slice is deterministic local support-only
coverage for generated chunk replay idempotency variant 4. Final release
remains **NO-GO** because this proof does not include production storage
receipts, production row batch execution, production atomic group commit
evidence, live topology, credentials, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0769-chunk-replay-idempotency-v4.test.js` runs the existing
`guardedLarge` chunk replay benchmark and projects a hash-and-count-only public
proof.

Variant 4 asserts:

- RPP-0749 variant 3 coverage is carried forward over the RPP-0729 variant 2
  lineage and the RPP-0709 replay benchmark;
- local file-journal chunk receipts cover every generated chunk;
- each chunk is replayed twice and every replay returns the existing receipt;
- replay writes `0` duplicate chunk bytes, creates `0` duplicate receipt
  records, and performs `0` duplicate mutation work;
- replay decision hashes are deterministically recomputed before output;
- stale or mismatched replay probes fail closed;
- the `guardedLarge` local run finishes inside its documented duration and
  heap budgets; and
- unsafe evidence variants stay blocked when receipt coverage is missing,
  duplicate replay work appears, replay decision hashes change, budgets are
  exceeded, production claims are introduced, or the recorded correctness gate
  vector is cleared.

## Large-site local run

Focused local command shape:

```sh
node --test --test-name-pattern RPP-0769 test/rpp-0769-chunk-replay-idempotency-v4.test.js
```

Observed count-only summary from this sandbox:

- profile: `guardedLarge`
- file bytes: `402653184`
- chunk size: `8388608`
- chunks: `48`
- replay attempts per chunk: `2`
- replay attempts: `96`
- existing receipt returns: `96`
- exact receipt matches: `48`
- duplicate receipt records written: `0`
- bytes rewritten during replay: `0`
- duplicate mutation work: `0`
- duration: `2652.63 ms` within the documented `120000 ms` budget
- heap used: `6121832 bytes` within the documented `536870912 bytes` budget
- budget status: `passed`
- gates: `durable-chunk-receipts`, `chunk-hash-verification`,
  `chunk-replay-idempotency`, `no-duplicate-mutation-work`, and
  `large-site-runtime-budget` all reported `pass`
- production throughput: `not-claimed`
- release readiness: `NO-GO-without-live-production-proof`

## Variant 4 support gates

The proof recomputes this gate vector before emitting output:

1. `built-on-rpp-0749-v3`
2. `durable-local-receipts-complete`
3. `repeated-replay-idempotency`
4. `stable-replay-decision-hashes`
5. `stale-or-mismatched-replay-fails-closed`
6. `guarded-large-local-budget`
7. `hash-only-storage-performance-evidence`
8. `support-only-release-no-go`

All eight gates must pass. The resolver blocks output if the evidence is
otherwise marked passed but lacks complete local receipts, records duplicate
replay bytes, creates duplicate receipt records, performs duplicate mutation
work, changes the recomputed replay decision hashes, exceeds the large-site
budget, introduces production claims, or omits the recorded gate vector.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- production storage receipts are `not-claimed`
- production row batch execution is `not-claimed`
- production atomic group commit is `not-claimed`
- live topology is `not-claimed`
- credentials are `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim production storage durability, production throughput,
production row batching, production atomic group behavior, live-site topology,
credential availability, release approval, or final release readiness.

## Redaction posture

The variant 4 public projection is hash-and-count-only. It stores replay
counts, receipt counts, duplicate-work counters, deterministic replay decision
hash counts, runtime budgets, gate status vectors, blocker identifiers, and
hashes of manifest, finalized-file, replay decision, plan, and resource
identities. It does not store raw receipt keys, idempotency keys, logical
paths, absolute paths, staged file payloads, row payloads, option values, post
content, credentials, cookies, live URLs, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0769-chunk-replay-idempotency-v4.test.js`
- `node --test --test-name-pattern RPP-0769 test/rpp-0769-chunk-replay-idempotency-v4.test.js`
- `node --test --test-name-pattern RPP-0749 test/rpp-0749-chunk-replay-idempotency-v3.test.js`
- `node --test --test-name-pattern RPP-0729 test/rpp-0729-chunk-replay-idempotency-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0769-chunk-replay-idempotency-v4.md`
- `git diff --check`

Observed focused proof result before commit:

- RPP-0769 syntax check: passed
- RPP-0769 proof test: 2 pass, 0 fail
- Adjacent RPP-0749 proof test: 2 pass, 0 fail
- Adjacent RPP-0729 proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
