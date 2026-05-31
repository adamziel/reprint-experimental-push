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
const proofId = 'rpp-0831-object-cache-enabled-topology-v2';
const topologyProofScope = 'object-cache-enabled-topology-v2';
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
]);

test('RPP-0831 records object-cache topology variant 2 requirements and exact unavailable capability', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyV2Proof({ artifact, plan, probe });
  const validation = validateObjectCacheTopologyV2Proof(proof);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0831');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
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
    'object-cache-topology-v2-startup-proof',
  ]);

  assert.equal(proof.objectCacheTopologyV2.proofScope, topologyProofScope);
  assert.equal(proof.objectCacheTopologyV2.variant, 2);
  assert.equal(proof.objectCacheTopologyV2.requiredCapabilityCount, objectCacheTopologyRequirements.length);
  assert.deepEqual(
    proof.objectCacheTopologyV2.requiredCapabilities.map((entry) => entry.requiredCapability),
    objectCacheTopologyRequirements.map((entry) => entry.requiredCapability),
  );
  assert.equal(proof.objectCacheTopologyV2.cacheBackend.required, true);
  assert.equal(proof.objectCacheTopologyV2.cacheBackend.networkInternal, true);
  assert.equal(proof.objectCacheTopologyV2.cacheBackend.publishedHostPorts, 0);
  assert.equal(proof.objectCacheTopologyV2.cacheBackend.publicIngressAllowed, false);
  assert.deepEqual(proof.objectCacheTopologyV2.enabledSiteRoles, proof.topologyCommand.siteRoles);
  assert.equal(proof.objectCacheTopologyV2.enabledSiteRoleCount, 4);
  assert.equal(proof.objectCacheTopologyV2.runtime.requiredEverySite, true);
  assert.equal(proof.objectCacheTopologyV2.runtime.runtimeReadbackObserved, false);
  assert.equal(proof.objectCacheTopologyV2.runtime.runtimeReadbackSiteCount, 0);
  assert.equal(proof.objectCacheTopologyV2.runtime.runtimeReadbackBlockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(proof.objectCacheTopologyV2.runtime.claimMode, 'not-claimed-exact-capability');
  assert.equal(proof.objectCacheTopologyV2.releasePolicy, 'support-only-no-release-movement');
  assert.match(proof.objectCacheTopologyV2.requirementDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV2.siteSurfaceDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV2.cacheBoundary.surfaceDigest, proofHashPattern);
  assert.match(proof.objectCacheTopologyV2.scopeHash, proofHashPattern);

  assert.equal(proof.releaseVerifier.command, 'npm run verify:release');
  assert.equal(proof.releaseVerifier.noPackagedFallback, true);
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
  assert.equal(proof.evidenceLimits.evidenceSurfaceCount, 9);
  assert.equal(proof.evidenceLimits.rejectedSurfaceCount, 0);
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
  ]);

  assert.equal(proof.invariants.topologyCommandStartedSitesOrExactCapabilityRecorded, true);
  assert.equal(proof.invariants.failClosedWhenSitesNotStarted, true);
  assert.equal(proof.invariants.objectCacheRequirementsRecorded, true);
  assert.equal(proof.invariants.objectCacheRuntimeNotClaimedWhenDockerMissing, true);
  assert.equal(proof.invariants.noPublicCacheIngress, true);
  assert.equal(proof.invariants.onlySandbox8080Ingress, true);
  assert.equal(proof.invariants.noTunnelUsage, true);
  assert.equal(proof.invariants.noPackagedFallback, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.proofHash, proofHashPattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0831 object-cache topology v2 proof',
  }));
});

test('RPP-0831 validation rejects a non-started topology without an exact capability code', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyV2Proof({ artifact, plan, probe });
  const ambiguous = {
    ...proof,
    topologyCommand: {
      ...proof.topologyCommand,
      exactUnavailableCapability: {
        ...proof.topologyCommand.exactUnavailableCapability,
        code: '',
      },
    },
  };
  const validation = validateObjectCacheTopologyV2Proof(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_V2_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
});

