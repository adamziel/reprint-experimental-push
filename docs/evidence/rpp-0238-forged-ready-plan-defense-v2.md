# RPP-0238 forged ready plan defense, variant 2

Date: 2026-05-30
Lane: RPP-0238 forged ready plan defense, variant 2
Release status: NO-GO until integration accepts the local commit.

## Claim

Forged ready plans are refused before remote mutation and before target or
mutation durable-journal evidence. The proof serializes a hash-only plan
evidence envelope; raw private fixture values, raw forged hash material, and raw
forged mutation payloads are absent from that serialized evidence.

## Focused evidence

- `test/rpp-0238-forged-ready-plan-defense-v2.test.js` builds a ready plan with
  three private local changes: a file update, a core `wp_posts` row update, and
  an allowlisted plugin-owned `wp_options` update.
- The ready baseline asserts each mutation has exactly one live-remote
  precondition bound to the observed remote hash.
- Forged plan cases cover:
  - missing live-remote preconditions for each mutation;
  - duplicate live-remote precondition;
  - precondition without a matching mutation;
  - precondition not checked against `live-remote`;
  - raw private material forged into precondition hash evidence;
  - raw private material forged into `remoteBeforeHash`; and
  - raw private material forged into a mutation payload.
- Each forged case asserts `PLAN_INVARIANT_VIOLATION`, zero applied mutations,
  unchanged remote hash, and no durable journal events.
- Stale live-remote cases drift each mutation resource and assert
  `PRECONDITION_FAILED`, zero applied mutations, unchanged remote hash, and no
  `target-planned` or mutation durable-journal events.

## Redaction proof

The test serializes only hash/resource/status/refusal evidence from the ready,
forged, and stale plans. Hash fields are emitted as SHA-256 hex or redacted
invalid-hash summaries, mutation payloads are represented by planned-value
hashes, and refusal details are checked directly. Assertions prove the serialized
evidence and refusal details omit every private fixture value, including the raw
forged hash and raw forged payload strings.

## Commands

```sh
node --check test/rpp-0238-forged-ready-plan-defense-v2.test.js
node --test --test-name-pattern=RPP-0238 test/rpp-0238-forged-ready-plan-defense-v2.test.js
node --test --test-name-pattern='RPP-0218|RPP-0238' test/push-planner.test.js test/rpp-0238-forged-ready-plan-defense-v2.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0238-forged-ready-plan-defense-v2.md
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
node --test test/rpp-0238-forged-ready-plan-defense-v2.test.js
node --test --test-name-pattern=RPP-0238 test/push-planner.test.js
node --test --test-name-pattern=RPP-0218 test/push-planner.test.js
git diff --check
git diff --cached --check
```

Caveat: executable ready plans still carry mutation payloads. This proof covers
serialized evidence envelopes and refusal details, which intentionally use
hash-only summaries instead of raw plan payloads.
