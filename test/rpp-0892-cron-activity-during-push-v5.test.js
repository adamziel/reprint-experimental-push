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
  'docs/evidence/rpp-0892-cron-activity-during-push-v5.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0892-cron-activity-during-push-v5';
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;
const topologyLane = 'Far / production-topology';
const coverageMode = 'release-verifier-carry-through-local-support-only';
const topologyCommand = 'npm run verify:release:docker-local-production';
const releaseVerifierCommand = 'npm run verify:release';

const siteRoles = Object.freeze([
  'source',
  'remote-changed',
  'local-edited',
  'apply-revalidation-source',
]);

const currentTopologyEvidence = Object.freeze([
  'RPP-0881 three-site local production topology v5',
  'RPP-0883 external WordPress topology v5',
  'RPP-0891 object-cache enabled topology v5',
]);

const variant5ProductionTopologyPatterns = Object.freeze([
  'RPP-0881 three-site local production topology v5',
  'RPP-0883 external WordPress topology v5',
  'RPP-0891 object-cache enabled topology v5',
  'RPP-0893 maintenance mode interaction v5',
]);

const topologyRequiredFor = Object.freeze([
  'cron-active-wordpress-sites-start',
  'cron-runtime-readback-every-site',
  'cron-activity-window-readback-during-push',
  'cron-side-effect-drift-revalidation',
  'release-verifier-carry-through-current-topology',
  'release-verifier-requirements-carried-through-production-topology',
  'production-backed-cron-activity-readback-before-release',
  'verify-release-cron-active-topology-v5',
  'verify-release-without-packaged-fallback',
  'cron-activity-topology-v5-release-verifier-carry-through-fail-closed',
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
    id: 'release-verifier-requirements-carried-through',
    requiredCapability: 'release-verifier-requirements-carried-through-production-topology',
    evidenceRequired: 'verify-release-command-exit-blocker-fallback-and-release-gate-readback',
  }),
  Object.freeze({
    id: 'production-backed-artifact-required-before-release',
    requiredCapability: 'production-backed-cron-active-artifact-before-release-movement',
    evidenceRequired: 'checked-production-backed-artifact-or-final-no-go',
  }),
  Object.freeze({
    id: 'production-backed-cron-readback-before-release',
    requiredCapability: 'production-backed-cron-activity-readback-before-release-eligibility',
    evidenceRequired: 'production-backed-hash-count-cron-window-readback-or-final-no-go',
  }),
  Object.freeze({
    id: 'variant-5-production-topology-release-verifier-carry-through',
    requiredCapability: 'cron-activity-v5-carries-release-verifier-through-production-topology',
    evidenceRequired: 'variant-5-topology-patterns-and-release-verifier-requirement-readback',
  }),
]);

const releaseVerifierRequirements = Object.freeze([
  'topology-command-carries-npm-run-verify-release',
  'verify-release-exit-code-and-blocker-carried-through',
  'verify-release-no-packaged-fallback',
  'release-urls-use-docker-dns',
  'release-gate-rejects-without-production-backed-cron-readback',
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
  'release-verifier-requirements-carried-through',
  'sandbox-8080-only-no-tunnels',
  'production-backed-artifact-required-before-release',
  'production-backed-cron-readback-required-before-release',
  'variant-5-production-topology-patterns-recorded',
  'release-verifier-variant-5-docker-unavailable-fails-closed',
  'support-only-no-go',
]);

