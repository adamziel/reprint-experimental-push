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
const proofId = 'rpp-0812-cron-activity-during-push-v1';
const cronProofScope = 'cron-activity-during-push-v1';
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;

const cronActivityRequirements = Object.freeze([
  Object.freeze({
    id: 'wp-cron-enabled-every-site',
    requiredCapability: 'wordpress-cron-enabled-every-site',
    requirement: 'wp-cron-or-equivalent-scheduler-runtime-enabled-for-every-topology-site',
    evidenceRequired: 'per-site-cron-runtime-readback-before-push',
  }),
  Object.freeze({
    id: 'cron-window-captured-during-push',
    requiredCapability: 'cron-activity-window-captured-during-push',
    requirement: 'cron-activity-readback-spans-before-snapshot-during-apply-and-after-revalidation',
    evidenceRequired: 'hash-count-only-cron-event-window-readback',
  }),
  Object.freeze({
    id: 'cron-drift-visible-to-release-verifier',
    requiredCapability: 'cron-side-effects-visible-to-snapshot-and-apply-revalidation',
    requirement: 'cron-side-effects-cannot-hide-remote-drift-or-bypass-apply-revalidation',
    evidenceRequired: 'snapshot-and-apply-revalidation-boundary-proof',
  }),
  Object.freeze({
    id: 'cron-journal-boundary',
    requiredCapability: 'push-journal-separates-release-mutations-from-cron-effects',
    requirement: 'durable-journal-and-recovery-surfaces-distinguish-push-work-from-cron-side-effects',
    evidenceRequired: 'journal-and-recovery-inspect-boundary-proof',
  }),
  Object.freeze({
    id: 'release-verifier-cron-active-path',
    requiredCapability: 'verify-release-runs-through-cron-active-sites',
    requirement: 'runner-command-remains-npm-run-verify-release-with-no-packaged-fallback',
    evidenceRequired: 'docker-topology-command-starts-sites-or-records-exact-unavailable-capability',
  }),
]);

const expectedCronPhases = Object.freeze([
  'before-snapshot',
  'dry-run-window',
  'apply-window',
  'apply-revalidation',
  'recovery-inspect',
]);

