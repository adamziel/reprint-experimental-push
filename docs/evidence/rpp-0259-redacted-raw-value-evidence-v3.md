# RPP-0259 redacted raw value evidence, variant 3

Date: 2026-05-30
Lane: RPP-0259 redacted raw value evidence, variant 3
Checklist item: RPP-0259 — Add generated coverage for redacted raw value evidence, variant 3.

## Invariant

Generated raw-value proof must remain operator-auditable without serializing raw
site payloads. Across generated ready and non-ready cases, planner mutation
values and staged recovery-journal values must redact to the shared evidence
marker plus SHA-256 digests, while stale and non-ready refusals expose only
resource keys, refusal codes, counts, and hashes.

## Scenario matrix row

The scenario matrix now names the behavior and focused command:

```sh
node --test --test-name-pattern=RPP-0259 test/rpp-0259-redacted-raw-value-evidence-v3.test.js
```

Focused test: `RPP-0259 redacted raw value evidence variant 3 generated cases
keep proof hash-only`.

## Focused generated proof

`test/rpp-0259-redacted-raw-value-evidence-v3.test.js` reuses deterministic
generated push-harness cases without changing generated harness source. The test
recounts four variant-3 generated surfaces and selects one ready plus one
non-ready case from each surface for proof inspection.

Observed deterministic coverage:

```json
{
  "totalGeneratedCases": 80,
  "targets": {
    "serialized-options": { "total": 20, "statuses": { "conflict": 10, "ready": 10 } },
    "wp-posts": { "total": 20, "statuses": { "conflict": 10, "ready": 10 } },
    "plugin-owned-options": { "total": 20, "statuses": { "conflict": 10, "ready": 10 } },
    "users-usermeta-graph": { "total": 20, "statuses": { "blocked": 3, "conflict": 7, "ready": 10 } }
  },
  "perTier": { "0": 2, "1": 2, "2": 2, "3": 2, "4": 2, "5": 2, "6": 2, "7": 2, "8": 2, "9": 2 }
}
```

Assertions prove:

- each target contributes exactly two generated cases in every tier;
- ready selected cases preserve mutation/precondition one-to-one pairing, redact
  every mutation `value`, redact staged journal `beforeValue`/`afterValue`, and
  reject stale replay with `PRECONDITION_FAILED` after only the recovery-claim
  durable event;
- non-ready selected cases refuse apply with `PLAN_NOT_READY`, keep the remote
  digest unchanged, and redact any independent mutation payloads retained for
  audit; and
- the deterministic proof envelope contains the shared redaction marker,
  SHA-256 hashes, resource keys, counts, and refusal codes, but none of the
  fixture-private generated needles.

## Validation commands

```sh
node --check test/rpp-0259-redacted-raw-value-evidence-v3.test.js
node --test --test-name-pattern=RPP-0259 test/rpp-0259-redacted-raw-value-evidence-v3.test.js
```

Observed focused result: 1 subtest, 0 failures.

Caveat: this is deterministic local generated-harness evidence. It does not
replace release-gate, integration-lane, or production-backed validation.
