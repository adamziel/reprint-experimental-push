import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerReleaseCommand,
  dockerTopologyVariant,
  forbiddenPackagedFallbackEnvKeys,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
  validateTopologyPlan,
} from '../scripts/docker/production-complex-site-harness.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0882-docker-wordpress-topology-v5.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const topologyCommand = 'npm run verify:release:docker-local-production';
const releaseVerifierCommand = dockerReleaseCommand.join(' ');
const proofHashPattern = /^sha256:[a-f0-9]{64}$/;
const requiredServiceHosts = Object.freeze([
  'wp-source',
  'wp-remote-changed',
  'wp-local-edited',
  'wp-apply-revalidation-source',
]);
const requiredRoleOrder = Object.freeze([
  'source',
  'remote-changed',
  'local-edited',
  'apply-revalidation-source',
]);
const releaseEnvHostBindings = Object.freeze([
  {
    envKey: 'REPRINT_PUSH_SOURCE_URL',
    role: 'source',
    serviceHost: 'wp-source',
  },
  {
    envKey: 'REPRINT_PUSH_REMOTE_URL',
    role: 'source-alias',
    serviceHost: 'wp-source',
  },
  {
    envKey: 'REPRINT_PUSH_REMOTE_CHANGED_URL',
    role: 'remote-changed',
    serviceHost: 'wp-remote-changed',
  },
  {
    envKey: 'REPRINT_PUSH_LOCAL_URL',
    role: 'local-edited',
    serviceHost: 'wp-local-edited',
  },
  {
    envKey: 'REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL',
    role: 'apply-revalidation-source',
    serviceHost: 'wp-apply-revalidation-source',
  },
]);
const topologyRequiredFor = Object.freeze([
  'docker-wordpress-sites-start',
  'docker-network-service-dns-readback',
  'verify-release-docker-topology-run',
  'docker-wordpress-topology-v5-release-verifier-carry-through',
  'verify-release-passes-without-packaged-fallback-on-topology',
]);
const generatedCoverageAssertions = Object.freeze([
  'carry-topology-command-through-to-npm-run-verify-release',
  'record-verify-release-failure-reason-when-docker-unavailable',
  'require-private-docker-dns-release-env-hosts',
  'reject-packaged-fallback-env-and-runner-flags',
  'keep-passed-docker-artifact-as-local-candidate-evidence',
  'preserve-loopback-8080-only-inspection-ingress',
  'record-fail-closed-capability-matrix-when-docker-unavailable',
  'preserve-support-only-no-go',
]);
const releaseVerifierCarryThroughRequirements = Object.freeze([
  'topology-command-invokes-npm-run-verify-release',
  'verify-release-failure-reason-carried-when-topology-blocked',
  'verify-release-success-remains-local-candidate-without-production-provenance',
  'no-packaged-fallback-env-or-runner-flags',
  'docker-service-dns-release-urls-required',
]);
const requiredBlockerMatrix = Object.freeze([
  {
    code: 'DOCKER_CLI_MISSING',
    capability: 'docker-cli',
    command: 'docker --version',
    failClosed: true,
    startsTopology: false,
  },
  {
    code: 'DOCKER_COMPOSE_UNAVAILABLE',
    capability: 'docker-compose-v2',
    command: 'docker compose version --short',
    failClosed: true,
    startsTopology: false,
  },
  {
    code: 'DOCKER_DAEMON_UNAVAILABLE',
    capability: 'docker-daemon',
    command: 'docker info --format {{json .ServerVersion}}',
    failClosed: true,
    startsTopology: false,
  },
]);

