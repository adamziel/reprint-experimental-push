# RPP-0255 keep-remote decision variant 3 evidence

Date: 2026-05-31
Lane: RPP-0255 keep-remote decision, variant 3
Checklist item: RPP-0255 - Add generated coverage for keep-remote decision, variant 3.

## Invariant

Generated resources marked `keep-remote` must remain decision-only. Each
decision must have unchanged local/base hashes, a changed remote hash, no
planned mutation, no live-remote precondition, and ready apply must preserve the
remote resource. Non-ready generated plans must refuse before mutating remote
state.

## Evidence added

- Focused generated proof:
  `test/rpp-0255-keep-remote-decision-v3.test.js`.
- Test name: `RPP-0255 generated keep-remote decisions are decision-only across
  variant 3 coverage`.
- The test cross-checks the existing generated harness
  `remoteOnlyPreservationVariant3` target coverage: 9 ready target cases, one
  case in each tier 1 through 9.
- The proof then scans all 620 deterministic generated harness cases and covers
  1,575 `keep-remote` decisions across 533 cases.
- Covered generated decision resources include 316 files, 20 plugins, and 1,239
  rows. Remote change shapes are 514 creates, 20 deletes, and 1,041 updates.
- Ready apply preservation is checked for 706 ready-plan `keep-remote`
  decisions. The 249 non-ready cases carrying `keep-remote` decisions are
  expected to refuse with `PLAN_NOT_READY` while the remote snapshot hash stays
  unchanged.

## Redaction proof

The serialized proof envelope stores command text, caveat, counts, statuses,
families, resource keys, states, change kinds, hashes, refusal codes, and proof
hashes. The test rejects evidence-redaction issues, collects generated/private
raw fixture strings from each decision resource, and asserts none of those
strings appear in the serialized evidence.

## Progress Log Entry

Ready to paste if the integrator chooses to satisfy the checklist success via
progress log:

```md
- RPP-0255: `node --test --test-name-pattern=RPP-0255 test/rpp-0255-keep-remote-decision-v3.test.js` passed 1/1. Caveat: deterministic local Node generated-fixture evidence only; release remains gated by broader integration evidence.
```

## Commands

```sh
node --check test/rpp-0255-keep-remote-decision-v3.test.js
node --test --test-name-pattern=RPP-0255 test/rpp-0255-keep-remote-decision-v3.test.js
node --test --test-name-pattern='RPP-0215|RPP-0235|RPP-0255|RPP-0275' test/push-planner.test.js test/rpp-0235-keep-remote-decision-v2.test.js test/rpp-0255-keep-remote-decision-v3.test.js test/rpp-0275-keep-remote-decision-v4.test.js
node --test --test-name-pattern=RPP-0159 test/generated-push-harness.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0255-keep-remote-decision-v3.md
node --test test/artifact-redaction-scan.test.js
git diff --check
```

Caveat: this is deterministic local Node generated-fixture evidence for the
RPP-0255 slice. It does not update release progress surfaces or change release
verifier routes; release remains gated by integration and broader release
evidence.
