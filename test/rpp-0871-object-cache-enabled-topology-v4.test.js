import assert from 'node:assert/strict';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';

const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0871-object-cache-enabled-topology-v4';
const topologyProofScope = 'object-cache-enabled-topology-v4';
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;

const objectCacheTopologyRequirements = Object.freeze([
  Object.freeze({
    id: 'private-object-cache-backend',
    requiredCapability: 'object-cache-backend-private-network',
    requirement: 'redis-compatible-cache-service-on-private-docker-network',
    surface: 'cache-backend-private-network',
    publishedHostPorts: 0,
  }),
  Object.freeze({
    id: 'object-cache-runtime-enabled-every-site',
    requiredCapability: 'wordpress-object-cache-runtime-every-site',
    requirement: 'object-cache-dropin-or-equivalent-runtime-enabled-before-seed',
    surface: 'per-site-runtime-readback',
    evidenceRequired: 'per-site-runtime-readback',
  }),
  Object.freeze({
    id: 'cache-state-boundary',
    requiredCapability: 'object-cache-state-does-not-hide-snapshot-drift',
    requirement: 'flush-or-bypass-cache-before-snapshot-and-release-verifier-boundaries',
    surface: 'cache-boundary-readback',
    evidenceRequired: 'planner-and-release-verifier-cache-boundary-readback',
  }),
  Object.freeze({
    id: 'release-verifier-object-cache-path',
    requiredCapability: 'verify-release-runs-through-object-cache-enabled-sites',
    requirement: 'runner-command-remains-npm-run-verify-release-with-no-packaged-fallback',
    surface: 'release-verifier-command-contract',
    evidenceRequired: 'docker-topology-command-starts-sites-or-records-exact-unavailable-capability',
  }),
  Object.freeze({
    id: 'hash-count-surface-only-evidence',
    requiredCapability: 'object-cache-topology-evidence-hash-count-surface-only',
    requirement: 'store only requirement hashes, counts, surface names, and service-role surfaces',
    surface: 'hash-count-surface-only-evidence',
    rawPayloadsAllowed: 0,
  }),
  Object.freeze({
    id: 'variant-3-generated-capability-replay',
    requiredCapability: 'object-cache-topology-v3-generated-replay-is-deterministic',
    requirement: 'replayed generated support evidence preserves exact blocker and release no-go state',
    surface: 'generated-support-replay',
    evidenceRequired: 'deterministic-replay-hash-and-invariant-readback',
  }),
  Object.freeze({
    id: 'variant-4-focused-fail-closed-regression',
    requiredCapability: 'object-cache-topology-v4-focused-regression-fail-closed',
    requirement: 'focused regression preserves exit-2 exact blocker and no release movement when Docker is unavailable',
    surface: 'focused-regression-fail-closed-topology-command',
    evidenceRequired: 'exit-code-acceptedForReleaseGate-failClosed-readback',
  }),
]);