test('RPP-0882 support report records Docker WordPress topology v5 release verifier carry-through', () => {
  const { report, text } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateDockerWordPressTopologyV5Report(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0882');
  assert.equal(report.proofId, 'rpp-0882-docker-wordpress-topology-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.coverageMode, 'release-verifier-carry-through-local-support-only');
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.closestTemplate, 'RPP-0862 docker-wordpress-topology-v4');
  assert.deepEqual(report.builtOn.priorDockerTopologyEvidence, [
    'RPP-0802 docker-wordpress-topology-v1',
    'RPP-0822 docker-wordpress-topology-v2',
    'RPP-0842 docker-wordpress-topology-v3',
    'RPP-0862 docker-wordpress-topology-v4',
  ]);
  assert.equal(report.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.runtime, artifact.runtime);
  assert.equal(report.builtOn.gate, artifact.gate);
  assert.equal(report.builtOn.releaseVerifierCommand, releaseVerifierCommand);
  assert.equal(report.builtOn.blockedArtifactHash, artifact.deterministic.canonicalSha256);

  assert.equal(
    report.successContract.criterion,
    'verify-release-passes-without-packaged-fallback-on-docker-wordpress-topology-or-exact-unavailable-capability',
  );
  assert.equal(report.successContract.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(report.successContract.exactUnavailableCapabilityRecorded, true);
  assert.equal(report.successContract.releaseVerifierCarriedThrough, true);
  assert.equal(report.successContract.passedArtifactWouldBeAccepted, false);
  assert.equal(report.successContract.packagedFallbackMaySatisfySuccess, false);
  assert.equal(report.successContract.finalReleaseMayMove, false);

  assert.equal(
    report.generatedCoverage.coverageId,
    'docker-wordpress-topology-v5-release-verifier-carry-through',
  );
  assert.equal(
    report.generatedCoverage.requiredOutcome,
    'verify-release-passes-without-packaged-fallback-on-topology-or-exact-unavailable-capability',
  );
  assert.equal(report.generatedCoverage.productionBackedArtifactPresent, false);
  assert.equal(report.generatedCoverage.releaseGateMayConsumeAsProduction, false);
  assert.deepEqual(report.generatedCoverage.requiredAssertions, generatedCoverageAssertions);
  assert.equal(
    report.generatedCoverage.assertionDigest,
    `sha256:${digest(generatedCoverageAssertions)}`,
  );

  assert.equal(report.topologyCommand.command, topologyCommand);
  assert.equal(report.topologyCommand.releaseVerifierCommand, releaseVerifierCommand);
  assert.equal(report.topologyCommand.status, 'blocked');
  assert.equal(report.topologyCommand.exitCode, 2);
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.topologyCommand.releaseMovementAllowed, false);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    capability: 'docker-cli',
    command: probe.checks.dockerCli.command,
    missingExecutable: true,
    observedShellExitCode: 127,
    requiredFor: [...topologyRequiredFor],
  });

  assert.equal(report.dockerWordPressTopologyV5.proofScope, 'docker-wordpress-topology-v5');
  assert.equal(report.dockerWordPressTopologyV5.siteRoleCount, 4);
  assert.equal(report.dockerWordPressTopologyV5.primaryWordPressRoleCount, 3);
  assert.equal(report.dockerWordPressTopologyV5.supportWordPressRoleCount, 1);
  assert.equal(report.dockerWordPressTopologyV5.startedSiteCount, 0);
  assert.equal(report.dockerWordPressTopologyV5.startupBlockedBy, 'DOCKER_CLI_MISSING');
  assert.deepEqual(report.dockerWordPressTopologyV5.requiredServiceHosts, requiredServiceHosts);
  assert.deepEqual(report.dockerWordPressTopologyV5.releaseEnvHostBindings, releaseEnvHostBindings);
  assert.deepEqual(
    releaseEnvHostBindingsFromPlan(plan),
    report.dockerWordPressTopologyV5.releaseEnvHostBindings,
  );
  assert.deepEqual(
    report.dockerWordPressTopologyV5.dockerServiceSurfaces.map((entry) => entry.role),
    requiredRoleOrder,
  );
  assert.deepEqual(
    report.dockerWordPressTopologyV5.dockerServiceSurfaces.map((entry) => entry.serviceHost),
    plan.sites.map((site) => hostFromDockerUrl(site.url)),
  );
  assert.equal(report.dockerWordPressTopologyV5.network.internal, true);
  assert.equal(report.dockerWordPressTopologyV5.network.publishedHttpIngressCount, 1);
  assert.equal(report.dockerWordPressTopologyV5.network.publishedHttpIngressPort, 8080);
  assert.equal(report.dockerWordPressTopologyV5.network.publishedHttpIngressHostSurface, 'loopback-only');
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.command, releaseVerifierCommand);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.carriedThroughByTopologyCommand, true);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.releaseCommandIsVerifyRelease, true);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.noPackagedFallback, true);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.acceptedForReleaseGateAfterPassedArtifactOnly, false);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.blockedArtifactAcceptedForReleaseGate, false);
  assert.equal(report.dockerWordPressTopologyV5.releaseVerifier.commandArgsDigest, `sha256:${digest(dockerReleaseCommand)}`);
  assert.deepEqual(report.dockerWordPressTopologyV5.prerequisiteBlockerMatrix, requiredBlockerMatrix);
  assert.equal(
    report.dockerWordPressTopologyV5.requirementCount,
    report.dockerWordPressTopologyV5.requirementSurfaces.length,
  );

  assert.deepEqual(report.dockerWordPressTopologyV5.releaseVerifierCarryThrough, {
    command: releaseVerifierCommand,
    topologyCommand,
    carriedThroughByTopologyCommand: true,
    status: 'blocked',
    failClosed: true,
    verifyReleaseFailure: {
      exitCode: artifact.evidence.verifyReleaseFailure.exitCode,
      reason: artifact.evidence.verifyReleaseFailure.reason,
    },
    noPackagedFallback: true,
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    releaseUrlsUseDockerDns: true,
    releaseCommandIsVerifyRelease: true,
    acceptedForReleaseGate: false,
    releaseMovementAllowed: false,
    primaryFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
    releaseGateTotals: artifact.releaseGateEvaluation.totals,
    requiredCarryThrough: [...releaseVerifierCarryThroughRequirements],
  });

  assert.deepEqual(report.dockerWordPressTopologyV5.releaseAcceptance, {
    blockedArtifactAccepted: false,
    passedArtifactAccepted: false,
    passedArtifactStatus: 'passed',
    passedArtifactReleaseCommand: releaseVerifierCommand,
    passedArtifactPackagedFallbackObserved: false,
    passedArtifactUsesDockerDns: true,
    finalReleaseMovementAllowedFromSupportEvidence: false,
    finalReleaseFailureCode: 'LOCAL_CANDIDATE_EVIDENCE_ONLY',
  });
  assert.equal(report.releaseGate.acceptedForReleaseGate, false);
  assert.equal(report.releaseGate.releaseMovementAllowed, false);
  assert.equal(report.releaseGate.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(report.releaseGate.mutationAttempted, false);
  assert.equal(report.releaseGate.finalReleaseStatus, 'NO-GO');

  assert.equal(report.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(report.evidenceLimits.rawUrlCount, 0);
  assert.equal(report.evidenceLimits.rawPayloadCount, 0);
  assert.equal(report.evidenceLimits.credentialSurfaceCount, 0);
  assert.equal(report.evidenceLimits.tunnelOutputCount, 0);
  assert.equal(report.evidenceLimits.evidenceSurfaceCount, report.evidenceLimits.surfaceNames.length);
  assert.equal(report.invariants.verifyReleasePassedWithoutPackagedFallbackOnTopologyOrExactCapability, true);
  assert.equal(report.invariants.releaseVerifierCarriedThrough, true);
  assert.equal(report.invariants.releaseVerifierFailureReasonMatchesUnavailableCapability, true);
  assert.equal(report.invariants.passedArtifactRequiredForAcceptance, true);
  assert.equal(report.invariants.generatedCoverageIsSupportOnly, true);
  assert.equal(report.invariants.noProductionBackedProofClaim, true);
  assertSupportReportHashes(report);
  assert.deepEqual(findRawHttpStrings(report), []);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /Bearer\s+|Basic\s+|Set-Cookie|Cookie\s*:|application[_ -]?password/i);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(report, {
    label: 'RPP-0882 Docker WordPress topology v5 support report',
  }));
});

