import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  ROUTE_PROOF_MATRIX_CONTRACT_ID,
  ROUTE_PROOF_MATRIX_ROUTE_ORDER,
  buildRouteProofMatrixContract,
  productionRouteProofEntries,
  validateRouteProofMatrix,
} from '../src/route-proof-matrix.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerReleaseCommand,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0877-rest-route-matrix-proof-v4.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const expectedEvidenceSurfaceNames = [
  'route-matrix-contract-validated',
  'route-identity-method-permission-mutation-boundary-recorded',
  'variant-4-candidate-versus-release-ready-boundary-recorded',
  'live-route-readback-required-not-claimed',
  'per-route-receipts-required-not-stored',
  'topology-command-exact-unavailable-capability-recorded',
  'release-verifier-no-packaged-fallback-contract-recorded',
  'sandbox-8080-only-no-tunnels-policy-recorded',
  'dashboard-not-updated',
  'final-no-go-release-block-recorded',
];
const routeMatrixRuntimeRequirements = [
  'rest-route-matrix-live-route-readback',
  'verify-release-topology-run',
  'no-packaged-fallback-release-proof',
  'production-backed-route-receipt-proof',
  'variant-4-focused-regression-proof',
];

test('RPP-0877 records REST route matrix variant 4 candidate support evidence without release movement', () => {
  const { report, text } = loadEvidenceReport();
  const contract = buildRouteProofMatrixContract();
  const expectedRoutes = summarizeRoutes(productionRouteProofEntries());
  const proofValidation = validateRestRouteMatrixV4Proof(report);

  assert.equal(proofValidation.ok, true, JSON.stringify(proofValidation.failures));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0877');
  assert.equal(report.variant, 4);
  assert.equal(report.coverageMode, 'focused-regression-local-support-only');
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.failClosed, true);
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.routeMatrixContract.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.builtOn.routeMatrixContract.schemaVersion, contract.schema_version);
  assert.deepEqual(report.builtOn.routeMatrixContract.routeOrder, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.equal(report.builtOn.routeMatrixContract.variantLineage, 'RPP-0857-variant-3');
  assert.equal(report.builtOn.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.topologyCommand.releaseVerifierCommand, dockerReleaseCommand.join(' '));
  assert.equal(
    report.builtOn.topologyCommand.supportOnlyCriterion,
    'sites-started-or-exact-unavailable-capability-recorded',
  );
  assert.equal(
    report.builtOn.topologyCommand.releaseReadyCriterion,
    'verify-release-passes-without-packaged-fallback-on-the-topology',
  );
  assert.equal(report.builtOn.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.topologyCommand.publishedIngressPort, 8080);
  assert.equal(report.builtOn.topologyCommand.remoteTunnelsAllowed, false);
  assert.equal(report.builtOn.topologyCommand.packagedFallbackAllowed, false);

  assert.deepEqual(report.progressReport, {
    recordsCandidateVersusReleaseReadyScope: true,
    candidateLabel: 'candidate',
    releaseReadyLabel: 'release-ready',
    percentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.deepEqual(report.operationGuards, {
    liveWordPressUsed: false,
    wordpressRoutesCalled: false,
    networkProbePerformed: false,
    networkServiceStarted: false,
    topologyCommandInvokedByThisWorker: false,
    routeReceiptBodiesStored: false,
    releaseGatesMoved: false,
    dashboardUpdated: false,
  });

  assert.equal(report.candidateScope.status, 'rest-route-matrix-candidate-v4');
  assert.equal(report.candidateScope.coverageMode, 'focused-regression-candidate-vs-release-ready');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.deepEqual(report.candidateScope.variantLineage.precedentRppIds, [
    'RPP-0817',
    'RPP-0837',
    'RPP-0857',
  ]);
  assert.deepEqual(report.candidateScope.variantLineage.previousVariants, [1, 2, 3]);
  assert.equal(report.candidateScope.variantLineage.unavailableCapabilityPattern, true);
  assert.equal(report.candidateScope.variantLineage.deterministicLocalSupportOnly, true);
  assert.equal(report.candidateScope.variantLineage.focusedRegressionVariant, true);
  assert.equal(report.candidateScope.variantLineage.productionTopologyVariant4Pattern, true);
  assert.equal(report.candidateScope.variantLineage.candidateVersusReleaseReadyBoundary, true);

  assert.equal(report.candidateScope.routeMatrixCandidate.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.candidateScope.routeMatrixCandidate.routeCount, ROUTE_PROOF_MATRIX_ROUTE_ORDER.length);
  assert.deepEqual(report.candidateScope.routeMatrixCandidate.routeIds, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.equal(report.candidateScope.routeMatrixCandidate.methodSurfaceCount, 6);
  assert.equal(report.candidateScope.routeMatrixCandidate.permissionSurfaceCount, 6);
  assert.equal(report.candidateScope.routeMatrixCandidate.mutationBoundarySurfaceCount, 6);
  assert.equal(report.candidateScope.routeMatrixCandidate.permissionFloor, 'manage_options');
  assert.equal(
    report.candidateScope.routeMatrixCandidate.permissionCallback,
    'reprint_push_lab_rest_authenticated_permission',
  );
  assert.equal(report.candidateScope.routeMatrixCandidate.rawRouteBodiesIncluded, false);
  assert.equal(report.candidateScope.routeMatrixCandidate.liveRestIndexReadbackPerformed, false);
  assert.equal(report.candidateScope.routeMatrixCandidate.routeReceiptReadbackPerformed, false);
  assert.ok(report.candidateScope.candidateClaims.includes('route-matrix-contract-validated'));
  assert.ok(report.candidateScope.candidateClaims.includes('variant-4-candidate-versus-release-ready-boundary-recorded'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('live-rest-index-route-registration-readback'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('verify-release-accepted-route-matrix-artifact'));

  assert.equal(report.routeMatrix.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.routeMatrix.validationOk, true);
  assert.equal(report.routeMatrix.validationStatus, 'satisfied');
  assert.equal(report.routeMatrix.supportProofMode, 'contract-and-topology-prerequisite-only');
  assert.equal(report.routeMatrix.routeCount, ROUTE_PROOF_MATRIX_ROUTE_ORDER.length);
  assert.deepEqual(report.routeMatrix.routeOrder, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.deepEqual(report.routeMatrix.routes, expectedRoutes);
  assert.equal(report.routeMatrix.permissionFloor, 'manage_options');
  assert.equal(report.routeMatrix.permissionCallback, 'reprint_push_lab_rest_authenticated_permission');
  assert.equal(report.routeMatrix.mutatingRouteCount, 2);
  assert.equal(report.routeMatrix.readOnlyRouteCount, 2);
  assert.equal(report.routeMatrix.nonMutatingReceiptRouteCount, 2);
  assert.equal(report.routeMatrix.liveRestRouteReadbackObserved, false);
  assert.equal(report.routeMatrix.routeRegistrationReadbackObserved, false);
  assert.equal(report.routeMatrix.routeReceiptBodiesStored, false);
  assert.equal(report.routeMatrix.releaseVerifierTopologyPassObserved, false);
  assert.match(report.routeMatrix.routeMatrixHash, hexSha256Pattern);
  assert.equal(report.routeMatrix.routeMatrixHash, digest(routeMatrixHashInput(report)));
});

test('RPP-0877 records exact unavailable topology capability and local-only no-fallback policy', () => {
  const { report } = loadEvidenceReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(plan.validation.ok, true);
  assert.equal(plan.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(plan.validation.checks.noTunnelCommands, true);
  assert.equal(plan.validation.checks.packagedFallbackDisabled, true);
  assert.equal(artifact.commands.runHarness, report.topologyCommand.command);
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, dockerReleaseCommand.join(' '));
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.topology.publishedPorts[0].host, '127.0.0.1');
  assert.equal(artifact.topology.publishedPorts[0].hostPort, 8080);

  assert.equal(report.topologyCommand.status, artifact.status);
  assert.equal(report.topologyCommand.siteStartupStatus, 'not-started');
  assert.equal(report.topologyCommand.sitesStarted, false);
  assert.equal(report.topologyCommand.verifyReleasePassed, false);
  assert.equal(report.topologyCommand.verifyReleaseExitCode, 2);
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.topologyCommand.releaseMovementAllowed, false);
  assert.equal(report.topologyCommand.packagedFallbackObserved, false);
  assert.equal(report.topologyCommand.topologyCommandInvokedByThisWorker, false);
  assert.equal(report.topologyCommand.runtime, artifact.runtime);
  assert.equal(report.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.topologyCommand.siteRoleCount, 4);
  assert.equal(report.topologyCommand.localPrerequisiteProbe.command, 'command -v docker');
  assert.equal(report.topologyCommand.localPrerequisiteProbe.exitCode, 1);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    capability: 'docker-cli',
    probeCommand: probe.checks.dockerCli.command,
    missingExecutable: probe.checks.dockerCli.missingExecutable,
    requiredFor: routeMatrixRuntimeRequirements,
  });
  assert.deepEqual(report.topologyCommand.publishedIngress, {
    hostSurface: 'loopback-only',
    port: 8080,
    publishedPortCount: 1,
  });
  assert.deepEqual(report.topologyCommand.policy, {
    sandboxIngressPort: 8080,
    onlySandbox8080Ingress: true,
    remoteTunnelsAllowed: false,
    tunnelCommandCount: 0,
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    releaseUrlsUseDockerDns: true,
    releaseVerifierCommand: dockerReleaseCommand.join(' '),
  });
  assert.equal(report.topologyCommand.statusMarker, artifact.evidence.tmuxStatusMarker.marker);
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));

  assert.equal(report.localOnlyPolicy.onlySandbox8080Ingress, true);
  assert.equal(report.localOnlyPolicy.publishedHttpIngress.hostSurface, 'loopback-only');
  assert.equal(report.localOnlyPolicy.publishedHttpIngress.port, 8080);
  assert.equal(report.localOnlyPolicy.publishedHttpIngress.publishedPortCount, 1);
  assert.equal(report.localOnlyPolicy.noTunnelPolicyEnforced, true);
  assert.equal(report.localOnlyPolicy.tunnelCommandCount, 0);
  assert.equal(report.localOnlyPolicy.dockerNetworkInternal, true);
  assert.equal(report.localOnlyPolicy.releaseUrlsUseDockerDns, true);
  assert.equal(report.localOnlyPolicy.networkProbePerformed, false);
  assert.equal(report.localOnlyPolicy.networkServiceStarted, false);
});

