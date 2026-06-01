# RPP-0918 telemetry-free audit mode evidence

Date: 2026-06-01
Slice: RPP-0918
Variant: 1
Mode: support-only telemetry-free audit
Release posture: NO-GO

## Claim

CI blocks release readiness when a required proof fails, using only local
required-check observations and redacted support artifacts. The slice does not
collect telemetry, raw private values, operator identity, hosted branch state,
or remote service status.

## Proof Matrix

| Scenario | Expected result | Evidence path |
| --- | --- | --- |
| All blocking required proofs are represented as passed and fresh | Local summary can report `releaseReady: true`; this is a fixture control only | `test/rpp-0918-telemetry-free-audit-mode.test.js` |
| `artifact-redaction-proof` reports failed while every other blocking proof is fresh | Summary reports `ok: false`, `releaseReady: false`, `passedCount: 9`, and `REQUIRED_RELEASE_CHECK_FAILED` | `test/rpp-0918-telemetry-free-audit-mode.test.js` |
| The same failed-proof fixture is evaluated through the report command | Command result exits `1`, report status is `held`, and no release movement is made | `test/rpp-0918-telemetry-free-audit-mode.test.js` |
| Support artifacts are retained | Redaction scan passes over the audit and evidence markdown files | `docs/audit/telemetry-free-audit-mode.md`; this file |

## Telemetry Boundary

The focused test builds an in-memory fixture from
`src/required-release-checks.js`, writes a temporary observations file for the
local report command, and removes it after the test. The fixture records only
check ids, commands, artifact paths, status, and timestamps. It records no raw
environment data, credentials, cookies, bearer values, private option payloads,
operator identity, hosted CI metadata, analytics event names, or remote URLs.

The report command used by the test reads local files only. It does not consult
GitHub branch protection, call a hosted service, start a dashboard, or open a
tunnel.

## Expected Focused Commands

```sh
node --check test/rpp-0918-telemetry-free-audit-mode.test.js
node --test --test-name-pattern RPP-0918 test/rpp-0918-telemetry-free-audit-mode.test.js
node scripts/release/artifact-redaction-scan.mjs docs/audit/telemetry-free-audit-mode.md docs/evidence/rpp-0918-telemetry-free-audit-mode.md
git diff --check
```

Expected result: all focused support checks pass, while release posture remains
`NO-GO`. No release-gate status file or progress artifact is changed by this
slice.