test('RPP-0882 release verifier carry-through requires passed verify:release without fallback', () => {
  const blocked = evaluateDockerWordPressTopologyV5CarryThrough(buildMissingDockerCapabilityArtifact());
  const passed = evaluateDockerWordPressTopologyV5CarryThrough(buildPassedDockerArtifact());

  assert.equal(blocked.ok, true);
  assert.equal(blocked.releaseReadyArtifact, false);
  assert.equal(blocked.exactUnavailableCapability.code, 'DOCKER_CLI_MISSING');
  assert.equal(blocked.carriedThroughByTopologyCommand, true);
  assert.equal(blocked.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(blocked.acceptedForReleaseGate, false);
  assert.equal(blocked.releaseMovementAllowed, false);
  assert.equal(blocked.noPackagedFallback, true);
  assert.equal(blocked.packagedFallbackAllowed, false);
  assert.equal(blocked.packagedFallbackObserved, false);

  assert.equal(passed.ok, true);
  assert.equal(passed.releaseReadyArtifact, true);
  assert.equal(passed.exactUnavailableCapability, null);
  assert.equal(passed.carriedThroughByTopologyCommand, true);
  assert.equal(passed.verifyReleaseFailure, null);
  assert.equal(passed.acceptedForReleaseGate, false);
  assert.equal(passed.verifyReleaseCommand, releaseVerifierCommand);
  assert.deepEqual(passed.verifyReleaseCommandArgs, dockerReleaseCommand);
  assert.equal(passed.releaseUrlsUseDockerDns, true);
  assert.equal(passed.releaseCommandIsVerifyRelease, true);
  assert.equal(passed.noPackagedFallback, true);
  assert.equal(passed.packagedFallbackAllowed, false);
  assert.equal(passed.packagedFallbackObserved, false);
  assert.equal(passed.finalReleaseMovementAllowedFromSupportEvidence, false);
  assert.equal(passed.finalReleaseFailureCode, 'LOCAL_CANDIDATE_EVIDENCE_ONLY');
  assert.deepEqual(passed.releaseEnvHostBindings, releaseEnvHostBindings);
  assert.deepEqual(passed.requiredCarryThrough, releaseVerifierCarryThroughRequirements);
  assert.deepEqual(passed.generatedCoverageRequiredAssertions, generatedCoverageAssertions);
});

test('RPP-0882 prerequisite blockers carry verify:release failure reason and fail closed', () => {
  const matrix = buildPrerequisiteBlockerMatrix();

  assert.deepEqual(matrix, requiredBlockerMatrix);
  for (const entry of matrix) {
    assert.equal(entry.failClosed, true);
    assert.equal(entry.startsTopology, false);
    assert.ok(topologyRequiredFor.includes('verify-release-passes-without-packaged-fallback-on-topology'));
  }

  const { artifact } = buildMissingDockerCapabilityArtifact();
  const artifactFile = writeTempArtifact(artifact);
  const gateResult = runReleaseGateCli(['--evidence-file', artifactFile], {
    cwd: '/repo/reprint-push',
    env: {},
    now: new Date(fixedNow),
  });

  assert.equal(gateResult.exitCode, 1);
  assert.equal(gateResult.report.releaseStatus, 'NO-GO');
  assert.equal(gateResult.report.mutationAttempted, false);
  assert.equal(gateResult.report.releaseMovement.allowed, false);
  assert.equal(gateResult.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, releaseVerifierCommand);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
});

test('RPP-0882 topology plan rejects fallback, non-DNS release URLs, and widened ingress', () => {
  const plan = buildRpp0882Plan();

  assert.equal(plan.validation.ok, true);
  assert.deepEqual(releaseEnvHostBindingsFromPlan(plan), releaseEnvHostBindings);
  assert.deepEqual(plan.runner.releaseCommand, dockerReleaseCommand);
  assert.equal(plan.runner.packagedFallbackAllowed, false);
  assert.equal(plan.validation.checks.releaseUrlsUseDockerDns, true);
  assert.equal(plan.validation.checks.releaseCommandIsVerifyRelease, true);
  assert.equal(plan.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(plan.validation.checks.noTunnelCommands, true);
  for (const key of forbiddenPackagedFallbackEnvKeys) {
    assert.equal(plan.releaseEnv[key], undefined);
  }

  const fallbackEnvValidation = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only' },
  });
  assertFailure(fallbackEnvValidation, 'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED');

  const fallbackRunnerValidation = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, packagedFallbackAllowed: true },
  });
  assertFailure(fallbackRunnerValidation, 'DOCKER_PACKAGED_FALLBACK_NOT_DISABLED');

  const nonReleaseRunnerValidation = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, releaseCommand: ['npm', 'run', 'verify:release:local-production'] },
  });
  assertFailure(nonReleaseRunnerValidation, 'DOCKER_RELEASE_COMMAND_NOT_VERIFY_RELEASE');

  const nonDockerUrlValidation = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_LOCAL_URL: 'local.example.invalid' },
  });
  assertFailure(nonDockerUrlValidation, 'NON_DOCKER_INTERNAL_RELEASE_URL');

  const widenedIngressValidation = validateTopologyPlan({
    ...plan,
    publishedPorts: [
      ...plan.publishedPorts,
      { service: 'wp-local-edited', host: '127.0.0.1', hostPort: 8081, containerPort: 80 },
    ],
  });
  assertFailure(widenedIngressValidation, 'MULTIPLE_PUBLISHED_HTTP_PORTS');
  assertFailure(widenedIngressValidation, 'NON_LOCAL_OR_NON_8080_PORT');

  const tunnelReferenceValidation = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, plannerProofCommand: ['ngrok', 'start'] },
  });
  assertFailure(tunnelReferenceValidation, 'FORBIDDEN_TUNNEL_REFERENCE');
});

