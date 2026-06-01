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
const rppId = 'RPP-0881';
const proofId = 'rpp-0881-three-site-local-production-topology-v5';
const coverageMode = 'release-verifier-carry-through-local-support-only';
const topologyCommand = 'npm run verify:release:docker-local-production';
const releaseVerifierCommand = 'npm run verify:release';
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;
const primaryThreeSiteRoles = Object.freeze([
  'source',
  'remote-changed',
  'local-edited',
]);
const supportSiteRoles = Object.freeze([
  'apply-revalidation-source',
]);

const threeSiteTopologyRequirements = Object.freeze([
  Object.freeze({
    id: 'source-production-site',
    role: 'source',
    requiredCapability: 'wordpress-source-site-started',
    releaseEnvKey: 'REPRINT_PUSH_SOURCE_URL',
    service: 'wp-source',
  }),
  Object.freeze({
    id: 'remote-changed-production-site',
    role: 'remote-changed',
    requiredCapability: 'wordpress-remote-changed-site-started',
    releaseEnvKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
    service: 'wp-remote-changed',
  }),
  Object.freeze({
    id: 'local-edited-production-site',
    role: 'local-edited',
    requiredCapability: 'wordpress-local-edited-site-started',
    releaseEnvKey: 'REPRINT_PUSH_LOCAL_URL',
    service: 'wp-local-edited',
  }),
]);