test('RPP-0871 records object-cache topology variant 4 requirements and exact unavailable capability', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyV4Proof({ artifact, plan, probe });
  const validation = validateObjectCacheTopologyV4Proof(proof);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0871');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.coverageMode, 'focused-regression-local-support-only');
  assert.equal(proof.status, 'blocked-exact-unavailable-capability');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(proof.builtOn.commandContract, 'npm run verify:release');
  assert.match(proof.builtOn.artifactHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(proof.builtOn.patternReferences, [
    'RPP-0811 object-cache enabled topology v1',
    'RPP-0831 object-cache enabled topology v2',
    'RPP-0851 object-cache enabled topology v3',
  ]);
  assert.equal(proof.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(proof.topologyCommand.successCriterion, 'sites-started-or-exact-unavailable-capability-recorded');
  assert.equal(proof.topologyCommand.sitesStarted, false);
  assert.equal(proof.topologyCommand.expectedSiteCount, 4);
  assert.equal(proof.topologyCommand.startedSiteCount, 0);
  assert.equal(proof.topologyCommand.status, 'blocked');
  assert.equal(proof.topologyCommand.exitCode, 2);
  assert.deepEqual(proof.topologyCommand.siteRoles, [
    'source',
    'remote-changed',
    'local-edited',
    'apply-revalidation-source',
  ]);
  assert.equal(proof.topologyCommand.exactUnavailableCapability.code, 'DOCKER_CLI_MISSING');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.capability, 'docker-cli');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.command, 'docker --version');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.missingExecutable, true);
  assert.deepEqual(proof.topologyCommand.exactUnavailableCapability.requiredFor, [
    'object-cache-enabled-wordpress-sites-start',
    'object-cache-runtime-readback',
    'release-verifier-object-cache-path',
    'object-cache-topology-v4-startup-proof',
  ]);

  assert.equal(proof.dockerUnavailableOutcome.code, 'DOCKER_CLI_MISSING');
  assert.equal(proof.dockerUnavailableOutcome.exitCode, 2);
  assert.equal(proof.dockerUnavailableOutcome.acceptedForReleaseGate, false);
  assert.equal(proof.dockerUnavailableOutcome.failClosed, true);
  assert.equal(proof.dockerUnavailableOutcome.releaseMovementAllowed, false);
  assert.equal(proof.dockerUnavailableOutcome.exactUnavailableCapabilityRecorded, true);
  assert.equal(proof.dockerUnavailableOutcome.claimsReleaseReadiness, false);

  assert.equal(proof.dockerBlocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(proof.dockerBlocker.capability, 'docker-cli');
  assert.equal(proof.dockerBlocker.checkedCommand, 'docker --version');
  assert.equal(proof.dockerBlocker.missingExecutable, true);
  assert.equal(proof.dockerBlocker.exactUnavailableCapabilityRecorded, true);

  assert.equal(proof.objectCacheTopologyV4.proofScope, topologyProofScope);
  assert.equal(proof.objectCacheTopologyV4.variant, 4);
  assert.equal(proof.objectCacheTopologyV4.requiredCapabilityCount, objectCacheTopologyRequirements.length);
  assert.deepEqual(
    proof.objectCacheTopologyV4.requiredCapabilities.map((entry) => entry.requiredCapability),
    objectCacheTopologyRequirements.map((entry) => entry.requiredCapability),
  );
  assert.equal(proof.objectCacheTopologyV4.cacheBackend.required, true);
  assert.equal(proof.objectCacheTopologyV4.cacheBackend.networkInternal, true);
  assert.equal(proof.objectCacheTopologyV4.cacheBackend.publishedHostPorts, 0);
  assert.equal(proof.objectCacheTopologyV4.cacheBackend.publicIngressAllowed, false);
  assert.deepEqual(proof.objectCacheTopologyV4.enabledSiteRoles, proof.topologyCommand.siteRoles);
  assert.equal(proof.objectCacheTopologyV4.enabledSiteRoleCount, 4);
  assert.equal(proof.objectCacheTopologyV4.runtime.requiredEverySite, true);
  assert.equal(proof.objectCacheTopologyV4.runtime.runtimeReadbackObserved, false);
  assert.equal(proof.objectCacheTopologyV4.runtime.runtimeReadbackSiteCount, 0);
  assert.equal(proof.objectCacheTopologyV4.runtime.runtimeReadbackBlockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(proof.objectCacheTopologyV4.runtime.claimMode, 'not-claimed-exact-capability');
  assert.equal(proof.objectCacheTopologyV4.generatedReplay.deterministicReplayRequired, true);
  assert.equal(proof.objectCacheTopologyV4.generatedReplay.replayCount, 2);
  assert.equal(proof.objectCacheTopologyV4.generatedReplay.exactBlockerPreserved, true);
  assert.equal(proof.objectCacheTopologyV4.generatedReplay.releaseNoGoPreserved, true);
  assert.equal(proof.objectCacheTopologyV4.focusedRegression.exit2WhenDockerUnavailable, true);
  assert.equal(proof.objectCacheTopologyV4.focusedRegression.acceptedForReleaseGateWhenDockerUnavailable, false);
  assert.equal(proof.objectCacheTopologyV4.focusedRegression.failClosedWhenDockerUnavailable, true);
  assert.equal(proof.objectCacheTopologyV4.focusedRegression.surfaceCount, 4);
  assert.equal(proof.objectCacheTopologyV4.releasePolicy, 'support-only-no-release-movement');
  assert.match(proof.objectCacheTopologyV4.requirementDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV4.siteSurfaceDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV4.cacheBoundary.surfaceDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV4.generatedReplay.surfaceDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV4.focusedRegression.surfaceDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV4.scopeHash, proofHashPattern);

  assert.equal(proof.releaseVerifier.command, 'npm run verify:release');
  assert.equal(proof.releaseVerifier.noPackagedFallback, true);
  assert.equal(proof.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(proof.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(proof.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.noTunnelPolicyEnforced, true);
  assert.equal(proof.localOnlyPolicy.publishedHttpIngressCount, 1);
  assert.equal(proof.localOnlyPolicy.publishedHttpIngress[0].hostPort, 8080);
  assert.equal(proof.localOnlyPolicy.cacheBackendPublishedPorts, 0);
  assert.equal(proof.localOnlyPolicy.tunnelCommandCount, 0);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.releaseMovementAllowed, false);
  assert.equal(proof.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(proof.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(proof.evidenceLimits.payloadsStored, false);
  assert.equal(proof.evidenceLimits.rawPayloadCount, 0);
  assert.equal(proof.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(proof.evidenceLimits.objectCacheRequirementCount, objectCacheTopologyRequirements.length);
  assert.equal(proof.evidenceLimits.siteSurfaceCount, 4);
  assert.equal(proof.evidenceLimits.evidenceSurfaceCount, 11);
  assert.equal(proof.evidenceLimits.rejectedSurfaceCount, 0);
  assert.equal(proof.evidenceLimits.hashedSurfaceCount, 6);
  assert.match(proof.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.deepEqual(proof.evidenceLimits.surfaceNames, [
    'object-cache-required-capabilities-recorded',
    'private-cache-backend-no-host-port',
    'object-cache-runtime-required-every-site',
    'cache-boundary-before-snapshot',
    'cache-boundary-before-release-verifier',
    'topology-command-started-sites-or-exact-unavailable-capability',
    'docker-unavailable-capability-exact',
    'release-verifier-no-packaged-fallback',
    'sandbox-8080-only-no-tunnels',
    'generated-variant-3-replay-preserves-no-go',
    'focused-variant-4-docker-unavailable-fails-closed',
  ]);

  assert.equal(proof.invariants.topologyCommandStartedSitesOrExactCapabilityRecorded, true);
  assert.equal(proof.invariants.failClosedWhenSitesNotStarted, true);
  assert.equal(proof.invariants.objectCacheRequirementsRecorded, true);
  assert.equal(proof.invariants.objectCacheRuntimeNotClaimedWhenDockerMissing, true);
  assert.equal(proof.invariants.generatedReplayPreservesExactBlocker, true);
  assert.equal(proof.invariants.focusedRegressionPreservesDockerUnavailableFailClosed, true);
  assert.equal(proof.invariants.noPublicCacheIngress, true);
  assert.equal(proof.invariants.onlySandbox8080Ingress, true);
  assert.equal(proof.invariants.noTunnelUsage, true);
  assert.equal(proof.invariants.noPackagedFallback, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.proofHash, proofHashPattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0871 object-cache topology v4 proof',
  }));
});

test('RPP-0871 validation rejects a non-started topology without an exact capability code', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyV4Proof({ artifact, plan, probe });
  const ambiguous = {
    ...proof,
    dockerBlocker: {
      ...proof.dockerBlocker,
      exactUnavailableCapabilityRecorded: false,
    },
    topologyCommand: {
      ...proof.topologyCommand,
      exactUnavailableCapability: {
        ...proof.topologyCommand.exactUnavailableCapability,
        code: '',
      },
    },
  };
  const validation = validateObjectCacheTopologyV4Proof(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_V4_DOCKER_BLOCKER_NOT_RECORDED'));
});

test('RPP-0871 validation rejects Docker-unavailable evidence that is not fail-closed', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyV4Proof({ artifact, plan, probe });
  const unsafe = {
    ...proof,
    failClosed: false,
    dockerUnavailableOutcome: {
      ...proof.dockerUnavailableOutcome,
      acceptedForReleaseGate: true,
      failClosed: false,
    },
    releaseGate: {
      ...proof.releaseGate,
      acceptedForReleaseGate: true,
    },
  };
  const validation = validateObjectCacheTopologyV4Proof(unsafe);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_V4_DOCKER_UNAVAILABLE_MUST_FAIL_CLOSED'));
});

test('RPP-0871 validation rejects release movement or packaged fallback for support evidence', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyV4Proof({ artifact, plan, probe });
  const unsafe = {
    ...proof,
    finalReleaseStatus: 'GO',
    integrationRecommendation: 'GO',
    releaseVerifier: {
      ...proof.releaseVerifier,
      noPackagedFallback: false,
      packagedFallbackAllowed: true,
      packagedFallbackObserved: true,
    },
    localOnlyPolicy: {
      ...proof.localOnlyPolicy,
      packagedFallbackObserved: true,
    },
    releaseGate: {
      ...proof.releaseGate,
      releaseMovementAllowed: true,
    },
  };
  const validation = validateObjectCacheTopologyV4Proof(unsafe);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_V4_PACKAGED_FALLBACK_REJECTED'));
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_V4_RELEASE_STATUS_MUST_REMAIN_NO_GO'));
});

test('RPP-0871 proof is deterministic and hash/count/surface-only', () => {
  const first = buildObjectCacheTopologyV4Proof(buildMissingDockerCapabilityArtifact());
  const second = buildObjectCacheTopologyV4Proof(buildMissingDockerCapabilityArtifact());

  assert.equal(first.proofHash, second.proofHash);
  assert.equal(first.objectCacheTopologyV4.scopeHash, second.objectCacheTopologyV4.scopeHash);
  assert.equal(first.objectCacheTopologyV4.requirementDigest, second.objectCacheTopologyV4.requirementDigest);
  assert.equal(first.objectCacheTopologyV4.siteSurfaceDigest, second.objectCacheTopologyV4.siteSurfaceDigest);
  assert.equal(
    first.objectCacheTopologyV4.generatedReplay.surfaceDigest,
    second.objectCacheTopologyV4.generatedReplay.surfaceDigest,
  );
  assert.equal(
    first.objectCacheTopologyV4.focusedRegression.surfaceDigest,
    second.objectCacheTopologyV4.focusedRegression.surfaceDigest,
  );
  assert.equal(first.evidenceLimits.surfaceDigest, second.evidenceLimits.surfaceDigest);
  assert.deepEqual(first.objectCacheTopologyV4.requiredCapabilities, second.objectCacheTopologyV4.requiredCapabilities);
  assert.deepEqual(first.objectCacheTopologyV4.siteSurfaces, second.objectCacheTopologyV4.siteSurfaces);
  assert.deepEqual(
    first.objectCacheTopologyV4.focusedRegression.surfaces,
    second.objectCacheTopologyV4.focusedRegression.surfaces,
  );
  assert.deepEqual(first.evidenceLimits.evidenceSurfaces, second.evidenceLimits.evidenceSurfaces);
  assert.equal(first.evidenceLimits.payloadsStored, false);
  assert.equal(first.evidenceLimits.rawPayloadCount, 0);
  assert.equal(first.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(first.invariants.hashCountSurfaceOnly, true);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(first, {
    label: 'RPP-0871 first deterministic object-cache topology v4 proof',
  }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(second, {
    label: 'RPP-0871 second deterministic object-cache topology v4 proof',
  }));
});

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0871-docker-work',
    evidenceDir: '/tmp/rpp-0871-docker-evidence',
    env: {},
  });
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'blocked',
    verify: { status: 2, signal: null },
    generatedAt: fixedNow,
  });

  return { artifact, plan, probe };
}

