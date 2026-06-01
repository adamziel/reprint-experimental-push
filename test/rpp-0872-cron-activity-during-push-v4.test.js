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
  'docs/evidence/rpp-0872-cron-activity-during-push-v4.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0872-cron-activity-during-push-v4';
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
  'RPP-0863 external WordPress topology v4',
]);

const variant4ProductionTopologyPatterns = Object.freeze([
  'RPP-0861 three-site local production topology v4',
  'RPP-0863 external WordPress topology v4',
  'RPP-0871 object-cache enabled topology v4',
  'RPP-0873 maintenance mode interaction v4',
]);

const topologyRequiredFor = Object.freeze([
  'cron-active-wordpress-sites-start',
  'cron-runtime-readback-every-site',
  'cron-activity-window-readback-during-push',
  'cron-side-effect-drift-revalidation',
  'release-verifier-carry-through-current-topology',
  'verify-release-cron-active-topology-v4',
  'verify-release-without-packaged-fallback',
  'cron-activity-topology-v4-focused-regression-fail-closed',
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
  Object.freeze({
    id: 'variant-4-production-topology-fail-closed-regression',
    requiredCapability: 'cron-activity-v4-follows-production-topology-fail-closed-pattern',
    evidenceRequired: 'variant-4-topology-patterns-and-exact-unavailable-capability-readback',
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
  'variant-4-production-topology-patterns-recorded',
  'focused-variant-4-docker-unavailable-fails-closed',
  'support-only-no-go',
]);

test('RPP-0872 support report records cron-active topology v4 fail-closed scope', () => {
  const { report, text } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const expected = buildExpectedSupportReport({ artifact, plan, probe });
  const validation = validateCronActivityV4SupportReport(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.deepEqual(report, expected);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0872');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 4);
  assert.equal(report.coverageMode, 'focused-regression-local-support-only');
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.deepEqual(report.builtOn.precedentEvidence, [
    'RPP-0812 cron activity during push v1',
    'RPP-0832 cron activity during push v2',
    'RPP-0852 cron activity during push v3',
  ]);
  assert.deepEqual(report.builtOn.currentProductionTopologyEvidence, currentTopologyEvidence);
  assert.deepEqual(report.builtOn.variant4ProductionTopologyPatterns, variant4ProductionTopologyPatterns);
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

  assert.equal(report.cronActivityDuringPushV4.proofScope, 'cron-activity-during-push-v4');
  assert.equal(report.cronActivityDuringPushV4.generatedCoverageId, 'cron-activity-during-push-v4-generated-coverage');
  assert.equal(report.cronActivityDuringPushV4.productionBackedArtifactPresent, false);
  assert.equal(report.cronActivityDuringPushV4.releaseGateMayConsumeAsProduction, false);
  assert.deepEqual(report.cronActivityDuringPushV4.variant4ProductionTopologyPatterns, variant4ProductionTopologyPatterns);
  assert.equal(report.cronActivityDuringPushV4.requiredCapabilityCount, cronRequirementSurfaces.length);
  assert.deepEqual(report.cronActivityDuringPushV4.requiredSiteRoles, siteRoles);
  assert.deepEqual(report.cronActivityDuringPushV4.phaseSurfaces, cronPhaseSurfaces);
  assert.equal(report.cronActivityDuringPushV4.activityReadback.observed, false);
  assert.equal(report.cronActivityDuringPushV4.activityReadback.siteCount, 0);
  assert.equal(report.cronActivityDuringPushV4.activityReadback.eventCount, 0);
  assert.equal(report.cronActivityDuringPushV4.activityReadback.blockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(report.cronActivityDuringPushV4.activityReadback.claimMode, 'not-claimed-exact-capability');
  assert.equal(report.cronActivityDuringPushV4.sideEffectBoundary.directCronMutationReleaseEligible, false);
  assert.equal(report.cronActivityDuringPushV4.sideEffectBoundary.applyRevalidationAfterCronWindow, true);
  assert.equal(report.cronActivityDuringPushV4.releaseVerifierCarryThrough.required, true);
  assert.equal(report.cronActivityDuringPushV4.releaseVerifierCarryThrough.observed, true);
  assert.equal(report.cronActivityDuringPushV4.releaseVerifierCarryThrough.verifierCommand, 'npm run verify:release');
  assert.equal(report.cronActivityDuringPushV4.releaseVerifierCarryThrough.verifierExitCodeWhenBlocked, 2);
  assert.equal(report.cronActivityDuringPushV4.releaseVerifierCarryThrough.verifierFailureReasonWhenBlocked, 'DOCKER_CLI_MISSING');
  assert.equal(report.cronActivityDuringPushV4.releaseVerifierCarryThrough.packagedFallbackObserved, false);

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
    label: 'RPP-0872 cron activity during push v4 support report',
  }));
});

test('RPP-0872 missing Docker topology artifact stays release-ineligible without packaged fallback', () => {
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

test('RPP-0872 validation rejects release movement, ambiguous blockers, fallback, and unsupported production claims', () => {
  const { report } = loadSupportReport();

  const movementClaim = structuredClone(report);
  movementClaim.productionBacked = true;
  movementClaim.releaseEligible = true;
  movementClaim.finalReleaseStatus = 'GO';
  movementClaim.releaseGate.releaseMovementAllowed = true;
  movementClaim.successContract.finalReleaseMayMove = true;
  assertFailure(
    validateCronActivityV4SupportReport(movementClaim),
    'CRON_ACTIVITY_V4_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const productionClaim = structuredClone(report);
  productionClaim.cronActivityDuringPushV4.productionBackedArtifactPresent = true;
  productionClaim.cronActivityDuringPushV4.releaseGateMayConsumeAsProduction = true;
  assertFailure(
    validateCronActivityV4SupportReport(productionClaim),
    'CRON_ACTIVITY_V4_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const ambiguousBlocker = structuredClone(report);
  ambiguousBlocker.topologyCommand.exactUnavailableCapability.code = '';
  assertFailure(
    validateCronActivityV4SupportReport(ambiguousBlocker),
    'CRON_ACTIVITY_V4_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT',
  );

  const cronReadbackClaim = structuredClone(report);
  cronReadbackClaim.cronActivityDuringPushV4.activityReadback.observed = true;
  cronReadbackClaim.cronActivityDuringPushV4.activityReadback.siteCount = 4;
  cronReadbackClaim.cronActivityDuringPushV4.activityReadback.eventCount = 8;
  cronReadbackClaim.cronActivityDuringPushV4.activityReadback.claimMode = 'claimed-without-started-sites';
  assertFailure(
    validateCronActivityV4SupportReport(cronReadbackClaim),
    'CRON_ACTIVITY_V4_READBACK_CLAIMED_WITHOUT_STARTED_TOPOLOGY',
  );

  const packagedFallback = structuredClone(report);
  packagedFallback.releaseVerifier.noPackagedFallback = false;
  packagedFallback.releaseVerifier.packagedFallbackObserved = true;
  packagedFallback.cronActivityDuringPushV4.releaseVerifierCarryThrough.packagedFallbackObserved = true;
  assertFailure(
    validateCronActivityV4SupportReport(packagedFallback),
    'CRON_ACTIVITY_V4_PACKAGED_FALLBACK_REJECTED',
  );

  const widenedIngress = structuredClone(report);
  widenedIngress.localOnlyPolicy.publishedHttpIngressPort = 3000;
  widenedIngress.localOnlyPolicy.remoteTunnelsAllowed = true;
  assertFailure(
    validateCronActivityV4SupportReport(widenedIngress),
    'CRON_ACTIVITY_V4_LOCAL_ONLY_POLICY_FAILED',
  );

  const carryThroughGap = structuredClone(report);
  carryThroughGap.cronActivityDuringPushV4.releaseVerifierCarryThrough.observed = false;
  carryThroughGap.cronActivityDuringPushV4.releaseVerifierCarryThrough.verifierCommand = 'npm run verify:release:local-production';
  assertFailure(
    validateCronActivityV4SupportReport(carryThroughGap),
    'CRON_ACTIVITY_V4_RELEASE_VERIFIER_CARRY_THROUGH_REQUIRED',
  );
});

test('RPP-0872 report is deterministic and hash/count/surface-only', () => {
  const first = buildExpectedSupportReport(buildMissingDockerCapabilityArtifact());
  const second = buildExpectedSupportReport(buildMissingDockerCapabilityArtifact());

  assert.equal(first.supportReportHash, second.supportReportHash);
  assert.equal(first.cronActivityDuringPushV4.scopeHash, second.cronActivityDuringPushV4.scopeHash);
  assert.equal(first.cronActivityDuringPushV4.requirementDigest, second.cronActivityDuringPushV4.requirementDigest);
  assert.equal(first.cronActivityDuringPushV4.siteSurfaceDigest, second.cronActivityDuringPushV4.siteSurfaceDigest);
  assert.equal(first.cronActivityDuringPushV4.phaseSurfaceDigest, second.cronActivityDuringPushV4.phaseSurfaceDigest);
  assert.equal(
    first.cronActivityDuringPushV4.currentTopologyEvidenceDigest,
    second.cronActivityDuringPushV4.currentTopologyEvidenceDigest,
  );
  assert.equal(
    first.cronActivityDuringPushV4.variant4PatternDigest,
    second.cronActivityDuringPushV4.variant4PatternDigest,
  );
  assert.equal(first.evidenceLimits.surfaceDigest, second.evidenceLimits.surfaceDigest);
  assert.deepEqual(first.cronActivityDuringPushV4.requirementSurfaces, second.cronActivityDuringPushV4.requirementSurfaces);
  assert.deepEqual(first.cronActivityDuringPushV4.siteSurfaces, second.cronActivityDuringPushV4.siteSurfaces);
  assert.deepEqual(first.evidenceLimits.surfaceNames, second.evidenceLimits.surfaceNames);
  assert.equal(first.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(first.evidenceLimits.rawPayloadCount, 0);
  assert.equal(first.evidenceLimits.rawUrlCount, 0);
  assert.equal(first.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(first.evidenceLimits.tunnelOutputCount, 0);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(first, {
    label: 'RPP-0872 deterministic cron activity proof',
  }));
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0872 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0872-docker-work',
    evidenceDir: '/tmp/rpp-0872-docker-evidence',
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
  const cronActivityDuringPushV4 = {
    proofScope: 'cron-activity-during-push-v4',
    scenario: 'cron-active-current-topology-release-verifier-carry-through',
    generatedCoverageId: 'cron-activity-during-push-v4-generated-coverage',
    sourcePattern: 'RPP-0852 v3 plus RPP-0861/RPP-0863/RPP-0871/RPP-0873 variant-4 production-topology boundaries',
    productionBackedArtifactPresent: false,
    releaseGateMayConsumeAsProduction: false,
    currentProductionTopologyEvidence: [...currentTopologyEvidence],
    currentTopologyEvidenceDigest: `sha256:${digest(currentTopologyEvidence)}`,
    variant4ProductionTopologyPatterns: [...variant4ProductionTopologyPatterns],
    variant4PatternDigest: `sha256:${digest(variant4ProductionTopologyPatterns)}`,
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
      'variant-4-production-topology-patterns-carried-forward',
      'focused-v4-docker-unavailable-fail-closed-readback',
      'verify-release-docker-local-production-passes-without-packaged-fallback',
    ],
  };
  cronActivityDuringPushV4.requirementDigest = `sha256:${digest(cronActivityDuringPushV4.requirementSurfaces)}`;
  cronActivityDuringPushV4.siteSurfaceDigest = `sha256:${digest(cronActivityDuringPushV4.siteSurfaces)}`;
  cronActivityDuringPushV4.phaseSurfaceDigest = `sha256:${digest(cronActivityDuringPushV4.phaseSurfaces)}`;

  const reportCore = {
    schemaVersion: 1,
    rppId: 'RPP-0872',
    proofId,
    variant: 4,
    title: 'Cron activity during push topology v4 support proof',
    checkedAt: fixedNow,
    status: sitesStarted ? 'cron-activity-readback-required' : 'blocked-exact-unavailable-capability',
    coverageMode: 'focused-regression-local-support-only',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    builtOn: {
      precedentEvidence: [
        'RPP-0812 cron activity during push v1',
        'RPP-0832 cron activity during push v2',
        'RPP-0852 cron activity during push v3',
      ],
      currentProductionTopologyEvidence: [...currentTopologyEvidence],
      variant4ProductionTopologyPatterns: [...variant4ProductionTopologyPatterns],
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
    cronActivityDuringPushV4,
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

  reportCore.cronActivityDuringPushV4.scopeHash = `sha256:${digest(cronActivityScopeCore(reportCore))}`;
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
      cronActivityRequirementsRecorded: reportCore.cronActivityDuringPushV4.requiredCapabilityCount
        === cronRequirementSurfaces.length,
      cronActivityNotClaimedWhenTopologyMissing: sitesStarted
        || (reportCore.cronActivityDuringPushV4.activityReadback.observed === false
          && reportCore.cronActivityDuringPushV4.activityReadback.siteCount === 0
          && reportCore.cronActivityDuringPushV4.activityReadback.eventCount === 0),
      cronMutationsBoundedBySnapshotAndApplyRevalidation:
        reportCore.cronActivityDuringPushV4.sideEffectBoundary.cronMutationsMustBeVisibleAsRemoteDrift === true
        && reportCore.cronActivityDuringPushV4.sideEffectBoundary.applyRevalidationAfterCronWindow === true
        && reportCore.cronActivityDuringPushV4.sideEffectBoundary.directCronMutationReleaseEligible === false,
      releaseVerifierCarryThroughRecorded:
        reportCore.cronActivityDuringPushV4.releaseVerifierCarryThrough.required === true
        && reportCore.cronActivityDuringPushV4.releaseVerifierCarryThrough.observed === true
        && reportCore.cronActivityDuringPushV4.releaseVerifierCarryThrough.verifierCommand === 'npm run verify:release'
        && reportCore.cronActivityDuringPushV4.releaseVerifierCarryThrough.verifierFailureReasonWhenBlocked === blockerCode,
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
        reportCore.cronActivityDuringPushV4.productionBackedArtifactPresent === false
        && reportCore.cronActivityDuringPushV4.releaseGateMayConsumeAsProduction === false
        && reportCore.releaseGate.releaseMovementAllowed === false,
    },
  };

  return {
    ...withInvariants,
    supportReportHash: `sha256:${digest(withInvariants)}`,
  };
}

function validateCronActivityV4SupportReport(report) {
  const failures = [];
  if (report.rppId !== 'RPP-0872'
    || report.variant !== 4
    || report.proofId !== proofId
    || report.coverageMode !== 'focused-regression-local-support-only') {
    failures.push({ code: 'CRON_ACTIVITY_V4_IDENTITY_MISMATCH' });
  }
  if (report.supportOnly !== true
    || report.productionBacked !== false
    || report.releaseEligible !== false
    || report.finalReleaseStatus !== 'NO-GO'
    || report.integrationRecommendation !== 'NO-GO'
    || report.releaseGate?.releaseMovementAllowed !== false
    || report.releaseGate?.acceptedForReleaseGate !== false
    || report.successContract?.finalReleaseMayMove !== false
    || report.cronActivityDuringPushV4?.productionBackedArtifactPresent !== false
    || report.cronActivityDuringPushV4?.releaseGateMayConsumeAsProduction !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V4_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.verifyReleasePassedWithoutPackagedFallback !== true
    && report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'CRON_ACTIVITY_V4_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.topologyCommand?.sitesStarted !== true) {
    const capability = report.topologyCommand?.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'CRON_ACTIVITY_V4_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (report.topologyCommand?.failClosed !== true
      || report.topologyCommand?.startedSiteCount !== 0
      || report.cronActivityDuringPushV4?.activityReadback?.observed !== false
      || report.cronActivityDuringPushV4?.activityReadback?.siteCount !== 0
      || report.cronActivityDuringPushV4?.activityReadback?.eventCount !== 0) {
      failures.push({ code: 'CRON_ACTIVITY_V4_READBACK_CLAIMED_WITHOUT_STARTED_TOPOLOGY' });
    }
  }
  if (!arraysEqual(report.topologyCommand?.siteRoles || [], siteRoles)
    || !arraysEqual(report.cronActivityDuringPushV4?.requiredSiteRoles || [], siteRoles)
    || report.cronActivityDuringPushV4?.siteSurfaces?.length !== siteRoles.length) {
    failures.push({ code: 'CRON_ACTIVITY_V4_SITE_SURFACES_MISMATCH' });
  }
  if (!arraysEqual(report.cronActivityDuringPushV4?.phaseSurfaces || [], cronPhaseSurfaces)
    || report.cronActivityDuringPushV4?.phaseCount !== cronPhaseSurfaces.length) {
    failures.push({ code: 'CRON_ACTIVITY_V4_PHASE_SURFACES_MISMATCH' });
  }
  if (report.cronActivityDuringPushV4?.requiredCapabilityCount !== cronRequirementSurfaces.length
    || report.cronActivityDuringPushV4?.requirementSurfaces?.length !== cronRequirementSurfaces.length) {
    failures.push({ code: 'CRON_ACTIVITY_V4_REQUIREMENTS_MISSING' });
  }
  if (!arraysEqual(
    report.cronActivityDuringPushV4?.currentProductionTopologyEvidence || [],
    currentTopologyEvidence,
  )
    || report.cronActivityDuringPushV4?.currentTopologyEvidenceDigest !== `sha256:${digest(currentTopologyEvidence)}`) {
    failures.push({ code: 'CRON_ACTIVITY_V4_CURRENT_TOPOLOGY_REFERENCES_MISMATCH' });
  }
  if (!arraysEqual(
    report.cronActivityDuringPushV4?.variant4ProductionTopologyPatterns || [],
    variant4ProductionTopologyPatterns,
  )
    || report.cronActivityDuringPushV4?.variant4PatternDigest
      !== `sha256:${digest(variant4ProductionTopologyPatterns)}`) {
    failures.push({ code: 'CRON_ACTIVITY_V4_PATTERN_REFERENCES_MISMATCH' });
  }
  if (report.cronActivityDuringPushV4?.sideEffectBoundary?.cronMutationsMustBeVisibleAsRemoteDrift !== true
    || report.cronActivityDuringPushV4?.sideEffectBoundary?.applyRevalidationAfterCronWindow !== true
    || report.cronActivityDuringPushV4?.sideEffectBoundary?.durableJournalSeparatesPushAndCronEffects !== true
    || report.cronActivityDuringPushV4?.sideEffectBoundary?.directCronMutationReleaseEligible !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V4_SIDE_EFFECT_BOUNDARY_FAILED' });
  }
  const carryThrough = report.cronActivityDuringPushV4?.releaseVerifierCarryThrough;
  if (carryThrough?.required !== true
    || carryThrough?.observed !== true
    || carryThrough?.verifierCommand !== 'npm run verify:release'
    || carryThrough?.verifierExitCodeWhenBlocked !== 2
    || carryThrough?.verifierFailureReasonWhenBlocked !== 'DOCKER_CLI_MISSING'
    || carryThrough?.releaseUrlsUseDockerDns !== true) {
    failures.push({ code: 'CRON_ACTIVITY_V4_RELEASE_VERIFIER_CARRY_THROUGH_REQUIRED' });
  }
  if (report.releaseVerifier?.command !== 'npm run verify:release'
    || report.releaseVerifier?.noPackagedFallback !== true
    || report.releaseVerifier?.packagedFallbackObserved !== false
    || carryThrough?.packagedFallbackAllowed !== false
    || carryThrough?.packagedFallbackObserved !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V4_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.localOnlyPolicy?.onlySandbox8080Ingress !== true
    || report.localOnlyPolicy?.publishedHttpIngressCount !== 1
    || report.localOnlyPolicy?.publishedHttpIngressPort !== 8080
    || report.localOnlyPolicy?.remoteTunnelsAllowed !== false
    || report.localOnlyPolicy?.noTunnelPolicyEnforced !== true
    || report.localOnlyPolicy?.tunnelCommandCount !== 0) {
    failures.push({ code: 'CRON_ACTIVITY_V4_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.payloadsStored !== false
    || report.evidenceLimits?.rawPayloadCount !== 0
    || report.evidenceLimits?.rawUrlCount !== 0
    || report.evidenceLimits?.sensitiveSurfaceCount !== 0
    || report.evidenceLimits?.tunnelOutputCount !== 0
    || report.evidenceLimits?.evidenceSurfaceCount !== evidenceSurfaceNames.length) {
    failures.push({ code: 'CRON_ACTIVITY_V4_EVIDENCE_LIMITS_FAILED' });
  }
  if (findRawHttpStrings(report).length > 0) {
    failures.push({ code: 'CRON_ACTIVITY_V4_RAW_URL_SURFACE_REJECTED' });
  }
  if (!supportReportHashesOk(report)) {
    failures.push({ code: 'CRON_ACTIVITY_V4_HASH_MISMATCH' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertSupportReportHashes(report) {
  assert.match(report.supportReportHash, proofHashPattern);
  assert.match(report.cronActivityDuringPushV4.scopeHash, proofHashPattern);
  assert.match(report.cronActivityDuringPushV4.requirementDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV4.siteSurfaceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV4.phaseSurfaceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV4.currentTopologyEvidenceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV4.variant4PatternDigest, proofHashPattern);
  assert.match(report.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.equal(supportReportHashesOk(report), true);
}

function supportReportHashesOk(report) {
  const withoutReportHash = structuredClone(report);
  delete withoutReportHash.supportReportHash;

  return report.cronActivityDuringPushV4?.currentTopologyEvidenceDigest
      === `sha256:${digest(report.cronActivityDuringPushV4?.currentProductionTopologyEvidence || [])}`
    && report.cronActivityDuringPushV4?.requirementDigest
      === `sha256:${digest(report.cronActivityDuringPushV4?.requirementSurfaces || [])}`
    && report.cronActivityDuringPushV4?.siteSurfaceDigest
      === `sha256:${digest(report.cronActivityDuringPushV4?.siteSurfaces || [])}`
    && report.cronActivityDuringPushV4?.phaseSurfaceDigest
      === `sha256:${digest(report.cronActivityDuringPushV4?.phaseSurfaces || [])}`
    && report.cronActivityDuringPushV4?.variant4PatternDigest
      === `sha256:${digest(report.cronActivityDuringPushV4?.variant4ProductionTopologyPatterns || [])}`
    && report.cronActivityDuringPushV4?.scopeHash === `sha256:${digest(cronActivityScopeCore(report))}`
    && report.evidenceLimits?.surfaceDigest === `sha256:${digest(report.evidenceLimits?.surfaceNames || [])}`
    && report.supportReportHash === `sha256:${digest(withoutReportHash)}`;
}

function cronActivityScopeCore(report) {
  return {
    proofScope: report.cronActivityDuringPushV4?.proofScope,
    status: report.status,
    coverageMode: report.coverageMode,
    successContract: report.successContract,
    variant4ProductionTopologyPatterns: report.cronActivityDuringPushV4?.variant4ProductionTopologyPatterns,
    topologyCommand: report.topologyCommand,
    requirementSurfaces: report.cronActivityDuringPushV4?.requirementSurfaces,
    siteSurfaces: report.cronActivityDuringPushV4?.siteSurfaces,
    phaseSurfaces: report.cronActivityDuringPushV4?.phaseSurfaces,
    releaseVerifierCarryThrough: report.cronActivityDuringPushV4?.releaseVerifierCarryThrough,
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
