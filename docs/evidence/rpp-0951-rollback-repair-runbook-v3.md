# RPP-0951 rollback repair runbook v3 evidence

Date: 2026-06-01
Variant: 3
Audited local branch: `session/rpp-951`
Audited lane head before this evidence file: `675b362f58cb1fd589c78e93e7002e02d7a66da4`
Scope: rollback and repair operations support evidence only

This evidence records rollback and repair controls for runbook variant 3. It
uses the RPP-0931 rollback repair runbook v2 evidence as the pattern, updates
the audited lane head, links exact audit and validation commands to commit
anchors, names rollback and repair prerequisites, names repair stop
conditions, and keeps final release at **NO-GO**. It adds no production-backed
rollback or repair proof and makes no release-gate status movement.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0951",
  "proofId": "rpp-0951-rollback-repair-runbook-v3",
  "variant": 3,
  "generatedAt": "2026-06-01T03:10:00.000Z",
  "status": "rollback-repair-runbook-v3-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "audit file links exact commands and commits",
  "auditRecordPath": "docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
  "patternRecordPath": "docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
  "auditedLane": {
    "branch": "session/rpp-951",
    "headBeforeEvidence": "675b362f58cb1fd589c78e93e7002e02d7a66da4",
    "headShortSha": "675b362f5",
    "headSubject": "Merge published progress page state",
    "originMainAtAudit": "9f278e4d975b5073dec0e4c21ce75ec1a637e5be",
    "originMainShortSha": "9f278e4d9",
    "originMainSubject": "docs: publish progress page"
  },
  "documents": {
    "evidence": "docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
    "patternEvidence": "docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
    "sourceRunbookEvidence": "docs/evidence/rpp-0911-rollback-repair-runbook.md",
    "runbook": "docs/operations/rollback-repair-runbook.md",
    "stateContract": "docs/recovery/acceptable-states.md",
    "journalContext": "docs/recovery/apply-journal.md"
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
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T03:10:00.000Z",
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
    "git log --oneline --all --grep='RPP-0947\\|RPP-0948\\|RPP-0949\\|RPP-0950' -12",
    "git show -s --format='%H%x09%s' 675b362f5 9f278e4d9 1faf54e5e ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 2f53dde24 97cc7daab a0576fdd6"
  ],
  "validationCommands": [
    "node --check test/rpp-0951-rollback-repair-runbook-v3.test.js",
    "node --test --test-name-pattern RPP-0951 test/rpp-0951-rollback-repair-runbook-v3.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
    "git diff --check"
  ],
  "relevantCurrentCommits": [
    {
      "name": "audited-lane-head-before-rpp-0951",
      "sha": "675b362f58cb1fd589c78e93e7002e02d7a66da4",
      "shortSha": "675b362f5",
      "subject": "Merge published progress page state",
      "reason": "Current lane head observed before the RPP-0951 support-only update."
    },
    {
      "name": "origin-main-observed",
      "sha": "9f278e4d975b5073dec0e4c21ce75ec1a637e5be",
      "shortSha": "9f278e4d9",
      "subject": "docs: publish progress page",
      "reason": "Observed origin/main and origin/HEAD reference during the audit."
    },
    {
      "name": "rpp-0946-progress-integration",
      "sha": "1faf54e5e48d1b85e52ade7b68016057daf288db",
      "shortSha": "1faf54e5e",
      "subject": "docs: refresh progress for RPP-0946 integration",
      "reason": "Most recent integrated progress context before this support-only evidence."
    },
    {
      "name": "rpp-0931-pattern-runbook-v2",
      "sha": "ccac5bbebe8b1ae3f5cf37ac1f078518f26ce450",
      "shortSha": "ccac5bbeb",
      "subject": "Add RPP-0931 rollback repair runbook v2 evidence",
      "reason": "Pattern rollback repair runbook v2 evidence used for variant 3 support evidence."
    },
    {
      "name": "rpp-0911-source-runbook",
      "sha": "29d058579b38e315bf76667deff3a7a550f5c1c2",
      "shortSha": "29d058579",
      "subject": "Add RPP-0911 rollback repair runbook",
      "reason": "Original rollback repair runbook evidence retained through the RPP-0931 pattern."
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
    },
    {
      "name": "rpp-0949-operator-runbook-v3",
      "sha": "2f53dde24af98a4b47efd0073d76f2ae1def4186",
      "shortSha": "2f53dde24",
      "subject": "docs: add RPP-0949 operator runbook v3 evidence",
      "reason": "Recent support-only evidence located by the RPP-0947 through RPP-0950 audit command."
    },
    {
      "name": "rpp-0948-privacy-redaction-review-v3",
      "sha": "97cc7daabcaeb1cccf8e10d3ff5eaca0df283b56",
      "shortSha": "97cc7daab",
      "subject": "Add RPP-0948 privacy redaction review v3",
      "reason": "Recent support-only evidence located by the RPP-0947 through RPP-0950 audit command."
    },
    {
      "name": "rpp-0947-security-review-checklist",
      "sha": "a0576fdd6bf9fb43b9d827af6d907af692f5ac16",
      "shortSha": "a0576fdd6",
      "subject": "Add RPP-0947 security review checklist evidence",
      "reason": "Recent support-only evidence located by the RPP-0947 through RPP-0950 audit command."
    }
  ],
  "commandCommitLinks": [
    {
      "command": "git show -s --format='%h%x09%H%x09%s' HEAD",
      "commitRefs": [
        "675b362f5"
      ],
      "purpose": "Established the current audited lane head before adding RPP-0951 support evidence."
    },
    {
      "command": "git log --oneline --decorate -12",
      "commitRefs": [
        "675b362f5",
        "9f278e4d9",
        "1faf54e5e"
      ],
      "purpose": "Established current branch, origin main, and recent lane integration context."
    },
    {
      "command": "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
      "commitRefs": [
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
      "command": "git log --oneline --all --grep='RPP-0947\\|RPP-0948\\|RPP-0949\\|RPP-0950' -12",
      "commitRefs": [
        "2f53dde24",
        "97cc7daab",
        "a0576fdd6"
      ],
      "purpose": "Linked the v3 lane context to recent support-only evidence slices; the command returned no RPP-0950-specific subject."
    },
    {
      "command": "git show -s --format='%H%x09%s' 675b362f5 9f278e4d9 1faf54e5e ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 2f53dde24 97cc7daab a0576fdd6",
      "commitRefs": [
        "675b362f5",
        "9f278e4d9",
        "1faf54e5e",
        "ccac5bbeb",
        "29d058579",
        "54f6b6b3c",
        "e627a9717",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6",
        "12f684cd3",
        "2f53dde24",
        "97cc7daab",
        "a0576fdd6"
      ],
      "purpose": "Verified exact commit subjects for every anchor named by the audit."
    }
  ],
  "validationCommandCommitLinks": [
    {
      "command": "node --check test/rpp-0951-rollback-repair-runbook-v3.test.js",
      "commitRefs": [
        "675b362f5",
        "ccac5bbeb"
      ],
      "purpose": "Syntax-checks the focused RPP-0951 test against the updated lane head and RPP-0931 pattern."
    },
    {
      "command": "node --test --test-name-pattern RPP-0951 test/rpp-0951-rollback-repair-runbook-v3.test.js",
      "commitRefs": [
        "675b362f5",
        "ccac5bbeb",
        "29d058579",
        "54f6b6b3c",
        "12f684cd3",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6"
      ],
      "purpose": "Validates the v3 support-only runbook controls, prerequisites, repair stop conditions, and recovery-state anchors."
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0951-rollback-repair-runbook-v3.md",
      "commitRefs": [
        "675b362f5",
        "ccac5bbeb",
        "e627a9717"
      ],
      "purpose": "Proves the changed evidence artifact remains redacted while preserving the historical audit-export anchor."
    },
    {
      "command": "git diff --check",
      "commitRefs": [
        "675b362f5"
      ],
      "purpose": "Confirms the support-only diff is whitespace-clean against the audited lane head."
    }
  ],
  "evidenceLimits": {
    "mode": "rollback-repair-support-only-v3",
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

## Exact Audit Commands

The audit trail for this variant uses these exact local commands:

```bash
git show -s --format='%h%x09%H%x09%s' HEAD
git log --oneline --decorate -12
git log --oneline --all --grep='rollback\|repair\|recovery' -20
git log --oneline --all --grep='RPP-0947\|RPP-0948\|RPP-0949\|RPP-0950' -12
git show -s --format='%H%x09%s' 675b362f5 9f278e4d9 1faf54e5e ccac5bbeb 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 2f53dde24 97cc7daab a0576fdd6
```

The command output anchors this support document to the following commits:

| Commit | Subject | Audit use |
| --- | --- | --- |
| `675b362f5` | Merge published progress page state | Current lane head observed before the RPP-0951 update. |
| `9f278e4d9` | docs: publish progress page | Observed origin main reference during the audit. |
| `1faf54e5e` | docs: refresh progress for RPP-0946 integration | Most recent integrated progress context before this support-only evidence. |
| `ccac5bbeb` | Add RPP-0931 rollback repair runbook v2 evidence | Pattern rollback repair runbook v2 evidence used for variant 3 support evidence. |
| `29d058579` | Add RPP-0911 rollback repair runbook | Original rollback repair runbook evidence retained through the RPP-0931 pattern. |
| `54f6b6b3c` | Add RPP-0904 operator safe recovery docs | Existing recovery operator contract retained by the runbook pattern. |
| `e627a9717` | Add RPP-0700 manual recovery audit export release proof | Historical manual recovery audit-export anchor. |
| `bced8d1ae` | Add RPP-0691 new-remote recovery release proof | Historical fully updated remote classification anchor. |
| `3b0d2c873` | Add RPP-0692 blocked recovery release proof | Historical blocked recovery classification anchor. |
| `d3c23e7e6` | Add RPP-0693 unknown-drift recovery release proof | Historical drift classification anchor. |
| `12f684cd3` | Add RPP-0690 old-remote recovery release proof | Historical old remote classification anchor. |
| `2f53dde24` | docs: add RPP-0949 operator runbook v3 evidence | Recent support-only evidence located by the v3 audit command. |
| `97cc7daab` | Add RPP-0948 privacy redaction review v3 | Recent support-only evidence located by the v3 audit command. |
| `a0576fdd6` | Add RPP-0947 security review checklist evidence | Recent support-only evidence located by the v3 audit command. |

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
node --check test/rpp-0951-rollback-repair-runbook-v3.test.js
node --test --test-name-pattern RPP-0951 test/rpp-0951-rollback-repair-runbook-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0951-rollback-repair-runbook-v3.md
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