test('RPP-0877 fail-closed policy rejects missing live receipts, packaged fallback, and ambiguous blockers', () => {
  const { report } = loadEvidenceReport();
  const routeValidation = validateRouteProofMatrix(productionRouteProofEntries());
  const { artifact } = buildMissingDockerCapabilityArtifact();
  const readiness = evaluateRestRouteMatrixV4Readiness({
    proof: report,
    routeValidation,
    artifact,
  });

  assert.equal(readiness.readyForReleaseMovement, false);
  assert.equal(readiness.finalReleaseStatus, 'NO-GO');
  assert.equal(readiness.primaryBlocker, 'DOCKER_CLI_MISSING');
  assert.ok(readiness.blockers.includes('verify-release-topology-not-passed'));
  assert.ok(readiness.blockers.includes('live-rest-route-readback-missing'));
  assert.ok(readiness.blockers.includes('route-receipts-missing'));
  assert.ok(readiness.blockers.includes('candidate-support-only'));

  const routes = productionRouteProofEntries();
  routes.find((route) => route.id === 'journal').methods = ['POST'];
  const badRouteValidation = validateRouteProofMatrix(routes);
  assert.equal(badRouteValidation.ok, false);
  assert.ok(badRouteValidation.failures.some((failure) =>
    failure.routeId === 'journal' && failure.code === 'ROUTE_METHOD_MISMATCH'));

  const ambiguous = structuredClone(report);
  ambiguous.topologyCommand.exactUnavailableCapability.code = '';
  const ambiguousValidation = validateRestRouteMatrixV4Proof(ambiguous);
  assert.equal(ambiguousValidation.ok, false);
  assert.ok(ambiguousValidation.failures.some((failure) =>
    failure.code === 'REST_ROUTE_MATRIX_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT'));

  const missingReadback = structuredClone(report);
  missingReadback.topologyCommand.status = 'passed';
  missingReadback.topologyCommand.sitesStarted = true;
  missingReadback.topologyCommand.verifyReleasePassed = true;
  missingReadback.topologyCommand.verifyReleaseExitCode = 0;
  missingReadback.topologyCommand.exactUnavailableCapability = null;
  missingReadback.topologyCommand.failClosed = false;
  missingReadback.routeMatrix.releaseVerifierTopologyPassObserved = true;
  const readbackReadiness = evaluateRestRouteMatrixV4Readiness({
    proof: missingReadback,
    routeValidation,
    artifact: passedTopologyArtifactFrom(artifact),
  });
  assert.equal(readbackReadiness.readyForReleaseMovement, false);
  assert.ok(readbackReadiness.blockers.includes('live-rest-route-readback-missing'));
  assert.ok(readbackReadiness.blockers.includes('route-receipts-missing'));

  const packagedFallback = structuredClone(missingReadback);
  packagedFallback.routeMatrix.liveRestRouteReadbackObserved = true;
  packagedFallback.routeMatrix.routeRegistrationReadbackObserved = true;
  packagedFallback.routeMatrix.routeReceiptBodiesStored = true;
  packagedFallback.topologyCommand.packagedFallbackObserved = true;
  packagedFallback.topologyCommand.policy.packagedFallbackObserved = true;
  const packagedFallbackReadiness = evaluateRestRouteMatrixV4Readiness({
    proof: packagedFallback,
    routeValidation,
    artifact: passedTopologyArtifactFrom(artifact, { packagedFallbackObserved: true }),
  });
  assert.equal(packagedFallbackReadiness.readyForReleaseMovement, false);
  assert.ok(packagedFallbackReadiness.blockers.includes('packaged-fallback-observed'));
});

