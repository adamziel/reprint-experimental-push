# RPP-0914 Release Artifact Package Evidence Variant 1

Date: 2026-06-01
Issue: RPP-0914
Lane: Reprint Push evidence

## Scope

This slice adds a support-only release artifact package manifest at
`docs/release/release-artifact-package.md`. The package explains safe recovery
prerequisites, included artifacts, excluded production secrets, and stop
conditions without relying on unstated operator assumptions.

The artifact does not update checklist, progress-page, release-gate, or status
surfaces. It does not start dashboards, invoke remote tunnels, approve
production repair, include production secret material, or convert support
documentation into production-backed release evidence. Final release remains
`NO-GO`.

## Evidence Record

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0914",
  "proofId": "rpp-0914-release-artifact-package-v1",
  "variant": 1,
  "title": "Support-only release artifact package manifest for safe recovery review",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "documents": {
    "packageManifest": "docs/release/release-artifact-package.md",
    "evidence": "docs/evidence/rpp-0914-release-artifact-package.md",
    "operatorRunbook": "docs/operations/operator-runbook.md",
    "operatorSafeRecovery": "docs/recovery/operator-safe-recovery.md",
    "applyJournal": "docs/recovery/apply-journal.md",
    "acceptableStates": "docs/recovery/acceptable-states.md",
    "safeRecoveryEvidence": "docs/evidence/rpp-0904-operator-safe-recovery-audit.md",
    "operatorRunbookEvidence": "docs/evidence/rpp-0909-operator-runbook.md"
  },
  "packageContract": {
    "noHiddenAssumptions": true,
    "supportOnly": true,
    "normalValidatedApplyOnly": true,
    "sameRunEnvelopeRequired": true,
    "sameRecoveryPathRequired": true,
    "statusCodeOnlyClassificationAllowed": false,
    "missingEvidenceAction": "stop-preserve-artifacts-review",
    "unknownStateAction": "blocked-recovery",
    "manualProductionRepairAuthorized": false,
    "releaseGateMovement": "none",
    "dashboardsStarted": false,
    "remoteTunnelsUsed": false,
    "acceptableStates": [
      "old-remote",
      "fully-updated-remote",
      "blocked-recovery"
    ]
  },
  "prerequisites": [
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
  "includedArtifacts": [
    "docs/release/release-artifact-package.md",
    "docs/evidence/rpp-0914-release-artifact-package.md",
    "docs/operations/operator-runbook.md",
    "docs/recovery/operator-safe-recovery.md",
    "docs/recovery/apply-journal.md",
    "docs/recovery/acceptable-states.md",
    "docs/evidence/rpp-0904-operator-safe-recovery-audit.md",
    "docs/evidence/rpp-0909-operator-runbook.md"
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
  "stopConditions": [
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
    "hidden-assumption-answer-missing"
  ],
  "redactionPosture": {
    "mode": "hash-count-metadata-only",
    "rawValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "cookiesIncluded": false,
    "privatePathsIncluded": false,
    "liveServiceConfigurationIncluded": false,
    "productionSecretMaterialIncluded": false
  },
  "releasePosture": {
    "finalReleaseStatus": "NO-GO",
    "integrationRecommendation": "NO-GO",
    "releaseMovementAllowed": false,
    "productionBackedEvidenceAdded": false
  },
  "validation": [
    "node --check test/rpp-0914-release-artifact-package.test.js",
    "node --test --test-name-pattern RPP-0914 test/rpp-0914-release-artifact-package.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/release/release-artifact-package.md docs/evidence/rpp-0914-release-artifact-package.md",
    "git diff --check"
  ]
}
```

## Safe Recovery Prerequisites

The package is complete enough for support review only when it records the
same run envelope for approval, identities, plan, receipt, dry-run,
precondition hashes, lease, journal, idempotency hashes, backup reference,
named operator roles, redaction scan, and local-only network posture. Missing
or stale evidence is a stop condition, not an assumption to fill in later.

## Included Artifacts

The package includes the RPP-0914 manifest and evidence, the operator runbook,
safe recovery documentation, apply journal documentation, acceptable-state
documentation, and the RPP-0904/RPP-0909 support evidence that established the
operator recovery guidance. Included artifacts remain documentation and
support evidence, not production-backed release evidence.

## Excluded Production Secrets

The package excludes production credentials, application password values,
authorization headers, cookies, session identifiers, raw database rows, raw
option or post content, file bytes, private paths, live service configuration,
backup contents, customer data, and private notes. If recovery needs any of
that material, the package is insufficient and the operator must stop for a
separate approved handling path.

## Stop Conditions

Stop when approval is missing or not bound to the run, identities are
ambiguous, dry-run or preconditions are stale, hashes or counts do not match,
lease or journal ownership is unproven, observed hashes cannot be explained,
terminal evidence is missing, same-key replay would create fresh mutations,
manual production edits would be required, redaction fails, unapproved ingress
would be required, recovery is blocked or unknown, or a hidden-assumption
answer is missing.

## Validation

Focused validation for this slice:

```bash
node --check test/rpp-0914-release-artifact-package.test.js
node --test --test-name-pattern RPP-0914 test/rpp-0914-release-artifact-package.test.js
node scripts/release/artifact-redaction-scan.mjs docs/release/release-artifact-package.md docs/evidence/rpp-0914-release-artifact-package.md
git diff --check
```

## Release Posture

This is support-only packaging evidence. It does not prove production
durability, production rollback, production repair, live topology, credentials,
customer-safe rollout, or release approval. Final release remains `NO-GO`, and
no release-gate status movement is allowed.