test('RPP-0812 records cron activity requirements and exact unavailable capability', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildCronActivityDuringPushProof({ artifact, plan, probe });
  const validation = validateCronActivityDuringPushProof(proof);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0812');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 1);
  assert.equal(proof.status, 'blocked-exact-unavailable-capability');
  assert.equal(proof.failClosed, true);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(proof.builtOn.commandContract, 'npm run verify:release');
  assert.equal(proof.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(
    proof.topologyCommand.successCriterion,
    'cron-active-sites-started-with-release-verifier-proof-or-exact-unavailable-capability-recorded',
  );
  assert.equal(proof.topologyCommand.sitesStarted, false);
  assert.equal(proof.topologyCommand.startedSiteCount, 0);
  assert.equal(proof.topologyCommand.expectedSiteCount, 4);
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
    'cron-active-wordpress-sites-start',
    'cron-activity-window-readback',
    'cron-side-effect-drift-revalidation',
    'release-verifier-cron-active-path',
  ]);

  assert.equal(proof.cronActivityDuringPush.proofScope, cronProofScope);
  assert.equal(proof.cronActivityDuringPush.variant, 1);
  assert.equal(proof.cronActivityDuringPush.requiredCapabilityCount, cronActivityRequirements.length);
  assert.deepEqual(
    proof.cronActivityDuringPush.requiredCapabilities.map((entry) => entry.requiredCapability),
    cronActivityRequirements.map((entry) => entry.requiredCapability),
  );
  assert.deepEqual(proof.cronActivityDuringPush.enabledSiteRoles, proof.topologyCommand.siteRoles);
  assert.equal(proof.cronActivityDuringPush.enabledSiteRoleCount, 4);
  assert.equal(proof.cronActivityDuringPush.wordpressCron.requiredEverySite, true);
  assert.equal(proof.cronActivityDuringPush.wordpressCron.activityReadbackObserved, false);
  assert.equal(proof.cronActivityDuringPush.wordpressCron.activityReadbackSiteCount, 0);
  assert.equal(proof.cronActivityDuringPush.wordpressCron.readbackBlockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(proof.cronActivityDuringPush.wordpressCron.claimMode, 'not-claimed-exact-capability');
  assert.equal(proof.cronActivityDuringPush.activityWindow.required, true);
  assert.deepEqual(proof.cronActivityDuringPush.activityWindow.requiredPhases, expectedCronPhases);
  assert.equal(proof.cronActivityDuringPush.activityWindow.windowReadbackObserved, false);
  assert.equal(proof.cronActivityDuringPush.activityWindow.observedCronEventCount, 0);
  assert.equal(proof.cronActivityDuringPush.activityWindow.duringPushActivityClaimed, false);
  assert.equal(proof.cronActivityDuringPush.sideEffectBoundary.cronMutationsMustBeVisibleAsRemoteDrift, true);
  assert.equal(proof.cronActivityDuringPush.sideEffectBoundary.applyRevalidationAfterCronWindow, true);
  assert.equal(proof.cronActivityDuringPush.sideEffectBoundary.durableJournalSeparatesPushAndCronEffects, true);
  assert.equal(proof.cronActivityDuringPush.sideEffectBoundary.directCronMutationReleaseEligible, false);
  assert.match(proof.cronActivityDuringPush.requirementDigest, proofHashPattern);
  assert.match(proof.cronActivityDuringPush.siteSurfaceDigest, proofHashPattern);
  assert.match(proof.cronActivityDuringPush.scopeHash, proofHashPattern);

  assert.equal(proof.releaseVerifier.command, 'npm run verify:release');
  assert.equal(proof.releaseVerifier.noPackagedFallback, true);
  assert.equal(proof.releaseVerifier.passedOnTopology, false);
  assert.equal(proof.releaseVerifier.blockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(proof.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(proof.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(proof.localOnlyPolicy.noTunnelPolicyEnforced, true);
  assert.equal(proof.localOnlyPolicy.publishedHttpIngressCount, 1);
  assert.equal(proof.localOnlyPolicy.publishedHttpIngress[0].hostPort, 8080);
  assert.equal(proof.localOnlyPolicy.tunnelCommandCount, 0);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.releaseMovementAllowed, false);
  assert.equal(proof.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(proof.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(proof.evidenceLimits.payloadsStored, false);
  assert.equal(proof.evidenceLimits.rawPayloadCount, 0);
  assert.equal(proof.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(proof.evidenceLimits.cronRequirementCount, cronActivityRequirements.length);
  assert.equal(proof.evidenceLimits.siteSurfaceCount, 4);
  assert.equal(proof.evidenceLimits.evidenceSurfaceCount, 8);
  assert.equal(proof.evidenceLimits.rejectedSurfaceCount, 0);
  assert.match(proof.evidenceLimits.surfaceDigest, proofHashPattern);

  assert.equal(proof.invariants.topologyCommandStartedSitesOrExactCapabilityRecorded, true);
  assert.equal(proof.invariants.failClosedWhenSitesNotStarted, true);
  assert.equal(proof.invariants.cronActivityRequirementsRecorded, true);
  assert.equal(proof.invariants.cronActivityNotClaimedWhenDockerMissing, true);
  assert.equal(proof.invariants.cronMutationsBoundedBySnapshotAndApplyRevalidation, true);
  assert.equal(proof.invariants.verifyReleaseNoPackagedFallback, true);
  assert.equal(proof.invariants.onlySandbox8080IngressAndNoTunnels, true);
  assert.equal(proof.invariants.hashCountSurfaceOnly, true);
  assert.equal(proof.invariants.supportOnlyNoGo, true);
  assert.match(proof.proofHash, proofHashPattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0812 cron activity during push proof',
  }));
});

test('RPP-0812 validation rejects a non-started topology without an exact capability code', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildCronActivityDuringPushProof({ artifact, plan, probe });
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
  const validation = validateCronActivityDuringPushProof(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'CRON_ACTIVITY_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
});

test('RPP-0812 validation rejects claimed cron readback when topology did not start', () => {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const proof = buildCronActivityDuringPushProof({ artifact, plan, probe });
  const claimedWithoutStartedSites = {
    ...proof,
    cronActivityDuringPush: {
      ...proof.cronActivityDuringPush,
      wordpressCron: {
        ...proof.cronActivityDuringPush.wordpressCron,
        activityReadbackObserved: true,
        activityReadbackSiteCount: 4,
        claimMode: 'claimed-without-started-sites',
      },
      activityWindow: {
        ...proof.cronActivityDuringPush.activityWindow,
        windowReadbackObserved: true,
        observedCronEventCount: 4,
        duringPushActivityClaimed: true,
      },
    },
  };
  const validation = validateCronActivityDuringPushProof(claimedWithoutStartedSites);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'CRON_ACTIVITY_READBACK_CLAIMED_WITHOUT_STARTED_SITES'));
});

