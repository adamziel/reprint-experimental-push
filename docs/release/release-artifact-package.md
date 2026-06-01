# Reprint Push Release Artifact Package Manifest

Variant: RPP-0914 release artifact package variant 1
Status: support-only package manifest
Final release: `NO-GO`

This manifest defines the support package an operator may use for Reprint Push
recovery review. It is not release approval, does not move release gates, does
not authorize production apply, and does not include production secret material.
Every artifact in the package must remain hash/count/metadata-only unless a
separate production-backed gate explicitly approves a different artifact class.

The safe recovery contract remains the one documented in
[Operator Runbook](../operations/operator-runbook.md),
[Operator Safe Recovery](../recovery/operator-safe-recovery.md),
[Apply Journal Recovery States](../recovery/apply-journal.md), and
[Acceptable Post-Failure States](../recovery/acceptable-states.md).

## Package Manifest

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0914",
  "packageId": "rpp-0914-release-artifact-package-v1",
  "variant": 1,
  "status": "support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "releaseGateMovement": "none",
  "remoteTunnelsUsed": false,
  "dashboardsStarted": false,
  "safeRecoveryContract": {
    "noHiddenAssumptions": true,
    "normalValidatedApplyOnly": true,
    "sameRunEnvelopeRequired": true,
    "sameRecoveryPathRequired": true,
    "statusCodeOnlyClassificationAllowed": false,
    "missingEvidenceAction": "stop-preserve-artifacts-review",
    "unknownStateAction": "blocked-recovery",
    "manualProductionRepairAuthorized": false,
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
    {
      "path": "docs/release/release-artifact-package.md",
      "purpose": "support package manifest and safe recovery contract",
      "contains": "hash-count-metadata-only package inventory",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/evidence/rpp-0914-release-artifact-package.md",
      "purpose": "slice evidence for package completeness and NO-GO posture",
      "contains": "support-only evidence record",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/operations/operator-runbook.md",
      "purpose": "operator prerequisites, evidence capture, and stop conditions",
      "contains": "support-only procedural guidance",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/recovery/operator-safe-recovery.md",
      "purpose": "safe recovery classification and blocked recovery rules",
      "contains": "support-only recovery guidance",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/recovery/apply-journal.md",
      "purpose": "journal evidence and restart-readable recovery context",
      "contains": "support-only journal contract",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/recovery/acceptable-states.md",
      "purpose": "allowed post-failure state names and unsafe states",
      "contains": "support-only recovery state contract",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/evidence/rpp-0904-operator-safe-recovery-audit.md",
      "purpose": "prior safe recovery documentation evidence",
      "contains": "support-only audit record",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    },
    {
      "path": "docs/evidence/rpp-0909-operator-runbook.md",
      "purpose": "prior operator runbook evidence",
      "contains": "support-only runbook evidence",
      "productionSecretMaterial": false,
      "productionBackedEvidence": false
    }
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
  "validation": [
    "node --check test/rpp-0914-release-artifact-package.test.js",
    "node --test --test-name-pattern RPP-0914 test/rpp-0914-release-artifact-package.test.js",
    "node scripts/release/artifact-redaction-scan.mjs docs/release/release-artifact-package.md docs/evidence/rpp-0914-release-artifact-package.md",
    "git diff --check"
  ]
}
```

## Safe Recovery Prerequisites

Support may use this package only when the same run envelope has explicit
evidence for release gate approval, source and target identity hashes, plan hash
and receipt identifier, clean dry-run status, current precondition hashes,
single-writer lease ownership, restart-readable journal reference, idempotency
key and request body hashes, a backup or snapshot reference hash, named
operator/reviewer/recovery owner roles, redaction scan pass, and local-only
network posture.

Missing evidence is not a detail to reconstruct later. Missing evidence means
stop, preserve the artifacts already captured, and record `blocked-recovery` or
the more specific stop reason.

## Included Artifacts

The included artifacts are the manifest, this slice evidence, the operator
runbook, recovery-state documentation, journal documentation, and the supporting
RPP-0904 and RPP-0909 evidence records. They are documentation and support
evidence only. They do not contain live production payloads and do not prove a
production-backed release gate.

Any package handoff must preserve artifact paths, package identifier, run
envelope identifiers, and validation results. Do not replace a listed artifact
with a screen capture, chat summary, or memory of a run.

## Excluded Production Secrets

Production credentials, application password values, authorization headers,
cookies, session identifiers, raw database rows, raw option values, raw post
content, file bytes, private paths, live service configuration, backup contents,
customer data, and private notes are excluded from this package. If any such
material is needed to continue, stop and request a separate approved handling
path. Do not add it to this package.

## Stop Conditions

Stop before retry, finalization, cleanup, or escalation when release approval is
missing or for a different run, identities are ambiguous, the dry-run or
preconditions are stale, counts or hashes do not match the run envelope, the
lease or journal cannot prove ownership, observed hashes cannot be explained by
journaled before or after hashes, terminal evidence is missing, replay would
create fresh mutations, manual production edits would be needed, redaction
fails, a remote tunnel or unapproved ingress would be required, the state is
`blocked-recovery`, or any hidden-assumption answer is unknown.

Do not infer safety from a successful status code, a visible page state, a
single operator memory, or an artifact name. The evidence must answer the
question directly, and the recovery action must use the same checked path and
the same run envelope.

## Release Posture

This package is support-only. It does not establish production durability,
production rollback, production repair, live source access, customer-safe
rollout, or release readiness. Final release remains `NO-GO`, with no
release-gate status movement.
