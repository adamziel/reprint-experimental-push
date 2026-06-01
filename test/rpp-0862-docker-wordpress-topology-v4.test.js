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
  'docs/evidence/rpp-0862-docker-wordpress-topology-v4.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
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
  'docker-wordpress-topology-v4-release-contract-regression',
  'verify-release-without-packaged-fallback-on-topology',
]);
const generatedCoverageAssertions = Object.freeze([
  'probe-cli-compose-daemon-before-topology-start',
  'bind-release-env-to-private-docker-dns-hosts',
  'publish-only-loopback-8080-inspection-ingress',
  'invoke-npm-run-verify-release-inside-runner',
  'accept-release-gate-artifact-only-after-passed-docker-run',
  'reject-packaged-fallback-env-and-runner-flags',
  'record-fail-closed-capability-matrix-when-docker-unavailable',
  'preserve-support-only-no-go',
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

test('RPP-0862 support report records Docker WordPress topology v4 release contract', () => {
  const { report, text } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateDockerWordPressTopologyV4Report(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0862');
  assert.equal(report.proofId, 'rpp-0862-docker-wordpress-topology-v4');
  assert.equal(report.variant, 4);
  assert.equal(report.coverageMode, 'generated-local-support-only');
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.closestTemplate, 'RPP-0842 docker-wordpress-topology-v3');
  assert.deepEqual(report.builtOn.priorDockerTopologyEvidence, [
    'RPP-0802 docker-wordpress-topology-v1',
    'RPP-0822 docker-wordpress-topology-v2',
    'RPP-0842 docker-wordpress-topology-v3',
  ]);
  assert.equal(report.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.runtime, artifact.runtime);
  assert.equal(report.builtOn.gate, artifact.gate);
  assert.equal(report.builtOn.blockedArtifactHash, artifact.deterministic.canonicalSha256);

  assert.equal(
    report.successContract.criterion,
    'verify-release-passes-without-packaged-fallback-on-docker-wordpress-topology-or-exact-unavailable-capability',
  );
  assert.equal(report.successContract.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(report.successContract.exactUnavailableCapabilityRecorded, true);
  assert.equal(report.successContract.passedArtifactWouldBeAccepted, true);
  assert.equal(report.successContract.packagedFallbackMaySatisfySuccess, false);
  assert.equal(report.successContract.finalReleaseMayMove, false);

  assert.equal(
    report.generatedCoverage.coverageId,
    'docker-wordpress-topology-v4-release-contract-regression',
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

  assert.equal(report.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.topologyCommand.releaseVerifierCommand, dockerReleaseCommand.join(' '));
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

  assert.equal(report.dockerWordPressTopologyV4.proofScope, 'docker-wordpress-topology-v4');
  assert.equal(report.dockerWordPressTopologyV4.siteRoleCount, 4);
  assert.equal(report.dockerWordPressTopologyV4.primaryWordPressRoleCount, 3);
  assert.equal(report.dockerWordPressTopologyV4.supportWordPressRoleCount, 1);
  assert.equal(report.dockerWordPressTopologyV4.startedSiteCount, 0);
  assert.equal(report.dockerWordPressTopologyV4.startupBlockedBy, 'DOCKER_CLI_MISSING');
  assert.deepEqual(report.dockerWordPressTopologyV4.requiredServiceHosts, requiredServiceHosts);
  assert.deepEqual(report.dockerWordPressTopologyV4.releaseEnvHostBindings, releaseEnvHostBindings);
  assert.deepEqual(
    releaseEnvHostBindingsFromPlan(plan),
    report.dockerWordPressTopologyV4.releaseEnvHostBindings,
  );
  assert.deepEqual(
    report.dockerWordPressTopologyV4.dockerServiceSurfaces.map((entry) => entry.role),
    requiredRoleOrder,
  );
  assert.deepEqual(
    report.dockerWordPressTopologyV4.dockerServiceSurfaces.map((entry) => entry.serviceHost),
    plan.sites.map((site) => hostFromDockerUrl(site.url)),
  );
  assert.equal(report.dockerWordPressTopologyV4.network.internal, true);
  assert.equal(report.dockerWordPressTopologyV4.network.publishedHttpIngressCount, 1);
  assert.equal(report.dockerWordPressTopologyV4.network.publishedHttpIngressPort, 8080);
  assert.equal(report.dockerWordPressTopologyV4.network.publishedHttpIngressHostSurface, 'loopback-only');
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.releaseCommandIsVerifyRelease, true);
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.acceptedForReleaseGateAfterPassedArtifactOnly, true);
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.blockedArtifactAcceptedForReleaseGate, false);
  assert.equal(report.dockerWordPressTopologyV4.releaseVerifier.commandArgsDigest, `sha256:${digest(dockerReleaseCommand)}`);
  assert.deepEqual(report.dockerWordPressTopologyV4.prerequisiteBlockerMatrix, requiredBlockerMatrix);
  assert.equal(
    report.dockerWordPressTopologyV4.requirementCount,
    report.dockerWordPressTopologyV4.requirementSurfaces.length,
  );

  assert.deepEqual(report.dockerWordPressTopologyV4.releaseAcceptance, {
    blockedArtifactAccepted: false,
    passedArtifactAccepted: true,
    passedArtifactStatus: 'passed',
    passedArtifactReleaseCommand: 'npm run verify:release',
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
  assert.equal(report.invariants.passedArtifactRequiredForAcceptance, true);
  assert.equal(report.invariants.generatedCoverageIsSupportOnly, true);
  assert.equal(report.invariants.noProductionBackedProofClaim, true);
  assertSupportReportHashes(report);
  assert.deepEqual(findRawHttpStrings(report), []);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /Bearer\s+|Basic\s+|Set-Cookie|Cookie\s*:|application[_ -]?password/i);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(report, {
    label: 'RPP-0862 Docker WordPress topology v4 support report',
  }));
});

test('RPP-0862 release acceptance requires passed verify:release on Docker DNS without fallback', () => {
  const blocked = evaluateDockerWordPressTopologyV4Acceptance(buildMissingDockerCapabilityArtifact());
  const passed = evaluateDockerWordPressTopologyV4Acceptance(buildPassedDockerArtifact());

  assert.equal(blocked.ok, true);
  assert.equal(blocked.releaseReadyArtifact, false);
  assert.equal(blocked.exactUnavailableCapability.code, 'DOCKER_CLI_MISSING');
  assert.equal(blocked.acceptedForReleaseGate, false);
  assert.equal(blocked.releaseMovementAllowed, false);
  assert.equal(blocked.finalReleaseFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');

  assert.equal(passed.ok, true);
  assert.equal(passed.releaseReadyArtifact, true);
  assert.equal(passed.exactUnavailableCapability, null);
  assert.equal(passed.acceptedForReleaseGate, true);
  assert.equal(passed.verifyReleaseCommand, 'npm run verify:release');
  assert.deepEqual(passed.verifyReleaseCommandArgs, dockerReleaseCommand);
  assert.equal(passed.releaseUrlsUseDockerDns, true);
  assert.equal(passed.packagedFallbackAllowed, false);
  assert.equal(passed.packagedFallbackObserved, false);
  assert.equal(passed.finalReleaseMovementAllowedFromSupportEvidence, false);
  assert.equal(passed.finalReleaseFailureCode, 'LOCAL_CANDIDATE_EVIDENCE_ONLY');
  assert.deepEqual(passed.releaseEnvHostBindings, releaseEnvHostBindings);
  assert.deepEqual(passed.generatedCoverageRequiredAssertions, generatedCoverageAssertions);
});

test('RPP-0862 prerequisite blocker matrix fails closed for CLI, Compose, and daemon blockers', () => {
  const matrix = buildPrerequisiteBlockerMatrix();

  assert.deepEqual(matrix, requiredBlockerMatrix);
  for (const entry of matrix) {
    assert.equal(entry.failClosed, true);
    assert.equal(entry.startsTopology, false);
    assert.ok(topologyRequiredFor.includes('verify-release-without-packaged-fallback-on-topology'));
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
});

test('RPP-0862 topology plan rejects fallback, non-DNS release URLs, and widened ingress', () => {
  const plan = buildRpp0862Plan();

  assert.equal(plan.validation.ok, true);
  assert.deepEqual(releaseEnvHostBindingsFromPlan(plan), releaseEnvHostBindings);
  assert.deepEqual(plan.runner.releaseCommand, dockerReleaseCommand);
  assert.equal(plan.runner.packagedFallbackAllowed, false);
  assert.equal(plan.validation.checks.releaseUrlsUseDockerDns, true);
  assert.equal(plan.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(plan.validation.checks.noTunnelCommands, true);
  for (const key of forbiddenPackagedFallbackEnvKeys) {
    assert.equal(plan.releaseEnv[key], undefined);
  }

  const fallbackEnvValidation = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_PACKAGED_FALLBACK: '1' },
  });
  assertFailure(fallbackEnvValidation, 'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED');

  const fallbackRunnerValidation = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, packagedFallbackAllowed: true },
  });
  assertFailure(fallbackRunnerValidation, 'DOCKER_PACKAGED_FALLBACK_NOT_DISABLED');

  const nonDockerUrlValidation = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_SOURCE_URL: 'source.example.invalid' },
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