test('RPP-0812 validation rejects packaged fallback and stays deterministic', () => {
  const first = buildCronActivityDuringPushProof(buildMissingDockerCapabilityArtifact());
  const second = buildCronActivityDuringPushProof(buildMissingDockerCapabilityArtifact());
  const packagedFallback = {
    ...first,
    releaseVerifier: {
      ...first.releaseVerifier,
      noPackagedFallback: false,
    },
    localOnlyPolicy: {
      ...first.localOnlyPolicy,
      packagedFallbackObserved: true,
    },
  };
  const validation = validateCronActivityDuringPushProof(packagedFallback);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'CRON_ACTIVITY_TOPOLOGY_PACKAGED_FALLBACK_REJECTED'));
  assert.equal(first.proofHash, second.proofHash);
  assert.equal(first.cronActivityDuringPush.scopeHash, second.cronActivityDuringPush.scopeHash);
  assert.equal(first.cronActivityDuringPush.requirementDigest, second.cronActivityDuringPush.requirementDigest);
  assert.equal(first.cronActivityDuringPush.siteSurfaceDigest, second.cronActivityDuringPush.siteSurfaceDigest);
  assert.equal(first.evidenceLimits.surfaceDigest, second.evidenceLimits.surfaceDigest);
  assert.deepEqual(first.cronActivityDuringPush.requiredCapabilities, second.cronActivityDuringPush.requiredCapabilities);
  assert.deepEqual(first.cronActivityDuringPush.siteSurfaces, second.cronActivityDuringPush.siteSurfaces);
  assert.deepEqual(first.evidenceLimits.evidenceSurfaces, second.evidenceLimits.evidenceSurfaces);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(first, {
    label: 'RPP-0812 deterministic cron activity proof',
  }));
});

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0812-docker-work',
    evidenceDir: '/tmp/rpp-0812-docker-evidence',
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