test('RPP-0882 validation rejects release verifier carry-through gaps and fallback claims', () => {
  const { report } = loadSupportReport();

  const ambiguous = structuredClone(report);
  ambiguous.topologyCommand.exactUnavailableCapability.code = '';
  assertFailure(
    validateDockerWordPressTopologyV5Report(ambiguous),
    'DOCKER_WORDPRESS_TOPOLOGY_V5_UNAVAILABLE_CAPABILITY_NOT_EXACT',
  );

  const fallback = structuredClone(report);
  fallback.dockerWordPressTopologyV5.releaseVerifier.packagedFallbackObserved = true;
  fallback.dockerWordPressTopologyV5.releaseVerifierCarryThrough.packagedFallbackObserved = true;
  fallback.dockerWordPressTopologyV5.releaseVerifierCarryThrough.noPackagedFallback = false;
  assertFailure(
    validateDockerWordPressTopologyV5Report(fallback),
    'DOCKER_WORDPRESS_TOPOLOGY_V5_PACKAGED_FALLBACK_REJECTED',
  );

  const carryGap = structuredClone(report);
  carryGap.successContract.releaseVerifierCarriedThrough = false;
  carryGap.dockerWordPressTopologyV5.releaseVerifier.carriedThroughByTopologyCommand = false;
  carryGap.dockerWordPressTopologyV5.releaseVerifierCarryThrough.carriedThroughByTopologyCommand = false;
  assertFailure(
    validateDockerWordPressTopologyV5Report(carryGap),
    'DOCKER_WORDPRESS_TOPOLOGY_V5_RELEASE_VERIFIER_NOT_CARRIED',
  );

  const failureMismatch = structuredClone(report);
  failureMismatch.dockerWordPressTopologyV5.releaseVerifierCarryThrough.verifyReleaseFailure.reason = 'UNKNOWN';
  assertFailure(
    validateDockerWordPressTopologyV5Report(failureMismatch),
    'DOCKER_WORDPRESS_TOPOLOGY_V5_RELEASE_VERIFIER_FAILURE_MISMATCH',
  );

  const movementClaim = structuredClone(report);
  movementClaim.releaseGate.releaseMovementAllowed = true;
  movementClaim.successContract.finalReleaseMayMove = true;
  movementClaim.dockerWordPressTopologyV5.releaseVerifierCarryThrough.releaseMovementAllowed = true;
  assertFailure(
    validateDockerWordPressTopologyV5Report(movementClaim),
    'DOCKER_WORDPRESS_TOPOLOGY_V5_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const rawUrl = structuredClone(report);
  rawUrl.dockerWordPressTopologyV5.releaseEnvHostBindings[0].rawUrl = 'http://wp-source';
  assertFailure(
    validateDockerWordPressTopologyV5Report(rawUrl),
    'DOCKER_WORDPRESS_TOPOLOGY_V5_RAW_URL_SURFACE_REJECTED',
  );
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0882 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildRpp0882Plan() {
  return buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0882-docker-work',
    evidenceDir: '/tmp/rpp-0882-docker-evidence',
    env: {},
  });
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildRpp0882Plan();
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }),
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

