# RPP-0299 redacted raw value evidence release verifier v5 evidence

Date: 2026-05-31
Lane: RPP-0299 redacted raw value evidence release-verifier carry-through, variant 5
Checklist item: RPP-0299 - Carry through the release verifier for redacted raw value evidence, variant 5.

## Scope

This adds focused local release-verifier support evidence for redacted raw
value handling. The proof is productionBacked `false`, releaseEligible `false`,
and final release posture remains NO-GO.

## Proof surface

`test/rpp-0299-redacted-raw-value-evidence-release-verifier-v5.test.js`
builds a mixed ready plan with:

- a file update for `file:index.php`;
- a core `wp_posts` row update; and
- an allowlisted plugin-owned `wp_options` row update for owner `forms`.

The fixture uses private source values in the planner inputs. The test first
serializes an intentionally raw planner/executor candidate and proves the
shared evidence redaction assertion rejects it. The release-verifier proof then
uses only redacted planner mutation descriptors, executor recovery-journal
descriptors, durable journal record hashes, stale precondition refusal hashes,
resource keys, counts, and proof hashes.

The executor path injects failure after staging. The in-memory recovery journal
keeps `beforeValue` and `afterValue` redaction summaries with SHA-256 digests,
while the durable journal records are checked with
`assertJournalRecordHasNoRawValues()`. A stale live-remote replay separately
raises `PRECONDITION_FAILED` before mutation and preserves the remote hash.

## Scenario matrix row

`docs/scenario-matrix.md` names the behavior as "Redacted raw value evidence
release verifier, variant 5" and records the focused command:

```sh
node --test test/rpp-0299-redacted-raw-value-evidence-release-verifier-v5.test.js
```

## Focused verification observed locally

```sh
node --check test/rpp-0299-redacted-raw-value-evidence-release-verifier-v5.test.js
node --check test/rpp-0239-redacted-raw-value-evidence-v2.test.js
node --check test/rpp-0259-redacted-raw-value-evidence-v3.test.js
node --check test/rpp-0279-redacted-raw-value-evidence-v4.test.js
node --test test/rpp-0299-redacted-raw-value-evidence-release-verifier-v5.test.js
node --test test/rpp-0239-redacted-raw-value-evidence-v2.test.js test/rpp-0259-redacted-raw-value-evidence-v3.test.js test/rpp-0279-redacted-raw-value-evidence-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0299-redacted-raw-value-evidence-release-verifier-v5.md docs/scenario-matrix.md
git diff --check
```

Observed result after validation: all commands exited 0. The focused RPP-0299
test reported 1 subtest ok, 0 failed. The adjacent raw-value lineage suite
reported 3 subtests ok, 0 failed. The scoped artifact redaction scan returned
`"ok": true` for the touched docs.

## Release posture

This is local release-verifier support evidence only. The proof envelope is
hash-only with redaction descriptors and explicitly support-only; final release
remains NO-GO until broader production-backed release evidence satisfies the
release boundary.
