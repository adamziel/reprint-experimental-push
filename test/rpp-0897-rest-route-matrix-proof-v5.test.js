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
  'docs/evidence/rpp-0897-rest-route-matrix-proof-v5.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const topologyCommand = 'npm run verify:release:docker-local-production';
const releaseVerifierCommand = 'npm run verify:release';
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const sameRunId = 'rpp-0897-same-run-route-matrix-release-verifier';

const expectedEvidenceSurfaceNames = Object.freeze([
  'route-matrix-contract-validated',
  'route-identity-method-permission-mutation-boundary-recorded',
  'variant-5-release-verifier-carry-through-recorded',
  'live-route-readback-required-not-claimed',
  'per-route-receipts-required-not-stored',
  'topology-binding-required-not-release-ready',
  'same-run-release-verifier-binding-required',
  'release-verifier-no-packaged-fallback-contract-recorded',
  'sandbox-8080-only-no-tunnels-policy-recorded',
  'ambiguous-production-ready-claims-rejected',
  'stale-split-evidence-rejected',
  'final-no-go-release-block-recorded',
]);

const routeMatrixRuntimeRequirements = Object.freeze([
  'rest-route-matrix-live-route-readback',
  'verify-release-topology-run',
  'verify-release-passes-without-packaged-fallback',
  'production-backed-route-receipt-proof',
  'same-release-verifier-run-binding',
  'variant-5-release-verifier-carry-through-proof',
]);

const releaseVerifierCarryThroughRequirements = Object.freeze([
  'npm-run-verify-release-required-by-topology-command',
  'verify-release-result-carried-through-by-topology-artifact',
  'verify-release-must-pass-on-the-topology-for-release-ready',
  'no-packaged-fallback-observed-by-release-verifier',
  'live-route-receipts-bound-to-same-release-verifier-run',
  'stale-or-split-route-receipts-rejected',
]);