function buildPassedDockerArtifact() {
  const plan = buildRpp0882Plan();
  const probe = probeDockerPrerequisites({
    runCommand: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      }
      if (args[0] === 'compose') {
        return { status: 0, stdout: '2.27.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { status: 0, stdout: '"26.1.0"', stderr: '' };
      }
      throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
    },
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'passed',
    releaseEvidence: {
      ok: true,
      verifier: {
        authSessionBoundary: { manageOptions: true },
        gate2DurableRecoveryJournal: { ok: true },
        boundary: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      },
      invariants: {
        receiptHashPresent: true,
        applyRevalidationCoveredEveryMutation: true,
        durableJournalGateOk: true,
      },
    },
    verify: { status: 0, signal: null },
    generatedAt: fixedNow,
  });

  return { artifact, plan, probe };
}

function evaluateDockerWordPressTopologyV5CarryThrough({ artifact, plan, probe }) {
  const topologyEvidence = artifact.evidence.dockerVerifyReleaseTopology;
  const verifyReleaseFailure = artifact.evidence.verifyReleaseFailure || null;
  const noPackagedFallback = artifact.packagedFallback === false
    && artifact.evidence.packagedFallback?.observed === false
    && topologyEvidence.packagedFallbackAllowed === false
    && topologyEvidence.packagedFallbackObserved === false;
  const carriedThroughByTopologyCommand = topologyEvidence.command === releaseVerifierCommand
    && topologyEvidence.releaseCommandIsVerifyRelease === true;
  const releaseReadyArtifact = artifact.status === 'passed'
    && verifyReleaseFailure === null
    && topologyEvidence.ok === true
    && topologyEvidence.releaseUrlsUseDockerDns === true
    && carriedThroughByTopologyCommand
    && noPackagedFallback;
  const exactUnavailableCapability = releaseReadyArtifact ? null : exactUnavailableCapabilityForProbe(probe);
  const ok = releaseReadyArtifact || Boolean(exactUnavailableCapability?.code);

  return {
    ok,
    releaseReadyArtifact,
    acceptedForReleaseGate: artifact.acceptedForReleaseGate,
    releaseMovementAllowed: artifact.acceptedForReleaseGate === true
      && artifact.releaseGateEvaluation.releaseMovement.allowed === true,
    finalReleaseMovementAllowedFromSupportEvidence: false,
    finalReleaseFailureCode: artifact.status === 'passed' && artifact.acceptedForReleaseGate !== true
      ? 'LOCAL_CANDIDATE_EVIDENCE_ONLY'
      : artifact.releaseGateEvaluation.primaryFailureCode,
    carriedThroughByTopologyCommand,
    verifyReleaseFailure: verifyReleaseFailure ? {
      exitCode: verifyReleaseFailure.exitCode,
      reason: verifyReleaseFailure.reason,
    } : null,
    verifyReleaseCommand: topologyEvidence.command,
    verifyReleaseCommandArgs: topologyEvidence.commandArgs,
    releaseUrlsUseDockerDns: topologyEvidence.releaseUrlsUseDockerDns,
    releaseCommandIsVerifyRelease: topologyEvidence.releaseCommandIsVerifyRelease,
    noPackagedFallback,
    packagedFallbackAllowed: topologyEvidence.packagedFallbackAllowed,
    packagedFallbackObserved: topologyEvidence.packagedFallbackObserved,
    exactUnavailableCapability,
    serviceHosts: plan.sites.map((site) => hostFromDockerUrl(site.url)),
    releaseEnvHostBindings: releaseEnvHostBindingsFromPlan(plan),
    requiredCarryThrough: [...releaseVerifierCarryThroughRequirements],
    generatedCoverageRequiredAssertions: [...generatedCoverageAssertions],
  };
}

