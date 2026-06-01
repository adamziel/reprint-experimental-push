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
  'docs/evidence/rpp-0842-docker-wordpress-topology-v3.md',
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
const topologyRequiredFor = Object.freeze([
  'docker-wordpress-sites-start',
  'docker-network-service-dns-readback',
  'verify-release-docker-topology-run',
  'docker-wordpress-topology-v3-generated-coverage',
  'verify-release-without-packaged-fallback',
]);
const generatedCoverageAssertions = Object.freeze([
  'record-command-contract-for-docker-topology-runner',
  'record-exact-unavailable-capability-when-docker-cannot-start',
  'reject-packaged-fallback-or-non-verify-release-runner',
  'reject-release-movement-without-passed-docker-artifact',
  'preserve-service-dns-host-surface-without-raw-urls',
  'preserve-final-release-no-go',
]);

test('RPP-0842 support report records Docker WordPress topology v3 generated scope', () => {
  const { report, text } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateDockerWordPressTopologyV3Report(report);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0842');
  assert.equal(report.proofId, 'rpp-0842-docker-wordpress-topology-v3');
  assert.equal(report.variant, 3);
  assert.equal(report.coverageMode, 'generated-local-support-only');
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.adjacentEvidence, 'RPP-0822 docker-wordpress-topology-v2');
  assert.equal(report.builtOn.priorVariantEvidence, 'RPP-0802 docker-wordpress-topology-v1');
  assert.deepEqual(report.builtOn.productionTopologyEvidence, [
    'RPP-0841 three-site local production topology v3',
    'RPP-0861 three-site local production topology v4',
  ]);
  assert.equal(report.builtOn.dockerTopologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.runtime, artifact.runtime);
  assert.equal(report.builtOn.gate, artifact.gate);
  assert.equal(report.builtOn.artifactHash, artifact.deterministic.canonicalSha256);

  assert.equal(
    report.successContract.criterion,
    'verify-release-passes-without-packaged-fallback-or-exact-unavailable-capability',
  );
  assert.equal(report.successContract.verifyReleasePassedWithoutPackagedFallback, false);
  assert.equal(report.successContract.exactUnavailableCapabilityRecorded, true);
  assert.equal(report.successContract.finalReleaseMayMove, false);

  assert.equal(report.generatedCoverage.coverageId, 'docker-wordpress-topology-v3-generated-coverage');
  assert.equal(
    report.generatedCoverage.requiredOutcome,
    'verify-release-passes-without-packaged-fallback-or-exact-unavailable-capability',
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

  assert.equal(report.dockerWordPressTopologyV3.proofScope, 'docker-wordpress-topology-v3');
  assert.equal(report.dockerWordPressTopologyV3.siteRoleCount, 4);
  assert.equal(report.dockerWordPressTopologyV3.primaryWordPressRoleCount, 3);
  assert.equal(report.dockerWordPressTopologyV3.supportWordPressRoleCount, 1);
  assert.equal(report.dockerWordPressTopologyV3.startedSiteCount, 0);
  assert.equal(report.dockerWordPressTopologyV3.startupBlockedBy, 'DOCKER_CLI_MISSING');
  assert.deepEqual(report.dockerWordPressTopologyV3.requiredServiceHosts, requiredServiceHosts);
  assert.deepEqual(
    report.dockerWordPressTopologyV3.dockerServiceSurfaces.map((entry) => entry.role),
    requiredRoleOrder,
  );
  assert.deepEqual(
    report.dockerWordPressTopologyV3.dockerServiceSurfaces.map((entry) => entry.serviceHost),
    plan.sites.map((site) => hostFromDockerUrl(site.url)),
  );
  assert.equal(report.dockerWordPressTopologyV3.network.internal, true);
  assert.equal(report.dockerWordPressTopologyV3.network.publishedHttpIngressCount, 1);
  assert.equal(report.dockerWordPressTopologyV3.network.publishedHttpIngressPort, 8080);
  assert.equal(report.dockerWordPressTopologyV3.network.publishedHttpIngressHostSurface, 'loopback-only');
  assert.equal(report.dockerWordPressTopologyV3.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(report.dockerWordPressTopologyV3.releaseVerifier.releaseCommandIsVerifyRelease, true);
  assert.equal(report.dockerWordPressTopologyV3.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(report.dockerWordPressTopologyV3.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(report.dockerWordPressTopologyV3.releaseVerifier.acceptedForReleaseGateAfterPassedArtifactOnly, true);
  assert.equal(
    report.dockerWordPressTopologyV3.requirementCount,
    report.dockerWordPressTopologyV3.requirementSurfaces.length,
  );

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
  assert.equal(report.invariants.verifyReleasePassedWithoutPackagedFallbackOrExactCapability, true);
  assert.equal(report.invariants.generatedCoverageIsSupportOnly, true);
  assert.equal(report.invariants.noProductionBackedProofClaim, true);
  assertSupportReportHashes(report);
  assert.deepEqual(findRawHttpStrings(report), []);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /Bearer\s+|Basic\s+|Set-Cookie|Cookie\s*:|application[_ -]?password/i);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(report, {
    label: 'RPP-0842 Docker WordPress topology v3 support report',
  }));
});

test('RPP-0842 blocked Docker artifact fails closed without packaged fallback', () => {
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
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.packagedFallback, false);
  assert.deepEqual(artifact.env, {});
  assert.equal(artifact.evidence.packagedFallback.observed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, dockerReleaseCommand.join(' '));
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseCommandIsVerifyRelease, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.verifyReleaseFailure.exitCode, 2);
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.releaseGateEvaluation.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressBlockedUntilPrerequisitesPass, true);

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

