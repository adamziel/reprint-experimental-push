# RPP-0792 dry-run batch sizing release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0792 dry-run batch sizing release-verifier carry-through, variant 5
Checklist item: RPP-0792 - Carry through the release verifier for dry-run batch sizing, variant 5.

## Scope

This slice carries the RPP-0772 dry-run batch sizing variant 4 support proof
into a deterministic local release-verifier envelope. It verifies that bounded
dry-run batch windows, read-only dry-run receipts, complete hash-only resource
coverage, and guarded stale-storage refusal are preserved by the verifier
projection.

The proof remains support-only. It does not claim production storage receipts,
production row batch execution, production atomic group commit behavior, live
production service behavior, production throughput, release approval, or
rollout safety. Final release status and integration recommendation remain
**NO-GO**.

## Proof surface

`test/rpp-0792-dry-run-batch-sizing-release-verifier-v5.test.js` runs the
RPP-0712 dry-run batch sizing benchmark API with the RPP-0772 focused unit
shape:

- profile: `unit`
- file resources: `8`
- post rows: `14`
- postmeta rows: `17`
- option rows: `7`
- plugin metadata resources: `4`
- total resources: `50`
- total preconditions: `50`
- max resources per batch: `9`
- max estimated bytes per batch: `28672`
- max preconditions per batch: `9`
- max duration budget: `5000 ms`
- max heap budget: `134217728 bytes`

The public release-verifier proof stores only counts, booleans, statuses,
budget values, blocker identifiers, sequence ranges, and hashes of resource,
batch, receipt, storage-state, output, and decision identities.

## Variant 5 checks

The focused test asserts that release-verifier carry-through includes:

- RPP-0772 variant 4 as the built-on lane;
- RPP-0712 dry-run batch sizing benchmark status;
- RPP-0752 variant 3 as the previous generated-coverage variant;
- release-verifier command metadata reporting runtime, resources, and pass/fail
  gate statuses;
- all eleven RPP-0712 benchmark gates reported as `pass`;
- six deterministic dry-run batch windows:
  `[0..8]`, `[9..17]`, `[18..26]`, `[27..35]`, `[36..44]`, and `[45..49]`;
- dry-run receipts that do not authorize apply;
- one guarded write attempt per batch window;
- six stale-storage rejections before mutation-capable work starts;
- zero mutation-applied decisions;
- zero storage-state updates; and
- hash/count-only output emitted only after correctness gates are recorded.

## Release-verifier gates

The proof recomputes this gate vector before accepting output:

1. `release-verifier-runtime-resources-gates-reported`
2. `built-on-dry-run-batch-sizing-v4`
3. `bounded-dry-run-batch-sizing-carried-through`
4. `complete-dry-run-batch-coverage-carried-through`
5. `dry-run-receipts-do-not-authorize-apply`
6. `guarded-writes-reject-stale-storage-state`
7. `storage-state-preserved-after-rejected-guarded-writes`
8. `deterministic-release-verifier-support-evidence`
9. `release-verifier-carry-through-claimed`
10. `hash-count-only-release-verifier-evidence`
11. `support-only-release-no-go`

All eleven gates must pass and must be recorded before output is emitted. The
fail-closed test mutates otherwise passing evidence so stale guard acceptance,
storage mutation, a missing guarded write, a missing runtime report, a missing
carry-through claim, a production release claim, or missing recorded gates
blocks output.

## Stale storage refusal

The carried-through storage guard projection compares dry-run expected storage
hashes with live storage hashes observed immediately before guarded writes.
Every generated guarded write resolves as `stale-at-write`.

Recorded local support posture:

- guarded writes attempted: `6`
- stale storage rejections: `6`
- live storage matches dry-run precondition: `0`
- mutation-capable work started: `0`
- mutation applied: `0`
- storage state updated: `0`
- dry-run receipt authorizes mutation: `0`

## Redaction posture

The RPP-0792 release-verifier proof is hash/count-only. It does not store raw
file paths, row payloads, option values, post content, meta values, private site
values, credentials, cookies, bearer values, production service configuration,
or external endpoint values. The test checks the public proof with both a
dry-run-storage-specific raw-value pattern and the shared evidence redaction
assertion.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0792-dry-run-batch-sizing-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0792 test/rpp-0792-dry-run-batch-sizing-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0772 test/rpp-0772-dry-run-batch-sizing-v4.test.js
node --test --test-name-pattern RPP-0752 test/rpp-0752-dry-run-batch-sizing-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0792-dry-run-batch-sizing-release-verifier-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0792-dry-run-batch-sizing-release-verifier-v5.test.js`: exit 0
- RPP-0792 proof test: 2 pass, 0 fail
- RPP-0772 adjacent dry-run batch sizing proof test: 2 pass, 0 fail
- RPP-0752 adjacent dry-run batch sizing proof test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration recommendation

Integration recommendation: **NO-GO**.

This evidence is deterministic local release-verifier support evidence only.
Production-backed storage receipts, row batch executor evidence, atomic group
commit evidence, live production service evidence, and release approval remain
required for promotion.
