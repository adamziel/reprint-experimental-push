# RPP-0892 cron activity during push v5 evidence

Date: 2026-06-01
Lane: RPP-0892 cron activity during push, variant 5
Checklist item: RPP-0892 - Carry through the release verifier for cron activity during push, variant 5.

## Scope

This slice records deterministic support-only evidence for the cron-active
production topology boundary. It follows the RPP-0852 variant 3 and RPP-0872
variant 4 cron activity shapes, then carries the release verifier through the
variant 5 Far / production-topology pattern from RPP-0881, RPP-0883, RPP-0891,
and RPP-0893. It only adds the focused RPP-0892 test and this evidence file.

The release-ready success target remains stricter than this sandbox can prove:
`npm run verify:release` must pass on the cron-active Docker topology with
packaged fallback disabled, the topology command must carry through the
`verify:release` result and release-verifier requirements, every topology site
must have cron runtime readback, and production-backed cron activity during the
push window must be captured as hash/count/surface-only evidence before release
eligibility. Docker CLI is unavailable in this sandbox, so this proof fails
closed before claiming any site startup, cron event readback, mutation receipt,
production-backed proof, or release movement.

Final release status and integration recommendation remain **NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0892",
  "proofId": "rpp-0892-cron-activity-during-push-v5",
  "variant": 5,
  "title": "Cron activity during push topology v5 support proof",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "coverageMode": "release-verifier-carry-through-local-support-only",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "precedentEvidence": [
      "RPP-0812 cron activity during push v1",
      "RPP-0832 cron activity during push v2",
      "RPP-0852 cron activity during push v3",
      "RPP-0872 cron activity during push v4"
    ],
    "topologyLane": "Far / production-topology",
    "currentProductionTopologyEvidence": [
      "RPP-0881 three-site local production topology v5",
      "RPP-0883 external WordPress topology v5",
      "RPP-0891 object-cache enabled topology v5"
    ],
    "variant5ProductionTopologyPatterns": [
      "RPP-0881 three-site local production topology v5",
      "RPP-0883 external WordPress topology v5",
      "RPP-0891 object-cache enabled topology v5",
      "RPP-0893 maintenance mode interaction v5"
    ],
    "dockerTopologyVariant": "RPP-0802-variant-1",
    "commandContract": "npm run verify:release",
    "topologyCommand": "npm run verify:release:docker-local-production",
    "runtime": "docker-local-wordpress",
    "gate": "GATE-3",
    "artifactHash": "42b4752b7679ac5523d94eccf158dd35abf6afab8e933e7d56f9cc599adb980e"
  },
  "successContract": {
    "criterion": "verify-release-passes-on-cron-active-production-topology-v5-without-packaged-fallback-and-production-backed-cron-readback",
    "verifyReleasePassedWithoutPackagedFallback": false,
    "cronActivityObservedDuringPush": false,
    "releaseVerifierCarryThroughObserved": true,
    "productionBackedCronActivityReadbackRequired": true,
    "productionBackedCronActivityReadbackObserved": false,
    "exactUnavailableCapabilityRecorded": true,
    "finalReleaseMayMove": false
  },
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "releaseVerifierCommand": "npm run verify:release",
    "status": "blocked",
    "exitCode": 2,
    "failClosed": true,
    "sitesStarted": false,
    "expectedSiteCount": 4,
    "startedSiteCount": 0,
    "siteRoles": [
      "source",
      "remote-changed",
      "local-edited",
      "apply-revalidation-source"
    ],
    "exactUnavailableCapability": {
      "code": "DOCKER_CLI_MISSING",
      "capability": "docker-cli",
      "command": "docker --version",
      "missingExecutable": true,
      "observedShellExitCode": 127,
      "requiredFor": [
        "cron-active-wordpress-sites-start",
        "cron-runtime-readback-every-site",
        "cron-activity-window-readback-during-push",
        "cron-side-effect-drift-revalidation",
        "release-verifier-carry-through-current-topology",
        "release-verifier-requirements-carried-through-production-topology",
        "production-backed-cron-activity-readback-before-release",
        "verify-release-cron-active-topology-v5",
        "verify-release-without-packaged-fallback",
        "cron-activity-topology-v5-release-verifier-carry-through-fail-closed"
      ]
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
  },
  "cronActivityDuringPushV5": {
    "proofScope": "cron-activity-during-push-v5",
    "scenario": "cron-active-current-topology-release-verifier-carry-through",
    "generatedCoverageId": "cron-activity-during-push-v5-generated-coverage",
    "topologyLane": "Far / production-topology",
    "sourcePattern": "RPP-0872 v4 plus RPP-0881/RPP-0883/RPP-0891/RPP-0893 variant-5 production-topology boundaries",
    "productionBackedArtifactPresent": false,
    "releaseGateMayConsumeAsProduction": false,
    "currentProductionTopologyEvidence": [
      "RPP-0881 three-site local production topology v5",
      "RPP-0883 external WordPress topology v5",
      "RPP-0891 object-cache enabled topology v5"
    ],
    "currentTopologyEvidenceDigest": "sha256:536fd3188c9249f04e1d5b002aa824c58775bf9236437d4fe12d94649f18654e",
    "variant5ProductionTopologyPatterns": [
      "RPP-0881 three-site local production topology v5",
      "RPP-0883 external WordPress topology v5",
      "RPP-0891 object-cache enabled topology v5",
      "RPP-0893 maintenance mode interaction v5"
    ],
    "variant5PatternDigest": "sha256:01f4aca26133dd839407ccb8c630fc6debfc19bbd3b595ba5c780c3e910e4469",
    "releaseVerifierRequirements": [
      "topology-command-carries-npm-run-verify-release",
      "verify-release-exit-code-and-blocker-carried-through",
      "verify-release-no-packaged-fallback",
      "release-urls-use-docker-dns",
      "release-gate-rejects-without-production-backed-cron-readback"
    ],
    "releaseVerifierRequirementDigest": "sha256:7df95b39169429f3f0f2b306ff66f6b3d99ed4cbdbbaec1d0aea16287d3a12dc",
    "requiredCapabilityCount": 11,
    "requirementSurfaces": [
      {
        "id": "wp-cron-enabled-every-site",
        "requiredCapability": "wordpress-cron-enabled-every-site",
        "evidenceRequired": "per-site-cron-runtime-readback-before-push"
      },
      {
        "id": "cron-window-captured-during-push",
        "requiredCapability": "cron-activity-window-captured-during-push",
        "evidenceRequired": "hash-count-only-cron-event-window-readback"
      },
      {
        "id": "cron-drift-visible-to-release-verifier",
        "requiredCapability": "cron-side-effects-visible-to-snapshot-and-apply-revalidation",
        "evidenceRequired": "snapshot-and-apply-revalidation-boundary-proof"
      },
      {
        "id": "cron-journal-boundary",
        "requiredCapability": "push-journal-separates-release-mutations-from-cron-effects",
        "evidenceRequired": "journal-and-recovery-inspect-boundary-proof"
      },
      {
        "id": "release-verifier-cron-active-path",
        "requiredCapability": "verify-release-runs-through-cron-active-sites",
        "evidenceRequired": "docker-topology-command-starts-sites-or-records-exact-unavailable-capability"
      },
      {
        "id": "no-packaged-fallback-cron-topology",
        "requiredCapability": "verify-release-no-packaged-fallback-on-cron-active-topology",
        "evidenceRequired": "verify-release-pass-with-packaged-fallback-disabled"
      },
      {
        "id": "release-verifier-carry-through-current-topology",
        "requiredCapability": "current-topology-carries-verify-release-result",
        "evidenceRequired": "topology-command-carries-verify-release-exit-and-reason"
      },
      {
        "id": "release-verifier-requirements-carried-through",
        "requiredCapability": "release-verifier-requirements-carried-through-production-topology",
        "evidenceRequired": "verify-release-command-exit-blocker-fallback-and-release-gate-readback"
      },
      {
        "id": "production-backed-artifact-required-before-release",
        "requiredCapability": "production-backed-cron-active-artifact-before-release-movement",
        "evidenceRequired": "checked-production-backed-artifact-or-final-no-go"
      },
      {
        "id": "production-backed-cron-readback-before-release",
        "requiredCapability": "production-backed-cron-activity-readback-before-release-eligibility",
        "evidenceRequired": "production-backed-hash-count-cron-window-readback-or-final-no-go"
      },
      {
        "id": "variant-5-production-topology-release-verifier-carry-through",
        "requiredCapability": "cron-activity-v5-carries-release-verifier-through-production-topology",
        "evidenceRequired": "variant-5-topology-patterns-and-release-verifier-requirement-readback"
      }
    ],
    "requiredSiteRoles": [
      "source",
      "remote-changed",
      "local-edited",
      "apply-revalidation-source"
    ],
    "siteRoleCount": 4,
    "startedSiteCount": 0,
    "startupBlockedBy": "DOCKER_CLI_MISSING",
    "siteSurfaces": [
      {
        "role": "source",
        "service": "wp-source",
        "cliService": "cli-source",
        "dbService": "db-source",
        "cronRuntimeRequired": true,
        "cronReadbackObserved": false
      },
      {
        "role": "remote-changed",
        "service": "wp-remote-changed",
        "cliService": "cli-remote-changed",
        "dbService": "db-remote-changed",
        "cronRuntimeRequired": true,
        "cronReadbackObserved": false
      },
      {
        "role": "local-edited",
        "service": "wp-local-edited",
        "cliService": "cli-local-edited",
        "dbService": "db-local-edited",
        "cronRuntimeRequired": true,
        "cronReadbackObserved": false
      },
      {
        "role": "apply-revalidation-source",
        "service": "wp-apply-revalidation-source",
        "cliService": "cli-apply-revalidation-source",
        "dbService": "db-apply-revalidation-source",
        "cronRuntimeRequired": true,
        "cronReadbackObserved": false
      }
    ],
    "phaseSurfaces": [
      "before-snapshot",
      "dry-run-window",
      "apply-window",
      "apply-revalidation",
      "recovery-inspect"
    ],
    "phaseCount": 5,
    "activityReadback": {
      "required": true,
      "observed": false,
      "siteCount": 0,
      "eventCount": 0,
      "blockedBy": "DOCKER_CLI_MISSING",
      "claimMode": "not-claimed-exact-capability",
      "readbackFormat": "hash-count-surface-only"
    },
    "sideEffectBoundary": {
      "cronMutationsMustBeVisibleAsRemoteDrift": true,
      "snapshotBeforeApplyMustNotHideCronDrift": true,
      "applyRevalidationAfterCronWindow": true,
      "durableJournalSeparatesPushAndCronEffects": true,
      "recoveryInspectMustSurfaceUnfinishedPushWorkOnly": true,
      "directCronMutationReleaseEligible": false
    },
    "releaseVerifierCarryThrough": {
      "required": true,
      "observed": true,
      "topologyCommand": "npm run verify:release:docker-local-production",
      "verifierCommand": "npm run verify:release",
      "verifierExitCodeWhenBlocked": 2,
      "verifierFailureReasonWhenBlocked": "DOCKER_CLI_MISSING",
      "releaseUrlsUseDockerDns": true,
      "packagedFallbackAllowed": false,
      "packagedFallbackObserved": false
    },
    "productionBackedCronReadback": {
      "required": true,
      "observed": false,
      "siteCount": 0,
      "eventCount": 0,
      "blockedBy": "DOCKER_CLI_MISSING",
      "claimMode": "not-claimed-support-only",
      "readbackFormat": "production-backed-hash-count-surface-only",
      "requiredBeforeReleaseEligibility": true,
      "releaseEligibilityWhenMissing": "blocked-final-no-go"
    },
    "releaseReadyRequiredEvidence": [
      "docker-wordpress-topology-sites-started",
      "per-site-cron-runtime-readback-before-push",
      "hash-count-cron-activity-window-spans-push",
      "snapshot-and-apply-revalidation-cover-cron-side-effects",
      "journal-and-recovery-inspect-distinguish-push-work-from-cron-effects",
      "topology-command-carries-verify-release-result",
      "checked-production-backed-cron-active-artifact",
      "production-backed-cron-activity-readback-before-release-eligibility",
      "release-verifier-requirements-carried-through-production-topology",
      "variant-5-production-topology-patterns-carried-forward",
      "release-verifier-v5-docker-unavailable-fail-closed-readback",
      "verify-release-docker-local-production-passes-without-packaged-fallback"
    ],
    "requirementDigest": "sha256:ef65a68d6deececab6afb389cf82523e47212b3a9e34dcc5cbed4c2adb163ad2",
    "siteSurfaceDigest": "sha256:ab0ac423104927c6258f895f5cf1a81e0cd732209786af6fb1cd66bb4a916751",
    "phaseSurfaceDigest": "sha256:662a085248d44f9316d125e50209413674f3db72baf6e75b844d98748206293e",
    "scopeHash": "sha256:4a4574505d04ff148f3162df9fcc42b17d5cde78abc3770efb85e62da7fc3eb5"
  },
  "releaseVerifier": {
    "command": "npm run verify:release",
    "noPackagedFallback": true,
    "packagedFallbackObserved": false,
    "passedOnTopology": false,
    "blockedBy": "DOCKER_CLI_MISSING",
    "releaseUrlsUseDockerDns": true
  },
  "localOnlyPolicy": {
    "onlySandbox8080Ingress": true,
    "publishedHttpIngressCount": 1,
    "publishedHttpIngressHostSurface": "loopback-only",
    "publishedHttpIngressPort": 8080,
    "remoteTunnelsAllowed": false,
    "noTunnelPolicyEnforced": true,
    "tunnelCommandCount": 0
  },
  "releaseGate": {
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED",
    "finalReleaseStatus": "NO-GO"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "payloadsStored": false,
    "rawPayloadCount": 0,
    "rawUrlCount": 0,
    "sensitiveSurfaceCount": 0,
    "tunnelOutputCount": 0,
    "evidenceSurfaceCount": 16,
    "surfaceNames": [
      "cron-required-capabilities-recorded",
      "wp-cron-runtime-required-every-site",
      "cron-activity-window-readback-or-exact-capability",
      "cron-side-effects-visible-to-snapshot-and-apply-revalidation",
      "journal-separates-push-work-from-cron-effects",
      "release-verifier-carry-through-on-current-topology",
      "topology-command-started-sites-or-exact-unavailable-capability",
      "docker-unavailable-capability-exact",
      "release-verifier-no-packaged-fallback",
      "release-verifier-requirements-carried-through",
      "sandbox-8080-only-no-tunnels",
      "production-backed-artifact-required-before-release",
      "production-backed-cron-readback-required-before-release",
      "variant-5-production-topology-patterns-recorded",
      "release-verifier-variant-5-docker-unavailable-fails-closed",
      "support-only-no-go"
    ],
    "surfaceDigest": "sha256:f270b65ecc04598e5b22c810da216866f5b8feb243ce37be8410470f08988ce8"
  },
  "invariants": {
    "topologyCommandStartedSitesOrExactCapabilityRecorded": true,
    "failClosedWhenSitesNotStarted": true,
    "cronActivityRequirementsRecorded": true,
    "cronActivityNotClaimedWhenTopologyMissing": true,
    "cronMutationsBoundedBySnapshotAndApplyRevalidation": true,
    "releaseVerifierCarryThroughRecorded": true,
    "releaseVerifierRequirementsCarriedThrough": true,
    "verifyReleaseNoPackagedFallback": true,
    "onlySandbox8080IngressAndNoTunnels": true,
    "hashCountSurfaceOnly": true,
    "supportOnlyNoGo": true,
    "productionBackedArtifactRequiredBeforeRelease": true,
    "productionBackedCronReadbackRequiredBeforeRelease": true
  },
  "supportReportHash": "sha256:bbbb58f3fe70fda5fa4f157b1c8dbda0a065fcf5e4194d94370001e72e6bd467"
}
```

## Cron Activity Requirements

Variant 5 keeps the variant 3 and variant 4 cron requirements and adds the
release-verifier carry-through production topology boundary:

- every topology site must have cron runtime enabled and read back before push;
- the cron activity window must span before snapshot, dry-run, apply,
  apply revalidation, and recovery inspection;
- cron side effects must remain visible as remote drift and must not bypass
  snapshot or apply-time revalidation;
- durable journal and recovery inspection evidence must distinguish push work
  from cron side effects;
- the topology command must carry through the `npm run verify:release` result;
- the release verifier must stay `npm run verify:release` with packaged
  fallback disabled;
- release-verifier requirements must carry through the topology command,
  including exit code, exact blocker, fallback status, release URL DNS mode, and
  release-gate rejection;
- the variant-5 production-topology support patterns must stay recorded as
  support-only, exact-capability, no-release-movement evidence;
- a checked production-backed cron-active artifact is required before release
  movement; and
- production-backed cron activity readback is required before release
  eligibility.

The only permitted inspection ingress remains the sandbox port `8080`. Remote
tunneling remains prohibited.

## Observed Prerequisite

The topology runner was not started by this worker. The direct prerequisite
probe was:

```sh
docker --version
```

Observed result in this sandbox:

- exit status: `127`
- stderr summary: `docker: command not found`
- exact unavailable capability: `DOCKER_CLI_MISSING`

The deterministic harness artifact represented by the support report records:

- topology command: `npm run verify:release:docker-local-production`
- release verifier command inside the topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- accepted for release gate: `false`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- packaged fallback observed: `false`

No started WordPress site, cron runtime readback, during-push cron event count,
mutation receipt, or production-backed release proof was observed.

## Focused Test

`test/rpp-0892-cron-activity-during-push-v5.test.js` validates that:

- the markdown support report is deterministic and self-hashing;
- the topology command records the exact unavailable Docker capability and
  fails closed;
- cron activity readback cannot be claimed when the topology did not start;
- the topology command carries through the `verify:release` command and
  blocked-result reason;
- RPP-0852, RPP-0872, and the variant-5 production-topology patterns are
  recorded as predecessor support without claiming production readiness;
- release-verifier requirements carry through the topology command;
- production-backed cron activity readback is required before release
  eligibility;
- packaged fallback, widened network exposure, and unsupported
  production-backed claims are rejected;
- evidence remains hash/count/surface-only; and
- final release status and integration recommendation remain `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0892-cron-activity-during-push-v5.test.js
node --test --test-name-pattern RPP-0892 test/rpp-0892-cron-activity-during-push-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0892-cron-activity-during-push-v5.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0892-cron-activity-during-push-v5.test.js`: exit 0
- `node --test --test-name-pattern RPP-0892 test/rpp-0892-cron-activity-during-push-v5.test.js`: exit 0
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0892-cron-activity-during-push-v5.md`: exit 0, `ok: true`, 0 rejected files
- `git diff --check`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox support-evidence contract by recording the
exact unavailable Docker capability and by keeping release status fail-closed.
A Docker-capable production topology still needs to start the sites, keep cron
active, collect production-backed hash/count-only cron activity readback across
the push window, carry through a passing `npm run verify:release` result, and
prove packaged fallback stayed disabled before this can become production-backed
release evidence.