test('RPP-0897 records REST route matrix variant 5 release-verifier carry-through without release movement', () => {
  const { report, text } = loadEvidenceReport();
  const contract = buildRouteProofMatrixContract();
  const expectedRoutes = summarizeRoutes(productionRouteProofEntries());
  const proofValidation = validateRestRouteMatrixV5Proof(report);

  assert.equal(proofValidation.ok, true, JSON.stringify(proofValidation.failures));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0897');
  assert.equal(report.variant, 5);
  assert.equal(report.coverageMode, 'release-verifier-carry-through-local-support-only');
  assert.equal(report.status, 'blocked-exact-unavailable-capability');
  assert.equal(report.failClosed, true);
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.routeMatrixContract.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.builtOn.routeMatrixContract.schemaVersion, contract.schema_version);
  assert.deepEqual(report.builtOn.routeMatrixContract.routeOrder, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.equal(report.builtOn.routeMatrixContract.variantLineage, 'RPP-0877-variant-4');
  assert.equal(report.builtOn.topologyCommand.command, topologyCommand);
  assert.equal(report.builtOn.topologyCommand.releaseVerifierCommand, dockerReleaseCommand.join(' '));
  assert.equal(
    report.builtOn.topologyCommand.releaseReadyCriterion,
    'verify-release-passes-without-packaged-fallback-on-the-topology',
  );
  assert.equal(report.builtOn.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.topologyCommand.publishedIngressPort, 8080);
  assert.equal(report.builtOn.topologyCommand.remoteTunnelsAllowed, false);
  assert.equal(report.builtOn.topologyCommand.packagedFallbackAllowed, false);
  assert.equal(report.builtOn.topologyCommand.sameRunBindingRequired, true);

  assert.deepEqual(report.progressReport, {
    recordsCandidateVersusReleaseReadyScope: true,
    candidateLabel: 'candidate',
    releaseReadyLabel: 'release-ready',
    percentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);
  assert.match(text, /## Verifier Guarantees/);

  assert.deepEqual(report.operationGuards, {
    liveWordPressUsed: false,
    wordpressRoutesCalled: false,
    networkProbePerformed: false,
    networkServiceStarted: false,
    topologyCommandInvokedByThisWorker: false,
    verifyReleaseInvokedByThisWorker: false,
    routeReceiptBodiesStored: false,
    releaseGatesMoved: false,
    dashboardUpdated: false,
  });

  assert.equal(report.candidateScope.status, 'rest-route-matrix-release-verifier-candidate-v5');
  assert.equal(report.candidateScope.coverageMode, 'release-verifier-carry-through-candidate-vs-release-ready');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.deepEqual(report.candidateScope.variantLineage.precedentRppIds, [
    'RPP-0817',
    'RPP-0837',
    'RPP-0857',
    'RPP-0877',
  ]);
  assert.deepEqual(report.candidateScope.variantLineage.previousVariants, [1, 2, 3, 4]);
  assert.equal(report.candidateScope.variantLineage.unavailableCapabilityPattern, true);
  assert.equal(report.candidateScope.variantLineage.releaseVerifierCarryThroughVariant, true);
  assert.equal(report.candidateScope.variantLineage.sameRunBindingVariant, true);

  assert.equal(report.candidateScope.routeMatrixCandidate.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.candidateScope.routeMatrixCandidate.routeCount, ROUTE_PROOF_MATRIX_ROUTE_ORDER.length);
  assert.deepEqual(report.candidateScope.routeMatrixCandidate.routeIds, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.equal(report.candidateScope.routeMatrixCandidate.requiresReleaseVerifierPass, true);
  assert.equal(report.candidateScope.routeMatrixCandidate.requiresSameRunRouteReceipts, true);
  assert.equal(report.candidateScope.routeMatrixCandidate.rawRouteBodiesIncluded, false);
  assert.equal(report.candidateScope.routeMatrixCandidate.liveRestIndexReadbackPerformed, false);
  assert.equal(report.candidateScope.routeMatrixCandidate.routeReceiptReadbackPerformed, false);
  assert.ok(report.candidateScope.candidateClaims.includes('release-verifier-carry-through-recorded'));
  assert.ok(report.candidateScope.candidateClaims.includes('variant-5-same-run-binding-requirement-recorded'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('verify-release-passed-on-topology'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('same-run-live-route-receipts'));

  assert.equal(report.routeMatrix.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.routeMatrix.validationOk, true);
  assert.equal(report.routeMatrix.validationStatus, 'satisfied');
  assert.equal(report.routeMatrix.supportProofMode, 'contract-and-release-verifier-carry-through-prerequisite');
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
  assert.equal(report.routeMatrix.routeReceiptHashesObserved, false);
  assert.equal(report.routeMatrix.routeReceiptBodiesStored, false);
  assert.equal(report.routeMatrix.releaseVerifierTopologyPassObserved, false);
  assert.match(report.routeMatrix.routeMatrixHash, hexSha256Pattern);
  assert.equal(report.routeMatrix.routeMatrixHash, digest(routeMatrixHashInput(report)));
});

test('RPP-0897 records exact topology capability, release-verifier failure carry-through, and no fallback', () => {
  const { report } = loadEvidenceReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(plan.validation.ok, true);
  assert.equal(plan.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(plan.validation.checks.noTunnelCommands, true);
  assert.equal(plan.validation.checks.packagedFallbackDisabled, true);
  assert.equal(plan.validation.checks.releaseCommandIsVerifyRelease, true);
  assert.equal(artifact.commands.runHarness, report.topologyCommand.command);
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, releaseVerifierCommand);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.verifyReleaseFailure.exitCode, 2);
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
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
    releaseVerifierCommand,
  });
  assert.equal(report.topologyCommand.statusMarker, artifact.evidence.tmuxStatusMarker.marker);
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));

  assert.equal(report.releaseVerifier.command, releaseVerifierCommand);
  assert.equal(report.releaseVerifier.topologyCommand, topologyCommand);
  assert.equal(report.releaseVerifier.requiredByTopologyCommand, true);
  assert.equal(report.releaseVerifier.carriedThroughByTopologyCommand, true);
  assert.equal(report.releaseVerifier.status, 'blocked');
  assert.equal(report.releaseVerifier.failClosed, true);
  assert.equal(report.releaseVerifier.acceptedForReleaseGate, false);
  assert.equal(report.releaseVerifier.verifyReleaseExitCode, artifact.evidence.verifyReleaseFailure.exitCode);
  assert.equal(report.releaseVerifier.verifyReleaseFailure.reason, artifact.evidence.verifyReleaseFailure.reason);
  assert.equal(report.releaseVerifier.verifyReleaseFailure.reason, report.topologyCommand.exactUnavailableCapability.code);
  assert.equal(report.releaseVerifier.mustPassOnTopologyForReleaseReady, true);
  assert.equal(report.releaseVerifier.noPackagedFallback, true);
  assert.equal(report.releaseVerifier.packagedFallbackAllowed, false);
  assert.equal(report.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(report.releaseVerifier.releaseUrlsUseDockerDns, true);
  assert.equal(report.releaseVerifier.topologyValidationOk, true);
  assert.equal(report.releaseVerifier.releaseCommandIsVerifyRelease, true);
  assert.equal(report.releaseVerifier.routeMatrixProofAccepted, false);
  assert.equal(report.releaseVerifier.liveRouteReceiptProofAccepted, false);
  assert.equal(report.releaseVerifier.releaseMovementAllowed, false);
  assert.equal(report.releaseVerifier.primaryFailureCode, artifact.releaseGateEvaluation.primaryFailureCode);
  assert.deepEqual(report.releaseVerifier.releaseGateTotals, artifact.releaseGateEvaluation.totals);
  assert.deepEqual(report.releaseVerifier.requiredCarryThrough, releaseVerifierCarryThroughRequirements);
  assert.deepEqual(report.releaseVerifier.requiredRouteIds, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.equal(report.releaseVerifier.runIdentity.artifactHash, report.topologyCommand.artifactHash);
  assert.match(report.releaseVerifier.runHash, prefixedSha256Pattern);
  assert.equal(report.releaseVerifier.runHash, releaseVerifierRunHash(report));
});

test('RPP-0897 release-ready evaluator accepts only same-run verify:release topology proof', () => {
  const { report } = loadEvidenceReport();
  const routeValidation = validateRouteProofMatrix(productionRouteProofEntries());
  const { artifact } = buildMissingDockerCapabilityArtifact();
  const readyProof = makeReleaseReadyFixture(report);
  const passedArtifact = passedTopologyArtifactFrom(artifact);
  const ready = evaluateRestRouteMatrixV5Readiness({
    proof: readyProof,
    routeValidation,
    artifact: passedArtifact,
  });

  assert.equal(ready.readyForReleaseMovement, true, JSON.stringify(ready.blockers));
  assert.equal(ready.finalReleaseStatus, 'GO');
  assert.deepEqual(ready.blockers, []);

  const missingReceipt = makeReleaseReadyFixture(report);
  missingReceipt.liveRouteReceipts.observedRouteIds = missingReceipt.liveRouteReceipts.observedRouteIds.slice(0, -1);
  missingReceipt.liveRouteReceipts.receipts = missingReceipt.liveRouteReceipts.receipts.slice(0, -1);
  missingReceipt.liveRouteReceipts.receiptCount -= 1;
  missingReceipt.liveRouteReceipts.receiptHashCount -= 1;
  missingReceipt.liveRouteReceipts.receiptSetHash = `sha256:${digest(receiptSetHashInput(missingReceipt.liveRouteReceipts))}`;
  const missingReceiptReadiness = evaluateRestRouteMatrixV5Readiness({
    proof: missingReceipt,
    routeValidation,
    artifact: passedArtifact,
  });
  assert.equal(missingReceiptReadiness.readyForReleaseMovement, false);
  assert.ok(missingReceiptReadiness.blockers.includes('live-route-receipts-missing'));

  const missingBinding = makeReleaseReadyFixture(report);
  missingBinding.releaseVerifier.topologyBinding.artifactHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  missingBinding.releaseVerifier.runIdentity.artifactHash = missingBinding.releaseVerifier.topologyBinding.artifactHash;
  missingBinding.releaseVerifier.runHash = releaseVerifierRunHash(missingBinding);
  missingBinding.releaseVerifier.sameRunBinding.sameRunBindingHash = `sha256:${digest(sameRunBindingInput(missingBinding))}`;
  const missingBindingReadiness = evaluateRestRouteMatrixV5Readiness({
    proof: missingBinding,
    routeValidation,
    artifact: passedArtifact,
  });
  assert.equal(missingBindingReadiness.readyForReleaseMovement, false);
  assert.ok(missingBindingReadiness.blockers.includes('topology-binding-missing'));

  const packagedFallback = makeReleaseReadyFixture(report);
  packagedFallback.topologyCommand.packagedFallbackObserved = true;
  packagedFallback.topologyCommand.policy.packagedFallbackObserved = true;
  packagedFallback.releaseVerifier.packagedFallbackObserved = true;
  packagedFallback.releaseVerifier.noPackagedFallback = false;
  const packagedFallbackReadiness = evaluateRestRouteMatrixV5Readiness({
    proof: packagedFallback,
    routeValidation,
    artifact: passedTopologyArtifactFrom(artifact, { packagedFallbackObserved: true }),
  });
  assert.equal(packagedFallbackReadiness.readyForReleaseMovement, false);
  assert.ok(packagedFallbackReadiness.blockers.includes('packaged-fallback-observed'));

  const widenedNetwork = makeReleaseReadyFixture(report);
  widenedNetwork.localOnlyPolicy.onlySandbox8080Ingress = false;
  widenedNetwork.localOnlyPolicy.tunnelCommandCount = 1;
  widenedNetwork.topologyCommand.policy.remoteTunnelsAllowed = true;
  const widenedNetworkReadiness = evaluateRestRouteMatrixV5Readiness({
    proof: widenedNetwork,
    routeValidation,
    artifact: passedArtifact,
  });
  assert.equal(widenedNetworkReadiness.readyForReleaseMovement, false);
  assert.ok(widenedNetworkReadiness.blockers.includes('widened-network-or-tunnel-evidence'));

  const ambiguousClaim = structuredClone(report);
  ambiguousClaim.releaseEligible = true;
  ambiguousClaim.finalReleaseStatus = 'GO';
  ambiguousClaim.integrationRecommendation = 'GO';
  ambiguousClaim.releaseVerifier.productionReadyClaim = 'production-ready';
  const ambiguousReadiness = evaluateRestRouteMatrixV5Readiness({
    proof: ambiguousClaim,
    routeValidation,
    artifact,
  });
  assert.equal(ambiguousReadiness.readyForReleaseMovement, false);
  assert.ok(ambiguousReadiness.blockers.includes('ambiguous-production-ready-claim'));

  const staleSplit = makeReleaseReadyFixture(report);
  staleSplit.liveRouteReceipts.releaseVerifierRunId = 'rpp-0897-stale-route-receipts';
  staleSplit.liveRouteReceipts.receipts = staleSplit.liveRouteReceipts.receipts.map((receipt) => ({
    ...receipt,
    releaseVerifierRunId: staleSplit.liveRouteReceipts.releaseVerifierRunId,
  }));
  staleSplit.liveRouteReceipts.receiptSetHash = `sha256:${digest(receiptSetHashInput(staleSplit.liveRouteReceipts))}`;
  staleSplit.releaseVerifier.sameRunBinding.liveRouteReceiptRunId = staleSplit.liveRouteReceipts.releaseVerifierRunId;
  staleSplit.releaseVerifier.sameRunBinding.sameRunBindingHash = `sha256:${digest(sameRunBindingInput(staleSplit))}`;
  const staleSplitReadiness = evaluateRestRouteMatrixV5Readiness({
    proof: staleSplit,
    routeValidation,
    artifact: passedArtifact,
  });
  assert.equal(staleSplitReadiness.readyForReleaseMovement, false);
  assert.ok(staleSplitReadiness.blockers.includes('stale-or-split-release-verifier-evidence'));
});

test('RPP-0897 support evidence stays NO-GO until live same-run receipts are present', () => {
  const { report } = loadEvidenceReport();
  const routeValidation = validateRouteProofMatrix(productionRouteProofEntries());
  const { artifact } = buildMissingDockerCapabilityArtifact();
  const readiness = evaluateRestRouteMatrixV5Readiness({
    proof: report,
    routeValidation,
    artifact,
  });

  assert.equal(readiness.readyForReleaseMovement, false);
  assert.equal(readiness.finalReleaseStatus, 'NO-GO');
  assert.equal(readiness.primaryBlocker, 'DOCKER_CLI_MISSING');
  assert.ok(readiness.blockers.includes('verify-release-topology-not-passed'));
  assert.ok(readiness.blockers.includes('live-route-receipts-missing'));
  assert.ok(readiness.blockers.includes('same-run-release-verifier-binding-missing'));
  assert.ok(readiness.blockers.includes('candidate-support-only'));

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.equal(report.releaseReadyScope.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseReadyScope.releaseGateMovement, 'none');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'verify-release-docker-local-production-passes-without-packaged-fallback',
    ),
  );
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('same-release-verifier-run-live-route-receipts'));
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('live-rest-index-route-registration-readback'));
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('candidate-does-not-have-same-run-route-receipts'));
  assert.ok(report.releaseReadyScope.blockers.includes('candidate-does-not-have-release-verifier-passed-on-topology'));
  assert.equal(report.releaseReadyScope.routeMatrixReleaseGate.status, 'not-satisfied');
  assert.equal(report.releaseReadyScope.routeMatrixReleaseGate.candidateOnlyReleaseMovement, 'blocked');
  assert.equal(report.releaseReadyScope.routeMatrixReleaseGate.packagedFallbackCanSatisfyRouteMatrixProof, false);
  assert.deepEqual(report.releaseReadyScope.routeMatrixReleaseGate.releaseMovementBlockedUntil, [
    'docker-wordpress-topology-sites-started',
    'verify-release-docker-local-production-passes-without-packaged-fallback',
    'live-rest-index-route-registration-readback',
    'route-receipts-cover-all-six-production-routes',
    'route-receipts-bound-to-the-same-release-verifier-run',
  ]);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
});

