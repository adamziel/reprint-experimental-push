# RPP-0794 large post table benchmark release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0794 large post table benchmark release-verifier carry-through, variant 5
Checklist item: RPP-0794 - Carry through the release verifier for large post table benchmark, variant 5.

## Scope

This slice carries the RPP-0774 large post table benchmark variant 4 support
proof into a deterministic local release-verifier envelope. It verifies that
the RPP-0714 large-site `wp_posts` benchmark report still exposes runtime,
resources, pass/fail gates, ordered primary-key batch windows, live remote
precondition counts, generated hash-only coverage, deterministic repeat
evidence, and RPP-0774 fail-closed cases.

The proof remains support-only. It does not claim production storage receipts,
production row batch execution, production atomic group commit behavior, live
production service behavior, production throughput, release approval, or
rollout safety. Final release status and integration recommendation remain
**NO-GO**.

## Proof surface

`test/rpp-0794-large-post-table-benchmark-release-verifier-v5.test.js` runs
the existing RPP-0714 large post table benchmark API using the large-site
profile carried by RPP-0774:

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
- changed hash-only samples: `5`
- unchanged hash-only samples: `3`
- applied mutations: `10000`
- changed rows verified after apply: `10000`
- unchanged sample rows verified after apply: `3`
- verification failures: `0`
- max duration budget: `15000 ms`
- max heap budget: `268435456 bytes`

The public release-verifier proof stores only counts, booleans, status strings,
budget values, blocker identifiers, primary-key window bounds, and hashes of
benchmark reports, batch windows, generated coverage, deterministic projections,
output, and decisions.

## Variant 5 checks

The focused test asserts that release-verifier carry-through includes:

- RPP-0774 variant 4 as the built-on lane;
- RPP-0714 as the source large post table benchmark;
- RPP-0754 variant 3 as the previous generated-coverage variant;
- release-verifier command metadata reporting runtime, resources, and pass/fail
  gate statuses;
- all six RPP-0714 benchmark gates reported as `pass`;
- large-site duration and heap budgets carried through;
- live remote preconditions for every planned row mutation;
- twenty ordered primary-key batch windows covering rows `1` through `10000`;
- generated large-site coverage preserved as hash/count-only evidence;
- deterministic repeat projection equality over runtime-free evidence; and
- hash/count-only output emitted only after correctness gates are recorded.

## Release-verifier gates

The proof recomputes this gate vector before accepting output:

1. `release-verifier-runtime-resources-gates-reported`
2. `built-on-large-post-table-benchmark-v4`
3. `large-site-benchmark-budget-carried-through`
4. `live-remote-post-preconditions-carried-through`
5. `ordered-primary-key-window-coverage-carried-through`
6. `deterministic-large-post-table-coverage-carried-through`
7. `generated-unsafe-large-post-table-cases-fail-closed`
8. `release-verifier-carry-through-claimed`
9. `hash-count-only-release-verifier-evidence`
10. `support-only-release-no-go`

All ten gates must pass and must be recorded before output is emitted. The
fail-closed test mutates otherwise passing evidence so missing runtime
reporting, stale batch-window evidence, stale generated coverage, deterministic
repeat drift, missing carry-through, raw-value leakage, production release
claims, or missing recorded gates block output.

## Generated negative coverage

The carried RPP-0774 generated matrix contains one safe local support case and
six unsafe cases:

- safe outputs: `1`
- blocked cases: `6`
- unsafe outputs: `0`
- over-budget evidence blocks on `documented-large-site-budget`;
- missing-window evidence blocks on `ordered-primary-key-window-coverage`;
- stale-window evidence blocks on `row-window-hashes-match`;
- raw-value evidence blocks on `hash-count-only-storage-performance-evidence`;
- deterministic repeat mismatch blocks on
  `deterministic-large-site-coverage-repeatable`; and
- premature passed status blocks on `correctness-gates-not-recorded`.

## Redaction posture

The RPP-0794 release-verifier proof is hash/count-only. It does not store raw
row payloads, post titles, post bodies, slugs, option values, meta values,
private site values, credentials, cookies, bearer values, production service
configuration, external endpoint values, or raw resource keys. The test checks
the public proof with both a large-post-specific raw-value pattern and the
shared evidence redaction assertion.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0794-large-post-table-benchmark-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0794 test/rpp-0794-large-post-table-benchmark-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0774 test/rpp-0774-large-post-table-benchmark-v4.test.js
node --test --test-name-pattern RPP-0754 test/rpp-0754-large-post-table-benchmark-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0794-large-post-table-benchmark-release-verifier-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0794-large-post-table-benchmark-release-verifier-v5.test.js`: exit 0
- RPP-0794 proof test: 2 pass, 0 fail; total duration `14102.972981 ms`
- RPP-0774 adjacent large post table variant 4 test: 2 pass, 0 fail; total
  duration `15018.40766 ms`
- RPP-0754 adjacent large post table variant 3 test: 2 pass, 0 fail; total
  duration `7728.202578 ms`
- Evidence redaction scan: `ok: true`, 0 rejected files,
  `allowedHashEvidence: 0`
- Diff whitespace check: clean

## Integration recommendation

Integration recommendation: **NO-GO**.

This evidence is deterministic local release-verifier support evidence only.
Production-backed storage receipts, row batch executor evidence, atomic group
commit evidence, live production service evidence, and release approval remain
required for promotion.
