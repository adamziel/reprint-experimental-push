# RPP-0929 Operator Runbook Evidence Variant 2

Date: 2026-06-01
Issue: RPP-0929
Audited local branch: `session/rpp-929`
Audited lane head before this evidence file: `ace2cf55c6457b8b54da5b2b98408a9fd704c909`
Write scope: support-only operator runbook v2 evidence and focused test.

## Scope

This slice records support-only evidence for the existing Reprint Push operator
runbook at `docs/operations/operator-runbook.md`. It follows the RPP-0909
operator runbook evidence pattern and verifies that operator documentation names
the prerequisites, recovery evidence, stop conditions, and hidden-assumption
blockers needed before mutation, retry, finalization, cleanup, escalation, or
release movement.

This artifact does not update checklist, progress-page, release-gate, or status
surfaces. It does not start dashboards, use remote tunnels, approve production
repair, or convert support documentation into production-backed release
evidence. The verdict stays held and final release remains `NO-GO`.

## Evidence Record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0929",
  "proofId": "rpp-0929-operator-runbook-v2",
  "variant": 2,
  "title": "Operator runbook v2 hidden-assumption recovery audit",
  "checkedAt": "2026-06-01T02:25:00.000Z",
  "status": "held-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "auditedBranch": "session/rpp-929",
  "auditedLaneHeadBeforeEvidence": "ace2cf55c6457b8b54da5b2b98408a9fd704c909",
  "documents": {
    "operatorRunbook": "docs/operations/operator-runbook.md",
    "patternEvidence": "docs/evidence/rpp-0909-operator-runbook.md",
    "recoveryStates": "docs/recovery/acceptable-states.md",
    "journalContext": "docs/recovery/apply-journal.md",
    "safeRecovery": "docs/recovery/operator-safe-recovery.md"
  },
  "operatorRunbookContract": {
    "safeProductionOperation": true,
    "noHiddenRecoveryAssumptions": true,
    "productionApplyRequiresSeparateGate": true,
    "normalValidatedApplyOnly": true,
    "manualProductionRepairAuthorized": false,
    "releaseGateMovement": "none",
    "releaseVerdictHeld": true,
    "dashboardsStarted": false,
    "remoteTunnelsUsed": false
  },
  "productionPrerequisitesBeforeMutation": [
    "separate release gate approval for the exact run envelope",
    "source and target site identities verified from approved operator inventory",
    "immutable plan identifier, receipt identifier, plan hash, and mutation count",
    "dry-run result with no unresolved conflicts or stale preconditions",
    "current precondition hashes for every planned target",
    "single-writer lease owner, lease timestamp, and lease expiry policy",
    "durable restart-readable journal path or table for the same run envelope",
    "idempotency key hash bound to the same request body",
    "backup or snapshot identifier recorded outside the evidence artifact",
    "approved authentication material is not copied into evidence",
    "local-only network posture confirmed, with no remote tunnel",
    "rollback, traffic freeze, and customer-impact decision owner identified before mutation begins"
  ],
  "recoveryEvidenceRequired": [
    "run identifier, operator, reviewer, recovery owner, and UTC timestamp",
    "release gate decision, and whether it is production-backed for this exact run",
    "source identity hash, target identity hash, plan hash, receipt identifier, mutation count, and target count",
    "dry-run status, conflict count, precondition status, and current precondition hash set",
    "lease owner hash, lease claim timestamp, journal location hash, and journal schema/version identifier",
    "idempotency key hash and request body hash",
    "journal-opened evidence before the first target mutation",
    "monotonic journal sequence numbers and restart-readable boundary records",
    "per-target before hash, planned after hash, and observed hash",
    "terminal completed, replayed, rejected, or blocked journal evidence",
    "redaction result for every artifact that will be retained or shared",
    "failed push identifier or receipt identifier",
    "checked recovery path used for inspection and any retry or finalization",
    "journal ownership result and active writer or claim evidence",
    "current observed hash for each planned target",
    "terminal journal evidence, or the exact missing terminal evidence that caused the stop",
    "idempotency replay result for the same request body"
  ],
  "stopConditions": [
    "separate release gate approval is absent, expired, or for a different run",
    "source or target identity is ambiguous",
    "single-writer lease is missing, stale, unowned, or contested",
    "durable journal is missing, uninspectable, unowned, non-monotonic, or not restart-readable",
    "dry-run conflicts remain unresolved",
    "precondition hashes drift before or during apply",
    "target count, mutation count, or plan hash does not match the run envelope",
    "current observed hashes cannot be explained by the journaled before or after hashes",
    "terminal evidence is missing after a mutation boundary",
    "same key replay would require fresh mutations for an already completed run",
    "manual production edits, direct database changes, manual file patching, or cleanup that deletes recovery artifacts",
    "evidence contains raw or sensitive material",
    "a remote tunnel or unapproved network ingress is needed to continue",
    "case classifies as `blocked-recovery`",
    "operator cannot answer a hidden-assumption check below with explicit evidence"
  ],
  "hiddenAssumptionBlockers": [
    "Is the release gate approval production-backed and bound to this exact run?",
    "Are the inspected source and target identities the intended production pair?",
    "Is the checked recovery path the same path used by the recovery action?",
    "Is the journal restart-readable after the failure or process restart?",
    "Is every planned target accounted for in the target counts?",
    "Are all current target hashes explained by either the planned before hash or planned after hash?",
    "Does terminal evidence match the selected recovery state?",
    "Does same key replay return the same result without fresh mutation work, or fail closed?",
    "Are all artifacts redacted to hash/count/metadata-only evidence?",
    "Does the action avoid manual production edits, direct database changes, release-gate movement, and artifact deletion?"
  ],
  "lifecycleGuards": {
    "beforeMutation": "Record every prerequisite before starting production apply work. If any item is missing or unknown, stop before mutation.",
    "beforeRetryFinalizationCleanupOrEscalation": "Before retry, finalization, cleanup, or escalation, record explicit answers to these checks:",
    "releaseMovementBlockedWhenStopped": "When stopped, do not retry automatically, do not patch production by hand, and do not perform release-gate movement.",
    "unknownAnswerAction": "blocked-recovery"
  },
  "recoveryPolicy": {
    "acceptableStates": [
      "old-remote",
      "fully-updated-remote",
      "blocked-recovery"
    ],
    "unknownStateAction": "blocked-recovery",
    "missingEvidenceAction": "stop-preserve-artifacts-review",
    "statusCodeOnlyClassificationAllowed": false,
    "sameRecoveryPathRequired": true,
    "samePlanEnvelopeRequired": true,
    "sameRequestReplayMustBeNonMutatingOrBlocked": true,
    "manualPatchingAllowed": false
  },
  "releaseHold": {
    "noReleaseGateMovement": true,
    "releaseGateStatusMoved": false,
    "statusFilesChanged": false,
    "progressFilesChanged": false,
    "completionChecklistChanged": false,
    "productionRepairAuthorized": false,
    "finalReleaseRecommendation": "NO-GO",
    "integrationRecommendation": "NO-GO; integrate as support-only evidence without release-gate movement"
  },
  "redactionPosture": {
    "mode": "hash-count-metadata-only",
    "rawPayloadsIncluded": false,
    "credentialMaterialIncluded": false,
    "cookiesIncluded": false,
    "privatePathsIncluded": false,
    "liveServiceConfigurationIncluded": false
  }
}
```

## Exact Commands for Focused Validation

| Purpose | Exact command | Expected result |
| --- | --- | --- |
| Audited commit | `git rev-parse HEAD` | `ace2cf55c6457b8b54da5b2b98408a9fd704c909` before adding this evidence. |
| Focused syntax check | `node --check test/rpp-0929-operator-runbook-v2.test.js` | JavaScript syntax accepted. |
| Focused RPP-0929 test | `node --test --test-name-pattern RPP-0929 test/rpp-0929-operator-runbook-v2.test.js` | Focused support evidence passes. |
| Evidence redaction scan | `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0929-operator-runbook-v2.md` | Evidence remains metadata-only and redaction safe. |
| Diff whitespace check | `git diff --check` | No whitespace errors. |

## Release Posture

This is support-only operator documentation evidence. It proves the runbook names
the safety controls an operator must check before mutation, retry, finalization,
cleanup, escalation, or release movement. It does not prove production
durability, production rollback, production repair, live topology,
customer-safe rollout, or release approval. Final release remains `NO-GO`.
