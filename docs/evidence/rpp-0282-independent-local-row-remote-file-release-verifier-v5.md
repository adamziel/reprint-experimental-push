# RPP-0282 independent local row plus remote file release verifier variant 5 evidence

Date: 2026-05-30
Lane: RPP-0282 independent local row plus remote file edit, variant 5
Checklist item: RPP-0282 — Carry through the release verifier for independent local row plus remote file edit, variant 5.

## Scope

This slice carries the existing generated independent local row plus remote file invariant into `scripts/playground/production-shaped-release-verify.mjs` as local production-shaped support evidence. It does not change planner merge semantics, generated harness fixtures, executor auth routes, recovery storage, public progress files, or unrelated plugin-driver checks.

## Invariant

For generated `independent-local-row-remote-file` cases, the release verifier now records that the local `wp_posts` row is the only target mutation while the independent remote file remains a hash-only `keep-remote` decision. The executor must reject both forged remote-file mutation attempts and stale row replays before any mutation or durable event is written.

## Evidence added

- Focused release-verifier test: `test/rpp-0282-independent-local-row-remote-file-release-verifier-v5.test.js`.
- Release-verifier carry-through helper: `summarizeIndependentLocalRowRemoteFileReleaseVerifierProof()` in `scripts/playground/production-shaped-release-verify.mjs`.
- Release-verifier output now includes `mergeInvariants.independentLocalRowRemoteFile` beside the existing production-shaped proof summaries.
- Checklist line RPP-0282 is marked complete.

## Proof envelope

The helper recounts all ten generated `independent-local-row-remote-file` cases, one per tier 0 through 9. For every case it records hash-only proof of:

- ready plan status and exact one-to-one live-remote preconditions for planned mutations;
- target row `put` mutation with no corresponding remote-file mutation;
- target remote file `keep-remote` decision with no precondition;
- apply carry-through that mutates the row and preserves the remote file;
- forged file mutation rejection with `PLAN_INVARIANT_VIOLATION` and `MUTATION_DECISION_RESOURCE_OVERLAP` before durable events;
- stale row replay rejection with `PRECONDITION_FAILED` before durable events.

The summarized coverage envelope is:

```json
{
  "target": "independentLocalRowRemoteFileReleaseVerifierVariant5",
  "family": "independent-local-row-remote-file",
  "total": 10,
  "perTier": {
    "0": 1,
    "1": 1,
    "2": 1,
    "3": 1,
    "4": 1,
    "5": 1,
    "6": 1,
    "7": 1,
    "8": 1,
    "9": 1
  },
  "statuses": {
    "ready": 10
  }
}
```

The proof intentionally remains `support_only`/`NO-GO` for release gating because it is local production-shaped evidence, not a claim that a checked external production source accepted the merge-invariant proof.

## Redaction

Case-level proof data uses resource keys, summary counts, hashes, refusal codes, issue codes, and event counts only. The focused test asserts that generated row titles, remote file payloads, forged file payloads, stale row payloads, and generic raw-value fields are absent from serialized release-verifier evidence.

## Validation commands

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0282-independent-local-row-remote-file-release-verifier-v5.test.js
node --test test/rpp-0282-independent-local-row-remote-file-release-verifier-v5.test.js
node --test test/rpp-0242-independent-local-row-remote-file-v3.test.js
node --test --test-name-pattern='RPP-0202|RPP-0222' test/push-planner.test.js
node --test --test-name-pattern='RPP-0222 generated harness preserves independent local rows and remote files' test/generated-push-harness.test.js
node --test test/rpp-0483-custom-table-allowlist-release-verifier-v5.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js test/rpp-0498-driver-apply-validation-release-verifier-v5.test.js test/rpp-0499-driver-audit-evidence-redaction-release-verifier-v5.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0282-independent-local-row-remote-file-release-verifier-v5.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Local validation observed the focused RPP-0282 test with 2 subtests and 0 failures, the RPP-0242 adjacent generated row/file test with 1 subtest and 0 failures, the RPP-0202/RPP-0222 planner subset with 2 subtests and 0 failures, the RPP-0222 generated harness subset with 1 subtest and 0 failures, and the release-verifier import/adjacent suite with 166 tests, 155 passes, 11 skips, and 0 failures. Checklist lint, scoped artifact redaction scan, `git diff --check`, and `git diff --cached --check` also passed. Full release readiness remains gated by the broader production release-verifier requirements outside this focused support-only merge-invariant carry-through.
