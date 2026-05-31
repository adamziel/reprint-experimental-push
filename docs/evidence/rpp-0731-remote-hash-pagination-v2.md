# RPP-0731 remote hash pagination variant 2 evidence

Evidence for RPP-0731. This slice is support-only and builds on the RPP-0711
remote hash pagination benchmark. Final release remains **NO-GO** because this
proof does not supply a live production remote service, production storage
receipts, production row batching, production atomic group commit evidence, or
release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0731-remote-hash-pagination-v2.test.js` exercises paged remote hash
collection with a deterministic 73-resource fixture and page size 17.

Variant 2 asserts:

- ordered page offsets and cursor handoff hashes across 5 pages;
- complete resource coverage with 73 unique resource-key hashes;
- page size bounded by the requested batch size and the route maximum;
- repeated collection over reversed input produces the same public projection;
- emitted page summaries contain hashes and counts instead of raw resource
  keys, row values, paths, cursors, or source configuration;
- stale page cursors, missing pages, mismatched page-summary hashes, and
  premature pass status all fail closed; and
- runtime/resource gates must pass before the proof can emit paged output.

## Observed benchmark summary

Focused benchmark summary from this sandbox:

- resources: `73`
- requested page size: `17`
- page count: `5`
- duration: `23.83 ms` within the `5000 ms` budget
- heap used: `5380232 bytes` within the `134217728 bytes` budget
- RSS: `62345216 bytes`
- CPU: `67.37 ms user`, `33.05 ms system`

The underlying RPP-0711 benchmark gates all reported `pass`:

- `complete-resource-set`
- `cursor-binds-source-and-scope`
- `configuration-bounds-enforced`
- `page-hashes-deterministic`
- `planning-only-not-write-authority`
- `hash-only-page-evidence`
- `runtime-resource-budget`

## Variant 2 gates

The RPP-0731 proof recomputes this gate vector from the hash-only page
projection before emitting output:

1. `ordered-page-chain`
2. `complete-page-coverage`
3. `bounded-page-size`
4. `page-summary-hashes-match`
5. `deterministic-page-evidence`
6. `hash-only-page-summaries`
7. `runtime-resource-budget`
8. `support-only-release-no-go`

The output is emitted only after all eight gates pass. If the evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Negative coverage

The focused proof mutates otherwise passing page evidence and verifies
fail-closed behavior:

- stale page cursor evidence changes the next page cursor-input hash and blocks
  on `ordered-page-chain`;
- missing page evidence removes a middle page and blocks on
  `complete-page-coverage`;
- mismatched page-summary hash evidence changes a recorded page summary hash and
  blocks on `page-summary-hashes-match`;
- premature pass evidence clears the recorded gate vector while leaving status
  as `passed`, then blocks on `correctness-gates-not-recorded`; and
- a stale source-bound cursor is rejected by the pagination cursor parser with
  `INVALID_CURSOR_SOURCE`.

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

This proof does not claim live production pagination, release approval, or
rollout safety. It proves only deterministic page collection, hash-only public
evidence, runtime/resource gates, and fail-closed stale or incomplete page
evidence behavior.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0731-remote-hash-pagination-v2.test.js`
- `node --test --test-name-pattern RPP-0731 test/rpp-0731-remote-hash-pagination-v2.test.js`
- `node --test --test-name-pattern "remote hash pagination benchmark" test/remote-hash-pagination.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0731-remote-hash-pagination-v2.md`
- `git diff --check`

Observed focused proof result:

- RPP-0731 proof test: 2 pass, 0 fail
- Adjacent RPP-0711 remote hash pagination benchmark test: 1 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