test('RPP-0877 release-ready scope stays NO-GO until live route matrix proof passes', () => {
  const { report } = loadEvidenceReport();

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.equal(report.releaseReadyScope.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseReadyScope.releaseGateMovement, 'none');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'verify-release-docker-local-production-passes-without-packaged-fallback',
    ),
  );
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('live-rest-index-route-registration-readback'));
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('recovery-repair-route-receipt'));
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('candidate-does-not-have-release-verifier-accepted-route-matrix-proof'));
  assert.equal(report.releaseReadyScope.routeMatrixReleaseGate.status, 'not-satisfied');
  assert.equal(report.releaseReadyScope.routeMatrixReleaseGate.candidateOnlyReleaseMovement, 'blocked');
  assert.equal(report.releaseReadyScope.routeMatrixReleaseGate.packagedFallbackCanSatisfyRouteMatrixProof, false);
  assert.deepEqual(report.releaseReadyScope.routeMatrixReleaseGate.releaseMovementBlockedUntil, [
    'docker-wordpress-topology-sites-started',
    'verify-release-docker-local-production-passes-without-packaged-fallback',
    'live-rest-index-route-registration-readback',
    'route-receipts-cover-all-six-production-routes',
  ]);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
});

test('RPP-0877 evidence remains hash/count/surface only', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0877 REST route matrix proof v4' }));
  assert.equal(report.evidenceLimits.mode, 'hash-count-surface-only');
  assert.equal(report.evidenceLimits.payloadsStored, false);
  assert.equal(report.evidenceLimits.rawPayloadCount, 0);
  assert.equal(report.evidenceLimits.rawUrlCount, 0);
  assert.equal(report.evidenceLimits.rawRouteBodyCount, 0);
  assert.equal(report.evidenceLimits.routeReceiptBodyCount, 0);
  assert.equal(report.evidenceLimits.sensitiveSurfaceCount, 0);
  assert.equal(report.evidenceLimits.routeSurfaceCount, ROUTE_PROOF_MATRIX_ROUTE_ORDER.length);
  assert.equal(report.evidenceLimits.evidenceSurfaceCount, expectedEvidenceSurfaceNames.length);
  assert.equal(report.evidenceLimits.rejectedSurfaceCount, 0);
  assert.deepEqual(report.evidenceLimits.surfaceNames, expectedEvidenceSurfaceNames);
  assert.deepEqual(
    report.evidenceLimits.evidenceSurfaces.map((entry) => entry.surface),
    expectedEvidenceSurfaceNames,
  );
  assert.ok(report.evidenceLimits.evidenceSurfaces.every((entry) => entry.ok === true));
  assert.match(report.evidenceLimits.surfaceDigest, prefixedSha256Pattern);
  assert.equal(report.evidenceLimits.surfaceDigest, `sha256:${digest(report.evidenceLimits.evidenceSurfaces)}`);

  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.rawRouteBodiesIncluded, false);
  assert.equal(report.redaction.routeReceiptBodiesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.tunnelOutputIncluded, false);
  assert.equal(report.redaction.rawReleaseArtifactsIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'routeMatrix',
    'topologyCommand',
    'localOnlyPolicy',
    'releaseReadyScope',
    'operationGuards',
    'evidenceLimits',
    'finalReleaseStatus',
    'integrationRecommendation',
  ]);
  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
  assert.equal(report.invariants.candidateVersusReleaseReadyScopeRecorded, true);
  assert.equal(report.invariants.dashboardNotUpdated, true);
  assert.equal(report.invariants.supportOnlyNoGo, true);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel/i,
  );
});

