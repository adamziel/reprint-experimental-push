# RPP-0233 localHash correctness, variant 2

Date: 2026-05-28
Lane: RPP-0233 localHash correctness, variant 2
Release status: NO-GO until integration accepts the session branch.

## Claim

Every ready mutation must carry a `localHash` matching the serialized planned
local resource payload. The planner also binds focused non-rewritten fixtures to
the local snapshot. Forged or stale `localHash` evidence is refused before any
remote mutation.

## Evidence added

- `src/apply.js` validates ready-plan `localHash` evidence during invariant
  checks, using precise issue codes for missing, malformed, invalid payload, and
  mismatched hash evidence. Malformed values are represented by type, length, and
  digest only.
- `scripts/harness/generated-push-cases.js` now asserts each generated mutation
  carries a hex hash matching its planned mutation value.
- `test/push-planner.test.js` adds a focused mixed fixture covering a file,
  a core row, and an allowlisted plugin-owned option. It rejects missing,
  malformed, wrong, stale-value, and stale-snapshot `localHash` attempts before
  mutation.
- `test/generated-push-harness.test.js` samples generated ready fixtures across
  file, row, post, and plugin-option families and proves forged `localHash`
  evidence fails closed.

## Commands

```sh
node --check src/apply.js
node --check scripts/harness/generated-push-cases.js
node --check test/push-planner.test.js
node --check test/generated-push-harness.test.js
node --test --test-name-pattern=RPP-0233 test/push-planner.test.js
node --test --test-name-pattern=RPP-0233 test/generated-push-harness.test.js
node --test test/generated-push-harness.test.js
node --test test/push-planner.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0233-local-hash-correctness-v2.md docs/evidence audits progress.html
git diff --check
```

Caveat: executable ready plans still include mutation payloads. The release
artifact proof serializes only hash-only envelopes and asserts private fixture
values and mutation payloads are absent from refusal evidence.