test('RPP-0881 carries release verifier through three-site topology v5 fail-closed evidence', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildThreeSiteTopologyProof({ artifact, plan, probe });
  const validation = validateThreeSiteTopologyProof(proof);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, rppId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.coverageMode, coverageMode);
  assert.equal(proof.status, 'blocked-exact-unavailable-capability');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(proof.builtOn.commandContract, releaseVerifierCommand);
  assert.equal(proof.topologyCommand.command, topologyCommand);
  assert.equal(proof.topologyCommand.successCriterion, 'sites-started-or-exact-unavailable-capability-recorded');
  assert.equal(proof.topologyCommand.sitesStarted, false);
  assert.equal(proof.topologyCommand.status, 'blocked');
  assert.equal(proof.topologyCommand.exitCode, 2);
  assert.equal(proof.topologyCommand.exactUnavailableCapability.code, 'DOCKER_CLI_MISSING');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.capability, 'docker-cli');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.command, 'docker --version');
  assert.equal(proof.topologyCommand.exactUnavailableCapability.missingExecutable, true);
  assert.deepEqual(proof.topologyCommand.exactUnavailableCapability.requiredFor, [
    'three-primary-wordpress-sites-start',
    'release-verifier-three-site-readback',
    'local-production-topology-v5-startup-proof',
  ]);

  assert.equal(proof.dockerBlocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(proof.dockerBlocker.capability, 'docker-cli');
  assert.equal(proof.dockerBlocker.checkedCommand, 'docker --version');
  assert.equal(proof.dockerBlocker.missingExecutable, true);
  assert.equal(proof.dockerBlocker.probeCheckCount, 1);
  assert.equal(proof.dockerBlocker.passedProbeCheckCount, 0);
  assert.equal(proof.dockerBlocker.exactUnavailableCapabilityRecorded, true);

  assert.deepEqual(proof.threeSiteContract.primarySiteRoles, primaryThreeSiteRoles);
  assert.deepEqual(
    proof.threeSiteContract.requiredCapabilities.map((entry) => entry.requiredCapability),
    threeSiteTopologyRequirements.map((entry) => entry.requiredCapability),
  );
  assert.deepEqual(
    proof.threeSiteContract.requiredCapabilities.map((entry) => entry.role),
    ['source', 'remote-changed', 'local-edited'],
  );
  assert.equal(proof.threeSiteContract.expectedPrimarySiteCount, 3);
  assert.equal(proof.threeSiteContract.observedPrimarySiteCount, 3);
  assert.equal(proof.threeSiteContract.startedPrimarySiteCount, 0);
  assert.equal(proof.threeSiteContract.startupBlockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(proof.threeSiteContract.contractHash, digest(proof.threeSiteContract.siteSurfaces));
  assert.deepEqual(
    proof.threeSiteContract.siteSurfaces.map((site) => site.role),
    ['source', 'remote-changed', 'local-edited'],
  );
  assert.deepEqual(
    proof.threeSiteContract.siteSurfaces.map((site) => site.serviceHost),
    ['wp-source', 'wp-remote-changed', 'wp-local-edited'],
  );

  assert.deepEqual(proof.supportBoundary.supportSiteRoles, supportSiteRoles);
  assert.equal(proof.supportBoundary.supportSiteCount, 1);
  assert.equal(proof.supportBoundary.countedAsPrimarySite, false);
  assert.equal(proof.supportBoundary.purpose, 'apply-revalidation-readback-support');
  assert.equal(proof.supportBoundary.siteSurfaces[0].role, 'apply-revalidation-source');
  assert.equal(proof.supportBoundary.siteSurfaces[0].serviceHost, 'wp-apply-revalidation-source');

  assert.equal(proof.releaseVerifier.command, releaseVerifierCommand);
  assert.equal(proof.releaseVerifier.topologyCommand, topologyCommand);
  assert.equal(proof.releaseVerifier.carriedThroughByTopologyCommand, true);
  assert.equal(proof.releaseVerifier.status, 'blocked');
  assert.equal(proof.releaseVerifier.failClosed, true);
  assert.equal(proof.releaseVerifier.verifyReleaseFailure.exitCode, 2);
  assert.equal(proof.releaseVerifier.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(proof.releaseVerifier.noPackagedFallback, true);
  assert.equal(proof.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(proof.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(proof.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(proof.releaseVerifier.topologyValidationOk, true);
  assert.equal(proof.releaseVerifier.releaseCommandIsVerifyRelease, true);
  assert.deepEqual(proof.releaseVerifier.primarySiteEnvKeys, [
    'REPRINT_PUSH_SOURCE_URL',
    'REPRINT_PUSH_REMOTE_CHANGED_URL',
    'REPRINT_PUSH_LOCAL_URL',
  ]);
  assert.deepEqual(proof.releaseVerifier.supportSiteEnvKeys, [
    'REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL',
  ]);
  assert.equal(proof.releaseVerifier.serviceDnsHostCount, 4);

  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.noTunnelPolicyEnforced, true);
  assert.equal(proof.localOnlyPolicy.publishedHttpIngressCount, 1);
  assert.equal(proof.localOnlyPolicy.publishedHttpIngress[0].hostPort, 8080);
  assert.equal(proof.localOnlyPolicy.tunnelCommandCount, 0);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.failClosed, true);
  assert.equal(proof.releaseGate.status, 'held');
  assert.equal(proof.releaseGate.releaseMovementAllowed, false);
  assert.equal(proof.releaseGate.candidateMovementAllowed, false);
  assert.equal(proof.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.deepEqual(proof.releaseGate.releaseGateTotals, {
    gates: 20,
    passed: 0,
    candidate: 5,
    missing: 15,
    failed: 0,
    blocking: 20,
  });
  assert.equal(proof.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(proof.evidenceLimits.rawPayloadCount, 0);
  assert.equal(proof.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(proof.evidenceLimits.productionTunnelCount, 0);
  assert.equal(proof.invariants.topologyCommandStartedSitesOrExactCapabilityRecorded, true);
  assert.equal(proof.invariants.releaseVerifierFailureCarriedThrough, true);
  assert.equal(proof.invariants.failClosedWhenSitesNotStarted, true);
  assert.equal(proof.invariants.releaseGateRejectsUnavailableTopology, true);
  assert.equal(proof.invariants.primaryThreeSiteContractRecorded, true);
  assert.equal(proof.invariants.primarySiteStartupNotClaimedWhenDockerMissing, true);
  assert.equal(proof.invariants.supportSiteNotCountedAsPrimary, true);
  assert.equal(proof.invariants.onlySandbox8080Ingress, true);
  assert.equal(proof.invariants.noTunnelUsage, true);
  assert.equal(proof.invariants.noPackagedFallback, true);
  assert.equal(proof.invariants.releaseRemainsNoGo, true);
  assert.match(proof.proofHash, proofHashPattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0881 three-site topology release-verifier proof',
  }));
});

test('RPP-0881 validation rejects a non-started topology without an exact capability object', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildThreeSiteTopologyProof({ artifact, plan, probe });
  const ambiguous = {
    ...proof,
    topologyCommand: {
      ...proof.topologyCommand,
      exactUnavailableCapability: null,
    },
  };
  const validation = validateThreeSiteTopologyProof(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
});

test('RPP-0881 validation rejects release verifier carry-through gaps', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildThreeSiteTopologyProof({ artifact, plan, probe });
  const withoutCarryThrough = {
    ...proof,
    releaseVerifier: {
      ...proof.releaseVerifier,
      carriedThroughByTopologyCommand: false,
      verifyReleaseFailure: null,
    },
  };
  const validation = validateThreeSiteTopologyProof(withoutCarryThrough);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_RELEASE_VERIFIER_NOT_CARRIED'));
});

test('RPP-0881 validation rejects incomplete primary-site topology reports', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildThreeSiteTopologyProof({ artifact, plan, probe });
  const incomplete = {
    ...proof,
    threeSiteContract: {
      ...proof.threeSiteContract,
      siteSurfaces: proof.threeSiteContract.siteSurfaces.slice(0, 2),
      contractHash: digest(proof.threeSiteContract.siteSurfaces.slice(0, 2)),
    },
  };
  const validation = validateThreeSiteTopologyProof(incomplete);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_PRIMARY_SITE_SURFACES_INCOMPLETE'));
});

test('RPP-0881 validation rejects support roles or blocked startup counts as primary evidence', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildThreeSiteTopologyProof({ artifact, plan, probe });
  const widened = {
    ...proof,
    threeSiteContract: {
      ...proof.threeSiteContract,
      primarySiteRoles: [...proof.threeSiteContract.primarySiteRoles, 'apply-revalidation-source'],
      observedPrimarySiteCount: 4,
      startedPrimarySiteCount: 3,
    },
    supportBoundary: {
      ...proof.supportBoundary,
      countedAsPrimarySite: true,
    },
  };
  const validation = validateThreeSiteTopologyProof(widened);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_PRIMARY_SITE_CONTRACT_MISMATCH'));
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_SUPPORT_SITE_COUNTED_AS_PRIMARY'));
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_STARTED_SITE_COUNT_CLAIMED_WHEN_BLOCKED'));
});

