import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
} from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0852-cron-activity-during-push-v3.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0852-cron-activity-during-push-v3';
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;

const siteRoles = Object.freeze([
  'source',
  'remote-changed',
  'local-edited',
  'apply-revalidation-source',
]);

const currentTopologyEvidence = Object.freeze([
  'RPP-0842 Docker WordPress topology v3',
  'RPP-0861 three-site local production topology v4',
  'RPP-0881 three-site local production topology v5',
]);

const topologyRequiredFor = Object.freeze([
  'cron-active-wordpress-sites-start',
  'cron-runtime-readback-every-site',
  'cron-activity-window-readback-during-push',
  'cron-side-effect-drift-revalidation',
  'release-verifier-carry-through-current-topology',
  'verify-release-cron-active-topology-v3',
  'verify-release-without-packaged-fallback',
]);

const cronRequirementSurfaces = Object.freeze([
  Object.freeze({
    id: 'wp-cron-enabled-every-site',
    requiredCapability: 'wordpress-cron-enabled-every-site',
    evidenceRequired: 'per-site-cron-runtime-readback-before-push',
  }),
  Object.freeze({
    id: 'cron-window-captured-during-push',
    requiredCapability: 'cron-activity-window-captured-during-push',
    evidenceRequired: 'hash-count-only-cron-event-window-readback',
  }),
  Object.freeze({
    id: 'cron-drift-visible-to-release-verifier',
    requiredCapability: 'cron-side-effects-visible-to-snapshot-and-apply-revalidation',
    evidenceRequired: 'snapshot-and-apply-revalidation-boundary-proof',
  }),
  Object.freeze({
    id: 'cron-journal-boundary',
    requiredCapability: 'push-journal-separates-release-mutations-from-cron-effects',
    evidenceRequired: 'journal-and-recovery-inspect-boundary-proof',
  }),
  Object.freeze({
    id: 'release-verifier-cron-active-path',
    requiredCapability: 'verify-release-runs-through-cron-active-sites',
    evidenceRequired: 'docker-topology-command-starts-sites-or-records-exact-unavailable-capability',
  }),
  Object.freeze({
    id: 'no-packaged-fallback-cron-topology',
    requiredCapability: 'verify-release-no-packaged-fallback-on-cron-active-topology',
    evidenceRequired: 'verify-release-pass-with-packaged-fallback-disabled',
  }),
  Object.freeze({
    id: 'release-verifier-carry-through-current-topology',
    requiredCapability: 'current-topology-carries-verify-release-result',
    evidenceRequired: 'topology-command-carries-verify-release-exit-and-reason',
  }),
  Object.freeze({
    id: 'production-backed-artifact-required-before-release',
    requiredCapability: 'production-backed-cron-active-artifact-before-release-movement',
    evidenceRequired: 'checked-production-backed-artifact-or-final-no-go',
  }),
]);

const cronPhaseSurfaces = Object.freeze([
  'before-snapshot',
  'dry-run-window',
  'apply-window',
  'apply-revalidation',
  'recovery-inspect',
]);

const evidenceSurfaceNames = Object.freeze([
  'cron-required-capabilities-recorded',
  'wp-cron-runtime-required-every-site',
  'cron-activity-window-readback-or-exact-capability',
  'cron-side-effects-visible-to-snapshot-and-apply-revalidation',
  'journal-separates-push-work-from-cron-effects',
  'release-verifier-carry-through-on-current-topology',
  'topology-command-started-sites-or-exact-unavailable-capability',
  'docker-unavailable-capability-exact',
  'release-verifier-no-packaged-fallback',
  'sandbox-8080-only-no-tunnels',
  'production-backed-artifact-required-before-release',
  'support-only-no-go',
]);