test('RPP-0877 evidence documents exact validation commands and results', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.validation.commands, [
    {
      command: 'node --check test/rpp-0877-rest-route-matrix-proof-v4.test.js',
      result: 'exit-0',
    },
    {
      command: 'node --test --test-name-pattern RPP-0877 test/rpp-0877-rest-route-matrix-proof-v4.test.js',
      result: 'exit-0',
    },
    {
      command: 'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0877-rest-route-matrix-proof-v4.md',
      result: 'exit-0',
    },
    {
      command: 'git diff --check',
      result: 'exit-0',
    },
  ]);
  assert.equal(report.validation.topologyCommandObservedOutcome.commandInvokedByThisWorker, false);
  assert.equal(report.validation.topologyCommandObservedOutcome.sitesStarted, false);
  assert.equal(report.validation.topologyCommandObservedOutcome.capabilityCode, 'DOCKER_CLI_MISSING');
  assert.equal(report.validation.evidenceRedactionScan.ok, true);
  assert.equal(report.validation.evidenceRedactionScan.rejectedFiles, 0);
  assert.match(text, /node --check test\/rpp-0877-rest-route-matrix-proof-v4\.test\.js/);
  assert.match(
    text,
    /node --test --test-name-pattern RPP-0877 test\/rpp-0877-rest-route-matrix-proof-v4\.test\.js/,
  );
  assert.match(
    text,
    /node scripts\/release\/artifact-redaction-scan\.mjs docs\/evidence\/rpp-0877-rest-route-matrix-proof-v4\.md/,
  );
  assert.match(text, /git diff --check/);
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0877 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function summarizeRoutes(routes) {
  return routes.map((route) => ({
    id: route.id,
    stage: route.stage,
    namespace: route.identity.namespace,
    routePath: route.identity.path,
    method: route.methods.join('|'),
    classification: route.mutation.classification,
    readOnly: route.mutation.readOnly,
    mutates: route.mutation.mutates,
    permissionCapability: route.permission.capability,
    failClosedPolicyRecorded: Boolean(
      route.failClosed.absentEvidence && route.failClosed.contradictoryEvidence,
    ),
  }));
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0877-docker-work',
    evidenceDir: '/tmp/rpp-0877-docker-evidence',
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

  return { plan, probe, artifact };
}