test('RPP-0881 validation rejects packaged fallback or release movement claims', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildThreeSiteTopologyProof({ artifact, plan, probe });
  const widened = {
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
      acceptedForReleaseGate: true,
      failClosed: false,
      releaseMovementAllowed: true,
    },
  };
  const validation = validateThreeSiteTopologyProof(widened);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_PACKAGED_FALLBACK_REJECTED'));
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_RELEASE_STATUS_MUST_REMAIN_NO_GO'));
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'THREE_SITE_TOPOLOGY_RELEASE_GATE_NOT_FAIL_CLOSED'));
});

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0881-docker-work',
    evidenceDir: '/tmp/rpp-0881-docker-evidence',
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

function buildThreeSiteTopologyProof({ artifact, plan, probe }) {
  const blockerCode = probe.blocker?.code || null;
  const sitesStarted = artifact.status === 'passed';
  const primarySites = plan.sites.filter((site) => primaryThreeSiteRoles.includes(site.key));
  const supportSites = plan.sites.filter((site) => supportSiteRoles.includes(site.key));
  const verifierEvidence = artifact.evidence.dockerVerifyReleaseTopology;
  const verifyFailure = artifact.evidence.verifyReleaseFailure || null;
  const siteSurfaces = primarySites.map((site) => ({
    role: site.key,
    service: site.service,
    serviceHost: hostFromDockerUrl(site.url),
    cliService: site.cliService,
    dbService: site.dbService,
    releaseEnvKey: releaseEnvKeyForRole(site.key),
    fixture: site.fixture,
  }));
  const proofCore = {
    schemaVersion: 1,
    rppId,
    variant: 5,
    coverageMode,
    proofId,
    checkedAt: fixedNow,
    status: sitesStarted ? 'sites-started' : 'blocked-exact-unavailable-capability',
    failClosed: !sitesStarted,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    patternReferences: [
      'RPP-0821 three-site local production topology variant 2',
      'RPP-0841 three-site local production topology variant 3',
      'RPP-0861 three-site local production topology variant 4',
    ],
    builtOn: {
      dockerTopologyVariant,
      commandContract: verifierEvidence.command,
      runtime: artifact.runtime,
      gate: artifact.gate,
      artifactHash: artifact.deterministic.canonicalSha256,
    },
    topologyCommand: {
      command: artifact.commands.runHarness,
      successCriterion: 'sites-started-or-exact-unavailable-capability-recorded',
      status: artifact.status,
      exitCode: verifyFailure?.exitCode || 0,
      sitesStarted,
      exactUnavailableCapability: sitesStarted ? null : {
        code: blockerCode,
        capability: dockerCapabilityForBlocker(blockerCode),
        command: probe.checks.dockerCli?.command || '',
        missingExecutable: probe.checks.dockerCli?.missingExecutable === true,
        requiredFor: [
          'three-primary-wordpress-sites-start',
          'release-verifier-three-site-readback',
          'local-production-topology-v5-startup-proof',
        ],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    dockerBlocker: sitesStarted ? null : {
      code: blockerCode,
      capability: dockerCapabilityForBlocker(blockerCode),
      checkedCommand: probe.checks.dockerCli?.command || '',
      missingExecutable: probe.checks.dockerCli?.missingExecutable === true,
      probeCheckCount: Object.values(probe.checks).filter(Boolean).length,
      passedProbeCheckCount: Object.values(probe.checks).filter((check) => check?.ok === true).length,
      exactUnavailableCapabilityRecorded: Boolean(blockerCode),
    },
    threeSiteContract: {
      variant: 'three-site-local-production-topology-v5',
      expectedPrimarySiteCount: 3,
      observedPrimarySiteCount: primarySites.length,
      startedPrimarySiteCount: sitesStarted ? primarySites.length : 0,
      primarySiteRoles: [...primaryThreeSiteRoles],
      requiredCapabilities: threeSiteTopologyRequirements.map((entry) => ({ ...entry })),
      siteSurfaces,
      contractHash: digest(siteSurfaces),
      startupBlockedBy: sitesStarted ? null : blockerCode,
    },
    supportBoundary: {
      supportSiteRoles: supportSites.map((site) => site.key),
      supportSiteCount: supportSites.length,
      countedAsPrimarySite: false,
      purpose: 'apply-revalidation-readback-support',
      siteSurfaces: supportSites.map((site) => ({
        role: site.key,
        service: site.service,
        serviceHost: hostFromDockerUrl(site.url),
        cliService: site.cliService,
        dbService: site.dbService,
      })),
    },
    releaseVerifier: {
      command: verifierEvidence.command,
      topologyCommand: artifact.commands.runHarness,
      carriedThroughByTopologyCommand: artifact.commands.runHarness === topologyCommand
        && verifierEvidence.command === releaseVerifierCommand,
      status: verifierEvidence.status,
      failClosed: verifierEvidence.failClosed,
      verifyReleaseFailure: verifyFailure ? {
        exitCode: verifyFailure.exitCode,
        reason: verifyFailure.reason,
        scope: verifyFailure.scope,
      } : null,
      noPackagedFallback: verifierEvidence.packagedFallbackObserved === false
        && verifierEvidence.packagedFallbackAllowed === false,
      packagedFallbackAllowed: verifierEvidence.packagedFallbackAllowed,
      packagedFallbackObserved: verifierEvidence.packagedFallbackObserved,
      releaseUrlsUseDockerDns: verifierEvidence.releaseUrlsUseDockerDns,
      topologyValidationOk: verifierEvidence.topologyValidationOk,
      releaseCommandIsVerifyRelease: verifierEvidence.releaseCommandIsVerifyRelease,
      primarySiteEnvKeys: primaryThreeSiteRoles.map(releaseEnvKeyForRole),
      supportSiteEnvKeys: supportSiteRoles.map(releaseEnvKeyForRole),
      serviceDnsHostCount: new Set(plan.sites.map((site) => hostFromDockerUrl(site.url))).size,
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
      packagedFallbackObserved: verifierEvidence.packagedFallbackObserved,
    },
    releaseGate: {
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      failClosed: artifact.failClosed,
      status: artifact.releaseGateEvaluation.status,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      candidateMovementAllowed: artifact.releaseGateEvaluation.candidateMovement.allowed,
      primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
      releaseGateTotals: { ...artifact.releaseGateEvaluation.totals },
    },
    evidenceLimits: {
      mode: 'hash-count-surface-only',
      rawPayloadCount: 0,
      sensitiveSurfaceCount: 0,
      productionTunnelCount: 0,
    },
  };
  const invariants = {
    topologyCommandStartedSitesOrExactCapabilityRecorded: sitesStarted
      || Boolean(proofCore.topologyCommand.exactUnavailableCapability?.code),
    releaseVerifierFailureCarriedThrough: proofCore.releaseVerifier.carriedThroughByTopologyCommand === true
      && proofCore.releaseVerifier.command === releaseVerifierCommand
      && proofCore.releaseVerifier.verifyReleaseFailure?.exitCode === 2
      && proofCore.releaseVerifier.verifyReleaseFailure?.reason === blockerCode,
    failClosedWhenSitesNotStarted: sitesStarted
      || (proofCore.failClosed === true
        && artifact.acceptedForReleaseGate === false
        && artifact.failClosed === true
        && artifact.releaseGateEvaluation.releaseMovement.allowed === false),
    releaseGateRejectsUnavailableTopology: proofCore.releaseGate.acceptedForReleaseGate === false
      && proofCore.releaseGate.failClosed === true
      && proofCore.releaseGate.releaseMovementAllowed === false
      && proofCore.releaseGate.primaryFailureCode === 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    primaryThreeSiteContractRecorded: proofCore.threeSiteContract.expectedPrimarySiteCount === 3
      && proofCore.threeSiteContract.observedPrimarySiteCount === 3
      && arraysEqual(proofCore.threeSiteContract.primarySiteRoles, primaryThreeSiteRoles)
      && arraysEqual(
        proofCore.threeSiteContract.siteSurfaces.map((site) => site.role),
        primaryThreeSiteRoles,
      ),
    primarySiteStartupNotClaimedWhenDockerMissing: sitesStarted
      || (proofCore.threeSiteContract.startedPrimarySiteCount === 0
        && proofCore.threeSiteContract.startupBlockedBy === blockerCode),
    supportSiteNotCountedAsPrimary: proofCore.supportBoundary.countedAsPrimarySite === false
      && proofCore.supportBoundary.supportSiteCount === 1
      && !proofCore.threeSiteContract.primarySiteRoles.some((role) => supportSiteRoles.includes(role)),
    onlySandbox8080Ingress: proofCore.localOnlyPolicy.onlySandbox8080Ingress === true
      && proofCore.localOnlyPolicy.publishedHttpIngressCount === 1
      && proofCore.localOnlyPolicy.publishedHttpIngress[0]?.hostPort === 8080,
    noTunnelUsage: proofCore.localOnlyPolicy.noTunnelPolicyEnforced === true
      && proofCore.localOnlyPolicy.tunnelCommandCount === 0,
    noPackagedFallback: proofCore.localOnlyPolicy.packagedFallbackObserved === false
      && proofCore.releaseVerifier.noPackagedFallback === true
      && proofCore.releaseVerifier.packagedFallbackAllowed === false
      && proofCore.releaseVerifier.packagedFallbackObserved === false,
    releaseRemainsNoGo: proofCore.finalReleaseStatus === 'NO-GO'
      && proofCore.integrationRecommendation === 'NO-GO'
      && proofCore.releaseGate.releaseMovementAllowed === false,
  };
  const withInvariants = { ...proofCore, invariants };
  return {
    ...withInvariants,
    validation: validateThreeSiteTopologyProof(withInvariants),
    proofHash: `sha256:${digest(withInvariants)}`,
  };
}

function validateThreeSiteTopologyProof(proof) {
  const failures = [];
  const blockerCode = proof.dockerBlocker?.code || proof.topologyCommand.exactUnavailableCapability?.code || null;
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'THREE_SITE_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true || proof.releaseGate.releaseMovementAllowed !== false) {
      failures.push({ code: 'THREE_SITE_TOPOLOGY_MUST_FAIL_CLOSED_WHEN_NOT_STARTED' });
    }
    if (proof.threeSiteContract.startedPrimarySiteCount !== 0) {
      failures.push({ code: 'THREE_SITE_TOPOLOGY_STARTED_SITE_COUNT_CLAIMED_WHEN_BLOCKED' });
    }
    if (!proof.dockerBlocker?.code || proof.dockerBlocker?.exactUnavailableCapabilityRecorded !== true) {
      failures.push({ code: 'THREE_SITE_TOPOLOGY_DOCKER_BLOCKER_NOT_RECORDED' });
    }
  }
  if (!Array.isArray(proof.threeSiteContract.primarySiteRoles)
    || !arraysEqual(proof.threeSiteContract.primarySiteRoles, primaryThreeSiteRoles)
    || proof.threeSiteContract.expectedPrimarySiteCount !== 3
    || proof.threeSiteContract.observedPrimarySiteCount !== 3) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_PRIMARY_SITE_CONTRACT_MISMATCH' });
  }
  if (!Array.isArray(proof.threeSiteContract.requiredCapabilities)
    || proof.threeSiteContract.requiredCapabilities.length !== threeSiteTopologyRequirements.length
    || !arraysEqual(
      proof.threeSiteContract.requiredCapabilities.map((entry) => entry.requiredCapability),
      threeSiteTopologyRequirements.map((entry) => entry.requiredCapability),
    )) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_REQUIREMENTS_MISSING' });
  }
  if (!Array.isArray(proof.threeSiteContract.siteSurfaces)
    || proof.threeSiteContract.siteSurfaces.length !== primaryThreeSiteRoles.length
    || !arraysEqual(
      proof.threeSiteContract.siteSurfaces.map((site) => site.role),
      primaryThreeSiteRoles,
    )
    || !arraysEqual(
      proof.threeSiteContract.siteSurfaces.map((site) => site.service),
      threeSiteTopologyRequirements.map((entry) => entry.service),
    )) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_PRIMARY_SITE_SURFACES_INCOMPLETE' });
  }
  if (proof.supportBoundary.countedAsPrimarySite !== false
    || proof.supportBoundary.supportSiteCount !== supportSiteRoles.length) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_SUPPORT_SITE_COUNTED_AS_PRIMARY' });
  }
  if (proof.releaseVerifier.carriedThroughByTopologyCommand !== true
    || proof.releaseVerifier.command !== releaseVerifierCommand
    || proof.releaseVerifier.topologyCommand !== topologyCommand
    || proof.releaseVerifier.status !== proof.topologyCommand.status
    || proof.releaseVerifier.failClosed !== true
    || proof.releaseVerifier.verifyReleaseFailure?.exitCode !== 2
    || proof.releaseVerifier.verifyReleaseFailure?.reason !== blockerCode
    || proof.releaseVerifier.releaseCommandIsVerifyRelease !== true
    || proof.releaseVerifier.topologyValidationOk !== true) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_RELEASE_VERIFIER_NOT_CARRIED' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy.tunnelCommandCount !== 0) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.localOnlyPolicy.packagedFallbackObserved !== false
    || proof.releaseVerifier.noPackagedFallback !== true
    || proof.releaseVerifier.packagedFallbackAllowed !== false
    || proof.releaseVerifier.packagedFallbackObserved !== false) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_PACKAGED_FALLBACK_REJECTED' });
  }
  if (proof.releaseGate.acceptedForReleaseGate !== false
    || proof.releaseGate.failClosed !== true
    || proof.releaseGate.releaseMovementAllowed !== false
    || proof.releaseGate.candidateMovementAllowed !== false) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_RELEASE_GATE_NOT_FAIL_CLOSED' });
  }
  if (proof.finalReleaseStatus !== 'NO-GO'
    || proof.integrationRecommendation !== 'NO-GO'
    || proof.releaseGate.releaseMovementAllowed !== false) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_RELEASE_STATUS_MUST_REMAIN_NO_GO' });
  }
  if (proof.evidenceLimits.mode !== 'hash-count-surface-only'
    || proof.evidenceLimits.rawPayloadCount !== 0
    || proof.evidenceLimits.sensitiveSurfaceCount !== 0
    || proof.evidenceLimits.productionTunnelCount !== 0) {
    failures.push({ code: 'THREE_SITE_TOPOLOGY_EVIDENCE_LIMITS_FAILED' });
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

function releaseEnvKeyForRole(role) {
  if (role === 'source') return 'REPRINT_PUSH_SOURCE_URL';
  if (role === 'remote-changed') return 'REPRINT_PUSH_REMOTE_CHANGED_URL';
  if (role === 'local-edited') return 'REPRINT_PUSH_LOCAL_URL';
  if (role === 'apply-revalidation-source') return 'REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL';
  return 'REPRINT_PUSH_UNKNOWN_SITE_URL';
}

function hostFromDockerUrl(url) {
  const parsed = new URL(url);
  return parsed.hostname;
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