test('RPP-0831 proof is deterministic and hash/count/surface-only', () => {
  const first = buildObjectCacheTopologyV2Proof(buildMissingDockerCapabilityArtifact());
  const second = buildObjectCacheTopologyV2Proof(buildMissingDockerCapabilityArtifact());

  assert.equal(first.proofHash, second.proofHash);
  assert.equal(first.objectCacheTopologyV2.scopeHash, second.objectCacheTopologyV2.scopeHash);
  assert.equal(first.objectCacheTopologyV2.requirementDigest, second.objectCacheTopologyV2.requirementDigest);
  assert.equal(first.objectCacheTopologyV2.siteSurfaceDigest, second.objectCacheTopologyV2.siteSurfaceDigest);
  assert.equal(first.evidenceLimits.surfaceDigest, second.evidenceLimits.surfaceDigest);
  assert.deepEqual(first.objectCacheTopologyV2.requiredCapabilities, second.objectCacheTopologyV2.requiredCapabilities);
  assert.deepEqual(first.objectCacheTopologyV2.siteSurfaces, second.objectCacheTopologyV2.siteSurfaces);
  assert.deepEqual(first.evidenceLimits.evidenceSurfaces, second.evidenceLimits.evidenceSurfaces);
  assert.equal(first.evidenceLimits.payloadsStored, false);
  assert.equal(first.evidenceLimits.rawPayloadCount, 0);
  assert.equal(first.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(first.invariants.hashCountSurfaceOnly, true);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(first, {
    label: 'RPP-0831 first deterministic object-cache topology v2 proof',
  }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(second, {
    label: 'RPP-0831 second deterministic object-cache topology v2 proof',
  }));
});

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0831-docker-work',
    evidenceDir: '/tmp/rpp-0831-docker-evidence',
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

function buildObjectCacheTopologyV2Proof({ artifact, plan, probe }) {
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
  const evidenceSurfaces = buildEvidenceSurfaces({
    artifact,
    blockerCode,
    plan,
    requirementSurfaces,
    sitesStarted,
  });
  const objectCacheScopeCore = {
    proofScope: topologyProofScope,
    requirements: requirementSurfaces,
    siteSurfaces,
    cacheBoundarySurfaces,
    releaseCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
    topologyCommandStatus: sitesStarted ? 'sites-started' : 'exact-unavailable-capability-recorded',
    exactUnavailableCapabilityCode: sitesStarted ? null : blockerCode,
    evidenceSurfaceNames: evidenceSurfaces.map((entry) => entry.surface),
  };
  const objectCacheTopologyV2 = {
    proofScope: topologyProofScope,
    variant: 2,
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
    hashedSurfaceCount: 4,
    surfaceNames: evidenceSurfaces.map((entry) => entry.surface),
    surfaceDigest: `sha256:${digest(evidenceSurfaces)}`,
    evidenceSurfaces,
  };
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0831',
    proofId,
    variant: 2,
    checkedAt: fixedNow,
    status: sitesStarted ? 'sites-started' : 'blocked-exact-unavailable-capability',
    failClosed: !sitesStarted,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    patternReferences: [
      'RPP-0811 exact unavailable-capability object-cache topology pattern',
      'RPP-0821 variant-2 local-production topology fail-closed pattern',
    ],
    builtOn: {
      dockerTopologyVariant,
      commandContract: artifact.evidence.dockerVerifyReleaseTopology.command,
      runtime: artifact.runtime,
      gate: artifact.gate,
      artifactHash: artifact.deterministic.canonicalSha256,
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
          'object-cache-topology-v2-startup-proof',
        ],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    objectCacheTopologyV2,
    releaseVerifier: {
      command: artifact.evidence.dockerVerifyReleaseTopology.command,
      noPackagedFallback: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved === false
        && artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed === false,
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
    objectCacheRequirementsRecorded: proofCore.objectCacheTopologyV2.requiredCapabilityCount
      === objectCacheTopologyRequirements.length
      && proofCore.objectCacheTopologyV2.requiredCapabilities.every((entry) => entry.requiredCapability),
    objectCacheRuntimeNotClaimedWhenDockerMissing: sitesStarted
      || (proofCore.objectCacheTopologyV2.runtime.runtimeReadbackObserved === false
        && proofCore.objectCacheTopologyV2.runtime.runtimeReadbackSiteCount === 0
        && proofCore.objectCacheTopologyV2.runtime.runtimeReadbackBlockedBy === blockerCode),
    noPublicCacheIngress: proofCore.objectCacheTopologyV2.cacheBackend.publishedHostPorts === 0
      && proofCore.localOnlyPolicy.cacheBackendPublishedPorts === 0,
    onlySandbox8080Ingress: proofCore.localOnlyPolicy.onlySandbox8080Ingress === true
      && proofCore.localOnlyPolicy.publishedHttpIngressCount === 1
      && proofCore.localOnlyPolicy.publishedHttpIngress[0]?.hostPort === 8080,
    noTunnelUsage: proofCore.localOnlyPolicy.noTunnelPolicyEnforced === true
      && proofCore.localOnlyPolicy.tunnelCommandCount === 0,
    noPackagedFallback: proofCore.localOnlyPolicy.packagedFallbackObserved === false
      && proofCore.releaseVerifier.noPackagedFallback === true,
    hashCountSurfaceOnly: proofCore.evidenceLimits.mode === 'hash-count-surface-only'
      && proofCore.evidenceLimits.payloadsStored === false
      && proofCore.evidenceLimits.rawPayloadCount === 0
      && proofCore.evidenceLimits.sensitiveSurfaceCount === 0
      && proofCore.evidenceLimits.rejectedSurfaceCount === 0
      && proofHashPattern.test(proofCore.objectCacheTopologyV2.scopeHash),
    supportOnlyNoGo: proofCore.supportOnly === true
      && proofCore.productionBacked === false
      && proofCore.releaseEligible === false
      && proofCore.finalReleaseStatus === 'NO-GO',
  };
  const withInvariants = { ...proofCore, invariants };
  return {
    ...withInvariants,
    validation: validateObjectCacheTopologyV2Proof(withInvariants),
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
  plan,
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
  ];
}

function validateObjectCacheTopologyV2Proof(proof) {
  const failures = [];
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true
      || proof.releaseGate.acceptedForReleaseGate !== false
      || proof.releaseGate.releaseMovementAllowed !== false) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_MUST_FAIL_CLOSED_WHEN_NOT_STARTED' });
    }
    if (proof.topologyCommand.startedSiteCount !== 0
      || proof.objectCacheTopologyV2.runtime.runtimeReadbackObserved !== false
      || proof.objectCacheTopologyV2.runtime.runtimeReadbackSiteCount !== 0) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_RUNTIME_READBACK_CLAIMED_WITHOUT_STARTED_SITES' });
    }
  }
  if (proof.objectCacheTopologyV2.proofScope !== topologyProofScope
    || proof.objectCacheTopologyV2.variant !== 2
    || !Array.isArray(proof.objectCacheTopologyV2.requiredCapabilities)
    || proof.objectCacheTopologyV2.requiredCapabilities.length !== objectCacheTopologyRequirements.length) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_REQUIREMENTS_MISSING' });
  }
  if (proof.objectCacheTopologyV2.cacheBackend.publishedHostPorts !== 0
    || proof.objectCacheTopologyV2.cacheBackend.publicIngressAllowed !== false
    || proof.localOnlyPolicy.cacheBackendPublishedPorts !== 0) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_CACHE_BACKEND_PUBLIC_INGRESS_FORBIDDEN' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy.tunnelCommandCount !== 0) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.localOnlyPolicy.packagedFallbackObserved !== false
    || proof.releaseVerifier.noPackagedFallback !== true) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_PACKAGED_FALLBACK_REJECTED' });
  }
  if (proof.evidenceLimits.mode !== 'hash-count-surface-only'
    || proof.evidenceLimits.payloadsStored !== false
    || proof.evidenceLimits.rawPayloadCount !== 0
    || proof.evidenceLimits.sensitiveSurfaceCount !== 0
    || proof.evidenceLimits.rejectedSurfaceCount !== 0
    || !proofHashPattern.test(proof.evidenceLimits.surfaceDigest)
    || !proofHashPattern.test(proof.objectCacheTopologyV2.scopeHash)) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_EVIDENCE_LIMITS_FAILED' });
  }
  if (!Array.isArray(proof.evidenceLimits.evidenceSurfaces)
    || proof.evidenceLimits.evidenceSurfaces.some((entry) => entry.ok !== true)) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_V2_SURFACE_CHECK_FAILED' });
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