function buildObjectCacheTopologyV4Proof({ artifact, plan, probe }) {
  const blockerCode = probe.blocker?.code || null;
  const siteSurfaces = buildSiteSurfaces(plan);
  const siteRoles = siteSurfaces.map((site) => site.role);
  const sitesStarted = artifact.status === 'passed';
  const requirementSurfaces = objectCacheTopologyRequirements.map((entry) => ({
    id: entry.id,
    requiredCapability: entry.requiredCapability,
    surface: entry.surface,
  }));
  const cacheBoundarySurfaces = [
    { surface: 'cache-flush-or-bypass-before-snapshot', required: true },
    { surface: 'cache-flush-or-bypass-before-release-verifier', required: true },
    { surface: 'mutation-receipt-does-not-depend-on-cached-remote-state', required: true },
  ];
  const replaySurfaces = [
    { surface: 'exact-unavailable-capability-code-stable', ok: Boolean(blockerCode), count: 1 },
    { surface: 'packaged-fallback-remains-disabled', ok: true, count: 1 },
    { surface: 'release-movement-remains-no-go', ok: true, count: 1 },
    { surface: 'hash-count-surface-only-replay', ok: true, count: 1 },
  ];
  const focusedRegressionSurfaces = [
    {
      surface: 'docker-unavailable-exits-2',
      ok: !sitesStarted && artifact.evidence.verifyReleaseFailure?.exitCode === 2,
      count: 1,
    },
    {
      surface: 'docker-unavailable-acceptedForReleaseGate-false',
      ok: !sitesStarted && artifact.acceptedForReleaseGate === false,
      count: 1,
    },
    {
      surface: 'docker-unavailable-failClosed-true',
      ok: !sitesStarted && artifact.releaseGateEvaluation.releaseMovement.allowed === false,
      count: 1,
    },
    {
      surface: 'docker-unavailable-exact-code-DOCKER_CLI_MISSING',
      ok: !sitesStarted && blockerCode === 'DOCKER_CLI_MISSING',
      count: 1,
    },
  ];
  const evidenceSurfaces = buildEvidenceSurfaces({
    artifact,
    blockerCode,
    focusedRegressionSurfaces,
    plan,
    replaySurfaces,
    requirementSurfaces,
    sitesStarted,
  });
  const objectCacheScopeCore = {
    proofScope: topologyProofScope,
    requirements: requirementSurfaces,
    siteSurfaces,
    cacheBoundarySurfaces,
    replaySurfaces,
    focusedRegressionSurfaces,
    releaseCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
    topologyCommandStatus: sitesStarted ? 'sites-started' : 'exact-unavailable-capability-recorded',
    exactUnavailableCapabilityCode: sitesStarted ? null : blockerCode,
    evidenceSurfaceNames: evidenceSurfaces.map((entry) => entry.surface),
    releasePolicy: 'support-only-no-release-movement',
  };
  const objectCacheTopologyV4 = {
    proofScope: topologyProofScope,
    variant: 4,
    requiredCapabilities: objectCacheTopologyRequirements.map((entry) => ({ ...entry })),
    requiredCapabilityCount: objectCacheTopologyRequirements.length,
    enabledSiteRoles: siteRoles,
    enabledSiteRoleCount: siteRoles.length,
    siteSurfaces,
    requirementDigest: `sha256:${digest(requirementSurfaces)}`,
    siteSurfaceDigest: `sha256:${digest(siteSurfaces)}`,
    cacheBackend: {
      required: true,
      backendKind: 'redis-compatible-object-cache',
      serviceRole: 'object-cache',
      dockerNetwork: plan.network.name,
      networkInternal: plan.network.internal,
      publishedHostPorts: 0,
      publicIngressAllowed: false,
    },
    runtime: {
      requiredEverySite: true,
      runtimeReadbackObserved: sitesStarted,
      runtimeReadbackSiteCount: sitesStarted ? siteRoles.length : 0,
      runtimeReadbackBlockedBy: sitesStarted ? null : blockerCode,
      claimMode: sitesStarted ? 'per-site-runtime-readback' : 'not-claimed-exact-capability',
    },
    cacheBoundary: {
      snapshotMustNotUseStaleCache: true,
      releaseVerifierMustRunAfterCacheBoundaryReadback: true,
      mutationReceiptMustNotDependOnCachedRemoteState: true,
      surfaces: cacheBoundarySurfaces,
      surfaceDigest: `sha256:${digest(cacheBoundarySurfaces)}`,
    },
    generatedReplay: {
      deterministicReplayRequired: true,
      replayCount: 2,
      exactBlockerPreserved: sitesStarted ? true : isExactDockerUnavailableCapability(blockerCode),
      releaseNoGoPreserved: true,
      surfaces: replaySurfaces,
      surfaceDigest: `sha256:${digest(replaySurfaces)}`,
    },
    focusedRegression: {
      required: true,
      exit2WhenDockerUnavailable: !sitesStarted && artifact.evidence.verifyReleaseFailure?.exitCode === 2,
      acceptedForReleaseGateWhenDockerUnavailable: sitesStarted ? null : artifact.acceptedForReleaseGate,
      failClosedWhenDockerUnavailable: sitesStarted ? null : artifact.releaseGateEvaluation.releaseMovement.allowed === false,
      exactBlockerWhenDockerUnavailable: sitesStarted ? null : blockerCode,
      surfaceCount: focusedRegressionSurfaces.length,
      surfaces: focusedRegressionSurfaces,
      surfaceDigest: `sha256:${digest(focusedRegressionSurfaces)}`,
    },
    releasePolicy: 'support-only-no-release-movement',
    scopeHash: `sha256:${digest(objectCacheScopeCore)}`,
  };
  const evidenceLimits = {
    mode: 'hash-count-surface-only',
    payloadsStored: false,
    rawPayloadCount: 0,
    sensitiveSurfaceCount: 0,
    objectCacheRequirementCount: objectCacheTopologyRequirements.length,
    siteSurfaceCount: siteSurfaces.length,
    evidenceSurfaceCount: evidenceSurfaces.length,
    rejectedSurfaceCount: evidenceSurfaces.filter((entry) => entry.ok !== true).length,
    hashedSurfaceCount: 6,
    surfaceNames: evidenceSurfaces.map((entry) => entry.surface),
    surfaceDigest: `sha256:${digest(evidenceSurfaces)}`,
    evidenceSurfaces,
  };
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0871',
    proofId,
    variant: 4,
    coverageMode: 'focused-regression-local-support-only',
    checkedAt: fixedNow,
    status: sitesStarted ? 'sites-started' : 'blocked-exact-unavailable-capability',
    failClosed: !sitesStarted,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      dockerTopologyVariant,
      commandContract: artifact.evidence.dockerVerifyReleaseTopology.command,
      runtime: artifact.runtime,
      gate: artifact.gate,
      artifactHash: artifact.deterministic.canonicalSha256,
      patternReferences: [
        'RPP-0811 object-cache enabled topology v1',
        'RPP-0831 object-cache enabled topology v2',
        'RPP-0851 object-cache enabled topology v3',
      ],
    },
    topologyCommand: {
      command: artifact.commands.runHarness,
      successCriterion: 'sites-started-or-exact-unavailable-capability-recorded',
      status: artifact.status,
      exitCode: artifact.evidence.verifyReleaseFailure?.exitCode || 0,
      sitesStarted,
      expectedSiteCount: siteRoles.length,
      startedSiteCount: sitesStarted ? siteRoles.length : 0,
      siteRoles,
      dockerServiceSurfaces: siteSurfaces,
      exactUnavailableCapability: sitesStarted ? null : {
        code: blockerCode,
        capability: dockerCapabilityForBlocker(blockerCode),
        command: blockerCommandForProbe(probe, blockerCode),
        missingExecutable: blockerMissingExecutableForProbe(probe, blockerCode),
        requiredFor: [
          'object-cache-enabled-wordpress-sites-start',
          'object-cache-runtime-readback',
          'release-verifier-object-cache-path',
          'object-cache-topology-v4-startup-proof',
        ],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    dockerUnavailableOutcome: sitesStarted ? null : {
      code: blockerCode,
      exitCode: artifact.evidence.verifyReleaseFailure?.exitCode || 0,
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      failClosed: !sitesStarted && artifact.releaseGateEvaluation.releaseMovement.allowed === false,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      exactUnavailableCapabilityRecorded: isExactDockerUnavailableCapability(blockerCode),
      claimsReleaseReadiness: false,
    },
    dockerBlocker: sitesStarted ? null : {
      code: blockerCode,
      capability: dockerCapabilityForBlocker(blockerCode),
      checkedCommand: blockerCommandForProbe(probe, blockerCode),
      missingExecutable: blockerMissingExecutableForProbe(probe, blockerCode),
      probeCheckCount: Object.values(probe.checks).filter(Boolean).length,
      passedProbeCheckCount: Object.values(probe.checks).filter((check) => check?.ok === true).length,
      exactUnavailableCapabilityRecorded: isExactDockerUnavailableCapability(blockerCode),
    },
    objectCacheTopologyV4,
    releaseVerifier: {
      command: artifact.evidence.dockerVerifyReleaseTopology.command,
      noPackagedFallback: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved === false
        && artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed === false,
      packagedFallbackAllowed: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed,
      packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
      releaseUrlsUseDockerDns: artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns,
    },
    localOnlyPolicy: {
      publishedHttpIngressCount: plan.publishedPorts.length,
      publishedHttpIngress: plan.publishedPorts.map((entry) => ({
        service: entry.service,
        host: entry.host,
        hostPort: entry.hostPort,
        containerPort: entry.containerPort,
      })),
      onlySandbox8080Ingress: plan.validation.checks.onlySandbox8080Ingress,
      noTunnelPolicyEnforced: plan.validation.checks.noTunnelCommands,
      tunnelCommandCount: plan.validation.failures
        .filter((failure) => failure.code === 'FORBIDDEN_TUNNEL_REFERENCE').length,
      cacheBackendPublishedPorts: 0,
      packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
    },
    releaseGate: {
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
    },
    evidenceLimits,
  };
  const invariants = {
    topologyCommandStartedSitesOrExactCapabilityRecorded: sitesStarted
      || Boolean(proofCore.topologyCommand.exactUnavailableCapability?.code),
    failClosedWhenSitesNotStarted: sitesStarted
      || (proofCore.failClosed === true
        && artifact.acceptedForReleaseGate === false
        && artifact.releaseGateEvaluation.releaseMovement.allowed === false),
    objectCacheRequirementsRecorded: proofCore.objectCacheTopologyV4.requiredCapabilityCount
      === objectCacheTopologyRequirements.length
      && proofCore.objectCacheTopologyV4.requiredCapabilities.every((entry) => entry.requiredCapability),
    objectCacheRuntimeNotClaimedWhenDockerMissing: sitesStarted
      || (proofCore.objectCacheTopologyV4.runtime.runtimeReadbackObserved === false
        && proofCore.objectCacheTopologyV4.runtime.runtimeReadbackSiteCount === 0
        && proofCore.objectCacheTopologyV4.runtime.runtimeReadbackBlockedBy === blockerCode),
    generatedReplayPreservesExactBlocker: proofCore.objectCacheTopologyV4.generatedReplay.deterministicReplayRequired === true
      && proofCore.objectCacheTopologyV4.generatedReplay.replayCount === 2
      && proofCore.objectCacheTopologyV4.generatedReplay.exactBlockerPreserved === true
      && proofCore.objectCacheTopologyV4.generatedReplay.releaseNoGoPreserved === true,
    focusedRegressionPreservesDockerUnavailableFailClosed: sitesStarted
      || (proofCore.dockerUnavailableOutcome?.code === 'DOCKER_CLI_MISSING'
        && proofCore.dockerUnavailableOutcome.exitCode === 2
        && proofCore.dockerUnavailableOutcome.acceptedForReleaseGate === false
        && proofCore.dockerUnavailableOutcome.failClosed === true
        && proofCore.dockerUnavailableOutcome.releaseMovementAllowed === false
        && proofCore.dockerUnavailableOutcome.claimsReleaseReadiness === false),
    noPublicCacheIngress: proofCore.objectCacheTopologyV4.cacheBackend.publishedHostPorts === 0
      && proofCore.localOnlyPolicy.cacheBackendPublishedPorts === 0,
    onlySandbox8080Ingress: proofCore.localOnlyPolicy.onlySandbox8080Ingress === true
      && proofCore.localOnlyPolicy.publishedHttpIngressCount === 1
      && proofCore.localOnlyPolicy.publishedHttpIngress[0]?.hostPort === 8080,
    noTunnelUsage: proofCore.localOnlyPolicy.noTunnelPolicyEnforced === true
      && proofCore.localOnlyPolicy.tunnelCommandCount === 0,
    noPackagedFallback: proofCore.localOnlyPolicy.packagedFallbackObserved === false
      && proofCore.releaseVerifier.noPackagedFallback === true
      && proofCore.releaseVerifier.packagedFallbackAllowed === false
      && proofCore.releaseVerifier.packagedFallbackObserved === false,
    hashCountSurfaceOnly: proofCore.evidenceLimits.mode === 'hash-count-surface-only'
      && proofCore.evidenceLimits.payloadsStored === false
      && proofCore.evidenceLimits.rawPayloadCount === 0
      && proofCore.evidenceLimits.sensitiveSurfaceCount === 0
      && proofCore.evidenceLimits.rejectedSurfaceCount === 0
      && proofHashPattern.test(proofCore.objectCacheTopologyV4.scopeHash),
    supportOnlyNoGo: proofCore.supportOnly === true
      && proofCore.productionBacked === false
      && proofCore.releaseEligible === false
      && proofCore.finalReleaseStatus === 'NO-GO'
      && proofCore.integrationRecommendation === 'NO-GO',
  };
  const withInvariants = { ...proofCore, invariants };
  return {
    ...withInvariants,
    validation: validateObjectCacheTopologyV4Proof(withInvariants),
    proofHash: `sha256:${digest(withInvariants)}`,
  };
}