test('RPP-0852 support report records cron-active topology v3 fail-closed scope', () => {
  const { report, text } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const expected = buildExpectedSupportReport({ artifact, plan, probe });
  const validation = validateCronActivityV3SupportReport(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.deepEqual(report, expected);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0852');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 3);
  assert.equal(report.coverageMode, 'generated-local-support-only');
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.deepEqual(report.builtOn.precedentEvidence, [
    'RPP-0812 cron activity during push v1',
    'RPP-0832 cron activity during push v2',
  ]);
  assert.deepEqual(report.builtOn.currentProductionTopologyEvidence, currentTopologyEvidence);
  assert.equal(report.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.commandContract, 'npm run verify:release');
  assert.equal(report.builtOn.topologyCommand, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.artifactHash, artifact.deterministic.canonicalSha256);

  assert.equal(report.successContract.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(report.successContract.cronActivityObservedDuringPush, false);
  assert.equal(report.successContract.releaseVerifierCarryThroughObserved, true);
  assert.equal(report.successContract.exactUnavailableCapabilityRecorded, true);
  assert.equal(report.successContract.finalReleaseMayMove, false);

  assert.equal(report.topologyCommand.command, artifact.commands.runHarness);
  assert.equal(report.topologyCommand.status, 'blocked');
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.sitesStarted, false);
  assert.equal(report.topologyCommand.startedSiteCount, 0);
  assert.equal(report.topologyCommand.expectedSiteCount, 4);
  assert.deepEqual(report.topologyCommand.siteRoles, siteRoles);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    capability: 'docker-cli',
    command: probe.checks.dockerCli.command,
    missingExecutable: true,
    observedShellExitCode: 127,
    requiredFor: [...topologyRequiredFor],
  });

  assert.equal(report.cronActivityDuringPushV3.proofScope, 'cron-activity-during-push-v3');
  assert.equal(report.cronActivityDuringPushV3.generatedCoverageId, 'cron-activity-during-push-v3-generated-coverage');
  assert.equal(report.cronActivityDuringPushV3.productionBackedArtifactPresent, false);
  assert.equal(report.cronActivityDuringPushV3.releaseGateMayConsumeAsProduction, false);
  assert.equal(report.cronActivityDuringPushV3.requiredCapabilityCount, cronRequirementSurfaces.length);
  assert.deepEqual(report.cronActivityDuringPushV3.requiredSiteRoles, siteRoles);
  assert.deepEqual(report.cronActivityDuringPushV3.phaseSurfaces, cronPhaseSurfaces);
  assert.equal(report.cronActivityDuringPushV3.activityReadback.observed, false);
  assert.equal(report.cronActivityDuringPushV3.activityReadback.siteCount, 0);
  assert.equal(report.cronActivityDuringPushV3.activityReadback.eventCount, 0);
  assert.equal(report.cronActivityDuringPushV3.activityReadback.blockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(report.cronActivityDuringPushV3.activityReadback.claimMode, 'not-claimed-exact-capability');
  assert.equal(report.cronActivityDuringPushV3.sideEffectBoundary.directCronMutationReleaseEligible, false);
  assert.equal(report.cronActivityDuringPushV3.sideEffectBoundary.applyRevalidationAfterCronWindow, true);
  assert.equal(report.cronActivityDuringPushV3.releaseVerifierCarryThrough.required, true);
  assert.equal(report.cronActivityDuringPushV3.releaseVerifierCarryThrough.observed, true);
  assert.equal(report.cronActivityDuringPushV3.releaseVerifierCarryThrough.verifierCommand, 'npm run verify:release');
  assert.equal(report.cronActivityDuringPushV3.releaseVerifierCarryThrough.verifierExitCodeWhenBlocked, 2);
  assert.equal(report.cronActivityDuringPushV3.releaseVerifierCarryThrough.verifierFailureReasonWhenBlocked, 'DOCKER_CLI_MISSING');
  assert.equal(report.cronActivityDuringPushV3.releaseVerifierCarryThrough.packagedFallbackObserved, false);

  assert.equal(report.releaseVerifier.command, 'npm run verify:release');
  assert.equal(report.releaseVerifier.noPackagedFallback, true);
  assert.equal(report.releaseVerifier.passedOnTopology, false);
  assert.equal(report.releaseVerifier.blockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(report.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(report.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(report.localOnlyPolicy.publishedHttpIngressPort, 8080);
  assert.equal(report.localOnlyPolicy.remoteTunnelsAllowed, false);
  assert.equal(report.localOnlyPolicy.tunnelCommandCount, 0);
  assert.equal(report.releaseGate.releaseMovementAllowed, false);
  assert.equal(report.releaseGate.acceptedForReleaseGate, false);
  assert.equal(report.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assertSupportReportHashes(report);
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.deepEqual(findRawHttpStrings(report), []);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /Bearer\s+|Basic\s+|Set-Cookie|Cookie\s*:|application[_ -]?password/i);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(report, {
    label: 'RPP-0852 cron activity during push v3 support report',
  }));
});

test('RPP-0852 missing Docker topology artifact stays release-ineligible without packaged fallback', () => {
  const { artifact, probe } = buildMissingDockerCapabilityArtifact();

  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(probe.ok, false);
  assert.equal(probe.failClosed, true);
  assert.equal(probe.blocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(probe.checks.dockerCli.command, 'docker --version');
  assert.equal(probe.checks.dockerCli.missingExecutable, true);
  assert.equal(probe.checks.dockerCompose, null);
  assert.equal(probe.checks.dockerDaemon, null);

  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.ok, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.packagedFallback, false);
  assert.equal(artifact.evidence.packagedFallback.observed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, 'npm run verify:release');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseCommandIsVerifyRelease, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.verifyReleaseFailure.exitCode, 2);
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.releaseGateEvaluation.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressBlockedUntilPrerequisitesPass, true);
});

