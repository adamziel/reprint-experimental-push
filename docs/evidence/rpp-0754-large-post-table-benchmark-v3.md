# RPP-0754 large post table benchmark variant 3 evidence

Evidence for RPP-0754. This slice is deterministic local support-only
coverage for the large `wp_posts` table benchmark, variant 3. Final release
remains **NO-GO** because this proof does not include production storage
receipts, production row batch execution, production atomic group commit
evidence, live topology, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0754-large-post-table-benchmark-v3.test.js` builds on the RPP-0714
large post table benchmark and the RPP-0734 variant 2 storage-performance proof
pattern.

Variant 3 asserts:

- the RPP-0714 large-site benchmark gates all report `pass`;
- the large-site run finishes inside the documented duration and heap budgets;
- row mutations carry live remote storage preconditions before apply;
- primary-key batch windows are ordered, bounded, complete, and hash-checked;
- generated benchmark coverage is preserved as count/hash-only evidence;
- apply verification covers all changed rows and unchanged-row samples;
- emitted output is blocked until correctness gates are recorded and passing;
- unsafe generated evidence fails closed; and
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
- changed hash-only samples: `5`
- unchanged hash-only samples: `3`
- applied mutations: `10000`
- changed rows verified after apply: `10000`
- unchanged sample rows verified after apply: `3`
- verification failures: `0`
- duration budget: `pass` against documented `15000 ms`
- heap budget: `pass` against documented `268435456 bytes`
- raw value evidence leaks: `0`

The evidence file intentionally records counts, budget pass/fail status, and
hash categories only. It does not copy row payloads, sample hash values, or
live configuration values.

## Variant 3 gates

The focused proof recomputes this gate vector before emitting generated
storage-performance output:

1. `benchmark-gates-pass`
2. `documented-large-site-budget`
3. `live-remote-storage-preconditions`
4. `ordered-primary-key-window-coverage`
5. `row-window-hashes-match`
6. `generated-large-site-coverage-complete`
7. `generated-coverage-hashes-match`
8. `apply-verification-complete`
9. `hash-count-only-storage-performance-evidence`
10. `support-only-release-no-go`

Output is emitted only after all ten gates are recorded and passing.

## Generated coverage posture

Variant 3 carries generated benchmark coverage forward as local support-only
evidence:

- workload counts: table rows, changed rows, and batch size;
- planner counts: mutations, conflicts, blockers, and decisions;
- batch window counts and primary-key bounds;
- changed and unchanged hash-only sample counts;
- batch-window digests and generated coverage summary hashes; and
- redaction count.

The proof rejects otherwise passing evidence if generated coverage carries a
raw value marker, if a row-window hash is stale, if a primary-key window is
missing, if the budget gate is over limit, or if a `passed` status appears
before the correctness gate vector is recorded.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production remote service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch execution is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim live production throughput, release approval, rollout
safety, or final release readiness.

## Redaction posture

Emitted evidence is hash/count-only. It stores counts, budgets, primary-key
window bounds, row-window digests, generated coverage hashes, gate hashes, and
decision hashes. It does not store post titles, post bodies, option values,
meta values, file bytes, paths, live service configuration, bearer tokens, or
private site values.

## Validation

Required validation commands for this slice:

- `node --check test/rpp-0754-large-post-table-benchmark-v3.test.js`
- `node --test --test-name-pattern RPP-0754 test/rpp-0754-large-post-table-benchmark-v3.test.js`
- `node --test --test-name-pattern RPP-0734 test/rpp-0734-large-post-table-benchmark-v2.test.js`
- `node --test test/rpp-0714-large-post-table-benchmark.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0754-large-post-table-benchmark-v3.md`
- `git diff --check`

Observed validation results before commit:

- RPP-0754 syntax check: pass
- RPP-0754 proof test: 2 pass, 0 fail; total duration
  `6503.940386 ms`
- RPP-0734 adjacent proof test: 2 pass, 0 fail; total duration
  `7272.545716 ms`
- RPP-0714 benchmark test: 4 pass, 0 fail; total duration
  `237.943086 ms`
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