test('RPP-0892 support report records cron-active topology v5 fail-closed scope', () => {
  const { report, text } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const expected = buildExpectedSupportReport({ artifact, plan, probe });
  const validation = validateCronActivityV5SupportReport(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.deepEqual(report, expected);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0892');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 5);
  assert.equal(report.coverageMode, coverageMode);
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
    'RPP-0872 cron activity during push v4',
  ]);
  assert.equal(report.builtOn.topologyLane, topologyLane);
  assert.deepEqual(report.builtOn.currentProductionTopologyEvidence, currentTopologyEvidence);
  assert.deepEqual(report.builtOn.variant5ProductionTopologyPatterns, variant5ProductionTopologyPatterns);
  assert.equal(report.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.commandContract, releaseVerifierCommand);
  assert.equal(report.builtOn.topologyCommand, topologyCommand);
  assert.equal(report.builtOn.artifactHash, artifact.deterministic.canonicalSha256);

  assert.equal(report.successContract.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(report.successContract.cronActivityObservedDuringPush, false);
  assert.equal(report.successContract.releaseVerifierCarryThroughObserved, true);
  assert.equal(report.successContract.productionBackedCronActivityReadbackRequired, true);
  assert.equal(report.successContract.productionBackedCronActivityReadbackObserved, false);
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

  assert.equal(report.cronActivityDuringPushV5.proofScope, 'cron-activity-during-push-v5');
  assert.equal(report.cronActivityDuringPushV5.generatedCoverageId, 'cron-activity-during-push-v5-generated-coverage');
  assert.equal(report.cronActivityDuringPushV5.topologyLane, topologyLane);
  assert.equal(report.cronActivityDuringPushV5.productionBackedArtifactPresent, false);
  assert.equal(report.cronActivityDuringPushV5.releaseGateMayConsumeAsProduction, false);
  assert.deepEqual(report.cronActivityDuringPushV5.variant5ProductionTopologyPatterns, variant5ProductionTopologyPatterns);
  assert.deepEqual(report.cronActivityDuringPushV5.releaseVerifierRequirements, releaseVerifierRequirements);
  assert.equal(report.cronActivityDuringPushV5.requiredCapabilityCount, cronRequirementSurfaces.length);
  assert.deepEqual(report.cronActivityDuringPushV5.requiredSiteRoles, siteRoles);
  assert.deepEqual(report.cronActivityDuringPushV5.phaseSurfaces, cronPhaseSurfaces);
  assert.equal(report.cronActivityDuringPushV5.activityReadback.observed, false);
  assert.equal(report.cronActivityDuringPushV5.activityReadback.siteCount, 0);
  assert.equal(report.cronActivityDuringPushV5.activityReadback.eventCount, 0);
  assert.equal(report.cronActivityDuringPushV5.activityReadback.blockedBy, 'DOCKER_CLI_MISSING');
  assert.equal(report.cronActivityDuringPushV5.activityReadback.claimMode, 'not-claimed-exact-capability');
  assert.equal(report.cronActivityDuringPushV5.sideEffectBoundary.directCronMutationReleaseEligible, false);
  assert.equal(report.cronActivityDuringPushV5.sideEffectBoundary.applyRevalidationAfterCronWindow, true);
  assert.equal(report.cronActivityDuringPushV5.releaseVerifierCarryThrough.required, true);
  assert.equal(report.cronActivityDuringPushV5.releaseVerifierCarryThrough.observed, true);
  assert.equal(report.cronActivityDuringPushV5.releaseVerifierCarryThrough.verifierCommand, 'npm run verify:release');
  assert.equal(report.cronActivityDuringPushV5.releaseVerifierCarryThrough.verifierExitCodeWhenBlocked, 2);
  assert.equal(report.cronActivityDuringPushV5.releaseVerifierCarryThrough.verifierFailureReasonWhenBlocked, 'DOCKER_CLI_MISSING');
  assert.equal(report.cronActivityDuringPushV5.releaseVerifierCarryThrough.packagedFallbackObserved, false);
  assert.equal(report.cronActivityDuringPushV5.productionBackedCronReadback.required, true);
  assert.equal(report.cronActivityDuringPushV5.productionBackedCronReadback.requiredBeforeReleaseEligibility, true);
  assert.equal(report.cronActivityDuringPushV5.productionBackedCronReadback.observed, false);
  assert.equal(report.cronActivityDuringPushV5.productionBackedCronReadback.siteCount, 0);
  assert.equal(report.cronActivityDuringPushV5.productionBackedCronReadback.eventCount, 0);
  assert.equal(report.cronActivityDuringPushV5.productionBackedCronReadback.releaseEligibilityWhenMissing, 'blocked-final-no-go');

  assert.equal(report.releaseVerifier.command, releaseVerifierCommand);
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
    label: 'RPP-0892 cron activity during push v5 support report',
  }));
});