test('RPP-0862 validation rejects ambiguous, widened, or fallback-scoped evidence', () => {
  const { report } = loadSupportReport();

  const ambiguous = structuredClone(report);
  ambiguous.topologyCommand.exactUnavailableCapability.command = '';
  assertFailure(
    validateDockerWordPressTopologyV4Report(ambiguous),
    'DOCKER_WORDPRESS_TOPOLOGY_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT',
  );

  const fallback = structuredClone(report);
  fallback.dockerWordPressTopologyV4.releaseVerifier.packagedFallbackObserved = true;
  assertFailure(
    validateDockerWordPressTopologyV4Report(fallback),
    'DOCKER_WORDPRESS_TOPOLOGY_V4_PACKAGED_FALLBACK_REJECTED',
  );

  const hostDrift = structuredClone(report);
  hostDrift.dockerWordPressTopologyV4.releaseEnvHostBindings[1].serviceHost = 'wp-remote-changed';
  assertFailure(
    validateDockerWordPressTopologyV4Report(hostDrift),
    'DOCKER_WORDPRESS_TOPOLOGY_V4_RELEASE_ENV_BINDINGS_MISMATCH',
  );

  const missingBlocker = structuredClone(report);
  missingBlocker.dockerWordPressTopologyV4.prerequisiteBlockerMatrix.pop();
  assertFailure(
    validateDockerWordPressTopologyV4Report(missingBlocker),
    'DOCKER_WORDPRESS_TOPOLOGY_V4_BLOCKER_MATRIX_INCOMPLETE',
  );

  const movementClaim = structuredClone(report);
  movementClaim.releaseGate.releaseMovementAllowed = true;
  movementClaim.successContract.finalReleaseMayMove = true;
  assertFailure(
    validateDockerWordPressTopologyV4Report(movementClaim),
    'DOCKER_WORDPRESS_TOPOLOGY_V4_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const rawUrl = structuredClone(report);
  rawUrl.dockerWordPressTopologyV4.releaseEnvHostBindings[0].rawUrl = 'http://wp-source';
  assertFailure(
    validateDockerWordPressTopologyV4Report(rawUrl),
    'DOCKER_WORDPRESS_TOPOLOGY_V4_RAW_URL_SURFACE_REJECTED',
  );
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0862 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildRpp0862Plan() {
  return buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0862-docker-work',
    evidenceDir: '/tmp/rpp-0862-docker-evidence',
    env: {},
  });
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildRpp0862Plan();
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
  const plan = buildRpp0862Plan();
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

function evaluateDockerWordPressTopologyV4Acceptance({ artifact, plan, probe }) {
  const topologyEvidence = artifact.evidence.dockerVerifyReleaseTopology;
  const noPackagedFallback = artifact.packagedFallback === false
    && topologyEvidence.packagedFallbackAllowed === false
    && topologyEvidence.packagedFallbackObserved === false
    && artifact.evidence.packagedFallback?.observed === false;
  const releaseReadyArtifact = artifact.status === 'passed'
    && artifact.acceptedForReleaseGate === true
    && artifact.evidence.verifyReleaseFailure === undefined
    && topologyEvidence.ok === true
    && topologyEvidence.releaseCommandIsVerifyRelease === true
    && topologyEvidence.releaseUrlsUseDockerDns === true
    && noPackagedFallback;
  const exactUnavailableCapability = releaseReadyArtifact ? null : exactUnavailableCapabilityForProbe(probe);
  const ok = releaseReadyArtifact || Boolean(exactUnavailableCapability?.code);

  return {
    ok,
    releaseReadyArtifact,
    acceptedForReleaseGate: artifact.acceptedForReleaseGate,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    finalReleaseMovementAllowedFromSupportEvidence: artifact.releaseGateEvaluation.releaseMovement.allowed,
    finalReleaseFailureCode: artifact.releaseGateEvaluation.primaryFailureCode,
    verifyReleaseCommand: topologyEvidence.command,
    verifyReleaseCommandArgs: topologyEvidence.commandArgs,
    releaseUrlsUseDockerDns: topologyEvidence.releaseUrlsUseDockerDns,
    packagedFallbackAllowed: topologyEvidence.packagedFallbackAllowed,
    packagedFallbackObserved: topologyEvidence.packagedFallbackObserved,
    exactUnavailableCapability,
    serviceHosts: plan.sites.map((site) => hostFromDockerUrl(site.url)),
    releaseEnvHostBindings: releaseEnvHostBindingsFromPlan(plan),
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

function validateDockerWordPressTopologyV4Report(report) {
  const failures = [];
  if (report.rppId !== 'RPP-0862'
    || report.variant !== 4
    || report.proofId !== 'rpp-0862-docker-wordpress-topology-v4'
    || report.coverageMode !== 'generated-local-support-only') {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_IDENTITY_MISMATCH' });
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
    || report.generatedCoverage?.releaseGateMayConsumeAsProduction !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.verifyReleasePassedWithoutPackagedFallback !== true
    && report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.successContract?.passedArtifactWouldBeAccepted !== true
    || report.successContract?.packagedFallbackMaySatisfySuccess !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_ACCEPTANCE_CONTRACT_FAILED' });
  }
  if (report.topologyCommand?.status !== 'passed') {
    const capability = report.topologyCommand?.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
  }
  if (!Array.isArray(report.generatedCoverage?.requiredAssertions)
    || !arraysEqual(report.generatedCoverage.requiredAssertions, generatedCoverageAssertions)
    || report.generatedCoverage.assertionDigest !== `sha256:${digest(generatedCoverageAssertions)}`) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_GENERATED_ASSERTIONS_MISMATCH' });
  }
  if (!arraysEqual(report.dockerWordPressTopologyV4?.requiredServiceHosts || [], requiredServiceHosts)
    || report.dockerWordPressTopologyV4?.siteRoleCount !== requiredServiceHosts.length
    || report.dockerWordPressTopologyV4?.primaryWordPressRoleCount !== 3
    || report.dockerWordPressTopologyV4?.supportWordPressRoleCount !== 1
    || report.dockerWordPressTopologyV4?.dockerServiceSurfaces?.length !== requiredServiceHosts.length) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_SERVICE_HOSTS_MISMATCH' });
  }
  if (!arraysEqual(report.dockerWordPressTopologyV4?.releaseEnvHostBindings || [], releaseEnvHostBindings)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_RELEASE_ENV_BINDINGS_MISMATCH' });
  }
  if (!arraysEqual(report.dockerWordPressTopologyV4?.prerequisiteBlockerMatrix || [], requiredBlockerMatrix)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_BLOCKER_MATRIX_INCOMPLETE' });
  }
  if (report.dockerWordPressTopologyV4?.releaseVerifier?.releaseCommandIsVerifyRelease !== true
    || report.topologyCommand?.releaseVerifierCommand !== dockerReleaseCommand.join(' ')
    || report.dockerWordPressTopologyV4?.releaseVerifier?.commandArgsDigest !== `sha256:${digest(dockerReleaseCommand)}`) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_VERIFY_RELEASE_COMMAND_REQUIRED' });
  }
  if (report.dockerWordPressTopologyV4?.releaseVerifier?.releaseUrlsUseDockerDns !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_DOCKER_DNS_REQUIRED' });
  }
  if (report.dockerWordPressTopologyV4?.releaseVerifier?.packagedFallbackAllowed !== false
    || report.dockerWordPressTopologyV4?.releaseVerifier?.packagedFallbackObserved !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.dockerWordPressTopologyV4?.releaseAcceptance?.blockedArtifactAccepted !== false
    || report.dockerWordPressTopologyV4?.releaseAcceptance?.passedArtifactAccepted !== true
    || report.dockerWordPressTopologyV4?.releaseAcceptance?.passedArtifactReleaseCommand !== dockerReleaseCommand.join(' ')
    || report.dockerWordPressTopologyV4?.releaseAcceptance?.passedArtifactPackagedFallbackObserved !== false
    || report.dockerWordPressTopologyV4?.releaseAcceptance?.passedArtifactUsesDockerDns !== true
    || report.dockerWordPressTopologyV4?.releaseAcceptance?.finalReleaseMovementAllowedFromSupportEvidence !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_RELEASE_ACCEPTANCE_MISMATCH' });
  }
  if (report.dockerWordPressTopologyV4?.network?.publishedHttpIngressCount !== 1
    || report.dockerWordPressTopologyV4?.network?.publishedHttpIngressPort !== 8080
    || report.dockerWordPressTopologyV4?.network?.publishedHttpIngressHostSurface !== 'loopback-only'
    || report.dockerWordPressTopologyV4?.network?.internal !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.rawUrlCount !== 0
    || report.evidenceLimits?.rawPayloadCount !== 0
    || report.evidenceLimits?.credentialSurfaceCount !== 0
    || report.evidenceLimits?.tunnelOutputCount !== 0) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_EVIDENCE_LIMITS_FAILED' });
  }
  if (findRawHttpStrings(report).length > 0) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_RAW_URL_SURFACE_REJECTED' });
  }
  if (!supportReportHashesOk(report)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V4_HASH_MISMATCH' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertSupportReportHashes(report) {
  assert.match(report.supportReportHash, proofHashPattern);
  assert.match(report.generatedCoverage.assertionDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV4.releaseEnvBindingDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV4.blockerMatrixDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV4.scopeHash, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV4.serviceSurfaceDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV4.requirementDigest, proofHashPattern);
  assert.match(report.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.equal(supportReportHashesOk(report), true);
}

function supportReportHashesOk(report) {
  const withoutReportHash = structuredClone(report);
  delete withoutReportHash.supportReportHash;
  const scopeCore = {
    proofScope: report.dockerWordPressTopologyV4?.proofScope,
    status: report.status,
    coverageMode: report.coverageMode,
    successContract: report.successContract,
    generatedCoverage: report.generatedCoverage,
    topologyCommand: report.topologyCommand,
    releaseEnvHostBindings: report.dockerWordPressTopologyV4?.releaseEnvHostBindings,
    dockerServiceSurfaces: report.dockerWordPressTopologyV4?.dockerServiceSurfaces,
    prerequisiteBlockerMatrix: report.dockerWordPressTopologyV4?.prerequisiteBlockerMatrix,
    releaseAcceptance: report.dockerWordPressTopologyV4?.releaseAcceptance,
    requirementSurfaces: report.dockerWordPressTopologyV4?.requirementSurfaces,
    releaseGate: report.releaseGate,
  };

  return report.generatedCoverage?.assertionDigest === `sha256:${digest(generatedCoverageAssertions)}`
    && report.dockerWordPressTopologyV4?.releaseEnvBindingDigest
      === `sha256:${digest(report.dockerWordPressTopologyV4?.releaseEnvHostBindings || [])}`
    && report.dockerWordPressTopologyV4?.blockerMatrixDigest
      === `sha256:${digest(report.dockerWordPressTopologyV4?.prerequisiteBlockerMatrix || [])}`
    && report.dockerWordPressTopologyV4?.serviceSurfaceDigest
      === `sha256:${digest(report.dockerWordPressTopologyV4?.dockerServiceSurfaces || [])}`
    && report.dockerWordPressTopologyV4?.requirementDigest
      === `sha256:${digest(report.dockerWordPressTopologyV4?.requirementSurfaces || [])}`
    && report.dockerWordPressTopologyV4?.scopeHash === `sha256:${digest(scopeCore)}`
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0862-gate-artifact-'));
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
