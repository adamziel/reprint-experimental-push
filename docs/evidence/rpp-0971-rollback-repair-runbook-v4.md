# RPP-0971 rollback repair runbook v4 evidence

Date: 2026-06-01
Variant: 4
Audited local branch: `session/rpp-971`
Audited lane head before this evidence file: `fac63dd2cc01a010194b68421769ca43d9bd36c5`
Scope: rollback and repair operations support evidence only

This evidence records rollback and repair controls for runbook variant 4. It
uses the RPP-0951 rollback repair runbook v3 evidence as the pattern, updates
the audited lane head, links exact audit and validation commands to commit
anchors, names rollback and repair prerequisites, names repair stop rules, and
keeps final release at **NO-GO**. It adds no production-backed rollback or
repair proof and makes no release-gate status movement.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0971",
  "proofId": "rpp-0971-rollback-repair-runbook-v4",
  "variant": 4,
  "generatedAt": "2026-06-01T03:57:00.000Z",
  "status": "rollback-repair-runbook-v4-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "audit file links exact commands and commits",
  "auditRecordPath": "docs/evidence/rpp-0971-rollback-repair-runbook-v4.md",
  "patternRecordPath": "docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
  "auditedLane": {
    "branch": "session/rpp-971",
    "headBeforeEvidence": "fac63dd2cc01a010194b68421769ca43d9bd36c5",
    "headShortSha": "fac63dd2c",
    "headSubject": "Merge published progress page state",
    "originMainAtAudit": "6e48adcf3ec26d43f2f4ed2a089cdd4db06458ce",
    "originMainShortSha": "6e48adcf3",
    "originMainSubject": "docs: publish progress page"
  },
  "documents": {
    "evidence": "docs/evidence/rpp-0971-rollback-repair-runbook-v4.md",
    "patternEvidence": "docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
    "previousPatternEvidence": "docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
    "sourceRunbookEvidence": "docs/evidence/rpp-0911-rollback-repair-runbook.md",
    "runbook": "docs/operations/rollback-repair-runbook.md",
    "stateContract": "docs/recovery/acceptable-states.md",
    "journalContext": "docs/recovery/apply-journal.md"
  },
  "carriedForwardRollbackRepairContract": {
    "patternRppId": "RPP-0951",
    "patternProofId": "rpp-0951-rollback-repair-runbook-v3",
    "patternVariant": 3,
    "patternRecordPath": "docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
    "requiresExactAuditCommandLinks": true,
    "requiresExactValidationCommandLinks": true,
    "requiresCommitAnchors": true,
    "requiresRollbackPrerequisites": true,
    "requiresRepairPrerequisites": true,
    "requiresRepairStopRules": true,
    "requiresProductionBackedRepairProofBeforeReleaseMovement": true,
    "requiresFinalReleaseNoGo": true,
    "requiresNoReleaseGateMovement": true,
    "carriedForwardFields": [
      "runbookContract",
      "rollbackRepairPrerequisites",
      "rollbackPolicy",
      "repairPolicy",
      "repairStopConditions",
      "productionBackedRepairProofGate",
      "requiredEvidence"
    ],
    "rule": "Carry forward the RPP-0951 v3 rollback/repair contract unchanged unless production-backed rollback or repair proof exists; no such proof is present in this support-only slice."
  },
  "posture": {
    "productionEndpointAdded": false,
    "productionMutationAttempted": false,
    "productionRollbackAttempted": false,
    "productionRepairAttempted": false,
    "productionLiveSourceProofAdded": false,
    "productionDurabilityProofAdded": false,
    "releaseGateStatusMoved": false,
    "releaseGateFilesChanged": false,
    "progressFilesChanged": false,
    "completionChecklistChanged": false,
    "finalReleaseNoGoRetained": true
  },
  "writeScope": {
    "allowedFiles": [
      "docs/evidence/rpp-0971-rollback-repair-runbook-v4.md",
      "test/rpp-0971-rollback-repair-runbook-v4.test.js"
    ],
    "prohibitedFiles": [
      "checklist",
      "progress log",
      "progress.html",
      "release gate status files",
      "dashboard state",
      "tags"
    ],
    "releaseGateStatusMovement": false
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
    "partialRemoteAction": "blocked-recovery",
    "manualWriteRepairAuthorized": false,
    "automaticRollbackAuthorized": false,
    "releaseMovementAuthorized": false,
    "productionBackedProofRequiredForRelease": true
  },
  "rollbackRepairPrerequisites": [
    {
      "id": "failed-push-or-receipt-identifier",
      "required": true,
      "purpose": "Tie rollback or repair review to one failed push, receipt, or recovery request.",
      "stopIfMissing": "missing-required-evidence"
    },
    {
      "id": "journal-ownership-boundary",
      "required": true,
      "purpose": "Confirm every target belongs to the same journal ownership boundary before retry or repair review.",
      "stopIfMissing": "partial-or-unowned-remote"
    },
    {
      "id": "restart-readable-monotonic-journal",
      "required": true,
      "purpose": "Prove the journal is readable after restart, ordered, and not duplicated across ownership boundaries.",
      "stopIfMissing": "non-monotonic-or-unreadable-journal"
    },
    {
      "id": "planned-target-counts",
      "required": true,
      "purpose": "Reconcile planned, old, fully updated, unknown, and blocked target counts before action.",
      "stopIfMissing": "planned-target-count-mismatch"
    },
    {
      "id": "before-after-hash-envelope",
      "required": true,
      "purpose": "Compare every observed target hash to the journaled before or after hash only.",
      "stopIfMissing": "drift-outside-before-after-envelope"
    },
    {
      "id": "terminal-or-missing-terminal-evidence",
      "required": true,
      "purpose": "Record terminal success, terminal failure, or explicitly missing terminal evidence.",
      "stopIfMissing": "terminal-evidence-missing"
    },
    {
      "id": "same-request-replay-result",
      "required": true,
      "purpose": "Show retry or finalization uses the same request and performs zero fresh mutations.",
      "stopIfMissing": "fresh-mutation-would-run"
    },
    {
      "id": "artifact-redaction-scan-result",
      "required": true,
      "purpose": "Keep rollback and repair evidence hash-only and free of raw site values.",
      "stopIfMissing": "missing-required-evidence"
    },
    {
      "id": "production-backed-repair-proof",
      "required": true,
      "purpose": "Provide production rollback or repair proof before any release movement.",
      "stopIfMissing": "production-backed-proof-absent"
    }
  ],
  "rollbackPolicy": {
    "decision": "not-authorized-by-current-artifacts",
    "reason": "Current recovery artifacts are hash-only support evidence and do not contain raw before values for production rollback.",
    "rawBeforeValuesAvailable": false,
    "safeSubstitute": "validated-retry-after-old-remote-classification",
    "requiredStateBeforeRetry": "old-remote",
    "stopOnAnyNewDriftedOrUnknownTarget": true
  },
  "repairPolicy": {
    "decision": "support-only-roll-forward-review",
    "allowedScope": "old-targets-only-after-hash-confirmation",
    "fullyUpdatedAction": "finalize-or-replay-with-zero-fresh-mutations",
    "blockedAction": "stop-preserve-artifacts-recovery-owner-review",
    "manualPatchAction": "forbidden",
    "releaseActionWithoutProductionProof": "hold-final-release-no-go"
  },
  "repairStopConditions": [
    {
      "id": "missing-required-evidence",
      "condition": "Any required journal, receipt, command output, target count, hash, terminal, replay, redaction, or release posture evidence is missing.",
      "action": "stop-preserve-artifacts-classify-blocked-recovery"
    },
    {
      "id": "unknown-recovery-state",
      "condition": "Observed state is outside old-remote, fully-updated-remote, or blocked-recovery.",
      "action": "stop-classify-blocked-recovery"
    },
    {
      "id": "drift-outside-before-after-envelope",
      "condition": "Any target hash is neither the journaled before hash nor the journaled after hash.",
      "action": "stop-preserve-current-observation-escalate"
    },
    {
      "id": "partial-or-unowned-remote",
      "condition": "The remote is partial, unowned, ambiguous, or cannot be tied to the same journal ownership boundary.",
      "action": "stop-retry-and-open-recovery-owner-review"
    },
    {
      "id": "non-monotonic-or-unreadable-journal",
      "condition": "The restart-readable journal is missing, unordered, duplicated across ownership boundaries, or not monotonic.",
      "action": "stop-before-any-repair-plan"
    },
    {
      "id": "planned-target-count-mismatch",
      "condition": "Planned target count differs from observed old, new, unknown, or blocked target accounting.",
      "action": "stop-reconcile-counts-before-review"
    },
    {
      "id": "terminal-evidence-missing",
      "condition": "Terminal success, terminal failure, or the explicitly missing terminal evidence is not recorded.",
      "action": "stop-preserve-artifacts"
    },
    {
      "id": "fresh-mutation-would-run",
      "condition": "Replay or finalization would perform any fresh mutation instead of zero fresh mutation work.",
      "action": "stop-do-not-replay"
    },
    {
      "id": "manual-production-write-requested",
      "condition": "Repair requires hand-editing production rows, files, options, plugin data, or content.",
      "action": "stop-manual-write-forbidden"
    },
    {
      "id": "production-backed-proof-absent",
      "condition": "Production rollback, production repair, live source access, or durability proof is absent.",
      "action": "hold-final-release-no-go"
    }
  ],
  "productionBackedRepairProofGate": {
    "requiredBeforeReleaseMovement": true,
    "observedProductionRollbackProof": false,
    "observedProductionRepairProof": false,
    "observedProductionDurabilityProof": false,
    "decisionWithoutProof": "block-release-movement",
    "releaseGateStateWithoutProof": "held",
    "allowedStatusMovementWithoutProof": false,
    "finalReleaseStatusWithoutProof": "NO-GO"
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
    "production-backed-repair-proof",
    "final-no-go-release-posture"
  ],
  "releaseGateSnapshot": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:57:00.000Z",
    "exitCode": 1,
    "releaseStatus": "NO-GO",
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "primaryFailureBucket": "topology",
    "status": "held",
    "gateState": "held",
    "statusMarker": "[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]",
    "mutationAttempted": false,
    "releaseMovementAllowed": false,
    "finalGates": "3/20",
    "candidateGates": "3/20",
    "totals": {
      "gates": 20,
      "passed": 3,
      "candidate": 0,
      "missing": 17,
      "failed": 0,
      "blocking": 17
    }
  },
  "auditCommands": [
    "git show -s --format='%h%x09%H%x09%s' HEAD",
    "git log --oneline --decorate -12",
    "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
    "git log --oneline --all --grep='RPP-0951\\|RPP-0961\\|RPP-0962\\|RPP-0963\\|RPP-0964\\|RPP-0965\\|RPP-0966' -16",
    "git show -s --format='%H%x09%s' fac63dd2c 6e48adcf3 94d855138 f5127285b 29fd81e1f 302f62b60 89130d02c 0da2d08aa b51d6f00b 025d87ec2 f5a566a50 ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3"
  ],
  "validationCommands": [
    "node --check test/rpp-0971-rollback-repair-runbook-v4.test.js",
    "node --test --test-name-pattern RPP-0971 test/rpp-0971-rollback-repair-runbook-v4.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0971-rollback-repair-runbook-v4.md",
    "git diff --check"
  ],
  "relevantCurrentCommits": [
    {
      "name": "audited-lane-head-before-rpp-0971",
      "sha": "fac63dd2cc01a010194b68421769ca43d9bd36c5",
      "shortSha": "fac63dd2c",
      "subject": "Merge published progress page state",
      "reason": "Current lane head observed before the RPP-0971 support-only update."
    },
    {
      "name": "origin-main-observed",
      "sha": "6e48adcf3ec26d43f2f4ed2a089cdd4db06458ce",
      "shortSha": "6e48adcf3",
      "subject": "docs: publish progress page",
      "reason": "Observed origin/main and origin/HEAD reference during the audit."
    },
    {
      "name": "rpp-0966-progress-integration",
      "sha": "94d85513814840651d9e9dd0c994934f1f54461d",
      "shortSha": "94d855138",
      "subject": "docs: refresh progress for RPP-0966 integration",
      "reason": "Most recent integrated progress context before this support-only evidence."
    },
    {
      "name": "rpp-0966-lane-merge",
      "sha": "f5127285b05e00c06b0f3437888ae01a93899f46",
      "shortSha": "f5127285b",
      "subject": "Merge branch 'session/rpp-966' into lane/evidence-integration-20260527",
      "reason": "Integrated the most recent support lane before the current head."
    },
    {
      "name": "rpp-0966-critic-audit-v4",
      "sha": "29fd81e1fef3270877a7b16ba5e2fb6c337ced9b",
      "shortSha": "29fd81e1f",
      "subject": "Add RPP-0966 critic audit update v4 evidence",
      "reason": "Recent support-only v4 evidence located by the RPP-0951 through RPP-0966 audit command."
    },
    {
      "name": "rpp-0965-objective-audit-v4",
      "sha": "302f62b6086890c40395ed61244dde6162ed0dfa",
      "shortSha": "302f62b60",
      "subject": "RPP-0965 objective audit update v4",
      "reason": "Recent support-only v4 objective audit context."
    },
    {
      "name": "rpp-0964-gate-4-audit-v4",
      "sha": "89130d02c43963bea8dd40cbf22a4b67f47d2e5a",
      "shortSha": "89130d02c",
      "subject": "Add RPP-0964 gate 4 final audit evidence",
      "reason": "Recent support-only gate audit context."
    },
    {
      "name": "rpp-0963-gate-3-audit-v4",
      "sha": "0da2d08aabfaebfeb38aeaf7c8d613edfcf9002d",
      "shortSha": "0da2d08aa",
      "subject": "Add RPP-0963 release gate 3 final audit v4",
      "reason": "Recent support-only gate audit context."
    },
    {
      "name": "rpp-0962-gate-2-audit-v4",
      "sha": "b51d6f00bf1f530af753a04faf09e79410e8734f",
      "shortSha": "b51d6f00b",
      "subject": "Add RPP-0962 release gate 2 audit evidence",
      "reason": "Recent support-only gate audit context."
    },
    {
      "name": "rpp-0961-gate-1-audit-v4",
      "sha": "025d87ec271db5dfb3d9f47cb0c2acd0cb3b5c2a",
      "shortSha": "025d87ec2",
      "subject": "Add RPP-0961 release gate 1 final audit v4",
      "reason": "Recent support-only gate audit context."
    },
    {
      "name": "rpp-0951-pattern-runbook-v3",
      "sha": "f5a566a50d05aa077c328091f04da6aba911d67e",
      "shortSha": "f5a566a50",
      "subject": "Add RPP-0951 rollback repair runbook v3 evidence",
      "reason": "Pattern rollback repair runbook v3 evidence carried forward for variant 4."
    },
    {
      "name": "rpp-0931-pattern-runbook-v2",
      "sha": "ccac5bbebe8b1ae3f5cf37ac1f078518f26ce450",
      "shortSha": "ccac5bbeb",
      "subject": "Add RPP-0931 rollback repair runbook v2 evidence",
      "reason": "Prior rollback repair runbook v2 evidence retained through the RPP-0951 pattern."
    },
    {
      "name": "rpp-0911-source-runbook",
      "sha": "29d058579b38e315bf76667deff3a7a550f5c1c2",
      "shortSha": "29d058579",
      "subject": "Add RPP-0911 rollback repair runbook",
      "reason": "Original rollback repair runbook evidence retained through the carried-forward pattern."
    },
    {
      "name": "rpp-0904-operator-safe-recovery",
      "sha": "54f6b6b3c806c1756dd8c73f5fe7cc381b2ee0e2",
      "shortSha": "54f6b6b3c",
      "subject": "Add RPP-0904 operator safe recovery docs",
      "reason": "Existing operator recovery contract retained by the runbook pattern."
    },
    {
      "name": "rpp-0700-manual-recovery-audit-export",
      "sha": "e627a9717fa658b9eae5fabbdec34994fa9476cb",
      "shortSha": "e627a9717",
      "subject": "Add RPP-0700 manual recovery audit export release proof",
      "reason": "Historical audit-export anchor for manual recovery review evidence."
    },
    {
      "name": "rpp-0691-new-remote",
      "sha": "bced8d1ae925ff2d14f41ca25eaf30f1abd1f594",
      "shortSha": "bced8d1ae",
      "subject": "Add RPP-0691 new-remote recovery release proof",
      "reason": "Historical recovery classification anchor for fully updated remote state."
    },
    {
      "name": "rpp-0692-blocked-recovery",
      "sha": "3b0d2c8732a559406bf0e943bd93a126dfed9ce8",
      "shortSha": "3b0d2c873",
      "subject": "Add RPP-0692 blocked recovery release proof",
      "reason": "Historical recovery classification anchor for blocked recovery."
    },
    {
      "name": "rpp-0693-unknown-drift",
      "sha": "d3c23e7e646f5dbbaa51e58d28b5b0b03ab1b518",
      "shortSha": "d3c23e7e6",
      "subject": "Add RPP-0693 unknown-drift recovery release proof",
      "reason": "Historical recovery classification anchor for drift outside the hash envelope."
    },
    {
      "name": "rpp-0690-old-remote",
      "sha": "12f684cd343a8082a24ca6207d1b2c5ff8729ba1",
      "shortSha": "12f684cd3",
      "subject": "Add RPP-0690 old-remote recovery release proof",
      "reason": "Historical recovery classification anchor for old remote state."
    }
  ],
  "commandCommitLinks": [
    {
      "command": "git show -s --format='%h%x09%H%x09%s' HEAD",
      "commitRefs": [
        "fac63dd2c"
      ],
      "purpose": "Established the current audited lane head before adding RPP-0971 support evidence."
    },
    {
      "command": "git log --oneline --decorate -12",
      "commitRefs": [
        "fac63dd2c",
        "6e48adcf3",
        "94d855138",
        "f5127285b"
      ],
      "purpose": "Established current branch, origin main, and recent lane integration context."
    },
    {
      "command": "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
      "commitRefs": [
        "f5a566a50",
        "ccac5bbeb",
        "29d058579",
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
      "command": "git log --oneline --all --grep='RPP-0951\\|RPP-0961\\|RPP-0962\\|RPP-0963\\|RPP-0964\\|RPP-0965\\|RPP-0966' -16",
      "commitRefs": [
        "94d855138",
        "29fd81e1f",
        "302f62b60",
        "89130d02c",
        "0da2d08aa",
        "b51d6f00b",
        "025d87ec2",
        "f5a566a50"
      ],
      "purpose": "Linked the v4 lane context to recent support-only evidence slices and the RPP-0951 rollback repair pattern."
    },
    {
      "command": "git show -s --format='%H%x09%s' fac63dd2c 6e48adcf3 94d855138 f5127285b 29fd81e1f 302f62b60 89130d02c 0da2d08aa b51d6f00b 025d87ec2 f5a566a50 ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3",
      "commitRefs": [
        "fac63dd2c",
        "6e48adcf3",
        "94d855138",
        "f5127285b",
        "29fd81e1f",
        "302f62b60",
        "89130d02c",
        "0da2d08aa",
        "b51d6f00b",
        "025d87ec2",
        "f5a566a50",
        "ccac5bbeb",
        "29d058579",
        "54f6b6b3c",
        "e627a9717",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6",
        "12f684cd3"
      ],
      "purpose": "Verified exact commit subjects for every anchor named by the audit."
    }
  ],
  "validationCommandCommitLinks": [
    {
      "command": "node --check test/rpp-0971-rollback-repair-runbook-v4.test.js",
      "commitRefs": [
        "fac63dd2c",
        "f5a566a50"
      ],
      "purpose": "Syntax-checks the focused RPP-0971 test against the updated lane head and RPP-0951 pattern."
    },
    {
      "command": "node --test --test-name-pattern RPP-0971 test/rpp-0971-rollback-repair-runbook-v4.test.js",
      "commitRefs": [
        "fac63dd2c",
        "f5a566a50",
        "ccac5bbeb",
        "29d058579",
        "54f6b6b3c",
        "12f684cd3",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6"
      ],
      "purpose": "Validates the v4 support-only runbook controls, carried-forward v3 contract, prerequisites, repair stop conditions, and recovery-state anchors."
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0971-rollback-repair-runbook-v4.md",
      "commitRefs": [
        "fac63dd2c",
        "f5a566a50",
        "e627a9717"
      ],
      "purpose": "Proves the changed evidence artifact remains redacted while preserving the historical audit-export anchor."
    },
    {
      "command": "git diff --check",
      "commitRefs": [
        "fac63dd2c"
      ],
      "purpose": "Confirms the support-only diff is whitespace-clean against the audited lane head."
    }
  ],
  "evidenceLimits": {
    "mode": "rollback-repair-support-only-v4",
    "rawPayloadsStored": false,
    "credentialsStored": false,
    "privatePathsStored": false,
    "liveServiceConfigurationStored": false,
    "releaseGateChanged": false,
    "releaseGateFilesChanged": false,
    "releaseGateStatusMoved": false,
    "progressRecordChanged": false,
    "completionChecklistChanged": false
  }
}
```

## Exact Audit Commands

The audit trail for this variant uses these exact local commands:

```bash
git show -s --format='%h%x09%H%x09%s' HEAD
git log --oneline --decorate -12
git log --oneline --all --grep='rollback\|repair\|recovery' -20
git log --oneline --all --grep='RPP-0951\|RPP-0961\|RPP-0962\|RPP-0963\|RPP-0964\|RPP-0965\|RPP-0966' -16
git show -s --format='%H%x09%s' fac63dd2c 6e48adcf3 94d855138 f5127285b 29fd81e1f 302f62b60 89130d02c 0da2d08aa b51d6f00b 025d87ec2 f5a566a50 ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3
```

The command output anchors this support document to the following commits:

| Commit | Subject | Audit use |
| --- | --- | --- |
| `fac63dd2c` | Merge published progress page state | Current lane head observed before the RPP-0971 update. |
| `6e48adcf3` | docs: publish progress page | Observed origin main reference during the audit. |
| `94d855138` | docs: refresh progress for RPP-0966 integration | Most recent integrated progress context before this support-only evidence. |
| `f5127285b` | Merge branch 'session/rpp-966' into lane/evidence-integration-20260527 | Recent lane merge context. |
| `29fd81e1f` | Add RPP-0966 critic audit update v4 evidence | Recent support-only v4 evidence located by the v4 audit command. |
| `302f62b60` | RPP-0965 objective audit update v4 | Recent support-only objective-audit context. |
| `89130d02c` | Add RPP-0964 gate 4 final audit evidence | Recent support-only gate audit context. |
| `0da2d08aa` | Add RPP-0963 release gate 3 final audit v4 | Recent support-only gate audit context. |
| `b51d6f00b` | Add RPP-0962 release gate 2 audit evidence | Recent support-only gate audit context. |
| `025d87ec2` | Add RPP-0961 release gate 1 final audit v4 | Recent support-only gate audit context. |
| `f5a566a50` | Add RPP-0951 rollback repair runbook v3 evidence | Pattern rollback repair runbook v3 evidence carried forward for variant 4. |
| `ccac5bbeb` | Add RPP-0931 rollback repair runbook v2 evidence | Prior rollback repair runbook v2 evidence retained through the RPP-0951 pattern. |
| `29d058579` | Add RPP-0911 rollback repair runbook | Original rollback repair runbook evidence retained through the carried-forward pattern. |
| `54f6b6b3c` | Add RPP-0904 operator safe recovery docs | Existing recovery operator contract retained by the runbook pattern. |
| `e627a9717` | Add RPP-0700 manual recovery audit export release proof | Historical manual recovery audit-export anchor. |
| `bced8d1ae` | Add RPP-0691 new-remote recovery release proof | Historical fully updated remote classification anchor. |
| `3b0d2c873` | Add RPP-0692 blocked recovery release proof | Historical blocked recovery classification anchor. |
| `d3c23e7e6` | Add RPP-0693 unknown-drift recovery release proof | Historical drift classification anchor. |
| `12f684cd3` | Add RPP-0690 old-remote recovery release proof | Historical old remote classification anchor. |

## Carried Forward RPP-0951 Contract

This variant carries forward the RPP-0951 v3 rollback/repair contract: only
`old-remote`, `fully-updated-remote`, and `blocked-recovery` are acceptable
states; unknown, partial, missing-evidence, or drifted states route to
`blocked-recovery`; manual production writes and automatic rollback are not
authorized; production-backed repair proof is required before release movement.

## Rollback And Repair Prerequisites

Rollback and repair review requires a failed push or receipt identifier,
journal ownership, a restart-readable monotonic journal, reconciled planned
target counts, before and after hash envelope checks, terminal or explicitly
missing terminal evidence, same-request replay evidence with zero fresh
mutations, a clean artifact redaction scan, and production-backed repair proof
before release movement.

## Repair Stop Conditions

Repair must stop when any required evidence is missing, the state is unknown,
observed hashes drift outside the before or after envelope, the remote is
partial or unowned, the journal is non-monotonic or unreadable, target counts
do not reconcile, terminal evidence is absent, replay would perform fresh
mutation work, manual production writes are requested, or production-backed
proof is absent for release. Each stop condition routes to
`blocked-recovery` or holds final release at `NO-GO`; none authorizes manual
production repair.

## Validation Commands

Focused validation for this slice:

```bash
node --check test/rpp-0971-rollback-repair-runbook-v4.test.js
node --test --test-name-pattern RPP-0971 test/rpp-0971-rollback-repair-runbook-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0971-rollback-repair-runbook-v4.md
git diff --check
```

Each validation command is linked to commit anchors in
`validationCommandCommitLinks` above.

## Release Posture

This is support-only operations evidence. It does not prove production
rollback, production repair, production durability, live source access, or
release readiness. Without production-backed repair proof, release movement is
blocked and the final release verdict remains **NO-GO**.

Integration recommendation: **NO-GO**.