function buildPrerequisiteBlockerMatrix() {
  return [
    exactUnavailableCapabilityForProbe(probeDockerPrerequisites({
      runCommand: () => ({
        error: Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }),
        stdout: '',
        stderr: '',
      }),
    })),
    exactUnavailableCapabilityForProbe(probeDockerPrerequisites({
      runCommand: (_command, args) => {
        if (args[0] === '--version') {
          return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
        }
        if (args[0] === 'compose') {
          return { status: 1, stdout: '', stderr: 'docker: unknown command "compose"' };
        }
        throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
      },
    })),
    exactUnavailableCapabilityForProbe(probeDockerPrerequisites({
      runCommand: (_command, args) => {
        if (args[0] === '--version') {
          return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
        }
        if (args[0] === 'compose') {
          return { status: 0, stdout: '2.27.0', stderr: '' };
        }
        if (args[0] === 'info') {
          return { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
        }
        throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
      },
    })),
  ].map((entry) => ({
    code: entry.code,
    capability: entry.capability,
    command: entry.command,
    failClosed: true,
    startsTopology: false,
  }));
}

function exactUnavailableCapabilityForProbe(probe) {
  const code = probe.blocker?.code || null;
  if (!code) return null;

  return {
    code,
    capability: dockerCapabilityForBlocker(code),
    command: blockerCommandForProbe(probe, code),
    missingExecutable: blockerMissingExecutableForProbe(probe, code),
    requiredFor: [...topologyRequiredFor],
  };
}

