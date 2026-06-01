# RPP-0812 cron activity during push v1 evidence

Date: 2026-06-01
Lane: RPP-0812 cron activity during push, variant 1
Checklist item: RPP-0812 - Implement cron activity during push, variant 1.

## Scope

This slice records deterministic support-only evidence for the cron-active
production topology boundary. It does not edit checklist surfaces, progress
surfaces, Docker harness code, release gates, or shared helpers.

The success target for release-ready evidence is stricter than this sandbox can
prove: `npm run verify:release` must pass inside the production topology with
packaged fallback disabled while cron activity is enabled and observed during
the push window. In this sandbox, Docker CLI is unavailable, so the proof fails
closed and records the exact unavailable capability before claiming any started
site, cron readback, mutation receipt, or production-backed release status.

Final release status and integration recommendation remain **NO-GO**.

## Cron Activity Requirements

Variant 1 records these requirements before cron-active topology evidence can
be accepted as a started-site proof:

- `wordpress-cron-enabled-every-site`: every topology site must have WordPress
  cron, or an equivalent scheduler runtime, enabled before push activity.
- `cron-activity-window-captured-during-push`: the proof must capture a
  hash/count-only cron activity window spanning before snapshot, dry-run,
  apply, apply revalidation, and recovery inspection.
- `cron-side-effects-visible-to-snapshot-and-apply-revalidation`: cron
  side-effects must remain visible as remote drift and cannot bypass snapshot
  or apply-time revalidation.
- `push-journal-separates-release-mutations-from-cron-effects`: durable journal
  and recovery inspection evidence must distinguish push work from cron
  side-effects.
- `verify-release-runs-through-cron-active-sites`: the topology runner must
  remain `npm run verify:release` with packaged fallback disabled.

The only permitted HTTP ingress remains the sandbox local inspection port
`127.0.0.1:8080`. Remote tunnel commands remain prohibited.

## Deterministic Support Evidence

`test/rpp-0812-cron-activity-during-push-v1.test.js` builds an RPP-0812 proof
from the existing Docker local-production topology artifact helpers. The proof
is support-only and release-ineligible:

```json
{
  "schemaVersion": 1,
  "rppId": "RPP-0812",
  "variant": 1,
  "proofId": "rpp-0812-cron-activity-during-push-v1",
  "status": "blocked-exact-unavailable-capability",
  "supportOnly": true,
  "productionBacked": false,
  "releaseEligible": false,
  "finalReleaseStatus": "NO-GO",
  "integrationRecommendation": "NO-GO",
  "topologyCommand": {
    "command": "npm run verify:release:docker-local-production",
    "releaseVerifierCommand": "npm run verify:release",
    "sitesStarted": false,
    "expectedSiteCount": 4,
    "startedSiteCount": 0,
    "packagedFallbackObserved": false
  },
  "cronActivityDuringPush": {
    "requiredCapabilityCount": 5,
    "requiredPhaseCount": 5,
    "activityReadbackObserved": false,
    "activityReadbackSiteCount": 0,
    "observedCronEventCount": 0,
    "claimMode": "not-claimed-exact-capability"
  },
  "releaseGate": {
    "acceptedForReleaseGate": false,
    "releaseMovementAllowed": false,
    "primaryFailureCode": "REPRINT_PUSH_LIVE_SOURCE_REQUIRED"
  },
  "evidenceLimits": {
    "mode": "hash-count-surface-only",
    "rawPayloadCount": 0,
    "sensitiveSurfaceCount": 0,
    "rejectedSurfaceCount": 0
  }
}
```

The focused test also proves that:

- a non-started topology without an exact unavailable capability is rejected;
- cron activity readback cannot be claimed when the topology did not start;
- packaged fallback evidence is rejected; and
- the support proof is deterministic and hash/count/surface-only.

## Observed Topology Command

Command run in this sandbox:

```sh
npm run verify:release:docker-local-production
```

Observed result:

- exit status: `2`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- artifact:
  `/tmp/reprint-docker-local-production-evidence-X8LQBR/release-gate-input.json`
- deterministic artifact hash:
  `11c1b0a55cc60f06ebbce06b9920a3f65dfbb86df7b36480ffce0d275bdc83f2`
- topology command: `npm run verify:release:docker-local-production`
- release-verifier command inside topology: `npm run verify:release`
- Docker topology variant: `RPP-0802-variant-1`
- accepted for release gate: `false`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`
- packaged fallback observed: `false`
- release URLs use Docker DNS: `true`
- local-only topology validation: `true`

Exact unavailable capability recorded by the command:

```json
{
  "code": "DOCKER_CLI_MISSING",
  "capability": "docker-cli",
  "command": "docker --version",
  "missingExecutable": true,
  "requiredFor": [
    "cron-active-wordpress-sites-start",
    "cron-activity-window-readback",
    "cron-side-effect-drift-revalidation",
    "release-verifier-cron-active-path"
  ]
}
```

Because Docker CLI is missing, this evidence does not claim started WordPress
sites, cron runtime readback, during-push cron event counts, mutation receipts,
or `verify:release` success on the topology.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0812-cron-activity-during-push-v1.test.js
node --test --test-name-pattern RPP-0812 test/rpp-0812-cron-activity-during-push-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0812-cron-activity-during-push-v1.md
git diff --check
```

Observed local results after implementation:

- syntax check: exit `0`
- focused RPP-0812 test: exit `0`
- evidence redaction scan: exit `0`, no rejected files
- diff whitespace check: exit `0`

## Integration Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox evidence contract by recording the exact
unavailable Docker capability and keeping release status fail-closed. A
Docker-capable production topology still needs to start the sites, keep cron
active, collect hash/count-only cron activity readback across the push window,
and pass `npm run verify:release` with packaged fallback disabled before this
can become production-backed evidence.