test('RPP-0897 evidence remains hash/count/surface only', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0897 REST route matrix proof v5' }));
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

  assert.equal(report.liveRouteReceipts.receiptCount, 0);
  assert.equal(report.liveRouteReceipts.receiptHashCount, 0);
  assert.equal(report.liveRouteReceipts.rawReceiptBodiesStored, false);
  assert.deepEqual(report.liveRouteReceipts.requiredRouteIds, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.deepEqual(report.liveRouteReceipts.observedRouteIds, []);
  assert.match(report.liveRouteReceipts.receiptSetHash, prefixedSha256Pattern);
  assert.equal(report.liveRouteReceipts.receiptSetHash, `sha256:${digest(receiptSetHashInput(report.liveRouteReceipts))}`);

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
    'releaseVerifier',
    'liveRouteReceipts',
    'localOnlyPolicy',
    'releaseReadyScope',
    'operationGuards',
    'evidenceLimits',
    'finalReleaseStatus',
    'integrationRecommendation',
  ]);
  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
  assert.equal(report.invariants.releaseVerifierCarryThroughRecorded, true);
  assert.equal(report.invariants.packagedFallbackDisabled, true);
  assert.equal(report.invariants.staleSplitEvidenceRejected, true);
  assert.equal(report.invariants.ambiguousProductionReadyClaimsRejected, true);
  assert.equal(report.invariants.supportOnlyNoGo, true);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel/i,
  );
});