function validateRestRouteMatrixV4Proof(proof) {
  const failures = [];
  if (proof.rppId !== 'RPP-0877' || proof.variant !== 4) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_IDENTITY_MISMATCH' });
  }
  if (proof.progressReport?.recordsCandidateVersusReleaseReadyScope !== true
    || proof.candidateScope?.variantLineage?.candidateVersusReleaseReadyBoundary !== true) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_CANDIDATE_RELEASE_BOUNDARY_MISSING' });
  }
  if (proof.routeMatrix.validationOk !== true
    || proof.routeMatrix.routeCount !== ROUTE_PROOF_MATRIX_ROUTE_ORDER.length
    || JSON.stringify(proof.routeMatrix.routeOrder) !== JSON.stringify(ROUTE_PROOF_MATRIX_ROUTE_ORDER)) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_ROUTE_CONTRACT_INVALID' });
  }
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.probeCommand) {
      failures.push({ code: 'REST_ROUTE_MATRIX_V4_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true
      || proof.topologyCommand.acceptedForReleaseGate !== false
      || proof.topologyCommand.releaseMovementAllowed !== false
      || proof.finalReleaseStatus !== 'NO-GO') {
      failures.push({ code: 'REST_ROUTE_MATRIX_V4_MUST_FAIL_CLOSED_WHEN_TOPOLOGY_NOT_STARTED' });
    }
    if (proof.routeMatrix.liveRestRouteReadbackObserved !== false
      || proof.routeMatrix.routeRegistrationReadbackObserved !== false
      || proof.routeMatrix.routeReceiptBodiesStored !== false) {
      failures.push({ code: 'REST_ROUTE_MATRIX_V4_LIVE_ROUTE_READBACK_CLAIMED_WITHOUT_TOPOLOGY' });
    }
  }
  if (proof.topologyCommand.packagedFallbackObserved !== false
    || proof.topologyCommand.policy?.packagedFallbackAllowed !== false
    || proof.builtOn.topologyCommand.packagedFallbackAllowed !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_PACKAGED_FALLBACK_REJECTED' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy.tunnelCommandCount !== 0
    || proof.localOnlyPolicy.networkServiceStarted !== false
    || proof.operationGuards.networkServiceStarted !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.evidenceLimits.mode !== 'hash-count-surface-only'
    || proof.evidenceLimits.payloadsStored !== false
    || proof.evidenceLimits.rawPayloadCount !== 0
    || proof.evidenceLimits.rawUrlCount !== 0
    || proof.evidenceLimits.rawRouteBodyCount !== 0
    || proof.evidenceLimits.routeReceiptBodyCount !== 0
    || proof.evidenceLimits.sensitiveSurfaceCount !== 0
    || proof.evidenceLimits.rejectedSurfaceCount !== 0
    || !prefixedSha256Pattern.test(proof.evidenceLimits.surfaceDigest)) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_EVIDENCE_LIMITS_FAILED' });
  }
  if (proof.releaseReadyScope.finalReleaseStatus !== 'NO-GO'
    || proof.releaseReadyScope.releaseGateMovement !== 'none'
    || proof.productionBacked !== false
    || proof.supportOnly !== true
    || proof.releaseEligible !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V4_RELEASE_MOVEMENT_FORBIDDEN' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function evaluateRestRouteMatrixV4Readiness({ proof, routeValidation, artifact }) {
  const blockers = [];
  if (routeValidation.ok !== true || proof.routeMatrix.validationOk !== true) {
    blockers.push('route-matrix-validation-failed');
  }
  if (artifact.status !== 'passed'
    || artifact.evidence?.dockerVerifyReleaseTopology?.ok !== true
    || proof.topologyCommand.verifyReleasePassed !== true
    || proof.routeMatrix.releaseVerifierTopologyPassObserved !== true) {
    blockers.push('verify-release-topology-not-passed');
  }
  if (proof.routeMatrix.liveRestRouteReadbackObserved !== true
    || proof.routeMatrix.routeRegistrationReadbackObserved !== true) {
    blockers.push('live-rest-route-readback-missing');
  }
  if (proof.routeMatrix.routeReceiptBodiesStored !== true) {
    blockers.push('route-receipts-missing');
  }
  if (artifact.packagedFallback !== false
    || artifact.evidence?.packagedFallback?.observed !== false
    || artifact.evidence?.dockerVerifyReleaseTopology?.packagedFallbackObserved !== false
    || proof.topologyCommand.packagedFallbackObserved !== false
    || proof.topologyCommand.policy?.packagedFallbackObserved !== false) {
    blockers.push('packaged-fallback-observed');
  }
  if (proof.supportOnly !== false || proof.productionBacked !== true || proof.releaseEligible !== true) {
    blockers.push('candidate-support-only');
  }
  const readyForReleaseMovement = blockers.length === 0;
  return {
    readyForReleaseMovement,
    finalReleaseStatus: readyForReleaseMovement ? 'GO' : 'NO-GO',
    primaryBlocker: artifact.prerequisiteProbe?.blocker?.code || blockers[0] || null,
    blockers,
  };
}

