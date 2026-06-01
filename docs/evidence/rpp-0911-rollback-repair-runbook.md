# RPP-0911 rollback repair runbook evidence

Date: 2026-06-01
Variant: 1
Scope: rollback and repair operations runbook

This evidence records a support-only rollback and repair runbook. It links the
exact local audit commands to commit anchors, records the validation commands
for this slice, and keeps final release at **NO-GO**. It adds no
production-backed proof and makes no release-gate status movement.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0911",
  "proofId": "rpp-0911-rollback-repair-runbook-v1",
  "variant": 1,
  "generatedAt": "2026-06-01T01:52:00.000Z",
  "status": "rollback-repair-runbook-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "audit file links exact commands and commits",
  "documents": {
    "runbook": "docs/operations/rollback-repair-runbook.md",
    "evidence": "docs/evidence/rpp-0911-rollback-repair-runbook.md",
    "stateContract": "docs/recovery/acceptable-states.md",
    "journalContext": "docs/recovery/apply-journal.md"
  },
  "posture": {
    "productionEndpointAdded": false,
    "productionMutationAttempted": false,
    "productionLiveSourceProofAdded": false,
    "productionDurabilityProofAdded": false,
    "releaseGateStatusMoved": false,
    "progressFilesChanged": false,
    "completionChecklistChanged": false,
    "finalReleaseNoGoRetained": true
  },
  "runbookContract": {
    "acceptableStates": [
      "old-remote",
      "fully-updated-remote",
      "blocked-recovery"
    ],
    "unknownStateAction": "blocked-recovery",
    "missingEvidenceAction": "blocked-recovery",
    "driftOutsideEnvelopeAction": "blocked-recovery",
    "manualWriteRepairAuthorized": false,
    "automaticRollbackAuthorized": false,
    "releaseMovementAuthorized": false
  },
  "rollbackPolicy": {
    "decision": "not-authorized-by-current-artifacts",
    "reason": "Current recovery artifacts are hash-only support evidence and do not contain raw before values for production rollback.",
    "rawBeforeValuesAvailable": false,
    "safeSubstitute": "validated-retry-after-old-remote-classification"
  },
  "repairPolicy": {
    "decision": "support-only-roll-forward-review",
    "allowedScope": "old-targets-only-after-hash-confirmation",
    "fullyUpdatedAction": "finalize-or-replay-with-zero-fresh-mutations",
    "blockedAction": "stop-preserve-artifacts-recovery-owner-review",
    "manualPatchAction": "forbidden"
  },
  "requiredEvidence": [
    "failed-push-or-receipt-identifier",
    "inspected-recovery-path",
    "journal-ownership",
    "restart-readable-monotonic-journal",
    "audit-command-output",
    "planned-target-counts",
    "before-after-observed-hashes",
    "terminal-or-missing-terminal-evidence",
    "same-request-replay-result",
    "artifact-redaction-scan-result",
    "final-no-go-release-posture"
  ],
  "auditCommands": [
    "git show -s --format='%h%x09%H%x09%s' HEAD",
    "git log --oneline --decorate -12",
    "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
    "git log --oneline --all --grep='RPP-0904\\|RPP-0905\\|RPP-0906' -12"
  ],
  "relevantCurrentCommits": [
    {
      "name": "current-branch-head-before-rpp-0911",
      "sha": "c4faf5245",
      "subject": "Merge published progress page state",
      "reason": "Current branch head observed before the RPP-0911 support-only update."
    },
    {
      "name": "origin-main-observed",
      "sha": "404506c5e",
      "subject": "docs: publish progress page",
      "reason": "Observed origin main reference during the audit."
    },
    {
      "name": "rpp-0906-critic-audit",
      "sha": "fe3af9d8e",
      "subject": "Add RPP-0906 critic audit disposition",
      "reason": "Prior support-only audit disposition that preserved final NO-GO."
    },
    {
      "name": "rpp-0904-operator-safe-recovery",
      "sha": "54f6b6b3c",
      "subject": "Add RPP-0904 operator safe recovery docs",
      "reason": "Existing operator recovery contract used as the runbook base."
    },
    {
      "name": "rpp-0690-old-remote",
      "sha": "12f684cd3",
      "subject": "Add RPP-0690 old-remote recovery release proof",
      "reason": "Historical recovery classification anchor for old remote state."
    },
    {
      "name": "rpp-0691-new-remote",
      "sha": "bced8d1ae",
      "subject": "Add RPP-0691 new-remote recovery release proof",
      "reason": "Historical recovery classification anchor for new remote state."
    },
    {
      "name": "rpp-0692-blocked-recovery",
      "sha": "3b0d2c873",
      "subject": "Add RPP-0692 blocked recovery release proof",
      "reason": "Historical recovery classification anchor for blocked recovery."
    },
    {
      "name": "rpp-0693-unknown-drift",
      "sha": "d3c23e7e6",
      "subject": "Add RPP-0693 unknown-drift recovery release proof",
      "reason": "Historical recovery classification anchor for drift outside the hash envelope."
    },
    {
      "name": "rpp-0700-manual-recovery-audit-export",
      "sha": "e627a9717",
      "subject": "Add RPP-0700 manual recovery audit export release proof",
      "reason": "Historical audit-export anchor for manual recovery review evidence."
    }
  ],
  "commandCommitLinks": [
    {
      "command": "git show -s --format='%h%x09%H%x09%s' HEAD",
      "commitRefs": [
        "c4faf5245"
      ],
      "purpose": "Established the current branch head before adding RPP-0911 support evidence."
    },
    {
      "command": "git log --oneline --decorate -12",
      "commitRefs": [
        "c4faf5245",
        "404506c5e",
        "fe3af9d8e"
      ],
      "purpose": "Established current branch, origin main, and recent RPP-0906 audit context."
    },
    {
      "command": "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
      "commitRefs": [
        "54f6b6b3c",
        "e627a9717",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6",
        "12f684cd3"
      ],
      "purpose": "Located prior rollback, repair, and recovery support evidence without moving a release gate."
    },
    {
      "command": "git log --oneline --all --grep='RPP-0904\\|RPP-0905\\|RPP-0906' -12",
      "commitRefs": [
        "fe3af9d8e",
        "54f6b6b3c"
      ],
      "purpose": "Linked the runbook to the most recent support-only recovery and audit slices."
    }
  ],
  "validationCommands": [
    "node --check test/rpp-0911-rollback-repair-runbook.test.js",
    "node --test --test-name-pattern RPP-0911 test/rpp-0911-rollback-repair-runbook.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/operations/rollback-repair-runbook.md docs/evidence/rpp-0911-rollback-repair-runbook.md",
    "git diff --check"
  ],
  "evidenceLimits": {
    "mode": "rollback-repair-support-only",
    "rawPayloadsStored": false,
    "credentialsStored": false,
    "privatePathsStored": false,
    "liveServiceConfigurationStored": false,
    "releaseGateChanged": false,
    "releaseGateFilesChanged": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false
  }
}
```

## Validation

Focused validation for this slice:

```bash
node --check test/rpp-0911-rollback-repair-runbook.test.js
node --test --test-name-pattern RPP-0911 test/rpp-0911-rollback-repair-runbook.test.js
node scripts/release/artifact-redaction-scan.mjs docs/operations/rollback-repair-runbook.md docs/evidence/rpp-0911-rollback-repair-runbook.md
git diff --check
```

Observed local result after validation:

- syntax check: passed
- RPP-0911 focused test: passed
- artifact redaction scan: passed
- diff whitespace check: clean

## Release posture

This is support-only operations evidence. It does not prove production
rollback, production repair, production durability, live source access, or
release readiness. Final release remains **NO-GO**.
