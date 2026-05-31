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
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;

const objectCacheTopologyRequirements = Object.freeze([
  Object.freeze({
    id: 'private-object-cache-backend',
    requiredCapability: 'object-cache-backend-private-network',
    requirement: 'redis-compatible-cache-service-on-docker-network',
    publishedHostPorts: 0,
  }),
  Object.freeze({
    id: 'object-cache-runtime-enabled-every-site',
    requiredCapability: 'wordpress-object-cache-runtime-every-site',
    requirement: 'object-cache-dropin-or-equivalent-runtime-enabled-before-seed',
    evidenceRequired: 'per-site-runtime-readback',
  }),
  Object.freeze({
    id: 'cache-state-boundary',
    requiredCapability: 'object-cache-state-does-not-hide-snapshot-drift',
    requirement: 'flush-or-bypass-cache-before-snapshot-and-release-verifier-boundaries',
    evidenceRequired: 'planner-and-release-verifier-cache-boundary-readback',
  }),
  Object.freeze({
    id: 'release-verifier-object-cache-path',
    requiredCapability: 'verify-release-runs-through-object-cache-enabled-sites',
    requirement: 'runner-command-remains-npm-run-verify-release-with-no-packaged-fallback',
    evidenceRequired: 'docker-topology-command-starts-sites-or-records-exact-unavailable-capability',
  }),
]);

test('RPP-0811 records object-cache topology requirements and exact unavailable capability', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyProof({ artifact, plan, probe });
  const validation = validateObjectCacheTopologyProof(proof);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0811');
  assert.equal(proof.variant, 1);
  assert.equal(proof.status, 'blocked-exact-unavailable-capability');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(proof.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(proof.topologyCommand.successCriterion, 'sites-started-or-exact-unavailable-capability-recorded');
  assert.equal(proof.topologyCommand.sitesStarted, false);
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

  assert.deepEqual(
    proof.objectCache.requiredCapabilities.map((entry) => entry.requiredCapability),
    objectCacheTopologyRequirements.map((entry) => entry.requiredCapability),
  );
  assert.equal(proof.objectCache.privateBackend.required, true);
  assert.equal(proof.objectCache.privateBackend.publishedHostPorts, 0);
  assert.equal(proof.objectCache.privateBackend.publicIngressAllowed, false);
  assert.deepEqual(proof.objectCache.enabledSites, proof.topologyCommand.siteRoles);
  assert.equal(proof.objectCache.runtimeReadbackObserved, false);
  assert.equal(proof.objectCache.runtimeReadbackBlockedBy, 'DOCKER_CLI_MISSING');

  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.noTunnelPolicyEnforced, true);
  assert.equal(proof.localOnlyPolicy.cacheBackendPublishedPorts, 0);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.releaseMovementAllowed, false);
  assert.equal(proof.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(proof.invariants.topologyCommandStartedSitesOrExactCapabilityRecorded, true);
  assert.equal(proof.invariants.failClosedWhenSitesNotStarted, true);
  assert.equal(proof.invariants.objectCacheRequirementsRecorded, true);
  assert.equal(proof.invariants.objectCacheRuntimeNotClaimedWhenDockerMissing, true);
  assert.equal(proof.invariants.noPublicCacheIngress, true);
  assert.equal(proof.invariants.noPackagedFallback, true);
  assert.match(proof.proofHash, proofHashPattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0811 object-cache topology proof',
  }));
});

test('RPP-0811 validation rejects a non-started topology without an exact capability code', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildObjectCacheTopologyProof({ artifact, plan, probe });
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
  const validation = validateObjectCacheTopologyProof(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'OBJECT_CACHE_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
});

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0811-docker-work',
    evidenceDir: '/tmp/rpp-0811-docker-evidence',
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

