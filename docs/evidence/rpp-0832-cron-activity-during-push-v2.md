# RPP-0832 cron activity during push v2 evidence

Date: 2026-06-01
Lane: RPP-0832 cron activity during push, variant 2
Checklist item: RPP-0832 - Implement cron activity during push, variant 2.

## Scope

This slice records deterministic support-only evidence for the cron-active
production topology boundary. It follows the RPP-0812 variant 1 cron activity
shape and the current production-topology support report shape. It does not
edit checklist surfaces, progress surfaces, release gates, Docker harness code,
shared helpers, package metadata, or production runtime code.

The release-ready success target remains stricter than this sandbox can prove:
`npm run verify:release` must pass on the cron-active Docker topology with
packaged fallback disabled, every topology site must have cron runtime
readback, and cron activity during the push window must be captured as
hash/count/surface-only evidence. Docker CLI is unavailable in this sandbox, so
this proof fails closed before claiming any site startup, cron event readback,
mutation receipt, production-backed proof, or release movement.

Final release status and integration recommendation remain **NO-GO**.

## Support Report

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0832",
  "proofId": "rpp-0832-cron-activity-during-push-v2",
  "variant": 2,
  "title": "Cron activity during push topology v2 support proof",
  "checkedAt": "2026-06-01T00:00:00.000Z",
  "status": "blocked-exact-unavailable-capability",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "builtOn": {
    "precedentEvidence": [
      "RPP-0812 cron activity during push v1",
      "RPP-0822 Docker WordPress topology v2"
    ],
    "dockerTopologyVariant": "RPP-0802-variant-1",
    "commandContract": "npm run verify:release",
    "topologyCommand": "npm run verify:release:docker-local-production",
    "runtime": "docker-local-wordpress",
    "gate": "GATE-3",
    "artifactHash": "dd125114e7da54f28e887cd445af1ee308d5d20ace77dbf8af2d96a1f66eab9d"
  },
  "successContract": {
    "criterion": "verify-release-passes-on-cron-active-topology-without-packaged-fallback-or-exact-unavailable-capability",
    "verifyReleasePassedWithoutPackagedFallback": false,
    "cronActivityObservedDuringPush": false,
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
      "requiredFor": [
        "cron-active-wordpress-sites-start",
        "cron-runtime-readback-every-site",
        "cron-activity-window-readback-during-push",
        "cron-side-effect-drift-revalidation",
        "verify-release-cron-active-topology-v2"
      ]
    },
    "statusMarker": "[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]"
  },
  "cronActivityDuringPushV2": {
    "proofScope": "cron-activity-during-push-v2",
    "scenario": "cron-side-effects-remain-visible-across-snapshot-apply-revalidation-and-recovery",
    "requiredCapabilityCount": 6,
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
    "releaseReadyRequiredEvidence": [
      "docker-wordpress-topology-sites-started",
      "per-site-cron-runtime-readback-before-push",
      "hash-count-cron-activity-window-spans-push",
      "snapshot-and-apply-revalidation-cover-cron-side-effects",
      "journal-and-recovery-inspect-distinguish-push-work-from-cron-effects",
      "verify-release-docker-local-production-passes-without-packaged-fallback"
    ],
    "requirementDigest": "sha256:6405abea84b588502697567d7dd1e335f31f9e6991366493ce8a0ac0f4fe5b43",
    "siteSurfaceDigest": "sha256:ab0ac423104927c6258f895f5cf1a81e0cd732209786af6fb1cd66bb4a916751",
    "phaseSurfaceDigest": "sha256:662a085248d44f9316d125e50209413674f3db72baf6e75b844d98748206293e",
    "scopeHash": "sha256:61e7e61d735e10e83b4301be134dbe9e2421bdfe958184964603b33598fa19a8"
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
    "evidenceSurfaceCount": 10,
    "surfaceNames": [
      "cron-required-capabilities-recorded",
      "wp-cron-runtime-required-every-site",
      "cron-activity-window-readback-or-exact-capability",
      "cron-side-effects-visible-to-snapshot-and-apply-revalidation",
      "journal-separates-push-work-from-cron-effects",
      "topology-command-started-sites-or-exact-unavailable-capability",
      "docker-unavailable-capability-exact",
      "release-verifier-no-packaged-fallback",
      "sandbox-8080-only-no-tunnels",
      "support-only-no-go"
    ],
    "surfaceDigest": "sha256:1396aff06a8b9613ef9c4331eeac925a9af6dd178e3b9292c86c30f9bc1afe13"
  },
  "invariants": {
    "topologyCommandStartedSitesOrExactCapabilityRecorded": true,
    "failClosedWhenSitesNotStarted": true,
    "cronActivityRequirementsRecorded": true,
    "cronActivityNotClaimedWhenTopologyMissing": true,
    "cronMutationsBoundedBySnapshotAndApplyRevalidation": true,
    "verifyReleaseNoPackagedFallback": true,
    "onlySandbox8080IngressAndNoTunnels": true,
    "hashCountSurfaceOnly": true,
    "supportOnlyNoGo": true
  },
  "supportReportHash": "sha256:e7880373defda8a48b20a546bb6a5d06cc00a8aede7b6aa8cfd3620e7d711602"
}
```

## Cron Activity Requirements

Variant 2 keeps the variant 1 requirements and tightens the release-ready
contract around the current topology report shape:

- every topology site must have cron runtime enabled and read back before push;
- the cron activity window must span before snapshot, dry-run, apply,
  apply revalidation, and recovery inspection;
- cron side effects must remain visible as remote drift and must not bypass
  snapshot or apply-time revalidation;
- durable journal and recovery inspection evidence must distinguish push work
  from cron side effects; and
- the release verifier must stay `npm run verify:release` with packaged
  fallback disabled.

The only permitted inspection ingress remains loopback port `8080`. Remote
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

`test/rpp-0832-cron-activity-during-push-v2.test.js` validates that:

- the markdown support report is deterministic and self-hashing;
- the topology command records the exact unavailable Docker capability and
  fails closed;
- cron activity readback cannot be claimed when the topology did not start;
- packaged fallback and widened network exposure are rejected;
- evidence remains hash/count/surface-only; and
- final release status and integration recommendation remain `NO-GO`.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0832-cron-activity-during-push-v2.test.js
node --test --test-name-pattern RPP-0832 test/rpp-0832-cron-activity-during-push-v2.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0832-cron-activity-during-push-v2.md
git diff --check origin/lane/evidence-integration-20260527...HEAD
```

Observed local results after implementation:

- `node --check test/rpp-0832-cron-activity-during-push-v2.test.js`: exit 0
- `node --test --test-name-pattern RPP-0832 test/rpp-0832-cron-activity-during-push-v2.test.js`: exit 0
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0832-cron-activity-during-push-v2.md`: exit 0, no rejected files
- `git diff --check origin/lane/evidence-integration-20260527...HEAD`: exit 0

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox support-evidence contract by recording the
exact unavailable Docker capability and by keeping release status fail-closed.
A Docker-capable production topology still needs to start the sites, keep cron
active, collect hash/count-only cron activity readback across the push window,
and pass `npm run verify:release` with packaged fallback disabled before this
can become production-backed evidence.