function passedTopologyArtifactFrom(artifact, overrides = {}) {
  const passed = structuredClone(artifact);
  passed.status = 'passed';
  passed.ok = true;
  passed.acceptedForReleaseGate = true;
  passed.failClosed = false;
  passed.packagedFallback = overrides.packagedFallbackObserved === true;
  passed.evidence.packagedFallback.observed = overrides.packagedFallbackObserved === true;
  passed.evidence.dockerVerifyReleaseTopology.ok = true;
  passed.evidence.dockerVerifyReleaseTopology.status = 'passed';
  passed.evidence.dockerVerifyReleaseTopology.failClosed = false;
  passed.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved = overrides.packagedFallbackObserved === true;
  passed.releaseGateEvaluation.releaseMovement.allowed = true;
  passed.prerequisiteProbe.blocker = null;
  return passed;
}

function routeMatrixHashInput(report) {
  return {
    contractId: report.routeMatrix.contractId,
    routeOrder: report.routeMatrix.routeOrder,
    routes: report.routeMatrix.routes,
    permissionFloor: report.routeMatrix.permissionFloor,
    permissionCallback: report.routeMatrix.permissionCallback,
    validationOk: report.routeMatrix.validationOk,
    validationStatus: report.routeMatrix.validationStatus,
    failClosedPolicy: report.routeMatrix.failClosedPolicy,
  };
}

function topologyArtifactHash(report, artifact, probe) {
  return `sha256:${digest({
    command: artifact.commands.runHarness,
    successCriterion: report.topologyCommand.successCriterion,
    status: artifact.status,
    blockerCode: probe.blocker.code,
    capability: report.topologyCommand.exactUnavailableCapability.capability,
    requiredFor: report.topologyCommand.exactUnavailableCapability.requiredFor,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    releaseVerifierCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
    siteRoleCount: report.topologyCommand.siteRoleCount,
    hostSurface: report.topologyCommand.publishedIngress.hostSurface,
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    onlySandbox8080Ingress: report.topologyCommand.policy.onlySandbox8080Ingress,
    packagedFallbackAllowed: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed,
    packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    routeMatrixHash: report.routeMatrix.routeMatrixHash,
    evidenceSurfaceDigest: report.evidenceLimits.surfaceDigest,
  })}`;
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    routeMatrix: report.routeMatrix,
    topologyCommand: report.topologyCommand,
    localOnlyPolicy: report.localOnlyPolicy,
    releaseReadyScope: report.releaseReadyScope,
    operationGuards: report.operationGuards,
    evidenceLimits: report.evidenceLimits,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
  };
}