test('RPP-0897 evidence documents exact validation commands and results', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(report.validation.commands, [
    {
      command: 'node --check test/rpp-0897-rest-route-matrix-proof-v5.test.js',
      result: 'exit-0',
    },
    {
      command: 'node --test --test-name-pattern RPP-0897 test/rpp-0897-rest-route-matrix-proof-v5.test.js',
      result: 'exit-0',
    },
    {
      command: 'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0897-rest-route-matrix-proof-v5.md',
      result: 'exit-0',
    },
    {
      command: 'git diff --check',
      result: 'exit-0',
    },
  ]);
  assert.equal(report.validation.topologyCommandExpectedOutcome, 'verify-release-pass-or-exact-unavailable-capability');
  assert.equal(report.validation.topologyCommandObservedOutcome.commandInvokedByThisWorker, false);
  assert.equal(report.validation.topologyCommandObservedOutcome.sitesStarted, false);
  assert.equal(report.validation.topologyCommandObservedOutcome.capabilityCode, 'DOCKER_CLI_MISSING');
  assert.equal(report.validation.topologyCommandObservedOutcome.acceptedForReleaseGate, false);
  assert.equal(report.validation.evidenceRedactionScan.ok, true);
  assert.equal(report.validation.evidenceRedactionScan.rejectedFiles, 0);
  assert.match(text, /node --check test\/rpp-0897-rest-route-matrix-proof-v5\.test\.js/);
  assert.match(
    text,
    /node --test --test-name-pattern RPP-0897 test\/rpp-0897-rest-route-matrix-proof-v5\.test\.js/,
  );
  assert.match(
    text,
    /node scripts\/release\/artifact-redaction-scan\.mjs docs\/evidence\/rpp-0897-rest-route-matrix-proof-v5\.md/,
  );
  assert.match(text, /git diff --check/);
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0897 evidence must contain one JSON progress report block');
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
    workDir: '/tmp/rpp-0897-docker-work',
    evidenceDir: '/tmp/rpp-0897-docker-evidence',
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

function validateRestRouteMatrixV5Proof(proof) {
  const failures = [];
  if (proof.rppId !== 'RPP-0897' || proof.variant !== 5) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_IDENTITY_MISMATCH' });
  }
  if (proof.progressReport?.recordsCandidateVersusReleaseReadyScope !== true
    || proof.candidateScope?.variantLineage?.sameRunBindingVariant !== true) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_CANDIDATE_RELEASE_BOUNDARY_MISSING' });
  }
  if (proof.routeMatrix.validationOk !== true
    || proof.routeMatrix.routeCount !== ROUTE_PROOF_MATRIX_ROUTE_ORDER.length
    || JSON.stringify(proof.routeMatrix.routeOrder) !== JSON.stringify(ROUTE_PROOF_MATRIX_ROUTE_ORDER)) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_ROUTE_CONTRACT_INVALID' });
  }
  if (!proof.topologyCommand.sitesStarted) {
    const capability = proof.topologyCommand.exactUnavailableCapability;
    if (!capability?.code || !capability?.capability || !capability?.probeCommand) {
      failures.push({ code: 'REST_ROUTE_MATRIX_V5_UNAVAILABLE_CAPABILITY_NOT_EXACT' });
    }
    if (proof.failClosed !== true
      || proof.topologyCommand.acceptedForReleaseGate !== false
      || proof.topologyCommand.releaseMovementAllowed !== false
      || proof.finalReleaseStatus !== 'NO-GO') {
      failures.push({ code: 'REST_ROUTE_MATRIX_V5_MUST_FAIL_CLOSED_WHEN_TOPOLOGY_NOT_STARTED' });
    }
    if (proof.routeMatrix.liveRestRouteReadbackObserved !== false
      || proof.routeMatrix.routeRegistrationReadbackObserved !== false
      || proof.routeMatrix.routeReceiptHashesObserved !== false
      || proof.routeMatrix.releaseVerifierTopologyPassObserved !== false) {
      failures.push({ code: 'REST_ROUTE_MATRIX_V5_LIVE_ROUTE_READBACK_CLAIMED_WITHOUT_TOPOLOGY' });
    }
  }
  if (proof.releaseVerifier.command !== releaseVerifierCommand
    || proof.releaseVerifier.topologyCommand !== topologyCommand
    || proof.releaseVerifier.requiredByTopologyCommand !== true
    || proof.releaseVerifier.carriedThroughByTopologyCommand !== true
    || proof.releaseVerifier.mustPassOnTopologyForReleaseReady !== true) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_RELEASE_VERIFIER_NOT_CARRIED' });
  }
  if (proof.releaseVerifier.failClosed !== true
    || proof.releaseVerifier.acceptedForReleaseGate !== false
    || proof.releaseVerifier.releaseMovementAllowed !== false
    || proof.releaseVerifier.verifyReleaseFailure?.reason !== proof.topologyCommand.exactUnavailableCapability?.code
    || proof.releaseVerifier.verifyReleaseExitCode !== proof.topologyCommand.verifyReleaseExitCode) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_RELEASE_VERIFIER_NOT_FAIL_CLOSED' });
  }
  if (proof.topologyCommand.packagedFallbackObserved !== false
    || proof.topologyCommand.policy?.packagedFallbackAllowed !== false
    || proof.topologyCommand.policy?.packagedFallbackObserved !== false
    || proof.releaseVerifier.noPackagedFallback !== true
    || proof.releaseVerifier.packagedFallbackAllowed !== false
    || proof.releaseVerifier.packagedFallbackObserved !== false
    || proof.builtOn.topologyCommand.packagedFallbackAllowed !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_PACKAGED_FALLBACK_REJECTED' });
  }
  if (proof.localOnlyPolicy.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy.tunnelCommandCount !== 0
    || proof.localOnlyPolicy.widenedNetworkEvidenceObserved !== false
    || proof.operationGuards.networkServiceStarted !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_LOCAL_ONLY_POLICY_FAILED' });
  }
  if (proof.liveRouteReceipts.requiredSameReleaseVerifierRun !== true
    || proof.liveRouteReceipts.receiptCount !== 0
    || proof.liveRouteReceipts.rawReceiptBodiesStored !== false
    || proof.releaseVerifier.sameRunBinding.required !== true
    || proof.releaseVerifier.sameRunBinding.observed !== false
    || proof.releaseVerifier.sameRunBinding.staleOrSplitEvidenceAccepted !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_SAME_RUN_REQUIREMENT_NOT_RECORDED' });
  }
  if (proof.releaseVerifier.runHash !== releaseVerifierRunHash(proof)
    || proof.releaseVerifier.sameRunBinding.sameRunBindingHash !== `sha256:${digest(sameRunBindingInput(proof))}`) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_RUN_HASH_MISMATCH' });
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
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_EVIDENCE_LIMITS_FAILED' });
  }
  if (proof.releaseReadyScope.finalReleaseStatus !== 'NO-GO'
    || proof.releaseReadyScope.releaseGateMovement !== 'none'
    || proof.productionBacked !== false
    || proof.supportOnly !== true
    || proof.releaseEligible !== false) {
    failures.push({ code: 'REST_ROUTE_MATRIX_V5_RELEASE_MOVEMENT_FORBIDDEN' });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function evaluateRestRouteMatrixV5Readiness({ proof, routeValidation, artifact }) {
  const blockers = [];
  const releaseVerifier = proof.releaseVerifier || {};
  const topology = proof.topologyCommand || {};
  const receipts = proof.liveRouteReceipts || {};
  const sameRunBinding = releaseVerifier.sameRunBinding || {};

  if (routeValidation.ok !== true || proof.routeMatrix.validationOk !== true) {
    blockers.push('route-matrix-validation-failed');
  }
  if (releaseVerifier.requiredByTopologyCommand !== true
    || releaseVerifier.carriedThroughByTopologyCommand !== true
    || releaseVerifier.command !== releaseVerifierCommand
    || releaseVerifier.topologyCommand !== topologyCommand
    || topology.command !== topologyCommand
    || releaseVerifier.topologyBinding?.artifactHash !== topology.artifactHash
    || releaseVerifier.runIdentity?.artifactHash !== topology.artifactHash
    || releaseVerifier.topologyBinding?.topologyVariant !== topology.topologyVariant
    || artifact.evidence?.dockerVerifyReleaseTopology?.command !== releaseVerifierCommand
    || artifact.evidence?.dockerVerifyReleaseTopology?.topologyVariant !== topology.topologyVariant
    || releaseVerifier.runHash !== releaseVerifierRunHash(proof)) {
    blockers.push('topology-binding-missing');
  }
  if (artifact.status !== 'passed'
    || artifact.evidence?.dockerVerifyReleaseTopology?.ok !== true
    || topology.verifyReleasePassed !== true
    || topology.verifyReleaseExitCode !== 0
    || proof.routeMatrix.releaseVerifierTopologyPassObserved !== true
    || releaseVerifier.status !== 'passed'
    || releaseVerifier.verifyReleaseExitCode !== 0
    || releaseVerifier.mustPassOnTopologyForReleaseReady !== true) {
    blockers.push('verify-release-topology-not-passed');
  }
  if (proof.routeMatrix.liveRestRouteReadbackObserved !== true
    || proof.routeMatrix.routeRegistrationReadbackObserved !== true
    || proof.routeMatrix.routeReceiptHashesObserved !== true
    || receipts.receiptCount !== ROUTE_PROOF_MATRIX_ROUTE_ORDER.length
    || receipts.receiptHashCount !== ROUTE_PROOF_MATRIX_ROUTE_ORDER.length
    || JSON.stringify(receipts.observedRouteIds || []) !== JSON.stringify(ROUTE_PROOF_MATRIX_ROUTE_ORDER)
    || !Array.isArray(receipts.receipts)
    || receipts.receipts.length !== ROUTE_PROOF_MATRIX_ROUTE_ORDER.length
    || receipts.rawReceiptBodiesStored !== false
    || receipts.receiptSetHash !== `sha256:${digest(receiptSetHashInput(receipts))}`) {
    blockers.push('live-route-receipts-missing');
  }
  if (artifact.packagedFallback !== false
    || artifact.evidence?.packagedFallback?.observed !== false
    || artifact.evidence?.dockerVerifyReleaseTopology?.packagedFallbackAllowed !== false
    || artifact.evidence?.dockerVerifyReleaseTopology?.packagedFallbackObserved !== false
    || topology.packagedFallbackObserved !== false
    || topology.policy?.packagedFallbackAllowed !== false
    || topology.policy?.packagedFallbackObserved !== false
    || releaseVerifier.noPackagedFallback !== true
    || releaseVerifier.packagedFallbackAllowed !== false
    || releaseVerifier.packagedFallbackObserved !== false) {
    blockers.push('packaged-fallback-observed');
  }
  if (proof.localOnlyPolicy?.onlySandbox8080Ingress !== true
    || proof.localOnlyPolicy?.noTunnelPolicyEnforced !== true
    || proof.localOnlyPolicy?.tunnelCommandCount !== 0
    || proof.localOnlyPolicy?.widenedNetworkEvidenceObserved !== false
    || topology.policy?.onlySandbox8080Ingress !== true
    || topology.policy?.remoteTunnelsAllowed !== false
    || topology.policy?.tunnelCommandCount !== 0
    || topology.publishedIngress?.hostSurface !== 'loopback-only'
    || topology.publishedIngress?.port !== 8080
    || releaseVerifier.releaseUrlsUseDockerDns !== true) {
    blockers.push('widened-network-or-tunnel-evidence');
  }
  if (sameRunBinding.required !== true
    || sameRunBinding.observed !== true
    || sameRunBinding.staleOrSplitEvidenceAccepted !== false
    || sameRunBinding.topologyRunId !== sameRunId
    || sameRunBinding.releaseVerifierRunId !== sameRunId
    || sameRunBinding.liveRouteReceiptRunId !== sameRunId
    || receipts.topologyRunId !== sameRunId
    || receipts.releaseVerifierRunId !== sameRunId
    || releaseVerifier.runIdentity?.topologyRunId !== sameRunId
    || releaseVerifier.runIdentity?.releaseVerifierRunId !== sameRunId
    || !receipts.receipts?.every((receipt) =>
      receipt.topologyRunId === sameRunId && receipt.releaseVerifierRunId === sameRunId)
    || sameRunBinding.sameRunBindingHash !== `sha256:${digest(sameRunBindingInput(proof))}`) {
    blockers.push('same-run-release-verifier-binding-missing');
  }
  if (sameRunBinding.observed === true
    && (sameRunBinding.topologyRunId !== sameRunBinding.releaseVerifierRunId
      || sameRunBinding.releaseVerifierRunId !== sameRunBinding.liveRouteReceiptRunId
      || receipts.releaseVerifierRunId !== sameRunBinding.releaseVerifierRunId
      || receipts.topologyRunId !== sameRunBinding.topologyRunId)) {
    blockers.push('stale-or-split-release-verifier-evidence');
  }
  if (proof.supportOnly !== false || proof.productionBacked !== true || proof.releaseEligible !== true) {
    blockers.push('candidate-support-only');
  }

  const claimedReady = proof.finalReleaseStatus === 'GO'
    || proof.integrationRecommendation === 'GO'
    || proof.releaseEligible === true
    || releaseVerifier.productionReadyClaim === 'production-ready';
  if (claimedReady && blockers.length > 0) {
    blockers.push('ambiguous-production-ready-claim');
  }

  const readyForReleaseMovement = blockers.length === 0;
  return {
    readyForReleaseMovement,
    finalReleaseStatus: readyForReleaseMovement ? 'GO' : 'NO-GO',
    primaryBlocker: artifact.prerequisiteProbe?.blocker?.code || blockers[0] || null,
    blockers,
  };
}

function makeReleaseReadyFixture(report) {
  const ready = structuredClone(report);
  const receipts = ROUTE_PROOF_MATRIX_ROUTE_ORDER.map((routeId) => {
    const route = report.routeMatrix.routes.find((entry) => entry.id === routeId);
    return {
      routeId,
      topologyRunId: sameRunId,
      releaseVerifierRunId: sameRunId,
      receiptHash: `sha256:${digest({
        runId: sameRunId,
        routeId,
        method: route.method,
        classification: route.classification,
      })}`,
      methodHash: `sha256:${digest({ routeId, method: route.method })}`,
      permissionHash: `sha256:${digest({ routeId, capability: route.permissionCapability })}`,
      mutationBoundaryHash: `sha256:${digest({
        routeId,
        readOnly: route.readOnly,
        mutates: route.mutates,
        classification: route.classification,
      })}`,
    };
  });

  ready.status = 'passed-same-run-live-route-matrix-proof';
  ready.failClosed = false;
  ready.supportOnly = false;
  ready.productionBacked = true;
  ready.releaseEligible = true;
  ready.finalReleaseStatus = 'GO';
  ready.integrationRecommendation = 'GO';

  ready.routeMatrix.liveRestRouteReadbackObserved = true;
  ready.routeMatrix.routeRegistrationReadbackObserved = true;
  ready.routeMatrix.routeReceiptHashesObserved = true;
  ready.routeMatrix.routeReceiptBodiesStored = false;
  ready.routeMatrix.releaseVerifierTopologyPassObserved = true;

  ready.topologyCommand.status = 'passed';
  ready.topologyCommand.siteStartupStatus = 'started';
  ready.topologyCommand.sitesStarted = true;
  ready.topologyCommand.verifyReleasePassed = true;
  ready.topologyCommand.verifyReleaseExitCode = 0;
  ready.topologyCommand.failClosed = false;
  ready.topologyCommand.acceptedForReleaseGate = true;
  ready.topologyCommand.releaseMovementAllowed = true;
  ready.topologyCommand.exactUnavailableCapability = null;
  ready.topologyCommand.statusMarker = '[RPP-DOCKER-LOCAL-PRODUCTION:PASS]';

  ready.releaseVerifier.status = 'passed';
  ready.releaseVerifier.failClosed = false;
  ready.releaseVerifier.acceptedForReleaseGate = true;
  ready.releaseVerifier.verifyReleaseExitCode = 0;
  ready.releaseVerifier.verifyReleaseFailure = null;
  ready.releaseVerifier.routeMatrixProofAccepted = true;
  ready.releaseVerifier.liveRouteReceiptProofAccepted = true;
  ready.releaseVerifier.releaseMovementAllowed = true;
  ready.releaseVerifier.productionReadyClaim = 'same-run-live-topology-proof';
  ready.releaseVerifier.runIdentity.topologyRunId = sameRunId;
  ready.releaseVerifier.runIdentity.releaseVerifierRunId = sameRunId;
  ready.releaseVerifier.runIdentity.sameRunBindingObserved = true;
  ready.releaseVerifier.topologyBinding.sameRunProofObserved = true;
  ready.releaseVerifier.sameRunBinding.observed = true;
  ready.releaseVerifier.sameRunBinding.releaseReadyStatus = 'satisfied';
  ready.releaseVerifier.sameRunBinding.topologyRunId = sameRunId;
  ready.releaseVerifier.sameRunBinding.releaseVerifierRunId = sameRunId;
  ready.releaseVerifier.sameRunBinding.liveRouteReceiptRunId = sameRunId;

  ready.liveRouteReceipts.status = 'observed';
  ready.liveRouteReceipts.releaseReadyStatus = 'satisfied';
  ready.liveRouteReceipts.receiptCount = receipts.length;
  ready.liveRouteReceipts.receiptHashCount = receipts.length;
  ready.liveRouteReceipts.observedRouteIds = [...ROUTE_PROOF_MATRIX_ROUTE_ORDER];
  ready.liveRouteReceipts.topologyRunId = sameRunId;
  ready.liveRouteReceipts.releaseVerifierRunId = sameRunId;
  ready.liveRouteReceipts.receipts = receipts;
  ready.liveRouteReceipts.receiptSetHash = `sha256:${digest(receiptSetHashInput(ready.liveRouteReceipts))}`;

  ready.releaseVerifier.runHash = releaseVerifierRunHash(ready);
  ready.releaseVerifier.sameRunBinding.sameRunBindingHash = `sha256:${digest(sameRunBindingInput(ready))}`;

  return ready;
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
  delete passed.evidence.verifyReleaseFailure;
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
    verifyReleaseFailureExitCode: artifact.evidence.verifyReleaseFailure.exitCode,
    verifyReleaseFailureReason: artifact.evidence.verifyReleaseFailure.reason,
    siteRoleCount: report.topologyCommand.siteRoleCount,
    hostSurface: report.topologyCommand.publishedIngress.hostSurface,
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    onlySandbox8080Ingress: report.topologyCommand.policy.onlySandbox8080Ingress,
    packagedFallbackAllowed: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed,
    packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    routeMatrixHash: report.routeMatrix.routeMatrixHash,
    releaseVerifierCarryThrough: report.releaseVerifier.requiredCarryThrough,
    evidenceSurfaceDigest: report.evidenceLimits.surfaceDigest,
  })}`;
}

function releaseVerifierRunHash(report) {
  return `sha256:${digest({
    command: report.releaseVerifier.command,
    topologyCommand: report.releaseVerifier.topologyCommand,
    status: report.releaseVerifier.status,
    verifyReleaseExitCode: report.releaseVerifier.verifyReleaseExitCode,
    verifyReleaseFailure: report.releaseVerifier.verifyReleaseFailure,
    noPackagedFallback: report.releaseVerifier.noPackagedFallback,
    packagedFallbackAllowed: report.releaseVerifier.packagedFallbackAllowed,
    packagedFallbackObserved: report.releaseVerifier.packagedFallbackObserved,
    releaseCommandIsVerifyRelease: report.releaseVerifier.releaseCommandIsVerifyRelease,
    runIdentity: report.releaseVerifier.runIdentity,
    topologyBinding: report.releaseVerifier.topologyBinding,
    requiredCarryThrough: report.releaseVerifier.requiredCarryThrough,
    requiredRouteIds: report.releaseVerifier.requiredRouteIds,
  })}`;
}

function receiptSetHashInput(liveRouteReceipts) {
  return {
    requiredRouteIds: liveRouteReceipts.requiredRouteIds,
    observedRouteIds: liveRouteReceipts.observedRouteIds,
    receiptCount: liveRouteReceipts.receiptCount,
    receiptHashCount: liveRouteReceipts.receiptHashCount,
    topologyRunId: liveRouteReceipts.topologyRunId,
    releaseVerifierRunId: liveRouteReceipts.releaseVerifierRunId,
    rawReceiptBodiesStored: liveRouteReceipts.rawReceiptBodiesStored,
    receipts: liveRouteReceipts.receipts,
  };
}

function sameRunBindingInput(report) {
  return {
    required: report.releaseVerifier.sameRunBinding.required,
    observed: report.releaseVerifier.sameRunBinding.observed,
    topologyRunId: report.releaseVerifier.sameRunBinding.topologyRunId,
    releaseVerifierRunId: report.releaseVerifier.sameRunBinding.releaseVerifierRunId,
    liveRouteReceiptRunId: report.releaseVerifier.sameRunBinding.liveRouteReceiptRunId,
    artifactHash: report.releaseVerifier.runIdentity.artifactHash,
    releaseVerifierRunHash: report.releaseVerifier.runHash,
    receiptSetHash: report.liveRouteReceipts.receiptSetHash,
    staleOrSplitEvidenceAccepted: report.releaseVerifier.sameRunBinding.staleOrSplitEvidenceAccepted,
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    routeMatrix: report.routeMatrix,
    topologyCommand: report.topologyCommand,
    releaseVerifier: report.releaseVerifier,
    liveRouteReceipts: report.liveRouteReceipts,
    localOnlyPolicy: report.localOnlyPolicy,
    releaseReadyScope: report.releaseReadyScope,
    operationGuards: report.operationGuards,
    evidenceLimits: report.evidenceLimits,
    finalReleaseStatus: report.finalReleaseStatus,
    integrationRecommendation: report.integrationRecommendation,
  };
}