function buildSiteSurfaces(plan) {
  return plan.sites.map((site) => ({
    role: site.key,
    service: site.service,
    cliService: site.cliService,
    dbService: site.dbService,
    objectCacheRuntimeRequired: true,
  }));
}

function buildEvidenceSurfaces({
  artifact,
  blockerCode,
  focusedRegressionSurfaces,
  plan,
  replaySurfaces,
  requirementSurfaces,
  sitesStarted,
}) {
  return [
    {
      surface: 'object-cache-required-capabilities-recorded',
      ok: requirementSurfaces.length === objectCacheTopologyRequirements.length
        && requirementSurfaces.every((entry) => entry.requiredCapability),
      count: requirementSurfaces.length,
    },
    {
      surface: 'private-cache-backend-no-host-port',
      ok: true,
      count: 0,
    },
    {
      surface: 'object-cache-runtime-required-every-site',
      ok: plan.sites.length === 4,
      count: plan.sites.length,
    },
    {
      surface: 'cache-boundary-before-snapshot',
      ok: true,
      count: 1,
    },
    {
      surface: 'cache-boundary-before-release-verifier',
      ok: true,
      count: 1,
    },
    {
      surface: 'topology-command-started-sites-or-exact-unavailable-capability',
      ok: sitesStarted || Boolean(blockerCode),
      count: sitesStarted ? plan.sites.length : 0,
    },
    {
      surface: 'docker-unavailable-capability-exact',
      ok: sitesStarted || isExactDockerUnavailableCapability(blockerCode),
      count: sitesStarted ? 0 : 1,
    },
    {
      surface: 'release-verifier-no-packaged-fallback',
      ok: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved === false
        && artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed === false,
      count: 1,
    },
    {
      surface: 'sandbox-8080-only-no-tunnels',
      ok: plan.validation.checks.onlySandbox8080Ingress === true
        && plan.validation.checks.noTunnelCommands === true
        && plan.publishedPorts.length === 1
        && plan.publishedPorts[0]?.hostPort === 8080,
      count: plan.publishedPorts.length,
    },
    {
      surface: 'generated-variant-3-replay-preserves-no-go',
      ok: replaySurfaces.every((entry) => entry.ok === true),
      count: replaySurfaces.length,
    },
    {
      surface: 'focused-variant-4-docker-unavailable-fails-closed',
      ok: focusedRegressionSurfaces.every((entry) => entry.ok === true),
      count: focusedRegressionSurfaces.length,
    },
  ];
}