function buildCronActivityDuringPushProof({ artifact, plan, probe }) {
  const blockerCode = probe.blocker?.code || null;
  const siteSurfaces = buildSiteSurfaces(plan);
  const siteRoles = siteSurfaces.map((site) => site.role);
  const sitesStarted = artifact.status === 'passed';
  const releaseVerifierPassedOnTopology = artifact.evidence.dockerVerifyReleaseTopology.ok === true;
  const requirementSurfaces = cronActivityRequirements.map((entry) => ({
    id: entry.id,
    requiredCapability: entry.requiredCapability,
  }));
  const evidenceSurfaces = buildEvidenceSurfaces({
    artifact,
    blockerCode,
    plan,
    requirementSurfaces,
    sitesStarted,
  });
  const cronScopeCore = {
    proofScope: cronProofScope,
    requirements: requirementSurfaces,
    siteSurfaces,
    requiredPhases: expectedCronPhases,
    releaseCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
    topologyCommandStatus: sitesStarted ? 'sites-started' : 'exact-unavailable-capability-recorded',
    exactUnavailableCapabilityCode: sitesStarted ? null : blockerCode,
    evidenceSurfaceNames: evidenceSurfaces.map((entry) => entry.surface),
  };
  const cronActivityDuringPush = {
    proofScope: cronProofScope,
    variant: 1,
    requiredCapabilities: cronActivityRequirements.map((entry) => ({ ...entry })),
    requiredCapabilityCount: cronActivityRequirements.length,
    enabledSiteRoles: siteRoles,
    enabledSiteRoleCount: siteRoles.length,
    siteSurfaces,
    requirementDigest: `sha256:${digest(requirementSurfaces)}`,
    siteSurfaceDigest: `sha256:${digest(siteSurfaces)}`,
    wordpressCron: {
      requiredEverySite: true,
      activityReadbackObserved: false,
      activityReadbackSiteCount: 0,
      readbackBlockedBy: sitesStarted ? null : blockerCode,
      claimMode: sitesStarted ? 'required-readback-not-yet-proven' : 'not-claimed-exact-capability',
    },
    activityWindow: {
      required: true,
      requiredPhases: [...expectedCronPhases],
      phaseCount: expectedCronPhases.length,
      windowReadbackObserved: false,
      observedCronEventCount: 0,
      duringPushActivityClaimed: false,
      readbackFormat: 'hash-count-surface-only',
    },
    sideEffectBoundary: {
      cronMutationsMustBeVisibleAsRemoteDrift: true,
      snapshotBeforeApplyMustNotHideCronDrift: true,
      applyRevalidationAfterCronWindow: true,
      durableJournalSeparatesPushAndCronEffects: true,
      recoveryInspectMustSurfaceUnfinishedPushWorkOnly: true,
      directCronMutationReleaseEligible: false,
    },
    releasePolicy: 'support-only-no-release-movement',
    scopeHash: `sha256:${digest(cronScopeCore)}`,
  };
  const evidenceLimits = {
    mode: 'hash-count-surface-only',
    payloadsStored: false,
    rawPayloadCount: 0,
    sensitiveSurfaceCount: 0,
    cronRequirementCount: cronActivityRequirements.length,
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
    rppId: 'RPP-0812',
    proofId,
    variant: 1,
    checkedAt: fixedNow,
    status: sitesStarted ? 'cron-activity-readback-required' : 'blocked-exact-unavailable-capability',
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
    },
    topologyCommand: {
      command: artifact.commands.runHarness,
      successCriterion: 'cron-active-sites-started-with-release-verifier-proof-or-exact-unavailable-capability-recorded',
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
          'cron-active-wordpress-sites-start',
          'cron-activity-window-readback',
          'cron-side-effect-drift-revalidation',
          'release-verifier-cron-active-path',
        ],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    cronActivityDuringPush,
    releaseVerifier: {
      command: artifact.evidence.dockerVerifyReleaseTopology.command,
      noPackagedFallback: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved === false
        && artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed === false,
      passedOnTopology: releaseVerifierPassedOnTopology,
      blockedBy: releaseVerifierPassedOnTopology ? null : blockerCode,
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
    cronActivityRequirementsRecorded: proofCore.cronActivityDuringPush.requiredCapabilityCount
      === cronActivityRequirements.length
      && proofCore.cronActivityDuringPush.requiredCapabilities.every((entry) => entry.requiredCapability),
    cronActivityNotClaimedWhenDockerMissing: sitesStarted
      || (proofCore.cronActivityDuringPush.wordpressCron.activityReadbackObserved === false
        && proofCore.cronActivityDuringPush.wordpressCron.activityReadbackSiteCount === 0
        && proofCore.cronActivityDuringPush.activityWindow.windowReadbackObserved === false
        && proofCore.cronActivityDuringPush.activityWindow.observedCronEventCount === 0
        && proofCore.cronActivityDuringPush.wordpressCron.readbackBlockedBy === blockerCode),
    cronMutationsBoundedBySnapshotAndApplyRevalidation:
      proofCore.cronActivityDuringPush.sideEffectBoundary.cronMutationsMustBeVisibleAsRemoteDrift === true
      && proofCore.cronActivityDuringPush.sideEffectBoundary.snapshotBeforeApplyMustNotHideCronDrift === true
      && proofCore.cronActivityDuringPush.sideEffectBoundary.applyRevalidationAfterCronWindow === true
      && proofCore.cronActivityDuringPush.sideEffectBoundary.directCronMutationReleaseEligible === false,
    verifyReleaseNoPackagedFallback: proofCore.releaseVerifier.command === 'npm run verify:release'
      && proofCore.releaseVerifier.noPackagedFallback === true
      && proofCore.localOnlyPolicy.packagedFallbackObserved === false,
    onlySandbox8080IngressAndNoTunnels: proofCore.localOnlyPolicy.onlySandbox8080Ingress === true
      && proofCore.localOnlyPolicy.publishedHttpIngressCount === 1
      && proofCore.localOnlyPolicy.publishedHttpIngress[0]?.hostPort === 8080
      && proofCore.localOnlyPolicy.noTunnelPolicyEnforced === true
      && proofCore.localOnlyPolicy.tunnelCommandCount === 0,
    hashCountSurfaceOnly: proofCore.evidenceLimits.mode === 'hash-count-surface-only'
      && proofCore.evidenceLimits.payloadsStored === false
      && proofCore.evidenceLimits.rawPayloadCount === 0
      && proofCore.evidenceLimits.sensitiveSurfaceCount === 0
      && proofCore.evidenceLimits.rejectedSurfaceCount === 0
      && proofHashPattern.test(proofCore.cronActivityDuringPush.scopeHash),
    supportOnlyNoGo: proofCore.supportOnly === true
      && proofCore.productionBacked === false
      && proofCore.releaseEligible === false
      && proofCore.finalReleaseStatus === 'NO-GO',
  };
  const withInvariants = { ...proofCore, invariants };
  return {
    ...withInvariants,
    validation: validateCronActivityDuringPushProof(withInvariants),
    proofHash: `sha256:${digest(withInvariants)}`,
  };
}

