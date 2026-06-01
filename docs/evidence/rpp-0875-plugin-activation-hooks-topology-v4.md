# RPP-0875 Plugin Activation Hooks Topology Variant 4

Date: 2026-06-01

## Scope

RPP-0875 records a fourth activation-hook topology proof using the same
candidate-scope pattern as RPP-0855. This is deterministic local support-only
evidence. It records activation-hook surfaces, dependency and side-effect
boundaries, existing guardrails, and the release-ready gaps that still block
production movement.

This artifact does not update checklist, progress-page, or release-gate
surfaces. It is intended to tell the integrator exactly what is candidate
evidence versus what must still be proven before release movement.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0875",
  "variant": 4,
  "title": "Plugin activation hooks topology candidate scope variant 4",
  "status": "passed-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "integrationRecommendation": "NO-GO",
  "progressReport": {
    "recordsCandidateVersusReleaseReadyScope": true,
    "candidateLabel": "candidate",
    "releaseReadyLabel": "release-ready",
    "percentMovement": "none",
    "finalReleaseReadinessMovement": "none"
  },
  "candidateScope": {
    "status": "activation-hook-topology-candidate-v4",
    "sourcePattern": "rpp-0855-candidate-scope",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "productionMovementRecorded": false,
    "rawActivationHookValuesIncluded": false,
    "candidateClaims": [
      "activation-hook-surfaces-recorded",
      "dependency-boundary-linked",
      "direct-active-plugins-refusal-linked",
      "unproven-side-effects-blocked",
      "driver-proofed-side-effects-quarantined-as-support-only",
      "release-ready-gaps-recorded"
    ],
    "excludedFromCandidate": [
      "production-bound-wordpress-activate-plugin-run",
      "plugin-main-file-register-activation-hook-entrypoint-audit",
      "dynamic-activation-hook-side-effect-inventory",
      "multisite-network-activation-proof",
      "deactivation-uninstall-hook-separation-proof",
      "rewrite-flush-cron-custom-table-migration-production-proof",
      "durable-journal-and-recovery-inspect-production-run"
    ]
  },
  "activationHookSurfaces": {
    "format": "surface-count-hash-only",
    "rawValuesIncluded": false,
    "surfaceCount": 7,
    "surfaces": [
      {
        "surface": "wordpress-plugin-api-activation",
        "status": "required-not-observed",
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "surface": "register-activation-hook-entrypoint",
        "status": "required-not-audited",
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "surface": "plugin-state-resource",
        "resourceKey": "plugin:rpp-0489-activation-dependent",
        "status": "dependency-preflighted-candidate",
        "sourceRpp": "RPP-0489",
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "surface": "direct-active-plugins-row",
        "resourceKey": "row:[\"wp_options\",\"option_name:active_plugins\"]",
        "requiredDriver": "plugin-activation-driver",
        "status": "refused-before-mutation",
        "sourceRpp": "RPP-0492",
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "surface": "plugin-owned-activation-data-row",
        "resourceKey": "row:[\"wp_options\",\"option_name:rpp_0489_activation_data\"]",
        "driver": "wp-option",
        "status": "hash-only-support",
        "sourceRpp": "RPP-0489",
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "surface": "activation-hook-side-effect-row",
        "resourceKey": "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]",
        "driver": "wp-option",
        "status": "blocked-or-quarantined-support-only",
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "surface": "release-state-driver-row",
        "resourceKey": "row:[\"wp_reprint_push_release_state\",\"state_id:1\"]",
        "driver": "reprint-push-release-state",
        "status": "control-boundary-only",
        "productionBacked": false,
        "releaseEligible": false
      }
    ],
    "surfaceHash": "sha256:6f18962a0232424c013c7da193229103f9fc46e386fbb3bcd93e11eacbc4569f"
  },
  "dependencyAndSideEffectBoundaries": {
    "dependencyBoundary": {
      "rppIds": [
        "RPP-0449",
        "RPP-0489"
      ],
      "evidenceScope": "local-plugin-driver-support",
      "status": "support_only",
      "verdict": "PLUGIN_ACTIVATION_DEPENDENCY_REMOTE_DRIFT_PRESERVED",
      "productionBacked": false,
      "releaseEligible": false,
      "releaseGate": "NO-GO",
      "dependencyPluginResourceKey": "plugin:rpp-0489-activation-dependency",
      "dependentPluginResourceKey": "plugin:rpp-0489-activation-dependent",
      "pluginOwnedDataResourceKey": "row:[\"wp_options\",\"option_name:rpp_0489_activation_data\"]",
      "atomicGroupKind": "plugin-activation",
      "mutationCount": 2,
      "dependencyCount": 1,
      "dependencyRequirementSource": "live-remote",
      "dependencyRequirementHash": "sha256:42bffb3044e5e1451704516f274d3c53d52ab303ad356881fc0db173c8d9a112",
      "staleDependencyPreMutationRefused": true,
      "staleDependencyCode": "ATOMIC_GROUP_DEPENDENCY_STALE",
      "dependencyPluginPreserved": true,
      "dependentPluginPreserved": true,
      "targetUnchanged": true,
      "proofHash": "sha256:afc11dbad4b10764bda84197a7fa013cf12148fa679ef8f20f938025a5f745e0"
    },
    "sideEffectBoundary": {
      "evidenceScope": "production-shaped-local-boundary-summary",
      "productionBacked": false,
      "releaseEligible": false,
      "resourceKey": "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]",
      "cleanBoundary": {
        "status": "checked",
        "verdict": "LIVE_PLUGIN_DRIVER_BOUNDARY_OK",
        "noActivationHookSideEffectMutation": true,
        "activationHookStatus": "clear",
        "releaseEligible": true
      },
      "unproven": {
        "status": "blocked",
        "verdict": "ACTIVATION_HOOK_SIDE_EFFECT_DRIVER_PROOF_REQUIRED",
        "supportOnly": false,
        "releaseEligible": false,
        "resourceCount": 1,
        "resourceKeys": [
          "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]"
        ]
      },
      "driverProofed": {
        "status": "quarantined",
        "verdict": "ACTIVATION_HOOK_SIDE_EFFECT_SUPPORT_ONLY",
        "supportOnly": true,
        "releaseEligible": false,
        "resourceCount": 1,
        "resourceKeys": [
          "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]"
        ],
        "explicitDriverProof": true,
        "driverEvidenceSupported": true
      }
    }
  },
  "existingActivationHookGuardrails": {
    "evidenceScope": "local-support-only",
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGate": "NO-GO",
    "guardrailCount": 5,
    "guardrails": [
      {
        "guardrail": "activation-dependency-preflight",
        "sourceRpp": "RPP-0489",
        "status": "support_only",
        "verdict": "PLUGIN_ACTIVATION_DEPENDENCY_REMOTE_DRIFT_PRESERVED",
        "releaseGate": "NO-GO",
        "staleDependencyPreMutationRefused": true,
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "guardrail": "direct-active-plugins-mutation-refusal",
        "sourceRpp": "RPP-0492",
        "status": "support_only",
        "verdict": "DIRECT_ACTIVE_PLUGINS_MUTATION_REFUSAL_CARRIED",
        "releaseGate": "NO-GO",
        "resourceKey": "row:[\"wp_options\",\"option_name:active_plugins\"]",
        "requiredDriver": "plugin-activation-driver",
        "supportedVariants": 1,
        "unsupportedVariants": 2,
        "failClosedUnsupportedVariants": 2,
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "guardrail": "plugin-driver-active-plugins-direct-mutation-rejection",
        "sourceRpp": "production-shaped-proof",
        "status": "blocked",
        "verdict": "PRODUCTION_PLUGIN_DRIVER_BOUNDARY_REQUIRED",
        "resourceKeys": [
          "row:[\"wp_options\",\"option_name:active_plugins\"]"
        ],
        "noActivePluginsDirectMutation": false,
        "releaseEligible": false
      },
      {
        "guardrail": "activation-hook-side-effect-driver-proof-required",
        "sourceRpp": "production-shaped-proof",
        "status": "blocked",
        "verdict": "ACTIVATION_HOOK_SIDE_EFFECT_DRIVER_PROOF_REQUIRED",
        "resourceKeys": [
          "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]"
        ],
        "productionBacked": false,
        "releaseEligible": false
      },
      {
        "guardrail": "driver-proofed-activation-hook-side-effect-quarantine",
        "sourceRpp": "production-shaped-proof",
        "status": "quarantined",
        "verdict": "ACTIVATION_HOOK_SIDE_EFFECT_SUPPORT_ONLY",
        "resourceKeys": [
          "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]"
        ],
        "supportOnly": true,
        "productionBacked": false,
        "releaseEligible": false
      }
    ],
    "guardrailHash": "sha256:a63fde97e2b59e9e6900b339068e28dfd869f692c8c7b4a22033796cb064dd7e"
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "productionMovement": {
      "candidatePercentMovement": "none",
      "releaseReadyPercentMovement": "none",
      "finalReleaseReadinessMovement": "none"
    },
    "requiredEvidence": [
      "production-bound-wordpress-activate-plugin-run",
      "plugin-main-file-register-activation-hook-entrypoint-audited",
      "activation-dependency-preflight-production-backed",
      "direct-active-plugins-refusal-production-backed",
      "activation-hook-side-effect-inventory-production-backed",
      "side-effect-driver-proofs-release-eligible",
      "apply-time-revalidation-covers-activation-side-effects",
      "durable-journal-and-recovery-inspect-cover-activation-side-effects",
      "network-activation-deactivation-uninstall-separation-proved",
      "artifact-redaction-scan-passes-for-release-report"
    ],
    "blockers": [
      "no-production-bound-activation-run",
      "register-activation-hook-entrypoint-not-audited",
      "activation-hook-side-effect-inventory-missing",
      "driver-proofed-side-effects-are-support-only",
      "dependency-and-active-plugins-guardrails-not-production-backed",
      "network-activation-and-uninstall-separation-unproven"
    ],
    "readyWhen": "all-required-evidence-passes-with-productionBacked-true-and-releaseEligible-true"
  },
  "redaction": {
    "format": "hash-count-surface-only",
    "rawActivationHookValuesIncluded": false,
    "urlValuesIncluded": false,
    "credentialMaterialIncluded": false,
    "scopeComparisonHashCovers": [
      "candidateScope",
      "releaseReadyScope",
      "activationHookSurfaces",
      "dependencyAndSideEffectBoundaries",
      "existingActivationHookGuardrails",
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "c546c1ef650eac741dc2598ff47057e1f5736f914d04fb533b142a4c12c9f6ce"
}
```

## Candidate Scope

The candidate covers local, deterministic support evidence only. It records the
activation surfaces that are visible to the current proof harness, links the
dependency preflight boundary, records direct `active_plugins` refusal, and
keeps activation-hook side effects either blocked or quarantined as support
evidence.

The candidate does not prove a production WordPress activation API run, does
not audit a plugin main file for activation-hook registration, and does not
inventory dynamic hook effects such as rewrite flushes, scheduled tasks,
custom-table migrations, network activation behavior, deactivation behavior, or
uninstall behavior.

## Release-Ready Scope

Release-ready movement still requires a production-bound activation run through
the WordPress plugin API, a plugin entrypoint audit, production-backed
dependency and direct activation-row guardrails, an inventory of hook side
effects with release-eligible driver proofs, apply-time revalidation, durable
journaling, and recovery inspection.

## Integration Recommendation

Record as candidate-only progress evidence. Do not move release readiness from
this variant. The current recommendation is `NO-GO` for production movement
until every release-ready gap above is closed with production-backed evidence.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0875-plugin-activation-hooks-topology-v4.test.js
node --test --test-name-pattern RPP-0875 test/rpp-0875-plugin-activation-hooks-topology-v4.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0875-plugin-activation-hooks-topology-v4.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0875-plugin-activation-hooks-topology-v4.test.js`
  exited `0`
- `node --test --test-name-pattern RPP-0875 test/rpp-0875-plugin-activation-hooks-topology-v4.test.js`
  exited `0`; 5 subtests passed
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0875-plugin-activation-hooks-topology-v4.md`
  exited `0`; returned `"ok": true`, 1 scanned file, 0 rejected files,
  and 5 allowed hash-evidence entries
- `git diff --check` exited `0`
