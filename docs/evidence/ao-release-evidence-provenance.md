# AO release evidence provenance

Date: 2026-05-28
Lane: release-evidence-provenance
Primary checklist evidence IDs: RPP-0017, RPP-0018, RPP-0019, RPP-0020

## What changed

- Added `src/release-evidence-provenance.js`, a standalone deterministic validator for release evidence rows and artifacts.
- Added `fixtures/protocol/push-release-evidence-provenance-contract.json`, a machine-readable contract with accepted and rejected cases.
- Added `test/release-evidence-provenance.test.js` to pin fixture behavior, stable ordering, production-required counts, and reason-code ordering.

This is intentionally **not wired into `src/release-gates.js` yet**. The new validator is a contract and library surface that release gates can consume later after an integration test proves the handoff.

## Contract fields

Each evidence row is expected to carry:

| Field | Purpose |
| --- | --- |
| `evidenceId` | Stable row/artifact identity used in deterministic summaries. |
| `rppId` | Checklist item the evidence supports, such as `RPP-0017`. |
| `sourceKind` | Provenance class. Production-required rows must use `operator-production`, `live-production`, or `production-run`. |
| `artifactPath` | Repository-relative artifact reference. Raw URLs and secret-looking values are rejected and not echoed in summaries. |
| `observedAt` | ISO timestamp for when the operator observed the evidence. |
| `command` | Checked command that produced or verified the artifact. |
| `status` | Must be a checked terminal status such as `checked-passed`, `checked-failed`, `checked-nonzero`, or `verified`. |
| `subjectHash` | `sha256:<64 hex chars>` digest binding the evidence to the checked subject. |
| `operatorScope` | Scope of the operator run. Production-required rows must use a production scope such as `final-release`. |
| `productionRequired` | Whether the row is required before release movement may be considered ready. |

## Fail-closed reason codes

The validator rejects rows with deterministic reason codes for the release-critical cases:

- `OBSERVED_AT_REQUIRED` — no observation timestamp was supplied.
- `OBSERVED_AT_STALE` — the timestamp is older than the configured evidence age window.
- `PRODUCTION_SOURCE_REQUIRED` — a production-required row used local/generated source provenance or non-production operator scope.
- `SUBJECT_HASH_REQUIRED` — no subject digest binds the row to the checked subject.
- `ARTIFACT_PATH_RAW_URL` — the artifact reference is a raw URL instead of a repository artifact path.
- `ARTIFACT_PATH_SECRET_LIKE` — the artifact reference looks like it embeds a token, password, API key, authorization value, or bearer credential.
- `COMMAND_STATUS_UNCHECKED` — the command/status pair is missing or not a checked terminal status.

Additional malformed-field codes exist for invalid IDs, timestamps, hashes, or missing artifact paths, but the fixture focuses on the release gate provenance failures above.

## Summary shape

`validateReleaseEvidenceProvenance()` returns a deterministic summary:

```json
{
  "ok": false,
  "releaseReady": false,
  "acceptedEvidenceIds": ["RPP-0017:tmux-status-marker"],
  "rejectedEvidence": [
    {
      "evidenceId": "RPP-0018:progress-timestamp-stale",
      "rppId": "RPP-0018",
      "productionRequired": true,
      "reasonCodes": ["OBSERVED_AT_STALE"]
    }
  ],
  "productionRequired": {
    "total": 8,
    "accepted": 2,
    "rejected": 6
  }
}
```

`acceptedEvidenceIds` and `rejectedEvidence` are sorted by RPP/evidence ID, so the same inputs produce the same summary even if rows arrive in a different order.

## Covered checklist evidence

| RPP item | Provenance evidence added |
| --- | --- |
| RPP-0017 | Tmux stdout marker rows require fresh operator-production source, checked command status, and subject hash; generated marker placeholders are rejected. |
| RPP-0018 | Progress timestamp rows reject missing or stale `observedAt` values and distinguish local candidate evidence from production-required evidence. |
| RPP-0019 | `.agents/RELEASE_GATES.md` row artifacts reject local/generated placeholders, raw URL artifact references, and token-looking artifact values. |
| RPP-0020 | `verify:release` evidence accepts checked nonzero proof only when a subject hash is present, and rejects missing-hash rows. |

## Focused verification

```sh
node --check src/release-evidence-provenance.js
node --test test/release-evidence-provenance.test.js
git diff --check
```

The fixture contract is intentionally small and deterministic. It does not claim live production evidence exists; it defines how such evidence must be identified before release gates can accept it.