test('RPP-0842 accepts only verify:release on Docker DNS with no packaged fallback', () => {
  const blocked = evaluateDockerWordPressTopologyV3Contract(buildMissingDockerCapabilityArtifact());
  const passed = evaluateDockerWordPressTopologyV3Contract(buildPassedDockerArtifact());

  assert.equal(blocked.ok, true);
  assert.equal(blocked.releaseReadyArtifact, false);
  assert.equal(blocked.exactUnavailableCapability.code, 'DOCKER_CLI_MISSING');
  assert.equal(blocked.finalReleaseStatus, 'NO-GO');
  assert.equal(blocked.releaseMovementAllowed, false);

  assert.equal(passed.ok, true);
  assert.equal(passed.releaseReadyArtifact, true);
  assert.equal(passed.exactUnavailableCapability, null);
  assert.equal(passed.verifyReleaseCommand, 'npm run verify:release');
  assert.equal(passed.releaseUrlsUseDockerDns, true);
  assert.equal(passed.packagedFallbackAllowed, false);
  assert.equal(passed.packagedFallbackObserved, false);
  assert.equal(passed.acceptedForReleaseGate, true);
  assert.deepEqual(passed.generatedCoverageRequiredAssertions, generatedCoverageAssertions);

  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0842-docker-work',
    evidenceDir: '/tmp/rpp-0842-docker-evidence',
    env: {},
  });
  for (const key of forbiddenPackagedFallbackEnvKeys) {
    assert.equal(plan.releaseEnv[key], undefined);
  }

  const fallbackEnvValidation = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only' },
  });
  assert.equal(fallbackEnvValidation.ok, false);
  assert.ok(fallbackEnvValidation.failures.some((failure) =>
    failure.code === 'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED'));

  const nonReleaseRunnerValidation = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, releaseCommand: ['npm', 'run', 'verify:release:local-production'] },
  });
  assert.equal(nonReleaseRunnerValidation.ok, false);
  assert.ok(nonReleaseRunnerValidation.failures.some((failure) =>
    failure.code === 'DOCKER_RELEASE_COMMAND_NOT_VERIFY_RELEASE'));
});