function buildObjectCacheTopologyProof({ artifact, plan, probe }) {
  const blockerCode = probe.blocker?.code || null;
  const siteRoles = plan.sites.map((site) => site.key);
  const sitesStarted = artifact.status === 'passed';
  const proofCore = {
    schemaVersion: 1,
    rppId: 'RPP-0811',
    variant: 1,
    proofId: 'rpp-0811-object-cache-enabled-topology-v1',
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
    },
    topologyCommand: {
      command: artifact.commands.runHarness,
      successCriterion: 'sites-started-or-exact-unavailable-capability-recorded',
      status: artifact.status,
      exitCode: artifact.evidence.verifyReleaseFailure?.exitCode || 0,
      sitesStarted,
      siteRoles,
      dockerServiceRoles: plan.sites.map((site) => ({
        role: site.key,
        service: site.service,
        cliService: site.cliService,
        dbService: site.dbService,
      })),
      exactUnavailableCapability: sitesStarted ? null : {
        code: blockerCode,
        capability: dockerCapabilityForBlocker(blockerCode),
        command: probe.checks.dockerCli?.command || '',
        missingExecutable: probe.checks.dockerCli?.missingExecutable === true,
        requiredFor: [
          'object-cache-enabled-wordpress-sites-start',
          'object-cache-runtime-readback',
          'release-verifier-object-cache-path',
        ],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    objectCache: {
      variant: 'object-cache-enabled-topology-v1',
      requiredCapabilities: objectCacheTopologyRequirements.map((entry) => ({ ...entry })),
      privateBackend: {
        required: true,
        backendKind: 'redis-compatible-object-cache',
        dockerNetwork: plan.network.name,
        networkInternal: plan.network.internal,
        publishedHostPorts: 0,
        publicIngressAllowed: false,
      },
      enabledSites: siteRoles,
      runtimeReadbackObserved: sitesStarted,
      runtimeReadbackBlockedBy: sitesStarted ? null : blockerCode,
      cacheBoundary: {
        snapshotMustNotUseStaleCache: true,
        releaseVerifierMustRunAfterCacheBoundaryReadback: true,
        mutationReceiptMustNotDependOnCachedRemoteState: true,
      },
    },
    localOnlyPolicy: {
      publishedHttpIngress: plan.publishedPorts.map((entry) => ({
        service: entry.service,
        host: entry.host,
        hostPort: entry.hostPort,
        containerPort: entry.containerPort,
      })),
      onlySandbox8080Ingress: plan.validation.checks.onlySandbox8080Ingress,
      noTunnelPolicyEnforced: plan.validation.checks.noTunnelCommands,
      cacheBackendPublishedPorts: 0,
      packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
    },
    releaseGate: {
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
    },
  };
  const invariants = {
    topologyCommandStartedSitesOrExactCapabilityRecorded: sitesStarted
      || Boolean(proofCore.topologyCommand.exactUnavailableCapability?.code),
    failClosedWhenSitesNotStarted: sitesStarted
      || (proofCore.failClosed === true
        && artifact.acceptedForReleaseGate === false
        && artifact.releaseGateEvaluation.releaseMovement.allowed === false),
    objectCacheRequirementsRecorded: proofCore.objectCache.requiredCapabilities.length === 4
      && proofCore.objectCache.requiredCapabilities.every((entry) => entry.requiredCapability),
    objectCacheRuntimeNotClaimedWhenDockerMissing: sitesStarted
      || (proofCore.objectCache.runtimeReadbackObserved === false
        && proofCore.objectCache.runtimeReadbackBlockedBy === blockerCode),
    noPublicCacheIngress: proofCore.objectCache.privateBackend.publishedHostPorts === 0
      && proofCore.localOnlyPolicy.cacheBackendPublishedPorts === 0,
    noPackagedFallback: proofCore.localOnlyPolicy.packagedFallbackObserved === false,
  };
  const withInvariants = { ...proofCore, invariants };
  return {
    ...withInvariants,
    validation: validateObjectCacheTopologyProof(withInvariants),
    proofHash: `sha256:${digest(withInvariants)}`,
  };
}

function validateObjectCacheTopologyProof(proof) {
  const failures = [];
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true || proof.releaseGate.releaseMovementAllowed !== false) {
      failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_MUST_FAIL_CLOSED_WHEN_NOT_STARTED' });
    }
    if (proof.objectCache.runtimeReadbackObserved !== false) {
      failures.push({ code: 'OBJECT_CACHE_RUNTIME_READBACK_CLAIMED_WITHOUT_STARTED_SITES' });
    }
  }
  if (!Array.isArray(proof.objectCache.requiredCapabilities)
    || proof.objectCache.requiredCapabilities.length !== objectCacheTopologyRequirements.length) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_REQUIREMENTS_MISSING' });
  }
  if (proof.objectCache.privateBackend.publishedHostPorts !== 0
    || proof.localOnlyPolicy.cacheBackendPublishedPorts !== 0) {
    failures.push({ code: 'OBJECT_CACHE_BACKEND_PUBLIC_INGRESS_FORBIDDEN' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.localOnlyPolicy.packagedFallbackObserved !== false) {
    failures.push({ code: 'OBJECT_CACHE_TOPOLOGY_PACKAGED_FALLBACK_REJECTED' });
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