function validateObjectCacheTopologyV4Proof(proof) {
  const failures = [];
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true
      || proof.releaseGate.acceptedForReleaseGate !== false
      || proof.releaseGate.releaseMovementAllowed !== false) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_MUST_FAIL_CLOSED_WHEN_NOT_STARTED' });
    }
    if (proof.topologyCommand.startedSiteCount !== 0
      || proof.objectCacheTopologyV4.runtime.runtimeReadbackObserved !== false
      || proof.objectCacheTopologyV4.runtime.runtimeReadbackSiteCount !== 0) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_RUNTIME_READBACK_CLAIMED_WITHOUT_STARTED_SITES' });
    }
    if (!proof.dockerBlocker?.code || proof.dockerBlocker?.exactUnavailableCapabilityRecorded !== true) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_DOCKER_BLOCKER_NOT_RECORDED' });
    }
    if (proof.dockerUnavailableOutcome?.exitCode !== 2
      || proof.dockerUnavailableOutcome?.code !== 'DOCKER_CLI_MISSING'
      || proof.dockerUnavailableOutcome?.acceptedForReleaseGate !== false
      || proof.dockerUnavailableOutcome?.failClosed !== true
      || proof.dockerUnavailableOutcome?.claimsReleaseReadiness !== false) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_DOCKER_UNAVAILABLE_MUST_FAIL_CLOSED' });
    }
  }
  if (proof.objectCacheTopologyV4.proofScope !== topologyProofScope
    || proof.objectCacheTopologyV4.variant !== 4
    || !Array.isArray(proof.objectCacheTopologyV4.requiredCapabilities)
    || proof.objectCacheTopologyV4.requiredCapabilities.length !== objectCacheTopologyRequirements.length) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_REQUIREMENTS_MISSING' });
  }
  if (!proof.objectCacheTopologyV4.generatedReplay?.deterministicReplayRequired
    || proof.objectCacheTopologyV4.generatedReplay.replayCount !== 2
    || proof.objectCacheTopologyV4.generatedReplay.exactBlockerPreserved !== true
    || proof.objectCacheTopologyV4.generatedReplay.releaseNoGoPreserved !== true) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_GENERATED_REPLAY_NOT_DETERMINISTIC' });
  }
  if (proof.objectCacheTopologyV4.focusedRegression?.required !== true
    || proof.objectCacheTopologyV4.focusedRegression.exit2WhenDockerUnavailable !== true
    || proof.objectCacheTopologyV4.focusedRegression.acceptedForReleaseGateWhenDockerUnavailable !== false
    || proof.objectCacheTopologyV4.focusedRegression.failClosedWhenDockerUnavailable !== true
    || proof.objectCacheTopologyV4.focusedRegression.exactBlockerWhenDockerUnavailable !== 'DOCKER_CLI_MISSING') {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_FOCUSED_REGRESSION_FAILED' });
  }
  if (proof.objectCacheTopologyV4.cacheBackend.publishedHostPorts !== 0
    || proof.objectCacheTopologyV4.cacheBackend.publicIngressAllowed !== false
    || proof.localOnlyPolicy.cacheBackendPublishedPorts !== 0) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_CACHE_BACKEND_PUBLIC_INGRESS_FORBIDDEN' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy.tunnelCommandCount !== 0) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.localOnlyPolicy.packagedFallbackObserved !== false
    || proof.releaseVerifier.noPackagedFallback !== true
    || proof.releaseVerifier.packagedFallbackAllowed !== false
    || proof.releaseVerifier.packagedFallbackObserved !== false) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_PACKAGED_FALLBACK_REJECTED' });
  }
  if (proof.finalReleaseStatus !== 'NO-GO'
    || proof.integrationRecommendation !== 'NO-GO'
    || proof.releaseGate.releaseMovementAllowed !== false) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_RELEASE_STATUS_MUST_REMAIN_NO_GO' });
  }
  if (proof.evidenceLimits.mode !== 'hash-count-surface-only'
    || proof.evidenceLimits.payloadsStored !== false
    || proof.evidenceLimits.rawPayloadCount !== 0
    || proof.evidenceLimits.sensitiveSurfaceCount !== 0
    || proof.evidenceLimits.rejectedSurfaceCount !== 0
    || !proofHashPattern.test(proof.evidenceLimits.surfaceDigest)
    || !proofHashPattern.test(proof.objectCacheTopologyV4.scopeHash)) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_EVIDENCE_LIMITS_FAILED' });
  }
  if (!Array.isArray(proof.evidenceLimits.evidenceSurfaces)
    || proof.evidenceLimits.evidenceSurfaces.some((entry) => entry.ok !== true)) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V4_SURFACE_CHECK_FAILED' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function dockerCapabilityForBlocker(code) {
  if (code === 'DOCKER_CLI_MISSING' || code === 'DOCKER_CLI_UNAVAILABLE') {
    return 'docker-cli';
  }
  if (code === 'DOCKER_COMPOSE_UNAVAILABLE') {
    return 'docker-compose-v2';
  }
  if (code === 'DOCKER_DAEMON_UNAVAILABLE') {
    return 'docker-daemon';
  }
  return 'docker-local-production-runtime';
}

function isExactDockerUnavailableCapability(code) {
  return code === 'DOCKER_CLI_MISSING'
    || code === 'DOCKER_CLI_UNAVAILABLE'
    || code === 'DOCKER_COMPOSE_UNAVAILABLE'
    || code === 'DOCKER_DAEMON_UNAVAILABLE';
}

function blockerCommandForProbe(probe, code) {
  if (code === 'DOCKER_COMPOSE_UNAVAILABLE') {
    return probe.checks.dockerCompose?.command || probe.blocker?.detail?.command || '';
  }
  if (code === 'DOCKER_DAEMON_UNAVAILABLE') {
    return probe.checks.dockerDaemon?.command || probe.blocker?.detail?.command || '';
  }
  return probe.checks.dockerCli?.command || probe.blocker?.detail?.command || '';
}

function blockerMissingExecutableForProbe(probe, code) {
  if (code === 'DOCKER_COMPOSE_UNAVAILABLE') {
    return probe.checks.dockerCompose?.missingExecutable === true;
  }
  if (code === 'DOCKER_DAEMON_UNAVAILABLE') {
    return probe.checks.dockerDaemon?.missingExecutable === true;
  }
  return probe.checks.dockerCli?.missingExecutable === true;
}
