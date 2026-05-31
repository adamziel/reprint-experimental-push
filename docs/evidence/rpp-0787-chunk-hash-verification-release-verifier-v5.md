# RPP-0787 chunk hash verification release verifier variant 5 evidence

Date: 2026-05-31
Lane: RPP-0787 chunk hash verification release verifier carry-through, variant 5
Checklist item: RPP-0787 - Carry through the release verifier for chunk hash verification, variant 5.

## Scope

This slice carries the RPP-0767 chunk hash verification variant 4 proof through
a local release-verifier support evidence path. It focuses on the required
success condition: generated guarded writes reject stale storage state before
any bytes or mutation work are applied.

The proof is support-only. It does not claim production storage receipts,
production row batch execution, production atomic group commit behavior, a live
production service, release approval, or final release readiness. Final release
posture and integration recommendation remain **NO-GO**.

## Proof surface

`test/rpp-0787-chunk-hash-verification-release-verifier-v5.test.js` runs the
guarded executor unit profile and a release-verifier-shaped benchmark command.
It projects hash-and-count-only evidence for:

- release-verifier command output that reports runtime, resources, and the
  rollout pass/fail gate vector;
- carried-through RPP-0767 chunk hash verification status;
- every manifest chunk being verified against the chunk manifest;
- generated guard cases covering every chunk in the unit transfer;
- matching writes applying only when storage and manifest hashes match;
- stale storage state being rejected for every generated chunk case;
- observed chunk hash mismatch being rejected for every generated chunk case;
- rejected writes writing `0` bytes and doing `0` mutation work;
- deterministic hash/count evidence across fixed-shape local support runs; and
- fail-closed resolver behavior for missing command reports, stale writes,
  hash mismatches, incomplete generated coverage, mutation work on rejected
  writes, runtime budget failure, and missing release-verifier carry-through.

## Local support evidence

The variant 5 projection uses support-only local evidence:

- profile: `unit`
- file bytes: `1048576`
- chunk size: `262144`
- chunk count: `4`
- staging backend: `bench-generated-chunk-staging`
- receipt backend: `lab-file-journal-receipts`
- storage proof: `support-only-lab-file-journal`
- production backed: `false`
- verified chunks: `4`
- total verified bytes: `1048576`
- generated stale storage cases: `4`
- generated hash mismatch cases: `4`
- stale storage rejections: `4`
- hash mismatch rejections: `4`
- unsafe writes applied: `0`
- bytes written by rejected writes: `0`
- mutation work on rejected writes: `0`
- release-verifier carry-through: `claimed-support-only`
- final release status: `NO-GO`
- integration recommendation: `NO-GO`

The public projection hashes plan identity, resource identity, manifest
identity, finalized file identity, generated guard cases, resolver decisions,
and release-verifier output. It keeps counts, byte totals, runtime budgets,
gate statuses, blocker identifiers, and hashes only.

## Variant 5 gates

The proof recomputes this local release-verifier gate vector before emitting
output:

1. `release-verifier-command-reports-runtime-resources-gates`
2. `built-on-chunk-hash-verification-v4-passed`
3. `all-manifest-chunks-verified`
4. `generated-stale-storage-coverage`
5. `guarded-writes-reject-stale-storage-state`
6. `hash-mismatch-fails-closed`
7. `no-mutation-work-on-rejected-writes`
8. `deterministic-release-verifier-support-evidence`
9. `unit-storage-performance-budget`
10. `release-verifier-carry-through-claimed`
11. `hash-only-release-verifier-evidence`
12. `support-only-release-no-go`

The output is emitted only after all twelve gates pass. If otherwise passing
evidence is changed to remove the command gate report, allow stale storage,
allow hash mismatch, remove generated coverage, add mutation work to rejected
writes, exceed the runtime budget, clear the recorded correctness gates, or
drop the release-verifier carry-through claim, the resolver blocks output and
records the failing gate.

## Redaction posture

Chunk hash release-verifier evidence is hash-and-count-only. It stores
verification counts, byte totals, rejected-write counters, runtime budgets,
gate status vectors, blocker identifiers, and SHA-256 hashes of resource
identities, generated guard cases, command projections, and resolver outputs.
It does not store logical paths, raw file content, row payloads, option values,
meta values, live service configuration, cookies, private site values, or
sensitive credentials.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0787-chunk-hash-verification-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0787 test/rpp-0787-chunk-hash-verification-release-verifier-v5.test.js
node --test --test-name-pattern RPP-0767 test/rpp-0767-chunk-hash-verification-v4.test.js
node --test --test-name-pattern RPP-0747 test/rpp-0747-chunk-hash-verification-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0787-chunk-hash-verification-release-verifier-v5.md
git diff --check
```

Observed validation result before commit:

- `node --check test/rpp-0787-chunk-hash-verification-release-verifier-v5.test.js`: exit 0
- RPP-0787 proof test: 3 pass, 0 fail
- RPP-0767 adjacent proof test: 3 pass, 0 fail
- RPP-0747 adjacent proof test: 3 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Release recommendation

Integration recommendation: **NO-GO**.

This evidence carries chunk hash verification through the local release
verifier support path, including stale-storage guard refusal. It does not prove
production storage durability or production release eligibility.
