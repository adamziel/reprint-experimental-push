# RPP-0710 parallel snapshot hashing evidence

Evidence for RPP-0710. This slice adds a lab-only guarded-executor benchmark
proof for bounded parallel snapshot hashing. It hashes the base, local, and
remote snapshot resource sets with a capped scheduler, compares the result with
the canonical sequential `resourceHash` output, and updates the fast-path lane
only after every correctness gate holds.

## Benchmark behavior

The guarded executor report now emits `evidence.parallelSnapshotHashing` with:

- benchmark id: `rpp-0710-parallel-snapshot-hashing`
- variant: `1`
- mode: `bounded-parallel-scheduler-proof`
- scheduler cap: `DEFAULT_LIMITS.maxHashConcurrency`
- hash scope: base, local, and remote snapshot resources
- fast-path lane: `parallel-snapshot-hash-fast-path`
- lane policy: `update-only-after-correctness-gates-pass`

Correctness gates:

1. `bounded-hash-concurrency`
2. `complete-snapshot-hash-set`
3. `parallel-matches-sequential`
4. `deterministic-hash-set`
5. `planning-only-no-write-authority`
6. `hash-only-evidence`

The hash listing is planning evidence only. It does not authorize apply, and
the guarded executor still requires one live remote precondition per mutation.

## Focused validation

Command:

- `node --test --test-name-pattern RPP-0710 test/guarded-executor-benchmark.test.js`

Result:

- 1 test, 1 ok, 0 failed

## Benchmark observation

Command:

- `node scripts/bench/guarded-executor-benchmark.js --profile=unit --file-bytes=1048576 --chunk-size-bytes=262144 --row-count=8 --row-payload-bytes=64 --snapshot-hash-concurrency=2`

Observed summary from this sandbox:

- parallel snapshot hashing status: `passed`
- max configured hash concurrency: `2`
- max observed in-flight hash jobs: `2`
- snapshot hash resources: `22`
- snapshot hash jobs: `66`
- hash set digest matched the sequential digest
- deterministic second run digest matched the first run digest
- fast-path lane updated: `true`
- fast-path lane blockers: none
- rollout safety gates: `9` passed, `3` blocked, `0` failed
- production throughput: `not-claimed`
- remaining production blockers: production storage receipts, production row
  batch executor, and production atomic group commit

## Redaction posture

The parallel snapshot hashing evidence stores counts, scheduler metadata,
SHA-256 digests, resource-type counts, and hashed resource-key samples only. It
does not store row payloads, file bytes, plugin payloads, private content, or
raw resource keys.

## Limits

This is local guarded-executor benchmark evidence. It does not claim production
remote hash pagination, production storage receipts, production row batching,
production atomic group commit, or release-verifier carry-through. Final release
remains NO-GO.