test('RPP-0892 missing Docker topology artifact stays release-ineligible without packaged fallback', () => {
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

test('RPP-0892 validation rejects release movement, ambiguous blockers, fallback, and unsupported production claims', () => {
  const { report } = loadSupportReport();

  const movementClaim = structuredClone(report);
  movementClaim.productionBacked = true;
  movementClaim.releaseEligible = true;
  movementClaim.finalReleaseStatus = 'GO';
  movementClaim.releaseGate.releaseMovementAllowed = true;
  movementClaim.successContract.finalReleaseMayMove = true;
  assertFailure(
    validateCronActivityV5SupportReport(movementClaim),
    'CRON_ACTIVITY_V5_SUPPORT_ONLY_NO_GO_REQUIRED',
  );
  assertFailure(
    validateCronActivityV5SupportReport(movementClaim),
    'CRON_ACTIVITY_V5_PRODUCTION_CRON_READBACK_REQUIRED_BEFORE_RELEASE',
  );

  const productionClaim = structuredClone(report);
  productionClaim.cronActivityDuringPushV5.productionBackedArtifactPresent = true;
  productionClaim.cronActivityDuringPushV5.releaseGateMayConsumeAsProduction = true;
  productionClaim.productionBacked = true;
  assertFailure(
    validateCronActivityV5SupportReport(productionClaim),
    'CRON_ACTIVITY_V5_SUPPORT_ONLY_NO_GO_REQUIRED',
  );
  assertFailure(
    validateCronActivityV5SupportReport(productionClaim),
    'CRON_ACTIVITY_V5_PRODUCTION_CRON_READBACK_REQUIRED_BEFORE_RELEASE',
  );

  const missingProductionReadback = structuredClone(report);
  missingProductionReadback.cronActivityDuringPushV5.productionBackedCronReadback.requiredBeforeReleaseEligibility = false;
  missingProductionReadback.cronActivityDuringPushV5.productionBackedCronReadback.releaseEligibilityWhenMissing = 'ambiguous';
  assertFailure(
    validateCronActivityV5SupportReport(missingProductionReadback),
    'CRON_ACTIVITY_V5_PRODUCTION_CRON_READBACK_REQUIRED_BEFORE_RELEASE',
  );

  const ambiguousBlocker = structuredClone(report);
  ambiguousBlocker.topologyCommand.exactUnavailableCapability.code = '';
  assertFailure(
    validateCronActivityV5SupportReport(ambiguousBlocker),
    'CRON_ACTIVITY_V5_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT',
  );

  const cronReadbackClaim = structuredClone(report);
  cronReadbackClaim.cronActivityDuringPushV5.activityReadback.observed = true;
  cronReadbackClaim.cronActivityDuringPushV5.activityReadback.siteCount = 4;
  cronReadbackClaim.cronActivityDuringPushV5.activityReadback.eventCount = 8;
  cronReadbackClaim.cronActivityDuringPushV5.activityReadback.claimMode = 'claimed-without-started-sites';
  assertFailure(
    validateCronActivityV5SupportReport(cronReadbackClaim),
    'CRON_ACTIVITY_V5_READBACK_CLAIMED_WITHOUT_STARTED_TOPOLOGY',
  );

  const packagedFallback = structuredClone(report);
  packagedFallback.releaseVerifier.noPackagedFallback = false;
  packagedFallback.releaseVerifier.packagedFallbackObserved = true;
  packagedFallback.cronActivityDuringPushV5.releaseVerifierCarryThrough.packagedFallbackObserved = true;
  assertFailure(
    validateCronActivityV5SupportReport(packagedFallback),
    'CRON_ACTIVITY_V5_PACKAGED_FALLBACK_REJECTED',
  );

  const widenedIngress = structuredClone(report);
  widenedIngress.localOnlyPolicy.publishedHttpIngressPort = 3000;
  widenedIngress.localOnlyPolicy.remoteTunnelsAllowed = true;
  assertFailure(
    validateCronActivityV5SupportReport(widenedIngress),
    'CRON_ACTIVITY_V5_LOCAL_ONLY_POLICY_FAILED',
  );

  const carryThroughGap = structuredClone(report);
  carryThroughGap.cronActivityDuringPushV5.releaseVerifierCarryThrough.observed = false;
  carryThroughGap.cronActivityDuringPushV5.releaseVerifierCarryThrough.verifierCommand = 'npm run verify:release:local-production';
  carryThroughGap.cronActivityDuringPushV5.releaseVerifierRequirements = [];
  assertFailure(
    validateCronActivityV5SupportReport(carryThroughGap),
    'CRON_ACTIVITY_V5_RELEASE_VERIFIER_CARRY_THROUGH_REQUIRED',
  );
  assertFailure(
    validateCronActivityV5SupportReport(carryThroughGap),
    'CRON_ACTIVITY_V5_RELEASE_VERIFIER_REQUIREMENTS_NOT_CARRIED',
  );
});

test('RPP-0892 report is deterministic and hash/count/surface-only', () => {
  const first = buildExpectedSupportReport(buildMissingDockerCapabilityArtifact());
  const second = buildExpectedSupportReport(buildMissingDockerCapabilityArtifact());

  assert.equal(first.supportReportHash, second.supportReportHash);
  assert.equal(first.cronActivityDuringPushV5.scopeHash, second.cronActivityDuringPushV5.scopeHash);
  assert.equal(first.cronActivityDuringPushV5.requirementDigest, second.cronActivityDuringPushV5.requirementDigest);
  assert.equal(first.cronActivityDuringPushV5.siteSurfaceDigest, second.cronActivityDuringPushV5.siteSurfaceDigest);
  assert.equal(first.cronActivityDuringPushV5.phaseSurfaceDigest, second.cronActivityDuringPushV5.phaseSurfaceDigest);
  assert.equal(
    first.cronActivityDuringPushV5.currentTopologyEvidenceDigest,
    second.cronActivityDuringPushV5.currentTopologyEvidenceDigest,
  );
  assert.equal(
    first.cronActivityDuringPushV5.variant5PatternDigest,
    second.cronActivityDuringPushV5.variant5PatternDigest,
  );
  assert.equal(
    first.cronActivityDuringPushV5.releaseVerifierRequirementDigest,
    second.cronActivityDuringPushV5.releaseVerifierRequirementDigest,
  );
  assert.deepEqual(
    first.cronActivityDuringPushV5.releaseVerifierRequirements,
    second.cronActivityDuringPushV5.releaseVerifierRequirements,
  );
  assert.equal(first.evidenceLimits.surfaceDigest, second.evidenceLimits.surfaceDigest);
  assert.deepEqual(first.cronActivityDuringPushV5.requirementSurfaces, second.cronActivityDuringPushV5.requirementSurfaces);
  assert.deepEqual(first.cronActivityDuringPushV5.siteSurfaces, second.cronActivityDuringPushV5.siteSurfaces);
  assert.deepEqual(first.evidenceLimits.surfaceNames, second.evidenceLimits.surfaceNames);
  assert.equal(first.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(first.evidenceLimits.rawPayloadCount, 0);
  assert.equal(first.evidenceLimits.rawUrlCount, 0);
  assert.equal(first.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(first.evidenceLimits.tunnelOutputCount, 0);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(first, {
    label: 'RPP-0892 deterministic cron activity proof',
  }));
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0892 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0892-docker-work',
    evidenceDir: '/tmp/rpp-0892-docker-evidence',
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
  const cronActivityDuringPushV5 = {
    proofScope: 'cron-activity-during-push-v5',
    scenario: 'cron-active-current-topology-release-verifier-carry-through',
    generatedCoverageId: 'cron-activity-during-push-v5-generated-coverage',
    topologyLane,
    sourcePattern: 'RPP-0872 v4 plus RPP-0881/RPP-0883/RPP-0891/RPP-0893 variant-5 production-topology boundaries',
    productionBackedArtifactPresent: false,
    releaseGateMayConsumeAsProduction: false,
    currentProductionTopologyEvidence: [...currentTopologyEvidence],
    currentTopologyEvidenceDigest: `sha256:${digest(currentTopologyEvidence)}`,
    variant5ProductionTopologyPatterns: [...variant5ProductionTopologyPatterns],
    variant5PatternDigest: `sha256:${digest(variant5ProductionTopologyPatterns)}`,
    releaseVerifierRequirements: [...releaseVerifierRequirements],
    releaseVerifierRequirementDigest: `sha256:${digest(releaseVerifierRequirements)}`,
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
    productionBackedCronReadback: {
      required: true,
      observed: false,
      siteCount: 0,
      eventCount: 0,
      blockedBy: sitesStarted ? 'production-backed-readback-not-collected' : blockerCode,
      claimMode: sitesStarted ? 'required-production-readback-not-yet-proven' : 'not-claimed-support-only',
      readbackFormat: 'production-backed-hash-count-surface-only',
      requiredBeforeReleaseEligibility: true,
      releaseEligibilityWhenMissing: 'blocked-final-no-go',
    },
    releaseReadyRequiredEvidence: [
      'docker-wordpress-topology-sites-started',
      'per-site-cron-runtime-readback-before-push',
      'hash-count-cron-activity-window-spans-push',
      'snapshot-and-apply-revalidation-cover-cron-side-effects',
      'journal-and-recovery-inspect-distinguish-push-work-from-cron-effects',
      'topology-command-carries-verify-release-result',
      'checked-production-backed-cron-active-artifact',
      'production-backed-cron-activity-readback-before-release-eligibility',
      'release-verifier-requirements-carried-through-production-topology',
      'variant-5-production-topology-patterns-carried-forward',
      'release-verifier-v5-docker-unavailable-fail-closed-readback',
      'verify-release-docker-local-production-passes-without-packaged-fallback',
    ],
  };
  cronActivityDuringPushV5.requirementDigest = `sha256:${digest(cronActivityDuringPushV5.requirementSurfaces)}`;
  cronActivityDuringPushV5.siteSurfaceDigest = `sha256:${digest(cronActivityDuringPushV5.siteSurfaces)}`;
  cronActivityDuringPushV5.phaseSurfaceDigest = `sha256:${digest(cronActivityDuringPushV5.phaseSurfaces)}`;

  const reportCore = {
    schemaVersion: 1,
    rppId: 'RPP-0892',
    proofId,
    variant: 5,
    title: 'Cron activity during push topology v5 support proof',
    checkedAt: fixedNow,
    status: sitesStarted ? 'cron-activity-readback-required' : 'blocked-exact-unavailable-capability',
    coverageMode,
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
        'RPP-0872 cron activity during push v4',
      ],
      topologyLane,
      currentProductionTopologyEvidence: [...currentTopologyEvidence],
      variant5ProductionTopologyPatterns: [...variant5ProductionTopologyPatterns],
      dockerTopologyVariant,
      commandContract: artifact.evidence.dockerVerifyReleaseTopology.command,
      topologyCommand: artifact.commands.runHarness,
      runtime: artifact.runtime,
      gate: artifact.gate,
      artifactHash: artifact.deterministic.canonicalSha256,
    },
    successContract: {
      criterion: 'verify-release-passes-on-cron-active-production-topology-v5-without-packaged-fallback-and-production-backed-cron-readback',
      verifyReleasePassedWithoutPackagedFallback: false,
      cronActivityObservedDuringPush: false,
      releaseVerifierCarryThroughObserved: releaseVerifierCarryThrough.observed,
      productionBackedCronActivityReadbackRequired: true,
      productionBackedCronActivityReadbackObserved: false,
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
    cronActivityDuringPushV5,
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

  reportCore.cronActivityDuringPushV5.scopeHash = `sha256:${digest(cronActivityScopeCore(reportCore))}`;
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
      cronActivityRequirementsRecorded: reportCore.cronActivityDuringPushV5.requiredCapabilityCount
        === cronRequirementSurfaces.length,
      cronActivityNotClaimedWhenTopologyMissing: sitesStarted
        || (reportCore.cronActivityDuringPushV5.activityReadback.observed === false
          && reportCore.cronActivityDuringPushV5.activityReadback.siteCount === 0
          && reportCore.cronActivityDuringPushV5.activityReadback.eventCount === 0),
      cronMutationsBoundedBySnapshotAndApplyRevalidation:
        reportCore.cronActivityDuringPushV5.sideEffectBoundary.cronMutationsMustBeVisibleAsRemoteDrift === true
        && reportCore.cronActivityDuringPushV5.sideEffectBoundary.applyRevalidationAfterCronWindow === true
        && reportCore.cronActivityDuringPushV5.sideEffectBoundary.directCronMutationReleaseEligible === false,
      releaseVerifierCarryThroughRecorded:
        reportCore.cronActivityDuringPushV5.releaseVerifierCarryThrough.required === true
        && reportCore.cronActivityDuringPushV5.releaseVerifierCarryThrough.observed === true
        && reportCore.cronActivityDuringPushV5.releaseVerifierCarryThrough.verifierCommand === releaseVerifierCommand
        && reportCore.cronActivityDuringPushV5.releaseVerifierCarryThrough.verifierFailureReasonWhenBlocked === blockerCode,
      releaseVerifierRequirementsCarriedThrough:
        arraysEqual(reportCore.cronActivityDuringPushV5.releaseVerifierRequirements, releaseVerifierRequirements)
        && reportCore.cronActivityDuringPushV5.releaseVerifierRequirementDigest
          === `sha256:${digest(releaseVerifierRequirements)}`,
      verifyReleaseNoPackagedFallback: reportCore.releaseVerifier.command === releaseVerifierCommand
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
        reportCore.cronActivityDuringPushV5.productionBackedArtifactPresent === false
        && reportCore.cronActivityDuringPushV5.releaseGateMayConsumeAsProduction === false
        && reportCore.releaseGate.releaseMovementAllowed === false,
      productionBackedCronReadbackRequiredBeforeRelease:
        reportCore.cronActivityDuringPushV5.productionBackedCronReadback.required === true
        && reportCore.cronActivityDuringPushV5.productionBackedCronReadback.requiredBeforeReleaseEligibility === true
        && reportCore.cronActivityDuringPushV5.productionBackedCronReadback.observed === false
        && reportCore.cronActivityDuringPushV5.productionBackedCronReadback.releaseEligibilityWhenMissing === 'blocked-final-no-go'
        && reportCore.releaseEligible === false,
    },
  };

  return {
    ...withInvariants,
    supportReportHash: `sha256:${digest(withInvariants)}`,
  };
}

function validateCronActivityV5SupportReport(report) {
  const failures = [];
  if (report.rppId !== 'RPP-0892'
    || report.variant !== 5
    || report.proofId !== proofId
    || report.coverageMode !== coverageMode) {
    failures.push({ code: 'CRON_ACTIVITY_V5_IDENTITY_MISMATCH' });
  }
  if (report.supportOnly !== true
    || report.productionBacked !== false
    || report.releaseEligible !== false
    || report.finalReleaseStatus !== 'NO-GO'
    || report.integrationRecommendation !== 'NO-GO'
    || report.releaseGate?.releaseMovementAllowed !== false
    || report.releaseGate?.acceptedForReleaseGate !== false
    || report.successContract?.finalReleaseMayMove !== false
    || report.cronActivityDuringPushV5?.productionBackedArtifactPresent !== false
    || report.cronActivityDuringPushV5?.releaseGateMayConsumeAsProduction !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V5_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.verifyReleasePassedWithoutPackagedFallback !== true
    && report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'CRON_ACTIVITY_V5_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.topologyCommand?.sitesStarted !== true) {
    const capability = report.topologyCommand?.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'CRON_ACTIVITY_V5_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (report.topologyCommand?.failClosed !== true
      || report.topologyCommand?.startedSiteCount !== 0
      || report.cronActivityDuringPushV5?.activityReadback?.observed !== false
      || report.cronActivityDuringPushV5?.activityReadback?.siteCount !== 0
      || report.cronActivityDuringPushV5?.activityReadback?.eventCount !== 0) {
      failures.push({ code: 'CRON_ACTIVITY_V5_READBACK_CLAIMED_WITHOUT_STARTED_TOPOLOGY' });
    }
  }
  if (!arraysEqual(report.topologyCommand?.siteRoles || [], siteRoles)
    || !arraysEqual(report.cronActivityDuringPushV5?.requiredSiteRoles || [], siteRoles)
    || report.cronActivityDuringPushV5?.siteSurfaces?.length !== siteRoles.length) {
    failures.push({ code: 'CRON_ACTIVITY_V5_SITE_SURFACES_MISMATCH' });
  }
  if (!arraysEqual(report.cronActivityDuringPushV5?.phaseSurfaces || [], cronPhaseSurfaces)
    || report.cronActivityDuringPushV5?.phaseCount !== cronPhaseSurfaces.length) {
    failures.push({ code: 'CRON_ACTIVITY_V5_PHASE_SURFACES_MISMATCH' });
  }
  if (report.cronActivityDuringPushV5?.requiredCapabilityCount !== cronRequirementSurfaces.length
    || report.cronActivityDuringPushV5?.requirementSurfaces?.length !== cronRequirementSurfaces.length) {
    failures.push({ code: 'CRON_ACTIVITY_V5_REQUIREMENTS_MISSING' });
  }
  if (!arraysEqual(
    report.cronActivityDuringPushV5?.currentProductionTopologyEvidence || [],
    currentTopologyEvidence,
  )
    || report.cronActivityDuringPushV5?.currentTopologyEvidenceDigest !== `sha256:${digest(currentTopologyEvidence)}`) {
    failures.push({ code: 'CRON_ACTIVITY_V5_CURRENT_TOPOLOGY_REFERENCES_MISMATCH' });
  }
  if (!arraysEqual(
    report.cronActivityDuringPushV5?.variant5ProductionTopologyPatterns || [],
    variant5ProductionTopologyPatterns,
  )
    || report.cronActivityDuringPushV5?.variant5PatternDigest
      !== `sha256:${digest(variant5ProductionTopologyPatterns)}`) {
    failures.push({ code: 'CRON_ACTIVITY_V5_PATTERN_REFERENCES_MISMATCH' });
  }
  if (!arraysEqual(
    report.cronActivityDuringPushV5?.releaseVerifierRequirements || [],
    releaseVerifierRequirements,
  )
    || report.cronActivityDuringPushV5?.releaseVerifierRequirementDigest
      !== `sha256:${digest(releaseVerifierRequirements)}`) {
    failures.push({ code: 'CRON_ACTIVITY_V5_RELEASE_VERIFIER_REQUIREMENTS_NOT_CARRIED' });
  }
  if (report.cronActivityDuringPushV5?.sideEffectBoundary?.cronMutationsMustBeVisibleAsRemoteDrift !== true
    || report.cronActivityDuringPushV5?.sideEffectBoundary?.applyRevalidationAfterCronWindow !== true
    || report.cronActivityDuringPushV5?.sideEffectBoundary?.durableJournalSeparatesPushAndCronEffects !== true
    || report.cronActivityDuringPushV5?.sideEffectBoundary?.directCronMutationReleaseEligible !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V5_SIDE_EFFECT_BOUNDARY_FAILED' });
  }
  const carryThrough = report.cronActivityDuringPushV5?.releaseVerifierCarryThrough;
  if (carryThrough?.required !== true
    || carryThrough?.observed !== true
    || carryThrough?.verifierCommand !== releaseVerifierCommand
    || carryThrough?.verifierExitCodeWhenBlocked !== 2
    || carryThrough?.verifierFailureReasonWhenBlocked !== 'DOCKER_CLI_MISSING'
    || carryThrough?.releaseUrlsUseDockerDns !== true) {
    failures.push({ code: 'CRON_ACTIVITY_V5_RELEASE_VERIFIER_CARRY_THROUGH_REQUIRED' });
  }
  const productionReadback = report.cronActivityDuringPushV5?.productionBackedCronReadback;
  if (productionReadback?.required !== true
    || productionReadback?.requiredBeforeReleaseEligibility !== true
    || productionReadback?.observed !== false
    || productionReadback?.siteCount !== 0
    || productionReadback?.eventCount !== 0
    || productionReadback?.releaseEligibilityWhenMissing !== 'blocked-final-no-go'
    || report.successContract?.productionBackedCronActivityReadbackRequired !== true
    || report.successContract?.productionBackedCronActivityReadbackObserved !== false
    || ((report.productionBacked === true
        || report.releaseEligible === true
        || report.releaseGate?.releaseMovementAllowed === true
        || report.successContract?.finalReleaseMayMove === true)
      && productionReadback?.observed !== true)) {
    failures.push({ code: 'CRON_ACTIVITY_V5_PRODUCTION_CRON_READBACK_REQUIRED_BEFORE_RELEASE' });
  }
  if (report.releaseVerifier?.command !== releaseVerifierCommand
    || report.releaseVerifier?.noPackagedFallback !== true
    || report.releaseVerifier?.packagedFallbackObserved !== false
    || carryThrough?.packagedFallbackAllowed !== false
    || carryThrough?.packagedFallbackObserved !== false) {
    failures.push({ code: 'CRON_ACTIVITY_V5_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.localOnlyPolicy?.onlySandbox8080Ingress !== true
    || report.localOnlyPolicy?.publishedHttpIngressCount !== 1
    || report.localOnlyPolicy?.publishedHttpIngressPort !== 8080
    || report.localOnlyPolicy?.remoteTunnelsAllowed !== false
    || report.localOnlyPolicy?.noTunnelPolicyEnforced !== true
    || report.localOnlyPolicy?.tunnelCommandCount !== 0) {
    failures.push({ code: 'CRON_ACTIVITY_V5_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.payloadsStored !== false
    || report.evidenceLimits?.rawPayloadCount !== 0
    || report.evidenceLimits?.rawUrlCount !== 0
    || report.evidenceLimits?.sensitiveSurfaceCount !== 0
    || report.evidenceLimits?.tunnelOutputCount !== 0
    || report.evidenceLimits?.evidenceSurfaceCount !== evidenceSurfaceNames.length) {
    failures.push({ code: 'CRON_ACTIVITY_V5_EVIDENCE_LIMITS_FAILED' });
  }
  if (findRawHttpStrings(report).length > 0) {
    failures.push({ code: 'CRON_ACTIVITY_V5_RAW_URL_SURFACE_REJECTED' });
  }
  if (!supportReportHashesOk(report)) {
    failures.push({ code: 'CRON_ACTIVITY_V5_HASH_MISMATCH' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertSupportReportHashes(report) {
  assert.match(report.supportReportHash, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.scopeHash, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.requirementDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.siteSurfaceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.phaseSurfaceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.currentTopologyEvidenceDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.variant5PatternDigest, proofHashPattern);
  assert.match(report.cronActivityDuringPushV5.releaseVerifierRequirementDigest, proofHashPattern);
  assert.match(report.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.equal(supportReportHashesOk(report), true);
}

function supportReportHashesOk(report) {
  const withoutReportHash = structuredClone(report);
  delete withoutReportHash.supportReportHash;

  return report.cronActivityDuringPushV5?.currentTopologyEvidenceDigest
      === `sha256:${digest(report.cronActivityDuringPushV5?.currentProductionTopologyEvidence || [])}`
    && report.cronActivityDuringPushV5?.requirementDigest
      === `sha256:${digest(report.cronActivityDuringPushV5?.requirementSurfaces || [])}`
    && report.cronActivityDuringPushV5?.siteSurfaceDigest
      === `sha256:${digest(report.cronActivityDuringPushV5?.siteSurfaces || [])}`
    && report.cronActivityDuringPushV5?.phaseSurfaceDigest
      === `sha256:${digest(report.cronActivityDuringPushV5?.phaseSurfaces || [])}`
    && report.cronActivityDuringPushV5?.variant5PatternDigest
      === `sha256:${digest(report.cronActivityDuringPushV5?.variant5ProductionTopologyPatterns || [])}`
    && report.cronActivityDuringPushV5?.releaseVerifierRequirementDigest
      === `sha256:${digest(report.cronActivityDuringPushV5?.releaseVerifierRequirements || [])}`
    && report.cronActivityDuringPushV5?.scopeHash === `sha256:${digest(cronActivityScopeCore(report))}`
    && report.evidenceLimits?.surfaceDigest === `sha256:${digest(report.evidenceLimits?.surfaceNames || [])}`
    && report.supportReportHash === `sha256:${digest(withoutReportHash)}`;
}

function cronActivityScopeCore(report) {
  return {
    proofScope: report.cronActivityDuringPushV5?.proofScope,
    status: report.status,
    coverageMode: report.coverageMode,
    successContract: report.successContract,
    variant5ProductionTopologyPatterns: report.cronActivityDuringPushV5?.variant5ProductionTopologyPatterns,
    topologyCommand: report.topologyCommand,
    requirementSurfaces: report.cronActivityDuringPushV5?.requirementSurfaces,
    siteSurfaces: report.cronActivityDuringPushV5?.siteSurfaces,
    phaseSurfaces: report.cronActivityDuringPushV5?.phaseSurfaces,
    releaseVerifierRequirements: report.cronActivityDuringPushV5?.releaseVerifierRequirements,
    releaseVerifierCarryThrough: report.cronActivityDuringPushV5?.releaseVerifierCarryThrough,
    productionBackedCronReadback: report.cronActivityDuringPushV5?.productionBackedCronReadback,
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