function buildSiteSurfaces(plan) {
  return plan.sites.map((site) => ({
    role: site.key,
    service: site.service,
    cliService: site.cliService,
    dbService: site.dbService,
    cronActivityRequired: true,
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
      surface: 'cron-required-capabilities-recorded',
      ok: requirementSurfaces.length === cronActivityRequirements.length
        && requirementSurfaces.every((entry) => entry.requiredCapability),
      count: requirementSurfaces.length,
    },
    {
      surface: 'wp-cron-runtime-required-every-site',
      ok: plan.sites.length === 4,
      count: plan.sites.length,
    },
    {
      surface: 'cron-activity-window-readback-or-exact-capability',
      ok: sitesStarted ? false : isExactDockerUnavailableCapability(blockerCode),
      count: sitesStarted ? plan.sites.length : 0,
    },
    {
      surface: 'cron-side-effects-visible-to-snapshot-and-apply-revalidation',
      ok: true,
      count: 2,
    },
    {
      surface: 'topology-command-started-sites-or-exact-unavailable-capability',
      ok: sitesStarted || isExactDockerUnavailableCapability(blockerCode),
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

function validateCronActivityDuringPushProof(proof) {
  const failures = [];
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'CRON_ACTIVITY_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true
      || proof.releaseGate.acceptedForReleaseGate !== false
      || proof.releaseGate.releaseMovementAllowed !== false) {
      failures.push({ code: 'CRON_ACTIVITY_TOPOLOGY_MUST_FAIL_CLOSED_WHEN_NOT_STARTED' });
    }
    if (proof.topologyCommand.startedSiteCount !== 0
      || proof.cronActivityDuringPush.wordpressCron.activityReadbackObserved !== false
      || proof.cronActivityDuringPush.wordpressCron.activityReadbackSiteCount !== 0
      || proof.cronActivityDuringPush.activityWindow.windowReadbackObserved !== false
      || proof.cronActivityDuringPush.activityWindow.observedCronEventCount !== 0
      || proof.cronActivityDuringPush.activityWindow.duringPushActivityClaimed !== false) {
      failures.push({ code: 'CRON_ACTIVITY_READBACK_CLAIMED_WITHOUT_STARTED_SITES' });
    }
  }
  if (proof.topologyCommand.sitesStarted
    && proof.cronActivityDuringPush.wordpressCron.activityReadbackObserved !== true) {
    failures.push({ code: 'CRON_ACTIVITY_DURING_PUSH_READBACK_REQUIRED' });
  }
  if (proof.cronActivityDuringPush.proofScope !== cronProofScope
    || proof.cronActivityDuringPush.variant !== 1
    || !Array.isArray(proof.cronActivityDuringPush.requiredCapabilities)
    || proof.cronActivityDuringPush.requiredCapabilities.length !== cronActivityRequirements.length) {
    failures.push({ code: 'CRON_ACTIVITY_REQUIREMENTS_MISSING' });
  }
  if (!Array.isArray(proof.cronActivityDuringPush.activityWindow.requiredPhases)
    || proof.cronActivityDuringPush.activityWindow.requiredPhases.length !== expectedCronPhases.length) {
    failures.push({ code: 'CRON_ACTIVITY_WINDOW_PHASES_MISSING' });
  }
  if (proof.cronActivityDuringPush.sideEffectBoundary.cronMutationsMustBeVisibleAsRemoteDrift !== true
    || proof.cronActivityDuringPush.sideEffectBoundary.applyRevalidationAfterCronWindow !== true
    || proof.cronActivityDuringPush.sideEffectBoundary.durableJournalSeparatesPushAndCronEffects !== true
    || proof.cronActivityDuringPush.sideEffectBoundary.directCronMutationReleaseEligible !== false) {
    failures.push({ code: 'CRON_ACTIVITY_SIDE_EFFECT_BOUNDARY_FAILED' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy.tunnelCommandCount !== 0) {
    failures.push({ code: 'CRON_ACTIVITY_TOPOLOGY_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.localOnlyPolicy.packagedFallbackObserved !== false
    || proof.releaseVerifier.noPackagedFallback !== true
    || proof.releaseVerifier.command !== 'npm run verify:release') {
    failures.push({ code: 'CRON_ACTIVITY_TOPOLOGY_PACKAGED_FALLBACK_REJECTED' });
  }
  if (proof.evidenceLimits.mode !== 'hash-count-surface-only'
    || proof.evidenceLimits.payloadsStored !== false
    || proof.evidenceLimits.rawPayloadCount !== 0
    || proof.evidenceLimits.sensitiveSurfaceCount !== 0
    || proof.evidenceLimits.rejectedSurfaceCount !== 0
    || !proofHashPattern.test(proof.evidenceLimits.surfaceDigest)
    || !proofHashPattern.test(proof.cronActivityDuringPush.scopeHash)) {
    failures.push({ code: 'CRON_ACTIVITY_EVIDENCE_LIMITS_FAILED' });
  }
  if (!Array.isArray(proof.evidenceLimits.evidenceSurfaces)
    || proof.evidenceLimits.evidenceSurfaces.some((entry) => entry.ok !== true)) {
    failures.push({ code: 'CRON_ACTIVITY_SURFACE_CHECK_FAILED' });
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
