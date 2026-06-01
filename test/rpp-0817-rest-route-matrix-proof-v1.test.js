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
  'docs/evidence/rpp-0817-rest-route-matrix-proof-v1.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0817 records the REST route matrix support scope without release movement', () => {
  const { report, text } = loadEvidenceReport();
  const contract = buildRouteProofMatrixContract();
  const expectedRoutes = summarizeRoutes(productionRouteProofEntries());

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0817');
  assert.equal(report.variant, 1);
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
  assert.equal(report.builtOn.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.topologyCommand.releaseVerifierCommand, dockerReleaseCommand.join(' '));
  assert.equal(report.builtOn.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.topologyCommand.packagedFallbackAllowed, false);

  assert.equal(report.routeMatrix.contractId, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(report.routeMatrix.validationOk, true);
  assert.equal(report.routeMatrix.validationStatus, 'satisfied');
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

  assert.match(text, /## REST Route Matrix Scope/);
  assert.match(text, /## Release-Ready Scope/);
});

test('RPP-0817 records exact unavailable topology capability and no packaged fallback', () => {
  const { report } = loadEvidenceReport();
  const { artifact, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(artifact.commands.runHarness, report.topologyCommand.command);
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.packagedFallback, false);
  assert.equal(artifact.evidence.packagedFallback.observed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, dockerReleaseCommand.join(' '));
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);

  assert.equal(report.topologyCommand.status, artifact.status);
  assert.equal(report.topologyCommand.verifyReleasePassed, false);
  assert.equal(report.topologyCommand.verifyReleaseExitCode, 2);
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.topologyCommand.releaseMovementAllowed, false);
  assert.equal(report.topologyCommand.packagedFallbackObserved, false);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    capability: 'docker-cli',
    probeCommand: probe.checks.dockerCli.command,
    missingExecutable: probe.checks.dockerCli.missingExecutable,
    requiredFor: [
      'rest-route-matrix-live-route-readback',
      'verify-release-topology-run',
      'no-packaged-fallback-release-proof',
    ],
  });
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));
});

test('RPP-0817 fail-closed policy rejects incomplete route matrix or missing live topology', () => {
  const routes = productionRouteProofEntries();
  routes.find((route) => route.id === 'apply').methods = ['GET'];
  const routeValidation = validateRouteProofMatrix(routes);

  assert.equal(routeValidation.ok, false);
  assert.ok(routeValidation.failures.some((failure) =>
    failure.routeId === 'apply' && failure.code === 'ROUTE_METHOD_MISMATCH'));

  const { artifact } = buildMissingDockerCapabilityArtifact();
  const readiness = evaluateRestRouteMatrixReadiness({
    routeValidation: validateRouteProofMatrix(productionRouteProofEntries()),
    artifact,
  });

  assert.equal(readiness.readyForReleaseMovement, false);
  assert.equal(readiness.finalReleaseStatus, 'NO-GO');
  assert.equal(readiness.primaryBlocker, 'DOCKER_CLI_MISSING');
  assert.ok(readiness.blockers.includes('verify-release-topology-not-passed'));

  const packagedFallbackArtifact = {
    ...artifact,
    packagedFallback: true,
    evidence: {
      ...artifact.evidence,
      packagedFallback: {
        ...artifact.evidence.packagedFallback,
        observed: true,
      },
      dockerVerifyReleaseTopology: {
        ...artifact.evidence.dockerVerifyReleaseTopology,
        packagedFallbackObserved: true,
      },
    },
  };
  const packagedFallbackReadiness = evaluateRestRouteMatrixReadiness({
    routeValidation: validateRouteProofMatrix(productionRouteProofEntries()),
    artifact: packagedFallbackArtifact,
  });

  assert.equal(packagedFallbackReadiness.readyForReleaseMovement, false);
  assert.ok(packagedFallbackReadiness.blockers.includes('packaged-fallback-observed'));
});

test('RPP-0817 evidence remains hash/count/surface only', () => {
  const { report, text } = loadEvidenceReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0817 REST route matrix proof' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.routeReceiptBodiesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.tunnelOutputIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'routeMatrix',
    'topologyCommand',
    'releaseReadyScope',
    'integrationRecommendation',
  ]);
  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel|application_password/i,
  );
});

function loadEvidenceReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0817 evidence must contain one JSON progress report block');
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
    workDir: '/tmp/rpp-0817-docker-work',
    evidenceDir: '/tmp/rpp-0817-docker-evidence',
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

function evaluateRestRouteMatrixReadiness({ routeValidation, artifact }) {
  const blockers = [];
  if (routeValidation.ok !== true) {
    blockers.push('route-matrix-validation-failed');
  }
  if (artifact.status !== 'passed' || artifact.evidence?.dockerVerifyReleaseTopology?.ok !== true) {
    blockers.push('verify-release-topology-not-passed');
  }
  if (artifact.packagedFallback !== false
    || artifact.evidence?.packagedFallback?.observed !== false
    || artifact.evidence?.dockerVerifyReleaseTopology?.packagedFallbackObserved !== false) {
    blockers.push('packaged-fallback-observed');
  }
  const readyForReleaseMovement = blockers.length === 0;
  return {
    readyForReleaseMovement,
    finalReleaseStatus: readyForReleaseMovement ? 'GO' : 'NO-GO',
    primaryBlocker: artifact.prerequisiteProbe?.blocker?.code || blockers[0] || null,
    blockers,
  };
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
    status: artifact.status,
    blockerCode: probe.blocker.code,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    releaseVerifierCommand: artifact.evidence.dockerVerifyReleaseTopology.command,
    packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    routeMatrixHash: report.routeMatrix.routeMatrixHash,
  })}`;
}

function scopeComparisonInput(report) {
  return {
    routeMatrix: report.routeMatrix,
    topologyCommand: report.topologyCommand,
    releaseReadyScope: report.releaseReadyScope,
    integrationRecommendation: report.integrationRecommendation,
  };
}