test('RPP-0842 validation rejects ambiguous, widened, or raw-scope evidence', () => {
  const { report } = loadSupportReport();

  const ambiguous = structuredClone(report);
  ambiguous.topologyCommand.exactUnavailableCapability.code = '';
  assertFailure(
    validateDockerWordPressTopologyV3Report(ambiguous),
    'DOCKER_WORDPRESS_TOPOLOGY_V3_UNAVAILABLE_CAPABILITY_NOT_EXACT',
  );

  const fallback = structuredClone(report);
  fallback.dockerWordPressTopologyV3.releaseVerifier.packagedFallbackObserved = true;
  assertFailure(
    validateDockerWordPressTopologyV3Report(fallback),
    'DOCKER_WORDPRESS_TOPOLOGY_V3_PACKAGED_FALLBACK_REJECTED',
  );

  const movementClaim = structuredClone(report);
  movementClaim.releaseGate.releaseMovementAllowed = true;
  movementClaim.successContract.finalReleaseMayMove = true;
  assertFailure(
    validateDockerWordPressTopologyV3Report(movementClaim),
    'DOCKER_WORDPRESS_TOPOLOGY_V3_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const productionClaim = structuredClone(report);
  productionClaim.productionBacked = true;
  productionClaim.releaseEligible = true;
  productionClaim.generatedCoverage.productionBackedArtifactPresent = true;
  productionClaim.generatedCoverage.releaseGateMayConsumeAsProduction = true;
  assertFailure(
    validateDockerWordPressTopologyV3Report(productionClaim),
    'DOCKER_WORDPRESS_TOPOLOGY_V3_SUPPORT_ONLY_NO_GO_REQUIRED',
  );

  const rawUrl = structuredClone(report);
  rawUrl.dockerWordPressTopologyV3.dockerServiceSurfaces[0].rawUrl = 'http://wp-source';
  assertFailure(
    validateDockerWordPressTopologyV3Report(rawUrl),
    'DOCKER_WORDPRESS_TOPOLOGY_V3_RAW_URL_SURFACE_REJECTED',
  );

  const missingRole = structuredClone(report);
  missingRole.dockerWordPressTopologyV3.requiredServiceHosts = requiredServiceHosts.slice(0, 3);
  assertFailure(
    validateDockerWordPressTopologyV3Report(missingRole),
    'DOCKER_WORDPRESS_TOPOLOGY_V3_SERVICE_HOSTS_MISMATCH',
  );
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0842 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0842-docker-work',
    evidenceDir: '/tmp/rpp-0842-docker-evidence',
    env: {},
  });
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
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0842-docker-work',
    evidenceDir: '/tmp/rpp-0842-docker-evidence',
    env: {},
  });
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

function evaluateDockerWordPressTopologyV3Contract({ artifact, plan, probe }) {
  const topologyEvidence = artifact.evidence.dockerVerifyReleaseTopology;
  const noPackagedFallback = artifact.packagedFallback === false
    && topologyEvidence.packagedFallbackAllowed === false
    && topologyEvidence.packagedFallbackObserved === false;
  const verifyReleaseCommand = topologyEvidence.command;
  const releaseReadyArtifact = artifact.status === 'passed'
    && artifact.acceptedForReleaseGate === true
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
    finalReleaseStatus: 'NO-GO',
    verifyReleaseCommand,
    releaseUrlsUseDockerDns: topologyEvidence.releaseUrlsUseDockerDns,
    packagedFallbackAllowed: topologyEvidence.packagedFallbackAllowed,
    packagedFallbackObserved: topologyEvidence.packagedFallbackObserved,
    exactUnavailableCapability,
    serviceHosts: plan.sites.map((site) => hostFromDockerUrl(site.url)),
    generatedCoverageRequiredAssertions: [...generatedCoverageAssertions],
  };
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

