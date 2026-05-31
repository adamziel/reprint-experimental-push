# RPP-0734 large post table benchmark variant 2 evidence

Evidence for RPP-0734. This slice is support-only and builds on the RPP-0714
large post table benchmark. Final release remains **NO-GO** because this proof
does not supply a live production remote service, production storage receipts,
production row batch executor evidence, production atomic group commit evidence,
or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0734-large-post-table-benchmark-v2.test.js` exercises the RPP-0714
large-site profile over the in-memory WordPress site fixture.

Variant 2 asserts:

- the large-site benchmark uses the documented `wp_posts` workload and budget;
- the run finishes within the documented duration and heap budgets;
- row mutations carry live remote storage preconditions before apply;
- primary-key batch windows are ordered, bounded, complete, and hash-checked;
- apply verification covers all changed rows and unchanged-row samples;
- emitted performance output is blocked until correctness gates are recorded
  and passing;
- over-budget, missing-window, stale-window, and premature-pass evidence fails
  closed; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed large-site summary

Focused RPP-0714-backed large-site benchmark summary from this sandbox:

- profile: `large-site`
- table: `wp_posts`
- table rows: `20000`
- changed rows: `10000`
- unchanged rows: `10000`
- planned row mutations: `10000`
- live remote preconditions: `10000`
- batch size: `500` rows
- batch windows: `20`
- max observed batch rows: `500`
- duplicate post ids in batch windows: `0`
- applied mutations: `10000`
- changed rows verified after apply: `10000`
- unchanged sample rows verified after apply: `3`
- verification failures: `0`
- duration: `6878.51 ms` within the documented `15000 ms` budget
- heap used: `83495904 bytes` within the documented `268435456 bytes` budget
- RSS: `201109504 bytes`
- CPU: `6638.28 ms user`, `181.00 ms system`

Timings:

- fixture: `269.51 ms`
- plan: `764.40 ms`
- batch window construction: `20.49 ms`
- apply: `5683.39 ms`
- verification: `140.46 ms`
- total: `6878.51 ms`

The underlying RPP-0714 benchmark gates all reported `pass`:

- `large-post-table-plan-ready`
- `wp-posts-live-preconditions`
- `bounded-primary-key-batches`
- `apply-result-matches-plan`
- `hash-only-evidence`
- `large-site-runtime-budget`

## Variant 2 gates

The RPP-0734 proof recomputes this gate vector from the hash-only storage
performance projection before emitting output:

1. `benchmark-gates-pass`
2. `documented-large-site-budget`
3. `live-remote-storage-preconditions`
4. `ordered-primary-key-window-coverage`
5. `row-window-hashes-match`
6. `apply-verification-complete`
7. `hash-only-storage-performance-evidence`
8. `support-only-release-no-go`

The output is emitted only after all eight gates pass. If the evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Storage and performance posture

Recorded storage boundary:

- table: `wp_posts`
- apply mode: `applyPlan-live-precondition-row-mutations`
- storage boundary: `live-remote-hash-precondition-before-apply`
- expected preconditions: `10000`
- recorded preconditions: `10000`
- live remote preconditions: `10000`
- every mutation has a live remote precondition: `true`

Recorded performance boundary:

- documented profile: `large-site`
- documented duration budget: `15000 ms`
- documented heap budget: `268435456 bytes`
- observed duration: `6878.51 ms`
- observed heap used: `83495904 bytes`
- final budget gate: `pass`

## Negative coverage

The focused proof mutates otherwise passing storage performance evidence and
verifies fail-closed behavior:

- over-budget evidence sets duration above the documented maximum and blocks on
  `documented-large-site-budget`;
- missing-window evidence removes a primary-key batch window and blocks on
  `ordered-primary-key-window-coverage`;
- stale-window evidence changes a recorded row window digest and blocks on
  `row-window-hashes-match`; and
- premature-pass evidence clears the recorded gate vector while leaving status
  as `passed`, then blocks on `correctness-gates-not-recorded`.

All unsafe decisions suppress output and record deterministic decision hashes.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production remote service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch executor is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim live production throughput, release approval, or
rollout safety. It proves only local support-path storage preconditions,
hash-only batch-window evidence, runtime/resource gates, and fail-closed stale
or incomplete performance evidence behavior.

## Redaction posture

Storage performance evidence is hash-only for row contents. It stores counts,
budgets, timings, process resource measurements, primary-key window bounds,
row-window digests, collection hashes, and gate decision hashes. It does not
store post titles, post bodies, option values, meta values, file bytes, paths,
live service configuration, bearer tokens, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0734-large-post-table-benchmark-v2.test.js`
- `node --test --test-name-pattern RPP-734 test/rpp-0734-large-post-table-benchmark-v2.test.js`
- `node --test --test-name-pattern RPP-0714 test/rpp-0714-large-post-table-benchmark.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0734-large-post-table-benchmark-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result:

- RPP-0734 proof test: 2 pass, 0 fail
- Adjacent RPP-0714 large post table benchmark test: 4 pass, 0 fail
- Adjacent RPP-0732 dry-run batch sizing variant 2 test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