function validateDockerWordPressTopologyV5Report(report) {
  const failures = [];
  const topology = report.dockerWordPressTopologyV5 || {};
  const releaseVerifier = topology.releaseVerifier || {};
  const carryThrough = topology.releaseVerifierCarryThrough || {};
  const unavailableCapability = report.topologyCommand?.exactUnavailableCapability || {};

  if (report.rppId !== 'RPP-0882'
    || report.variant !== 5
    || report.proofId !== 'rpp-0882-docker-wordpress-topology-v5'
    || report.coverageMode !== 'release-verifier-carry-through-local-support-only') {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_IDENTITY_MISMATCH' });
  }
  if (report.supportOnly !== true
    || report.productionBacked !== false
    || report.releaseEligible !== false
    || report.finalReleaseStatus !== 'NO-GO'
    || report.integrationRecommendation !== 'NO-GO'
    || report.releaseGate?.releaseMovementAllowed !== false
    || report.releaseGate?.acceptedForReleaseGate !== false
    || report.successContract?.finalReleaseMayMove !== false
    || report.generatedCoverage?.productionBackedArtifactPresent !== false
    || report.generatedCoverage?.releaseGateMayConsumeAsProduction !== false
    || carryThrough.releaseMovementAllowed !== false
    || carryThrough.acceptedForReleaseGate !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.verifyReleasePassedWithoutPackagedFallback !== true
    && report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.successContract?.releaseVerifierCarriedThrough !== true
    || releaseVerifier.carriedThroughByTopologyCommand !== true
    || carryThrough.carriedThroughByTopologyCommand !== true
    || carryThrough.command !== releaseVerifierCommand
    || carryThrough.topologyCommand !== topologyCommand) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_RELEASE_VERIFIER_NOT_CARRIED' });
  }
  if (report.successContract?.passedArtifactWouldBeAccepted !== false
    || report.successContract?.packagedFallbackMaySatisfySuccess !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_ACCEPTANCE_CONTRACT_FAILED' });
  }
  if (report.topologyCommand?.status !== 'passed') {
    if (!unavailableCapability.code || !unavailableCapability.capability || !unavailableCapability.command) {
      failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (carryThrough.verifyReleaseFailure?.reason !== unavailableCapability.code
      || carryThrough.verifyReleaseFailure?.exitCode !== report.topologyCommand?.exitCode) {
      failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_RELEASE_VERIFIER_FAILURE_MISMATCH' });
    }
  }
  if (!Array.isArray(report.generatedCoverage?.requiredAssertions)
    || !arraysEqual(report.generatedCoverage.requiredAssertions, generatedCoverageAssertions)
    || report.generatedCoverage.assertionDigest !== `sha256:${digest(generatedCoverageAssertions)}`) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_GENERATED_ASSERTIONS_MISMATCH' });
  }
  if (!arraysEqual(topology.requiredServiceHosts || [], requiredServiceHosts)
    || topology.siteRoleCount !== requiredServiceHosts.length
    || topology.primaryWordPressRoleCount !== 3
    || topology.supportWordPressRoleCount !== 1
    || topology.dockerServiceSurfaces?.length !== requiredServiceHosts.length) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_SERVICE_HOSTS_MISMATCH' });
  }
  if (!arraysEqual(topology.releaseEnvHostBindings || [], releaseEnvHostBindings)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_RELEASE_ENV_BINDINGS_MISMATCH' });
  }
  if (!arraysEqual(topology.prerequisiteBlockerMatrix || [], requiredBlockerMatrix)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_BLOCKER_MATRIX_INCOMPLETE' });
  }
  if (releaseVerifier.releaseCommandIsVerifyRelease !== true
    || report.topologyCommand?.releaseVerifierCommand !== releaseVerifierCommand
    || releaseVerifier.command !== releaseVerifierCommand
    || releaseVerifier.commandArgsDigest !== `sha256:${digest(dockerReleaseCommand)}`) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_VERIFY_RELEASE_COMMAND_REQUIRED' });
  }
  if (releaseVerifier.releaseUrlsUseDockerDns !== true
    || carryThrough.releaseUrlsUseDockerDns !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_DOCKER_DNS_REQUIRED' });
  }
  if (releaseVerifier.noPackagedFallback !== true
    || releaseVerifier.packagedFallbackAllowed !== false
    || releaseVerifier.packagedFallbackObserved !== false
    || carryThrough.noPackagedFallback !== true
    || carryThrough.packagedFallbackAllowed !== false
    || carryThrough.packagedFallbackObserved !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_PACKAGED_FALLBACK_REJECTED' });
  }
  if (!Array.isArray(carryThrough.requiredCarryThrough)
    || !arraysEqual(carryThrough.requiredCarryThrough, releaseVerifierCarryThroughRequirements)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_CARRY_THROUGH_REQUIREMENTS_MISMATCH' });
  }
  if (topology.releaseAcceptance?.blockedArtifactAccepted !== false
    || topology.releaseAcceptance?.passedArtifactAccepted !== false
    || topology.releaseAcceptance?.passedArtifactReleaseCommand !== releaseVerifierCommand
    || topology.releaseAcceptance?.passedArtifactPackagedFallbackObserved !== false
    || topology.releaseAcceptance?.passedArtifactUsesDockerDns !== true
    || topology.releaseAcceptance?.finalReleaseMovementAllowedFromSupportEvidence !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_RELEASE_ACCEPTANCE_MISMATCH' });
  }
  if (topology.network?.publishedHttpIngressCount !== 1
    || topology.network?.publishedHttpIngressPort !== 8080
    || topology.network?.publishedHttpIngressHostSurface !== 'loopback-only'
    || topology.network?.internal !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.rawUrlCount !== 0
    || report.evidenceLimits?.rawPayloadCount !== 0
    || report.evidenceLimits?.credentialSurfaceCount !== 0
    || report.evidenceLimits?.tunnelOutputCount !== 0) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_EVIDENCE_LIMITS_FAILED' });
  }
  if (findRawHttpStrings(report).length > 0) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_RAW_URL_SURFACE_REJECTED' });
  }
  if (!supportReportHashesOk(report)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V5_HASH_MISMATCH' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertSupportReportHashes(report) {
  assert.match(report.supportReportHash, proofHashPattern);
  assert.match(report.generatedCoverage.assertionDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV5.releaseEnvBindingDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV5.blockerMatrixDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV5.releaseVerifierCarryThroughDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV5.scopeHash, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV5.serviceSurfaceDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV5.requirementDigest, proofHashPattern);
  assert.match(report.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.equal(supportReportHashesOk(report), true);
}

function supportReportHashesOk(report) {
  const withoutReportHash = structuredClone(report);
  delete withoutReportHash.supportReportHash;
  const scopeCore = {
    proofScope: report.dockerWordPressTopologyV5?.proofScope,
    status: report.status,
    coverageMode: report.coverageMode,
    successContract: report.successContract,
    generatedCoverage: report.generatedCoverage,
    topologyCommand: report.topologyCommand,
    releaseEnvHostBindings: report.dockerWordPressTopologyV5?.releaseEnvHostBindings,
    dockerServiceSurfaces: report.dockerWordPressTopologyV5?.dockerServiceSurfaces,
    prerequisiteBlockerMatrix: report.dockerWordPressTopologyV5?.prerequisiteBlockerMatrix,
    releaseVerifierCarryThrough: report.dockerWordPressTopologyV5?.releaseVerifierCarryThrough,
    releaseAcceptance: report.dockerWordPressTopologyV5?.releaseAcceptance,
    requirementSurfaces: report.dockerWordPressTopologyV5?.requirementSurfaces,
    releaseGate: report.releaseGate,
  };

  return report.generatedCoverage?.assertionDigest === `sha256:${digest(generatedCoverageAssertions)}`
    && report.dockerWordPressTopologyV5?.releaseEnvBindingDigest
      === `sha256:${digest(report.dockerWordPressTopologyV5?.releaseEnvHostBindings || [])}`
    && report.dockerWordPressTopologyV5?.blockerMatrixDigest
      === `sha256:${digest(report.dockerWordPressTopologyV5?.prerequisiteBlockerMatrix || [])}`
    && report.dockerWordPressTopologyV5?.releaseVerifierCarryThroughDigest
      === `sha256:${digest(report.dockerWordPressTopologyV5?.releaseVerifierCarryThrough || {})}`
    && report.dockerWordPressTopologyV5?.serviceSurfaceDigest
      === `sha256:${digest(report.dockerWordPressTopologyV5?.dockerServiceSurfaces || [])}`
    && report.dockerWordPressTopologyV5?.requirementDigest
      === `sha256:${digest(report.dockerWordPressTopologyV5?.requirementSurfaces || [])}`
    && report.dockerWordPressTopologyV5?.scopeHash === `sha256:${digest(scopeCore)}`
    && report.evidenceLimits?.surfaceDigest === `sha256:${digest(report.evidenceLimits?.surfaceNames || [])}`
    && report.supportReportHash === `sha256:${digest(withoutReportHash)}`;
}

function releaseEnvHostBindingsFromPlan(plan) {
  return releaseEnvHostBindings.map(({ envKey, role }) => ({
    envKey,
    role,
    serviceHost: hostFromDockerUrl(plan.releaseEnv[envKey]),
  }));
}

function writeTempArtifact(artifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0882-gate-artifact-'));
  const artifactFile = path.join(tempDir, 'release-gate-input.json');
  fs.writeFileSync(artifactFile, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifactFile;
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

function hostFromDockerUrl(url) {
  const parsed = new URL(url);
  return parsed.hostname;
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

function assertFailure(validation, code) {
  assert.equal(validation.ok, false);
  assert.ok(
    validation.failures.some((failure) => failure.code === code),
    `Expected ${code}; observed ${JSON.stringify(validation.failures)}`,
  );
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
