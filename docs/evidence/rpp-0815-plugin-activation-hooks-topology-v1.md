# RPP-0815 Plugin Activation Hooks Topology Variant 1

Date: 2026-06-01

## Scope

RPP-0815 records the plugin activation hook topology candidate shape against
the release-ready scope. This is support evidence only. It uses the existing
plugin activation dependency, direct `active_plugins` refusal, and activation
hook side-effect boundary signals to describe what the current candidate covers
and what remains required before any release-ready claim.

This variant does not update checklist or progress-page surfaces. It gives the
integrator a deterministic progress-report artifact for candidate versus
release-ready scope.

## Progress Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0815",
  "variant": 1,
  "title": "Plugin activation hooks topology candidate scope",
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
  "adjacentSupportEvidence": {
    "pluginActivationDependency": {
      "rppIds": [
        "RPP-0449",
        "RPP-0489"
      ],
      "evidenceScope": "local-plugin-driver-support",
      "productionBacked": false,
      "releaseEligible": false,
      "candidateSignal": "dependency-drift-refuses-before-activation"
    },
    "directActivePluginsMutationRefusal": {
      "rppIds": [
        "RPP-0472",
        "RPP-0492"
      ],
      "evidenceScope": "local-plugin-driver-support",
      "productionBacked": false,
      "releaseEligible": false,
      "candidateSignal": "direct-active-plugins-writes-refused-before-mutation"
    },
    "activationHookSideEffectBoundary": {
      "evidenceScope": "production-shaped-local-boundary-summary",
      "productionBacked": false,
      "releaseEligible": false,
      "unprovenStatus": "blocked",
      "unprovenVerdict": "ACTIVATION_HOOK_SIDE_EFFECT_DRIVER_PROOF_REQUIRED",
      "driverProofedStatus": "quarantined",
      "driverProofedVerdict": "ACTIVATION_HOOK_SIDE_EFFECT_SUPPORT_ONLY"
    }
  },
  "candidateScope": {
    "status": "activation-hook-topology-candidate",
    "supportOnly": true,
    "productionBacked": false,
    "releaseEligible": false,
    "releaseGateMovement": "none",
    "sourcePattern": "local-production-shaped-plugin-driver-boundary",
    "topologyShape": {
      "activationSurface": "plugin-activation-hooks",
      "pluginStateResourceKind": "plugin-metadata",
      "directActivePluginsResourceKey": "row:[\"wp_options\",\"option_name:active_plugins\"]",
      "directActivePluginsMutationAllowed": false,
      "activationHookSideEffectResourceKey": "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]",
      "activationHookSideEffectsAutoReleaseEligible": false,
      "driverProofedActivationHookEffectsQuarantined": true,
      "dependencyPreflightRequired": true,
      "dynamicHookExecutionObserved": false,
      "rawActivationHookValuesIncluded": false
    },
    "activationHookBoundarySignals": {
      "unprovenStatus": "blocked",
      "unprovenVerdict": "ACTIVATION_HOOK_SIDE_EFFECT_DRIVER_PROOF_REQUIRED",
      "unprovenResourceKeys": [
        "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]"
      ],
      "driverProofedStatus": "quarantined",
      "driverProofedVerdict": "ACTIVATION_HOOK_SIDE_EFFECT_SUPPORT_ONLY",
      "driverProofedSupportOnly": true,
      "driverProofedReleaseEligible": false,
      "driverProofedResourceKeys": [
        "row:[\"wp_options\",\"option_name:reprint_push_activation_hook_state\"]"
      ]
    },
    "candidateClaims": [
      "candidate-shape-recorded",
      "direct-active-plugins-refusal-linked",
      "activation-dependency-preflight-linked",
      "unproven-hook-effects-blocked",
      "driver-proofed-hook-effects-quarantined-as-support-only"
    ],
    "excludedFromCandidate": [
      "live-wordpress-activate-plugin-execution-proof",
      "register-activation-hook-entrypoint-static-audit",
      "production-bound-plugin-install-reactivation-proof",
      "dynamic-hook-side-effect-inventory",
      "multisite-network-activation-hook-proof",
      "deactivation-uninstall-hook-separation-proof",
      "rewrite-flush-cron-custom-table-migration-release-proof"
    ]
  },
  "releaseReadyScope": {
    "status": "not-release-ready",
    "requiredEvidence": [
      "production-bound-wordpress-plugin-activation-run",
      "plugin-main-file-register-activation-hook-entrypoint-audited",
      "activate-plugin-route-executes-hooks-through-wordpress-api",
      "direct-active-plugins-mutation-remains-refused",
      "activation-dependency-preflight-and-stale-drift-refusal-production-backed",
      "activation-hook-side-effects-inventoried-with-explicit-driver-proofs",
      "side-effect-drivers-survive-release-verifier-and-apply-revalidation",
      "deactivation-uninstall-rewrite-cron-and-custom-table-effects-separated",
      "durable-journal-and-recovery-inspect-cover-activation-side-effects",
      "artifact-redaction-scan-passes-for-release-reports"
    ],
    "blockers": [
      "no-accepted-production-bound-plugin-activation-run",
      "activation-hook-side-effect-proof-is-support-only",
      "driver-proofed-hook-effects-are-quarantined-not-release-eligible",
      "dynamic-hook-side-effect-inventory-missing",
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
      "integrationRecommendation"
    ]
  },
  "scopeComparisonHash": "0fe2c0b199e12a9852e77cd7baeba3e019a8fda8e37ab47aed5ab336555fa996"
}
```

## Candidate Scope

The candidate is limited to local support signals. It records that direct
`active_plugins` row mutation is still refused, activation dependencies must
pass preflight before activation, and activation-hook side effects are not
release eligible merely because a driver-shaped proof exists. Unproven hook
side effects stay blocked; driver-proofed hook effects are quarantined as
support-only.

The candidate does not prove a real WordPress `activate_plugin()` run, does not
audit a plugin main file for top-level activation hook registration, and does
not inventory dynamic hook side effects such as rewrite flushes, scheduled
events, custom table migrations, or option writes.

## Release-Ready Scope

Release-ready activation-hook topology evidence still requires a
production-bound WordPress activation run through the WordPress plugin API,
with the plugin main file audited for activation hook registration. The release
report must prove that dependency preflight, direct `active_plugins` refusal,
side-effect driver allowlists, apply-time revalidation, durable journaling, and
recovery inspection all cover the activation side effects without exposing raw
site values.

## Integration Recommendation

Record as candidate-only progress evidence. Do not move final release readiness
or mark plugin activation hooks topology release-ready from this variant.

## Validation

Required validation commands for this slice:

```sh
node --check scripts/playground/production-shaped-release-verify.mjs
node --check test/rpp-0815-plugin-activation-hooks-topology-v1.test.js
node --test test/rpp-0815-plugin-activation-hooks-topology-v1.test.js
node --test --test-name-pattern "activation hook" test/production-shaped-proof.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0815-plugin-activation-hooks-topology-v1.md
git diff --check
git diff --cached --check
```

Observed local results after implementation:

- syntax checks exited `0`
- focused RPP-0815 test exited `0`
- adjacent activation-hook regression exited `0`
- evidence redaction scan returned `"ok": true`
- diff whitespace checks were clean