test('RPP-0852 validation rejects release movement, ambiguous blockers, fallback, and unsupported production claims', () => {
  const { report } = loadSupportReport();

  const movementClaim = structuredClone(report);
  movementClaim.productionBacked = true;
  movementClaim.releaseEligible = true;
  movementClaim.finalReleaseStatus = 'GO';
  movementClaim.releaseGate.releaseMovementAllowed = true;
  movementClaim.successContract.finalReleaseMayMove = true;
  assertFailure(
    validateCronActivityV3SupportReport(movementClaim),
    'CRON_ACTIVITY_V3_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const productionClaim = structuredClone(report);
  productionClaim.cronActivityDuringPushV3.productionBackedArtifactPresent = true;
  productionClaim.cronActivityDuringPushV3.releaseGateMayConsumeAsProduction = true;
  assertFailure(
    validateCronActivityV3SupportReport(productionClaim),
    'CRON_ACTIVITY_V3_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const ambiguousBlocker = structuredClone(report);
  ambiguousBlocker.topologyCommand.exactUnavailableCapability.code = '';
  assertFailure(
    validateCronActivityV3SupportReport(ambiguousBlocker),
    'CRON_ACTIVITY_V3_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT',
  );

  const cronReadbackClaim = structuredClone(report);
  cronReadbackClaim.cronActivityDuringPushV3.activityReadback.observed = true;
  cronReadbackClaim.cronActivityDuringPushV3.activityReadback.siteCount = 4;
  cronReadbackClaim.cronActivityDuringPushV3.activityReadback.eventCount = 8;
  cronReadbackClaim.cronActivityDuringPushV3.activityReadback.claimMode = 'claimed-without-started-sites';
  assertFailure(
    validateCronActivityV3SupportReport(cronReadbackClaim),
    'CRON_ACTIVITY_V3_READBACK_CLAIMED_WITHOUT_STARTED_TOPOLOGY',
  );

  const packagedFallback = structuredClone(report);
  packagedFallback.releaseVerifier.noPackagedFallback = false;
  packagedFallback.releaseVerifier.packagedFallbackObserved = true;
  packagedFallback.cronActivityDuringPushV3.releaseVerifierCarryThrough.packagedFallbackObserved = true;
  assertFailure(
    validateCronActivityV3SupportReport(packagedFallback),
    'CRON_ACTIVITY_V3_PACKAGED_FALLBACK_REJECTED',
  );

  const widenedIngress = structuredClone(report);
  widenedIngress.localOnlyPolicy.publishedHttpIngressPort = 3000;
  widenedIngress.localOnlyPolicy.remoteTunnelsAllowed = true;
  assertFailure(
    validateCronActivityV3SupportReport(widenedIngress),
    'CRON_ACTIVITY_V3_LOCAL_ONLY_POLICY_FAILED',
  );

  const carryThroughGap = structuredClone(report);
  carryThroughGap.cronActivityDuringPushV3.releaseVerifierCarryThrough.observed = false;
  carryThroughGap.cronActivityDuringPushV3.releaseVerifierCarryThrough.verifierCommand = 'npm run verify:release:local-production';
  assertFailure(
    validateCronActivityV3SupportReport(carryThroughGap),
    'CRON_ACTIVITY_V3_RELEASE_VERIFIER_CARRY_THROUGH_REQUIRED',
  );
});

test('RPP-0852 report is deterministic and hash/count/surface-only', () => {
  const first = buildExpectedSupportReport(buildMissingDockerCapabilityArtifact());
  const second = buildExpectedSupportReport(buildMissingDockerCapabilityArtifact());

  assert.equal(first.supportReportHash, second.supportReportHash);
  assert.equal(first.cronActivityDuringPushV3.scopeHash, second.cronActivityDuringPushV3.scopeHash);
  assert.equal(first.cronActivityDuringPushV3.requirementDigest, second.cronActivityDuringPushV3.requirementDigest);
  assert.equal(first.cronActivityDuringPushV3.siteSurfaceDigest, second.cronActivityDuringPushV3.siteSurfaceDigest);
  assert.equal(first.cronActivityDuringPushV3.phaseSurfaceDigest, second.cronActivityDuringPushV3.phaseSurfaceDigest);
  assert.equal(
    first.cronActivityDuringPushV3.currentTopologyEvidenceDigest,
    second.cronActivityDuringPushV3.currentTopologyEvidenceDigest,
  );
  assert.equal(first.evidenceLimits.surfaceDigest, second.evidenceLimits.surfaceDigest);
  assert.deepEqual(first.cronActivityDuringPushV3.requirementSurfaces, second.cronActivityDuringPushV3.requirementSurfaces);
  assert.deepEqual(first.cronActivityDuringPushV3.siteSurfaces, second.cronActivityDuringPushV3.siteSurfaces);
  assert.deepEqual(first.evidenceLimits.surfaceNames, second.evidenceLimits.surfaceNames);
  assert.equal(first.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(first.evidenceLimits.rawPayloadCount, 0);
  assert.equal(first.evidenceLimits.rawUrlCount, 0);
  assert.equal(first.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(first.evidenceLimits.tunnelOutputCount, 0);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(first, {
    label: 'RPP-0852 deterministic cron activity proof',
  }));
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0852 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0852-docker-work',
    evidenceDir: '/tmp/rpp-0852-docker-evidence',
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

function buildExpectedSupportReport({ artifact, plan, probe }) {
  const blockerCode = probe.blocker?.code || null;
  const sitesStarted = artifact.status === 'passed';
  const siteSurfaces = plan.sites.map((site) => ({
    role: site.key,
    service: site.service,
    cliService: site.cliService,
    dbService: site.dbService,
    cronRuntimeRequired: true,
    cronReadbackObserved: false,
  }));
  const releaseVerifierCarryThrough = {
    required: true,
    observed: true,
    topologyCommand: artifact.commands.runHarness,
    verifierCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
    verifierExitCodeWhenBlocked: artifact.evidence.verifyReleaseFailure?.exitCode || null,
    verifierFailureReasonWhenBlocked: artifact.evidence.verifyReleaseFailure?.reason || null,
    releaseUrlsUseDockerDns: artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns,
    packagedFallbackAllowed: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed,
    packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
  };
  const cronActivityDuringPushV3 = {
    proofScope: 'cron-activity-during-push-v3',
    scenario: 'cron-active-current-topology-release-verifier-carry-through',
    generatedCoverageId: 'cron-activity-during-push-v3-generated-coverage',
    sourcePattern: 'RPP-0832 v2 plus RPP-0842/RPP-0861/RPP-0881 production-topology boundaries',
    productionBackedArtifactPresent: false,
    releaseGateMayConsumeAsProduction: false,
    currentProductionTopologyEvidence: [...currentTopologyEvidence],
    currentTopologyEvidenceDigest: `sha256:${digest(currentTopologyEvidence)}`,
    requiredCapabilityCount: cronRequirementSurfaces.length,
    requirementSurfaces: cronRequirementSurfaces.map((entry) => ({ ...entry })),
    requiredSiteRoles: [...siteRoles],
    siteRoleCount: siteRoles.length,
    startedSiteCount: sitesStarted ? siteRoles.length : 0,
    startupBlockedBy: sitesStarted ? null : blockerCode,
    siteSurfaces,
    phaseSurfaces: [...cronPhaseSurfaces],
    phaseCount: cronPhaseSurfaces.length,
    activityReadback: {
      required: true,
      observed: false,
      siteCount: 0,
      eventCount: 0,
      blockedBy: sitesStarted ? null : blockerCode,
      claimMode: sitesStarted ? 'required-readback-not-yet-proven' : 'not-claimed-exact-capability',
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
    releaseVerifierCarryThrough,
    releaseReadyRequiredEvidence: [
      'docker-wordpress-topology-sites-started',
      'per-site-cron-runtime-readback-before-push',
      'hash-count-cron-activity-window-spans-push',
      'snapshot-and-apply-revalidation-cover-cron-side-effects',
      'journal-and-recovery-inspect-distinguish-push-work-from-cron-effects',
      'topology-command-carries-verify-release-result',
      'checked-production-backed-cron-active-artifact',
      'verify-release-docker-local-production-passes-without-packaged-fallback',
    ],
  };
  cronActivityDuringPushV3.requirementDigest = `sha256:${digest(cronActivityDuringPushV3.requirementSurfaces)}`;
  cronActivityDuringPushV3.siteSurfaceDigest = `sha256:${digest(cronActivityDuringPushV3.siteSurfaces)}`;
  cronActivityDuringPushV3.phaseSurfaceDigest = `sha256:${digest(cronActivityDuringPushV3.phaseSurfaces)}`;

  const reportCore = {
    schemaVersion: 1,
    rppId: 'RPP-0852',
    proofId,
    variant: 3,
    title: 'Cron activity during push topology v3 support proof',
    checkedAt: fixedNow,
    status: sitesStarted ? 'cron-activity-readback-required' : 'blocked-exact-unavailable-capability',
    coverageMode: 'generated-local-support-only',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      precedentEvidence: [
        'RPP-0812 cron activity during push v1',
        'RPP-0832 cron activity during push v2',
      ],
      currentProductionTopologyEvidence: [...currentTopologyEvidence],
      dockerTopologyVariant,
      commandContract: artifact.evidence.dockerVerifyReleaseTopology.command,
      topologyCommand: artifact.commands.runHarness,
      runtime: artifact.runtime,
      gate: artifact.gate,
      artifactHash: artifact.deterministic.canonicalSha256,
    },
    successContract: {
      criterion: 'verify-release-passes-on-cron-active-current-topology-without-packaged-fallback-or-exact-unavailable-capability',
      verifyReleasePassedWithoutPackagedFallback: false,
      cronActivityObservedDuringPush: false,
      releaseVerifierCarryThroughObserved: releaseVerifierCarryThrough.observed,
      exactUnavailableCapabilityRecorded: !sitesStarted && Boolean(blockerCode),
      finalReleaseMayMove: false,
    },
    topologyCommand: {
      command: artifact.commands.runHarness,
      releaseVerifierCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
      status: artifact.status,
      exitCode: artifact.evidence.verifyReleaseFailure?.exitCode || 0,
      failClosed: artifact.failClosed,
      sitesStarted,
      expectedSiteCount: siteRoles.length,
      startedSiteCount: sitesStarted ? siteRoles.length : 0,
      siteRoles: [...siteRoles],
      exactUnavailableCapability: sitesStarted ? null : {
        code: blockerCode,
        capability: dockerCapabilityForBlocker(blockerCode),
        command: blockerCommandForProbe(probe, blockerCode),
        missingExecutable: blockerMissingExecutableForProbe(probe, blockerCode),
        observedShellExitCode: 127,
        requiredFor: [...topologyRequiredFor],
      },
      statusMarker: artifact.evidence.tmuxStatusMarker.marker,
    },
    cronActivityDuringPushV3,
    releaseVerifier: {
      command: artifact.evidence.dockerVerifyReleaseTopology.command,
      noPackagedFallback: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed === false
        && artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved === false,
      packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
      passedOnTopology: artifact.evidence.dockerVerifyReleaseTopology.ok === true,
      blockedBy: artifact.evidence.dockerVerifyReleaseTopology.ok === true ? null : blockerCode,
      releaseUrlsUseDockerDns: artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns,
    },
    localOnlyPolicy: {
      onlySandbox8080Ingress: plan.validation.checks.onlySandbox8080Ingress,
      publishedHttpIngressCount: plan.publishedPorts.length,
      publishedHttpIngressHostSurface: 'loopback-only',
      publishedHttpIngressPort: plan.publishedPorts[0]?.hostPort || null,
      remoteTunnelsAllowed: false,
      noTunnelPolicyEnforced: plan.validation.checks.noTunnelCommands,
      tunnelCommandCount: plan.validation.failures
        .filter((failure) => failure.code === 'FORBIDDEN_TUNNEL_REFERENCE').length,
    },
    releaseGate: {
      acceptedForReleaseGate: artifact.acceptedForReleaseGate,
      releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
      primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
      finalReleaseStatus: 'NO-GO',
    },
    evidenceLimits: {
      mode: 'hash-count-surface-only',
      payloadsStored: false,
      rawPayloadCount: 0,
      rawUrlCount: 0,
      sensitiveSurfaceCount: 0,
      tunnelOutputCount: 0,
      evidenceSurfaceCount: evidenceSurfaceNames.length,
      surfaceNames: [...evidenceSurfaceNames],
    },
  };

  reportCore.cronActivityDuringPushV3.scopeHash = `sha256:${digest(cronActivityScopeCore(reportCore))}`;
  reportCore.evidenceLimits.surfaceDigest = `sha256:${digest(reportCore.evidenceLimits.surfaceNames)}`;

  const withInvariants = {
    ...reportCore,
    invariants: {
      topologyCommandStartedSitesOrExactCapabilityRecorded: sitesStarted
        || Boolean(reportCore.topologyCommand.exactUnavailableCapability?.code),
      failClosedWhenSitesNotStarted: sitesStarted
        || (reportCore.topologyCommand.failClosed === true
          && reportCore.releaseGate.acceptedForReleaseGate === false
          && reportCore.releaseGate.releaseMovementAllowed === false),
      cronActivityRequirementsRecorded: reportCore.cronActivityDuringPushV3.requiredCapabilityCount
        === cronRequirementSurfaces.length,
      cronActivityNotClaimedWhenTopologyMissing: sitesStarted
        || (reportCore.cronActivityDuringPushV3.activityReadback.observed === false
          && reportCore.cronActivityDuringPushV3.activityReadback.siteCount === 0
          && reportCore.cronActivityDuringPushV3.activityReadback.eventCount === 0),
      cronMutationsBoundedBySnapshotAndApplyRevalidation:
        reportCore.cronActivityDuringPushV3.sideEffectBoundary.cronMutationsMustBeVisibleAsRemoteDrift === true
        && reportCore.cronActivityDuringPushV3.sideEffectBoundary.applyRevalidationAfterCronWindow === true
        && reportCore.cronActivityDuringPushV3.sideEffectBoundary.directCronMutationReleaseEligible === false,
      releaseVerifierCarryThroughRecorded:
        reportCore.cronActivityDuringPushV3.releaseVerifierCarryThrough.required === true
        && reportCore.cronActivityDuringPushV3.releaseVerifierCarryThrough.observed === true
        && reportCore.cronActivityDuringPushV3.releaseVerifierCarryThrough.verifierCommand === 'npm run verify:release'
        && reportCore.cronActivityDuringPushV3.releaseVerifierCarryThrough.verifierFailureReasonWhenBlocked === blockerCode,
      verifyReleaseNoPackagedFallback: reportCore.releaseVerifier.command === 'npm run verify:release'
        && reportCore.releaseVerifier.noPackagedFallback === true
        && reportCore.releaseVerifier.packagedFallbackObserved === false,
      onlySandbox8080IngressAndNoTunnels: reportCore.localOnlyPolicy.onlySandbox8080Ingress === true
        && reportCore.localOnlyPolicy.publishedHttpIngressCount === 1
        && reportCore.localOnlyPolicy.publishedHttpIngressPort === 8080
        && reportCore.localOnlyPolicy.remoteTunnelsAllowed === false
        && reportCore.localOnlyPolicy.noTunnelPolicyEnforced === true
        && reportCore.localOnlyPolicy.tunnelCommandCount === 0,
      hashCountSurfaceOnly: reportCore.evidenceLimits.mode === 'hash-count-surface-only'
        && reportCore.evidenceLimits.payloadsStored === false
        && reportCore.evidenceLimits.rawPayloadCount === 0
        && reportCore.evidenceLimits.rawUrlCount === 0
        && reportCore.evidenceLimits.sensitiveSurfaceCount === 0,
      supportOnlyNoGo: reportCore.supportOnly === true
        && reportCore.productionBacked === false
        && reportCore.releaseEligible === false
        && reportCore.finalReleaseStatus === 'NO-GO',
      productionBackedArtifactRequiredBeforeRelease:
        reportCore.cronActivityDuringPushV3.productionBackedArtifactPresent === false
        && reportCore.cronActivityDuringPushV3.releaseGateMayConsumeAsProduction === false
        && reportCore.releaseGate.releaseMovementAllowed === false,
    },
  };

  return {
    ...withInvariants,
    supportReportHash: `sha256:${digest(withInvariants)}`,
  };
}

function validateCronActivityV3SupportReport(report) {
  const failures = [];
  if (report.rppId !== 'RPP-0852'
    || report.variant !== 3
    || report.proofId !== proofId
    || report.coverageMode !== 'generated-local-support-only') {
    failures.push({ code: 'CRON_ACTIVITY_V3_IDENTITY_MISMATCH' });
  }
  if (report.supportOnly !== true
    || report.productionBacked !== false
    || report.releaseEligible !== false
    || report.finalReleaseStatus !== 'NO-GO'
    || report.integrationRecommendation !== 'NO-GO'
    || report.releaseGate?.releaseMovementAllowed !== false
    || report.releaseGate?.acceptedForReleaseGate !== false
    || report.successContract?.finalReleaseMayMove !== false
    || report.cronActivityDuringPushV3?.productionBackedArtifactPresent !== false
    || report.cronActivityDuringPushV3?.releaseGateMayConsumeAsProduction !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V3_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.verifyReleasePassedWithoutPackagedFallback !== true
    && report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'CRON_ACTIVITY_V3_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.topologyCommand?.sitesStarted !== true) {
    const capability = report.topologyCommand?.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'CRON_ACTIVITY_V3_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (report.topologyCommand?.failClosed !== true
      || report.topologyCommand?.startedSiteCount !== 0
      || report.cronActivityDuringPushV3?.activityReadback?.observed !== false
      || report.cronActivityDuringPushV3?.activityReadback?.siteCount !== 0
      || report.cronActivityDuringPushV3?.activityReadback?.eventCount !== 0) {
      failures.push({ code: 'CRON_ACTIVITY_V3_READBACK_CLAIMED_WITHOUT_STARTED_TOPOLOGY' });
    }
  }
  if (!arraysEqual(report.topologyCommand?.siteRoles || [], siteRoles)
    || !arraysEqual(report.cronActivityDuringPushV3?.requiredSiteRoles || [], siteRoles)
    || report.cronActivityDuringPushV3?.siteSurfaces?.length !== siteRoles.length) {
    failures.push({ code: 'CRON_ACTIVITY_V3_SITE_SURFACES_MISMATCH' });
  }
  if (!arraysEqual(report.cronActivityDuringPushV3?.phaseSurfaces || [], cronPhaseSurfaces)
    || report.cronActivityDuringPushV3?.phaseCount !== cronPhaseSurfaces.length) {
    failures.push({ code: 'CRON_ACTIVITY_V3_PHASE_SURFACES_MISMATCH' });
  }
  if (report.cronActivityDuringPushV3?.requiredCapabilityCount !== cronRequirementSurfaces.length
    || report.cronActivityDuringPushV3?.requirementSurfaces?.length !== cronRequirementSurfaces.length) {
    failures.push({ code: 'CRON_ACTIVITY_V3_REQUIREMENTS_MISSING' });
  }
  if (!arraysEqual(
    report.cronActivityDuringPushV3?.currentProductionTopologyEvidence || [],
    currentTopologyEvidence,
  )
    || report.cronActivityDuringPushV3?.currentTopologyEvidenceDigest !== `sha256:${digest(currentTopologyEvidence)}`) {
    failures.push({ code: 'CRON_ACTIVITY_V3_CURRENT_TOPOLOGY_REFERENCES_MISMATCH' });
  }
  if (report.cronActivityDuringPushV3?.sideEffectBoundary?.cronMutationsMustBeVisibleAsRemoteDrift !== true
    || report.cronActivityDuringPushV3?.sideEffectBoundary?.applyRevalidationAfterCronWindow !== true
    || report.cronActivityDuringPushV3?.sideEffectBoundary?.durableJournalSeparatesPushAndCronEffects !== true
    || report.cronActivityDuringPushV3?.sideEffectBoundary?.directCronMutationReleaseEligible !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V3_SIDE_EFFECT_BOUNDARY_FAILED' });
  }
  const carryThrough = report.cronActivityDuringPushV3?.releaseVerifierCarryThrough;
  if (carryThrough?.required !== true
    || carryThrough?.observed !== true
    || carryThrough?.verifierCommand !== 'npm run verify:release'
    || carryThrough?.verifierExitCodeWhenBlocked !== 2
    || carryThrough?.verifierFailureReasonWhenBlocked !== 'DOCKER_CLI_MISSING'
    || carryThrough?.releaseUrlsUseDockerDns !== true) {
    failures.push({ code: 'CRON_ACTIVITY_V3_RELEASE_VERIFIER_CARRY_THROUGH_REQUIRED' });
  }
  if (report.releaseVerifier?.command !== 'npm run verify:release'
    || report.releaseVerifier?.noPackagedFallback !== true
    || report.releaseVerifier?.packagedFallbackObserved !== false
    || carryThrough?.packagedFallbackAllowed !== false
    || carryThrough?.packagedFallbackObserved !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V3_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.localOnlyPolicy?.onlySandbox8080Ingress !== true
    || report.localOnlyPolicy?.publishedHttpIngressCount !== 1
    || report.localOnlyPolicy?.publishedHttpIngressPort !== 8080
    || report.localOnlyPolicy?.remoteTunnelsAllowed !== false
    || report.localOnlyPolicy?.noTunnelPolicyEnforced !== true
    || report.localOnlyPolicy?.tunnelCommandCount !== 0) {
    failures.push({ code: 'CRON_ACTIVITY_V3_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.payloadsStored !== false
    || report.evidenceLimits?.rawPayloadCount !== 0
    || report.evidenceLimits?.rawUrlCount !== 0
    || report.evidenceLimits?.sensitiveSurfaceCount !== 0
    || report.evidenceLimits?.tunnelOutputCount !== 0
    || report.evidenceLimits?.evidenceSurfaceCount !== evidenceSurfaceNames.length) {
    failures.push({ code: 'CRON_ACTIVITY_V3_EVIDENCE_LIMITS_FAILED' });
  }
  if (findRawHttpStrings(report).length > 0) {
    failures.push({ code: 'CRON_ACTIVITY_V3_RAW_URL_SURFACE_REJECTED' });
  }
  if (!supportReportHashesOk(report)) {
    failures.push({ code: 'CRON_ACTIVITY_V3_HASH_MISMATCH' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertSupportReportHashes(report) {
  assert.match(report.supportReportHash, proofHashPattern);
  assert.match(report.cronActivityDuringPushV3.scopeHash, proofHashPattern);
  assert.match(report.cronActivityDuringPushV3.requirementDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV3.siteSurfaceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV3.phaseSurfaceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV3.currentTopologyEvidenceDigest, proofHashPattern);
  assert.match(report.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.equal(supportReportHashesOk(report), true);
}

function supportReportHashesOk(report) {
  const withoutReportHash = structuredClone(report);
  delete withoutReportHash.supportReportHash;

  return report.cronActivityDuringPushV3?.currentTopologyEvidenceDigest
      === `sha256:${digest(report.cronActivityDuringPushV3?.currentProductionTopologyEvidence || [])}`
    && report.cronActivityDuringPushV3?.requirementDigest
      === `sha256:${digest(report.cronActivityDuringPushV3?.requirementSurfaces || [])}`
    && report.cronActivityDuringPushV3?.siteSurfaceDigest
      === `sha256:${digest(report.cronActivityDuringPushV3?.siteSurfaces || [])}`
    && report.cronActivityDuringPushV3?.phaseSurfaceDigest
      === `sha256:${digest(report.cronActivityDuringPushV3?.phaseSurfaces || [])}`
    && report.cronActivityDuringPushV3?.scopeHash === `sha256:${digest(cronActivityScopeCore(report))}`
    && report.evidenceLimits?.surfaceDigest === `sha256:${digest(report.evidenceLimits?.surfaceNames || [])}`
    && report.supportReportHash === `sha256:${digest(withoutReportHash)}`;
}

function cronActivityScopeCore(report) {
  return {
    proofScope: report.cronActivityDuringPushV3?.proofScope,
    status: report.status,
    coverageMode: report.coverageMode,
    successContract: report.successContract,
    topologyCommand: report.topologyCommand,
    requirementSurfaces: report.cronActivityDuringPushV3?.requirementSurfaces,
    siteSurfaces: report.cronActivityDuringPushV3?.siteSurfaces,
    phaseSurfaces: report.cronActivityDuringPushV3?.phaseSurfaces,
    releaseVerifierCarryThrough: report.cronActivityDuringPushV3?.releaseVerifierCarryThrough,
    releaseGate: report.releaseGate,
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

function findRawHttpStrings(value, pathParts = []) {
  const found = [];
  if (typeof value === 'string') {
    if (/https?:\/\//i.test(value)) {
      found.push({ path: pathParts.join('.'), value });
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      found.push(...findRawHttpStrings(entry, [...pathParts, String(index)]));
    });
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.push(...findRawHttpStrings(child, [...pathParts, key]));
    }
  }
  return found;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function assertFailure(validation, code) {
  assert.equal(validation.ok, false);
  assert.ok(
    validation.failures.some((failure) => failure.code === code),
    `Expected ${code}; saw ${JSON.stringify(validation.failures)}`,
  );
}