function validateDockerWordPressTopologyV3Report(report) {
  const failures = [];
  if (report.rppId !== 'RPP-0842'
    || report.variant !== 3
    || report.proofId !== 'rpp-0842-docker-wordpress-topology-v3'
    || report.coverageMode !== 'generated-local-support-only') {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_IDENTITY_MISMATCH' });
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
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_SUPPORT_ONLY_NO_GO_REQUIRED' });
  }
  if (report.successContract?.verifyReleasePassedWithoutPackagedFallback !== true
    && report.successContract?.exactUnavailableCapabilityRecorded !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_SUCCESS_CONTRACT_UNMET' });
  }
  if (report.topologyCommand?.status !== 'passed') {
    const capability = report.topologyCommand?.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.command) {
      failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
  }
  if (!Array.isArray(report.generatedCoverage?.requiredAssertions)
    || !arraysEqual(report.generatedCoverage.requiredAssertions, generatedCoverageAssertions)
    || report.generatedCoverage.assertionDigest !== `sha256:${digest(generatedCoverageAssertions)}`) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_GENERATED_ASSERTIONS_MISMATCH' });
  }
  if (!arraysEqual(report.dockerWordPressTopologyV3?.requiredServiceHosts || [], requiredServiceHosts)
    || report.dockerWordPressTopologyV3?.siteRoleCount !== requiredServiceHosts.length
    || report.dockerWordPressTopologyV3?.primaryWordPressRoleCount !== 3
    || report.dockerWordPressTopologyV3?.supportWordPressRoleCount !== 1
    || report.dockerWordPressTopologyV3?.dockerServiceSurfaces?.length !== requiredServiceHosts.length) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_SERVICE_HOSTS_MISMATCH' });
  }
  if (report.dockerWordPressTopologyV3?.releaseVerifier?.releaseCommandIsVerifyRelease !== true
    || report.topologyCommand?.releaseVerifierCommand !== dockerReleaseCommand.join(' ')) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_VERIFY_RELEASE_COMMAND_REQUIRED' });
  }
  if (report.dockerWordPressTopologyV3?.releaseVerifier?.releaseUrlsUseDockerDns !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_DOCKER_DNS_REQUIRED' });
  }
  if (report.dockerWordPressTopologyV3?.releaseVerifier?.packagedFallbackAllowed !== false
    || report.dockerWordPressTopologyV3?.releaseVerifier?.packagedFallbackObserved !== false) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_PACKAGED_FALLBACK_REJECTED' });
  }
  if (report.dockerWordPressTopologyV3?.network?.publishedHttpIngressCount !== 1
    || report.dockerWordPressTopologyV3?.network?.publishedHttpIngressPort !== 8080
    || report.dockerWordPressTopologyV3?.network?.publishedHttpIngressHostSurface !== 'loopback-only'
    || report.dockerWordPressTopologyV3?.network?.internal !== true) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (report.evidenceLimits?.mode !== 'hash-count-surface-only'
    || report.evidenceLimits?.rawUrlCount !== 0
    || report.evidenceLimits?.rawPayloadCount !== 0
    || report.evidenceLimits?.credentialSurfaceCount !== 0
    || report.evidenceLimits?.tunnelOutputCount !== 0) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_EVIDENCE_LIMITS_FAILED' });
  }
  if (findRawHttpStrings(report).length > 0) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_RAW_URL_SURFACE_REJECTED' });
  }
  if (!supportReportHashesOk(report)) {
    failures.push({ code: 'DOCKER_WORDPRESS_TOPOLOGY_V3_HASH_MISMATCH' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertSupportReportHashes(report) {
  assert.match(report.supportReportHash, proofHashPattern);
  assert.match(report.generatedCoverage.assertionDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV3.scopeHash, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV3.serviceSurfaceDigest, proofHashPattern);
  assert.match(report.dockerWordPressTopologyV3.requirementDigest, proofHashPattern);
  assert.match(report.evidenceLimits.surfaceDigest, proofHashPattern);
  assert.equal(supportReportHashesOk(report), true);
}

function supportReportHashesOk(report) {
  const withoutReportHash = structuredClone(report);
  delete withoutReportHash.supportReportHash;
  const scopeCore = {
    proofScope: report.dockerWordPressTopologyV3?.proofScope,
    status: report.status,
    coverageMode: report.coverageMode,
    successContract: report.successContract,
    generatedCoverage: report.generatedCoverage,
    topologyCommand: report.topologyCommand,
    dockerServiceSurfaces: report.dockerWordPressTopologyV3?.dockerServiceSurfaces,
    requirementSurfaces: report.dockerWordPressTopologyV3?.requirementSurfaces,
    releaseGate: report.releaseGate,
  };

  return report.generatedCoverage?.assertionDigest === `sha256:${digest(generatedCoverageAssertions)}`
    && report.dockerWordPressTopologyV3?.serviceSurfaceDigest
      === `sha256:${digest(report.dockerWordPressTopologyV3?.dockerServiceSurfaces || [])}`
    && report.dockerWordPressTopologyV3?.requirementDigest
      === `sha256:${digest(report.dockerWordPressTopologyV3?.requirementSurfaces || [])}`
    && report.dockerWordPressTopologyV3?.scopeHash === `sha256:${digest(scopeCore)}`
    && report.evidenceLimits?.surfaceDigest === `sha256:${digest(report.evidenceLimits?.surfaceNames || [])}`
    && report.supportReportHash === `sha256:${digest(withoutReportHash)}`;
}

function writeTempArtifact(artifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0842-gate-artifact-'));
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
