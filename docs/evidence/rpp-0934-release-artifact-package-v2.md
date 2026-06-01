# RPP-0934 Release Artifact Package Evidence Variant 2

Date: 2026-06-01
Issue: RPP-0934
Audited local branch: `session/rpp-934`
Audited lane head before this evidence file: `7f2f8e6a1058afab14eab82635427de8a48a8c87`
Write scope: support-only release artifact package v2 evidence and focused test.

## Scope

This slice records support-only evidence for the Reprint Push release artifact
package. It follows the RPP-0914 release artifact package evidence pattern and
updates the audited lane head for this v2 review.

The package remains a support artifact. It names the packaged artifacts,
operator recovery prerequisites, safe recovery evidence, stop conditions, and
hidden-assumption blockers that must be answered before packaging, publication,
finalization, or release movement. Missing or unknown evidence stops the action;
it is not filled in from operator memory, status codes, screenshots, or artifact
names.

This artifact does not update checklist, progress-page, release-gate, or status
surfaces. It does not start dashboards, use remote tunnels, approve production
repair, publish a release artifact, finalize a release, or convert support
documentation into production-backed release evidence. The verdict stays held
and final release remains `NO-GO`.

## Evidence Record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0934",
  "proofId": "rpp-0934-release-artifact-package-v2",
  "variant": 2,
  "title": "Support-only release artifact package v2 hidden-assumption audit",
  "checkedAt": "2026-06-01T02:35:00.000Z",
  "status": "held-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "auditedBranch": "session/rpp-934",
  "auditedLaneHeadBeforeEvidence": "7f2f8e6a1058afab14eab82635427de8a48a8c87",
  "auditedLaneHeadSubject": "Merge published progress page state",
  "successCriterion": "operator docs explain safe recovery without hidden assumptions",
  "documents": {
    "packageManifest": "docs/release/release-artifact-package.md",
    "patternEvidence": "docs/evidence/rpp-0914-release-artifact-package.md",
    "evidence": "docs/evidence/rpp-0934-release-artifact-package-v2.md",
    "operatorRunbook": "docs/operations/operator-runbook.md",
    "operatorRunbookV2Evidence": "docs/evidence/rpp-0929-operator-runbook-v2.md",
    "operatorSafeRecovery": "docs/recovery/operator-safe-recovery.md",
    "applyJournal": "docs/recovery/apply-journal.md",
    "acceptableStates": "docs/recovery/acceptable-states.md",
    "safeRecoveryEvidence": "docs/evidence/rpp-0904-operator-safe-recovery-audit.md",
    "operatorRunbookEvidence": "docs/evidence/rpp-0909-operator-runbook.md"
  },
  "packageContract": {
    "supportOnly": true,
    "noHiddenAssumptions": true,
    "verdictHeld": true,
    "normalValidatedApplyOnly": true,
    "sameRunEnvelopeRequired": true,
    "sameRecoveryPathRequired": true,
    "statusCodeOnlyClassificationAllowed": false,
    "missingEvidenceAction": "stop-preserve-artifacts-review",
    "unknownStateAction": "blocked-recovery",
    "manualProductionRepairAuthorized": false,
    "packagePublicationAllowed": false,
    "packageFinalizationAllowed": false,
    "releaseGateMovement": "none",
    "releaseMovementAllowed": false,
    "dashboardsStarted": false,
    "remoteTunnelsUsed": false,
    "acceptableStates": [
      "old-remote",
      "fully-updated-remote",
      "blocked-recovery"
    ]
  },
  "packagedArtifacts": [
    {
      "name": "release artifact package manifest",
      "path": "docs/release/release-artifact-package.md",
      "purpose": "support package manifest and safe recovery contract",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "RPP-0914 release artifact package pattern evidence",
      "path": "docs/evidence/rpp-0914-release-artifact-package.md",
      "purpose": "variant 1 evidence pattern for package completeness and NO-GO posture",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "RPP-0934 release artifact package v2 evidence",
      "path": "docs/evidence/rpp-0934-release-artifact-package-v2.md",
      "purpose": "variant 2 hidden-assumption blocker and held verdict record",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "operator runbook",
      "path": "docs/operations/operator-runbook.md",
      "purpose": "operator prerequisites, evidence capture, and stop conditions",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "operator runbook v2 evidence",
      "path": "docs/evidence/rpp-0929-operator-runbook-v2.md",
      "purpose": "recent support evidence proving runbook hidden-assumption checks",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "operator safe recovery guide",
      "path": "docs/recovery/operator-safe-recovery.md",
      "purpose": "safe recovery classification and blocked recovery rules",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "apply journal recovery states",
      "path": "docs/recovery/apply-journal.md",
      "purpose": "journal evidence and restart-readable recovery context",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "acceptable post-failure states",
      "path": "docs/recovery/acceptable-states.md",
      "purpose": "allowed post-failure state names and unsafe states",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "RPP-0904 operator safe recovery audit",
      "path": "docs/evidence/rpp-0904-operator-safe-recovery-audit.md",
      "purpose": "prior safe recovery documentation evidence",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    },
    {
      "name": "RPP-0909 operator runbook evidence",
      "path": "docs/evidence/rpp-0909-operator-runbook.md",
      "purpose": "prior operator runbook evidence",
      "supportOnly": true,
      "productionBackedEvidence": false,
      "productionSecretMaterial": false
    }
  ],
  "operatorRecoveryPrerequisites": [
    "release-gate-approval-bound-to-run",
    "source-target-identity-hashes",
    "immutable-plan-hash-and-receipt-id",
    "clean-dry-run-no-unresolved-conflicts",
    "current-precondition-hashes-for-all-targets",
    "single-writer-lease-owner-hash",
    "durable-restart-readable-journal-reference",
    "idempotency-key-hash-and-request-body-hash",
    "backup-or-snapshot-reference-hash",
    "named-operator-reviewer-recovery-owner",
    "artifact-redaction-scan-pass",
    "local-only-network-posture"
  ],
  "safeRecoveryEvidence": [
    {
      "name": "run envelope evidence",
      "requires": "run identifier, operator, reviewer, recovery owner, UTC timestamp, plan hash, receipt identifier, mutation count, and target count",
      "sameRunEnvelopeRequired": true,
      "stopIfMissing": true
    },
    {
      "name": "identity evidence",
      "requires": "source identity hash and target identity hash for the intended production pair",
      "sameRunEnvelopeRequired": true,
      "stopIfMissing": true
    },
    {
      "name": "pre-mutation safety evidence",
      "requires": "clean dry-run result, conflict count, precondition status, and current precondition hash set",
      "sameRunEnvelopeRequired": true,
      "stopIfMissing": true
    },
    {
      "name": "single-writer and journal evidence",
      "requires": "lease owner hash, lease claim timestamp, journal location hash, journal schema/version identifier, and restart-readable boundary records",
      "sameRunEnvelopeRequired": true,
      "stopIfMissing": true
    },
    {
      "name": "per-target recovery evidence",
      "requires": "per-target before hash, planned after hash, observed hash, and terminal completed, replayed, rejected, or blocked journal evidence",
      "sameRunEnvelopeRequired": true,
      "stopIfMissing": true
    },
    {
      "name": "same-request replay evidence",
      "requires": "idempotency key hash, request body hash, and replay result for the same request body",
      "sameRunEnvelopeRequired": true,
      "stopIfMissing": true
    },
    {
      "name": "redaction evidence",
      "requires": "artifact redaction result for every retained or shared evidence, doc, or audit artifact",
      "sameRunEnvelopeRequired": false,
      "stopIfMissing": true
    }
  ],
  "hiddenAssumptionBlockers": [
    {
      "phase": "before-packaging",
      "mustAnswer": [
        "Are every packaged artifact name and path explicitly listed?",
        "Does the audited lane head match the commit recorded before this evidence file?",
        "Did the package inherit the RPP-0914 prerequisites, exclusions, and support-only NO-GO posture?",
        "Did redaction pass for every changed evidence, doc, or audit artifact?"
      ],
      "unknownAnswerAction": "stop-preserve-artifacts-review"
    },
    {
      "phase": "before-publication",
      "mustAnswer": [
        "Is publication explicitly approved for support review only?",
        "Is the publication path local-only or otherwise approved without a remote tunnel?",
        "Are production secret material, raw payloads, private paths, and live service configuration excluded?",
        "Have checklist, progress, release-gate, and status surfaces remained unchanged?"
      ],
      "unknownAnswerAction": "stop-preserve-artifacts-review"
    },
    {
      "phase": "before-finalization",
      "mustAnswer": [
        "Does terminal evidence classify the recovery state as old-remote, fully-updated-remote, or blocked-recovery?",
        "Can every observed target hash be explained by the journaled before or after hash?",
        "Would same-key replay avoid fresh mutations for already completed work?",
        "Can finalization proceed without manual production edits, direct database changes, or artifact deletion?"
      ],
      "unknownAnswerAction": "blocked-recovery"
    },
    {
      "phase": "before-release-movement",
      "mustAnswer": [
        "Is there separate production-backed final release evidence for the exact run?",
        "Do release gates authorize movement outside this support-only package?",
        "Is final release still NO-GO when that evidence is absent?",
        "Will the operator avoid release-gate status movement from this slice?"
      ],
      "unknownAnswerAction": "hold-release-no-go"
    }
  ],
  "stopConditions": [
    "packaged-artifact-name-or-path-missing",
    "audited-lane-head-missing-or-stale",
    "operator-recovery-prerequisite-missing",
    "safe-recovery-evidence-missing",
    "release-gate-approval-missing-expired-or-different-run",
    "source-target-identity-ambiguous-or-unverified",
    "dry-run-conflicts-or-stale-preconditions",
    "current-precondition-hash-drift",
    "plan-receipt-target-or-mutation-count-mismatch",
    "single-writer-lease-missing-stale-unowned-or-contested",
    "journal-missing-uninspectable-unowned-nonmonotonic-or-not-restart-readable",
    "observed-hashes-not-explained-by-before-or-after-hashes",
    "terminal-evidence-missing-after-mutation-boundary",
    "same-key-replay-would-create-fresh-mutations",
    "manual-production-edit-or-direct-database-change-required",
    "artifact-redaction-scan-fails",
    "remote-tunnel-or-unapproved-ingress-required",
    "blocked-recovery-or-unknown-state",
    "publication-target-not-local-or-approved",
    "package-publication-requested-from-this-slice",
    "finalization-terminal-evidence-missing",
    "release-movement-requested-without-production-backed-gates",
    "hidden-assumption-answer-missing"
  ],
  "excludedMaterial": [
    "production-credentials",
    "application-password-values",
    "authorization-headers",
    "cookies-or-session-identifiers",
    "raw-database-rows",
    "raw-option-or-post-content",
    "file-bytes-or-private-paths",
    "live-service-configuration",
    "backup-contents",
    "customer-data-or-private-notes"
  ],
  "lifecycleGuards": [
    {
      "phase": "before-packaging",
      "action": "support package assembly",
      "requiredEvidence": [
        "packaged artifact names and paths",
        "operator recovery prerequisites",
        "safe recovery evidence list",
        "stop conditions",
        "audited lane head",
        "redaction scan result"
      ],
      "hiddenAssumptionAction": "stop-preserve-artifacts-review",
      "releaseMovementAllowed": false
    },
    {
      "phase": "before-publication",
      "action": "artifact publication or handoff",
      "requiredEvidence": [
        "support-only publication approval",
        "local-only network posture",
        "redaction scan result",
        "unchanged release-gate and status surfaces"
      ],
      "hiddenAssumptionAction": "stop-preserve-artifacts-review",
      "releaseMovementAllowed": false
    },
    {
      "phase": "before-finalization",
      "action": "recovery finalization",
      "requiredEvidence": [
        "terminal journal evidence",
        "acceptable recovery state classification",
        "same-run replay result",
        "no manual production repair requirement"
      ],
      "hiddenAssumptionAction": "blocked-recovery",
      "releaseMovementAllowed": false
    },
    {
      "phase": "before-release-movement",
      "action": "release movement",
      "requiredEvidence": [
        "separate production-backed final release evidence",
        "release gate approval outside this support package",
        "NO-GO retained when evidence is absent"
      ],
      "hiddenAssumptionAction": "hold-release-no-go",
      "releaseMovementAllowed": false
    }
  ],
  "releaseHold": {
    "noReleaseGateMovement": true,
    "releaseGateStatusMoved": false,
    "statusFilesChanged": false,
    "progressFilesChanged": false,
    "completionChecklistChanged": false,
    "productionRepairAuthorized": false,
    "packagePublished": false,
    "releaseFinalized": false,
    "finalReleaseRecommendation": "NO-GO",
    "integrationRecommendation": "NO-GO; integrate as support-only evidence without release-gate movement"
  },
  "redactionPosture": {
    "mode": "hash-count-metadata-only",
    "rawPayloadsIncluded": false,
    "credentialMaterialIncluded": false,
    "cookiesIncluded": false,
    "privatePathsIncluded": false,
    "liveServiceConfigurationIncluded": false,
    "productionSecretMaterialIncluded": false
  },
  "validation": [
    "node --check test/rpp-0934-release-artifact-package-v2.test.js",
    "node --test --test-name-pattern RPP-0934 test/rpp-0934-release-artifact-package-v2.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0934-release-artifact-package-v2.md",
    "git diff --check"
  ]
}
```

## Packaged Artifacts

The package names the release artifact package manifest, the RPP-0914 pattern
evidence, this RPP-0934 v2 evidence, the operator runbook, the RPP-0929
runbook v2 evidence, safe recovery documentation, apply journal documentation,
acceptable-state documentation, and the RPP-0904/RPP-0909 support evidence.
Every packaged artifact remains support-only and excludes production secret
material.

## Operator Recovery Prerequisites

Support packaging is only reviewable when the same run envelope records release
gate approval, source and target identity hashes, immutable plan hash and
receipt identifier, clean dry-run status, current precondition hashes,
single-writer lease ownership, restart-readable journal reference, idempotency
key and request body hashes, backup or snapshot reference hash, named operator
roles, artifact redaction pass, and local-only network posture.

## Safe Recovery Evidence

Safe recovery evidence must bind the run envelope, identities, dry-run,
preconditions, lease, journal, per-target hashes, terminal state, same-request
replay, and redaction result. If any item is missing, stale, uninspectable, or
from a different run, the operator must stop and preserve the captured
artifacts for review.

## Hidden-Assumption Blockers

Before packaging, the package must explicitly name every artifact and prove the
audited lane head, RPP-0914 pattern alignment, and redaction posture. Before
publication, it must prove support-only publication approval, local-only network
posture, excluded production material, and unchanged checklist/progress/status
surfaces. Before finalization, it must prove terminal recovery state, hash
explainability, non-mutating replay, and no manual production repair. Before
release movement, it must have separate production-backed final release
evidence. This slice provides no such release evidence, so release movement is
blocked.

## Stop Conditions

Stop before packaging, publication, finalization, or release movement when an
artifact name or path is missing, the audited lane head is stale, an operator
recovery prerequisite is missing, safe recovery evidence is missing, approval is
not bound to the run, identities are ambiguous, dry-run or precondition evidence
is stale, lease or journal ownership is unproven, observed hashes cannot be
explained, terminal evidence is missing, replay would create fresh mutations,
manual production repair would be needed, redaction fails, remote tunnel or
unapproved ingress is required, the state is unknown or blocked, publication is
requested from this slice, production-backed release gates are absent, or a
hidden-assumption answer is unknown.

## Validation

Focused validation for this slice:

```bash
node --check test/rpp-0934-release-artifact-package-v2.test.js
node --test --test-name-pattern RPP-0934 test/rpp-0934-release-artifact-package-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0934-release-artifact-package-v2.md
git diff --check
```

## Release Posture

This is support-only package evidence. It does not prove production durability,
production rollback, production repair, live topology, customer-safe rollout,
release publication, release finalization, or release approval. Final release
remains `NO-GO`, the verdict is held, and no release-gate status movement is
allowed.
