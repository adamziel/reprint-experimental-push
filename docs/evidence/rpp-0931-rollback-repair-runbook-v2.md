# RPP-0931 rollback repair runbook v2 evidence

Date: 2026-06-01
Variant: 2
Audited local branch: `session/rpp-931`
Audited lane head before this evidence file: `b92b0ee5cf55b3774f0bf2e3d24f6104f0b9250f`
Scope: rollback and repair operations support evidence only

This evidence records rollback and repair controls for runbook variant 2. It
uses the RPP-0911 rollback repair runbook as the pattern, updates the audited
lane head, links exact audit and validation commands to commit anchors, names
repair stop conditions, and keeps final release at **NO-GO**. It adds no
production-backed proof and makes no release-gate status movement.

## Machine-readable record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0931",
  "proofId": "rpp-0931-rollback-repair-runbook-v2",
  "variant": 2,
  "generatedAt": "2026-06-01T02:30:00.000Z",
  "status": "rollback-repair-runbook-v2-recorded",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "successCriterion": "audit file links exact commands and commits",
  "auditRecordPath": "docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
  "patternRecordPath": "docs/evidence/rpp-0911-rollback-repair-runbook.md",
  "auditedLane": {
    "branch": "session/rpp-931",
    "headBeforeEvidence": "b92b0ee5cf55b3774f0bf2e3d24f6104f0b9250f",
    "headShortSha": "b92b0ee5c",
    "headSubject": "Merge published progress page state",
    "originMainAtAudit": "a52aaa7ee978ed3a492ecbcf5d35b328dfe3ef68",
    "originMainShortSha": "a52aaa7ee",
    "originMainSubject": "docs: publish progress page"
  },
  "documents": {
    "evidence": "docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
    "patternEvidence": "docs/evidence/rpp-0911-rollback-repair-runbook.md",
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
  "releaseGateSnapshot": {
    "command": "node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:30:00.000Z",
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
    "git log --oneline --all --grep='RPP-0927\\|RPP-0928\\|RPP-0929\\|RPP-0930' -12",
    "git show -s --format='%H%x09%s' b92b0ee5c a52aaa7ee fe2e55a40 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 165188673 55f2eeb7f edfafde8a"
  ],
  "validationCommands": [
    "node --check test/rpp-0931-rollback-repair-runbook-v2.test.js",
    "node --test --test-name-pattern RPP-0931 test/rpp-0931-rollback-repair-runbook-v2.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
    "git diff --check"
  ],
  "relevantCurrentCommits": [
    {
      "name": "audited-lane-head-before-rpp-0931",
      "sha": "b92b0ee5cf55b3774f0bf2e3d24f6104f0b9250f",
      "shortSha": "b92b0ee5c",
      "subject": "Merge published progress page state",
      "reason": "Current lane head observed before the RPP-0931 support-only update."
    },
    {
      "name": "origin-main-observed",
      "sha": "a52aaa7ee978ed3a492ecbcf5d35b328dfe3ef68",
      "shortSha": "a52aaa7ee",
      "subject": "docs: publish progress page",
      "reason": "Observed origin/main and origin/HEAD reference during the audit."
    },
    {
      "name": "rpp-0926-progress-integration",
      "sha": "fe2e55a407cbbd9d45a5790770cd3a2918537d78",
      "shortSha": "fe2e55a40",
      "subject": "docs: refresh progress for RPP-0926 integration",
      "reason": "Most recent integrated progress context before this support-only evidence."
    },
    {
      "name": "rpp-0911-pattern-runbook",
      "sha": "29d058579b38e315bf76667deff3a7a550f5c1c2",
      "shortSha": "29d058579",
      "subject": "Add RPP-0911 rollback repair runbook",
      "reason": "Pattern rollback repair runbook used for variant 2 support evidence."
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
      "name": "rpp-0928-privacy-redaction-review-v2",
      "sha": "16518867338479b49a8fdaadc8d1bf3b77a5af45",
      "shortSha": "165188673",
      "subject": "Add RPP-0928 privacy redaction review v2",
      "reason": "Recent support-only evidence located by the updated RPP-0927 through RPP-0930 audit command."
    },
    {
      "name": "rpp-0929-operator-runbook-v2",
      "sha": "55f2eeb7f928ddb43f7f54916ef9c1d51678548b",
      "shortSha": "55f2eeb7f",
      "subject": "docs: add RPP-0929 operator runbook v2 evidence",
      "reason": "Recent operator runbook evidence located by the updated RPP-0927 through RPP-0930 audit command."
    },
    {
      "name": "rpp-0927-security-review-checklist-v2",
      "sha": "edfafde8ae19388cc198082a4c11bafd5ef25acb",
      "shortSha": "edfafde8a",
      "subject": "Add RPP-0927 security review checklist v2 evidence",
      "reason": "Recent support-only evidence located by the updated RPP-0927 through RPP-0930 audit command."
    }
  ],
  "commandCommitLinks": [
    {
      "command": "git show -s --format='%h%x09%H%x09%s' HEAD",
      "commitRefs": [
        "b92b0ee5c"
      ],
      "purpose": "Established the current audited lane head before adding RPP-0931 support evidence."
    },
    {
      "command": "git log --oneline --decorate -12",
      "commitRefs": [
        "b92b0ee5c",
        "a52aaa7ee",
        "fe2e55a40"
      ],
      "purpose": "Established current branch, origin main, and recent lane integration context."
    },
    {
      "command": "git log --oneline --all --grep='rollback\\|repair\\|recovery' -20",
      "commitRefs": [
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
      "command": "git log --oneline --all --grep='RPP-0927\\|RPP-0928\\|RPP-0929\\|RPP-0930' -12",
      "commitRefs": [
        "165188673",
        "55f2eeb7f",
        "edfafde8a"
      ],
      "purpose": "Linked the updated v2 lane context to the most recent support-only evidence slices."
    },
    {
      "command": "git show -s --format='%H%x09%s' b92b0ee5c a52aaa7ee fe2e55a40 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 165188673 55f2eeb7f edfafde8a",
      "commitRefs": [
        "b92b0ee5c",
        "a52aaa7ee",
        "fe2e55a40",
        "29d058579",
        "54f6b6b3c",
        "e627a9717",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6",
        "12f684cd3",
        "165188673",
        "55f2eeb7f",
        "edfafde8a"
      ],
      "purpose": "Verified exact commit subjects for every anchor named by the audit."
    }
  ],
  "validationCommandCommitLinks": [
    {
      "command": "node --check test/rpp-0931-rollback-repair-runbook-v2.test.js",
      "commitRefs": [
        "b92b0ee5c",
        "29d058579"
      ],
      "purpose": "Syntax-checks the focused RPP-0931 test against the updated lane head and RPP-0911 pattern."
    },
    {
      "command": "node --test --test-name-pattern RPP-0931 test/rpp-0931-rollback-repair-runbook-v2.test.js",
      "commitRefs": [
        "b92b0ee5c",
        "29d058579",
        "54f6b6b3c",
        "12f684cd3",
        "bced8d1ae",
        "3b0d2c873",
        "d3c23e7e6"
      ],
      "purpose": "Validates the v2 support-only runbook controls, repair stop conditions, and recovery-state anchors."
    },
    {
      "command": "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0931-rollback-repair-runbook-v2.md",
      "commitRefs": [
        "b92b0ee5c",
        "29d058579",
        "e627a9717"
      ],
      "purpose": "Proves the changed evidence artifact remains redacted while preserving the historical audit-export anchor."
    },
    {
      "command": "git diff --check",
      "commitRefs": [
        "b92b0ee5c"
      ],
      "purpose": "Confirms the support-only diff is whitespace-clean against the audited lane head."
    }
  ],
  "evidenceLimits": {
    "mode": "rollback-repair-support-only-v2",
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
git log --oneline --all --grep='RPP-0927\|RPP-0928\|RPP-0929\|RPP-0930' -12
git show -s --format='%H%x09%s' b92b0ee5c a52aaa7ee fe2e55a40 29d058579 54f6b6b3c e627a9717 bced8d1ae 3b0d2c873 d3c23e7e6 12f684cd3 165188673 55f2eeb7f edfafde8a
```

The command output anchors this support document to the following commits:

| Commit | Subject | Audit use |
| --- | --- | --- |
| `b92b0ee5c` | Merge published progress page state | Current lane head observed before the RPP-0931 update. |
| `a52aaa7ee` | docs: publish progress page | Observed origin main reference during the audit. |
| `fe2e55a40` | docs: refresh progress for RPP-0926 integration | Most recent integrated progress context before this support-only evidence. |
| `29d058579` | Add RPP-0911 rollback repair runbook | Pattern rollback repair runbook used for variant 2 support evidence. |
| `54f6b6b3c` | Add RPP-0904 operator safe recovery docs | Existing recovery operator contract retained by the runbook pattern. |
| `e627a9717` | Add RPP-0700 manual recovery audit export release proof | Historical manual recovery audit-export anchor. |
| `bced8d1ae` | Add RPP-0691 new-remote recovery release proof | Historical fully updated remote classification anchor. |
| `3b0d2c873` | Add RPP-0692 blocked recovery release proof | Historical blocked recovery classification anchor. |
| `d3c23e7e6` | Add RPP-0693 unknown-drift recovery release proof | Historical drift classification anchor. |
| `12f684cd3` | Add RPP-0690 old-remote recovery release proof | Historical old remote classification anchor. |
| `165188673` | Add RPP-0928 privacy redaction review v2 | Recent support-only evidence located by the updated v2 audit command. |
| `55f2eeb7f` | docs: add RPP-0929 operator runbook v2 evidence | Recent operator runbook evidence located by the updated v2 audit command. |
| `edfafde8a` | Add RPP-0927 security review checklist v2 evidence | Recent support-only evidence located by the updated v2 audit command. |

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
node --check test/rpp-0931-rollback-repair-runbook-v2.test.js
node --test --test-name-pattern RPP-0931 test/rpp-0931-rollback-repair-runbook-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0931-rollback-repair-runbook-v2.md
git diff --check
```

Each validation command is linked to commit anchors in
`validationCommandCommitLinks` above.

## Release Posture

This is support-only operations evidence. It does not prove production
rollback, production repair, production durability, live source access, or
release readiness. The final release verdict remains **NO-GO**.

Integration recommendation: **NO-GO**.
