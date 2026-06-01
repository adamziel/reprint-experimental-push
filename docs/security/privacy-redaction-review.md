# Privacy and redaction review

Date: 2026-06-01
Scope: RPP-0908 privacy/redaction review, variant 1
Release recommendation: `NO-GO`
Evidence mode: hash/count/surface-only

## Review finding

Release movement must stay blocked whenever the required redaction proof is not
fresh, passed, exact-command matched, and complete for every mandatory artifact.
The required release-check contract already models this as the blocking
production-required check `artifact-redaction-proof`.

The review does not store raw site URLs, credentials, cookies, tokens, payload
values, option values, request bodies, or response bodies. It records only
surface names, counts, command names, status labels, and SHA-256 hashes for the
reviewed implementation surfaces.

## Gateable proof requirement

`artifact-redaction-proof` is release-blocking and production-required. A
release-ready observation must include:

- Exact command: `node --test test/evidence-redaction.test.js`
- Required artifact count: 4
- Required artifact paths:
  `src/evidence-redaction.js`,
  `test/evidence-redaction.test.js`,
  `docs/evidence/ao-evidence-redaction.md`,
  `docs/scenario-matrix.md`
- A non-stale `observedAt` timestamp under the check's freshness window
- A passed status from the exact command

## Fail-closed cases

The required release checks remain held for all of these redaction proof
failures:

| Case | Required-check code | Release effect |
| --- | --- | --- |
| Observation missing | `REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING` | `NO-GO` |
| Observation failed | `REQUIRED_RELEASE_CHECK_FAILED` | `NO-GO` |
| Command missing or mismatched | `REQUIRED_RELEASE_CHECK_COMMAND_MISMATCH` | `NO-GO` |
| Mandatory artifact omitted | `REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING` | `NO-GO` |
| Observation stale or missing timestamp | `REQUIRED_RELEASE_CHECK_STALE` | `NO-GO` |

## Hash-only surface evidence

| Surface | SHA-256 |
| --- | --- |
| `src/required-release-checks.js` | `sha256:8da71bfb4b6fe04583bc53dc0ad9ef8294860eda2561b3016e388620d3e8f0ae` |
| `scripts/release/required-release-checks-report.mjs` | `sha256:c80d2eaa5c8e5965fdd0457ce41acb732db25bb31aae635ea6db85e5b2ffe2ad` |
| `scripts/release/artifact-redaction-scan.mjs` | `sha256:2489960afb710def170c7d8a296b1feb5e08bc4ad1030bcc3269c38ec1a76df0` |
| `test/evidence-redaction.test.js` | `sha256:fe0b2fc5fefb42e20ecf917f8b8f74fad8d67808c09f9465cb3ca727c5e0d78b` |
| `docs/evidence/ao-evidence-redaction.md` | `sha256:09d0de0845bab3cdb3db51dee786f0726e5808891bb4553cdd9abe83fb17edc2` |
| `fixtures/protocol/push-required-release-checks-contract.json` | `sha256:44544d57cc6ee49ab1e2128ba650db0c50fc8607b9ce9d2510044df7398e029c` |

## Integration recommendation

Integrate this review as support evidence for RPP-0908 only. Do not move any
release gate status from this review. Final release should remain `NO-GO` until
CI records a fresh, passed `artifact-redaction-proof` observation and every
other required release proof is also release-ready.
