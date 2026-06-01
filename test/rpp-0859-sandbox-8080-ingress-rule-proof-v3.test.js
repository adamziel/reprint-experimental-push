import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues, findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerReleaseCommand,
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
  validateTopologyPlan,
} from '../scripts/docker/production-complex-site-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0859-sandbox-8080-ingress-rule-proof-v3.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const rppId = 'RPP-0859';
const proofId = 'rpp-0859-sandbox-8080-ingress-rule-proof-v3';
const variantNumber = 3;
const variant = 'RPP-0859-variant-3';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: rppId,
  variant,
  resource: 'reprint-push-release-state-row',
});
const sha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const rpp0859Env = Object.freeze({
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_TAG_TAXONOMY_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF: '1',
});
const requiredGraphSurfaces = Object.freeze([
  'featured-image-attachment',
  'category-term-relationship-termmeta',
  'post-tag-taxonomy-relationship',
  'post-parent-page-closure',
  'comment-parent-commentmeta',
]);
const requiredGraphSurvival = Object.freeze([
  'survived-import',
  'survived-export',
  'round-trip-hash',
]);
const topologyRequiredFor = Object.freeze([
  'docker-wordpress-topology-start',
  'sandbox-8080-ingress-readback',
  'real-wordpress-import-export-cycle',
  'plugin-evidence-import-export-readback',
  'graph-evidence-import-export-readback',
  'release-verifier-acceptance-without-packaged-fallback',
]);
const forbiddenExposurePattern =
  /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel|Bearer\s+|Basic\s+|Cookie\s*:|Set-Cookie|application_password/i;

test('RPP-0859 support report records sandbox 8080 ingress variant 3 scope', () => {
  const { report, text } = loadSupportReport();
  const expected = buildSupportReport();

  assert.deepEqual(report, expected);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, rppId);
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, variantNumber);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.failClosed, true);
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(
    report.successTarget,
    'plugin-and-graph-evidence-survive-real-wordpress-import-export-while-sandbox-8080-ingress-enforced',
  );
  assert.match(text, /Final release posture: `NO-GO`/);
  assert.match(text, /positive branch is a deterministic contract fixture/);

  assert.deepEqual(report.writeScope.allowedFiles, [
    'docs/evidence/rpp-0859-sandbox-8080-ingress-rule-proof-v3.md',
    'test/rpp-0859-sandbox-8080-ingress-rule-proof-v3.test.js',
  ]);
  assert.equal(report.writeScope.progressSurfacesModified, false);
  assert.equal(report.writeScope.releaseGateFilesModified, false);
  assert.equal(report.writeScope.sharedScriptsModified, false);
  assert.equal(report.writeScope.networkListenersStarted, false);
  assert.equal(report.writeScope.remoteTunnelsStarted, false);
  assert.equal(report.writeScope.sandboxIngressPort, 8080);

  assert.equal(report.builtOn.closestTemplate.proofId, 'rpp-0839-sandbox-8080-ingress-rule-proof-v2');
  assert.equal(report.builtOn.closestTemplate.usedAsTemplateOnly, true);
  assert.equal(report.builtOn.dockerTopology.rppId, 'RPP-0802');
  assert.equal(report.builtOn.dockerTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.dockerTopology.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.dockerTopology.releaseVerifierCommand, dockerReleaseCommand.join(' '));
  assert.equal(report.builtOn.dockerTopology.publishedIngressPort, 8080);
  assert.equal(report.builtOn.dockerTopology.remoteTunnelsAllowed, false);

  assert.equal(report.sandboxIngressRule.onlySandbox8080Ingress, true);
  assert.equal(report.sandboxIngressRule.publishedHttpIngressCount, 1);
  assert.equal(report.sandboxIngressRule.permittedHostSurface, 'loopback-only');
  assert.equal(report.sandboxIngressRule.permittedPort, 8080);
  assert.equal(report.sandboxIngressRule.localhostAliasAccepted, true);
  assert.equal(report.sandboxIngressRule.publicHostRejected, true);
  assert.equal(report.sandboxIngressRule.non8080PortRejected, true);
  assert.equal(report.sandboxIngressRule.multiplePublishedPortsRejected, true);
  assert.equal(report.sandboxIngressRule.releaseUrlsUseDockerDns, true);
  assert.equal(report.sandboxIngressRule.networkInternal, true);
  assert.equal(report.sandboxIngressRule.remoteTunnelsAllowed, false);

  const survival = report.candidateScope.importExportSurvivalSurface;
  assert.equal(report.candidateScope.status, 'sandbox-8080-ingress-rule-candidate-v3');
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.topologyShape.siteRoleCount, 4);
  assert.equal(report.candidateScope.topologyShape.onlySandbox8080Ingress, true);
  assert.equal(report.candidateScope.topologyShape.realImportExportObserved, false);
  assert.equal(survival.productionBackedRequired, true);
  assert.deepEqual(survival.requiredPluginEvidence, {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKind: 'plugin-driver-row',
    resourceKeyHash: pluginResourceKeyHash,
    importSurvivalRequired: true,
    exportSurvivalRequired: true,
    livePreconditionHashRequired: true,
  });
  assert.deepEqual(survival.requiredGraphTypes, [...requiredGraphSurfaces]);
  assert.deepEqual(survival.requiredGraphSurvival, [...requiredGraphSurvival]);
  assert.equal(survival.pluginEvidenceSurvivedImportExport, false);
  assert.equal(survival.graphEvidenceSurvivedImportExport, false);
  assert.equal(survival.ingressRuleObservedDuringImportExport, false);
  assert.ok(report.candidateScope.excludedFromCandidate.includes('real-wordpress-import-export-run'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('release-verifier-accepted-ingress-proof'));

  assert.equal(report.productionArtifactAudit.acceptedProductionBackedArtifactPresent, false);
  assert.equal(report.productionArtifactAudit.repositoryRpp0859ProductionArtifactPresent, false);
  assert.equal(report.productionArtifactAudit.claimAllowed, false);
  assert.equal(report.productionImportExportEvidence.present, false);
  assert.equal(report.productionImportExportEvidence.blockedReasonCode, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('sandbox-8080-ingress-readback-from-running-topology'));
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('plugin-driver-evidence-survives-real-wordpress-import-export'));
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('graph-evidence-survives-real-wordpress-import-export'));
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('no-production-backed-import-export-survival-artifact'));
  assert.match(report.scopeComparisonHash, prefixedSha256Pattern);
  assert.equal(report.scopeComparisonHash, sha256Evidence(scopeComparisonInput(report)));
  assert.match(report.proofHash, prefixedSha256Pattern);
  assert.equal(report.proofHash, sha256Evidence(proofHashInput(report)));
});

test('RPP-0859 topology command fails closed while preserving 8080-only ingress', () => {
  const { report } = loadSupportReport();
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);

  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.equal(plan.validation.ok, true);
  assert.equal(plan.validation.checks.onePublishedPort, true);
  assert.equal(plan.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(plan.validation.checks.internalNetwork, true);
  assert.equal(plan.validation.checks.releaseUrlsUseDockerDns, true);
  assert.equal(plan.validation.checks.noTunnelCommands, true);
  assert.equal(plan.validation.checks.packagedFallbackDisabled, true);
  assert.equal(plan.publishedPorts.length, 1);
  assert.equal(plan.publishedPorts[0].host, '127.0.0.1');
  assert.equal(plan.publishedPorts[0].hostPort, 8080);

  assert.equal(artifact.commands.runHarness, report.topologyCommand.command);
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.packagedFallback, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, dockerReleaseCommand.join(' '));
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);

  assert.equal(report.topologyCommand.status, artifact.status);
  assert.equal(report.topologyCommand.siteStartupStatus, 'not-started');
  assert.equal(report.topologyCommand.sitesStarted, false);
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.topologyCommand.releaseMovementAllowed, false);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    capability: 'docker-cli',
    probeCommand: probe.checks.dockerCli.command,
    missingExecutable: true,
    requiredFor: [...topologyRequiredFor],
  });
  assert.deepEqual(report.topologyCommand.publishedIngress, {
    hostSurface: 'loopback-only',
    port: 8080,
    publishedPortCount: 1,
  });
  assert.deepEqual(report.topologyCommand.policy, {
    remoteTunnelsAllowed: false,
    packagedFallbackAllowed: false,
    releaseVerifierCommand: dockerReleaseCommand.join(' '),
    onlySandbox8080Ingress: true,
    releaseUrlsUseDockerDns: true,
    networkInternal: true,
  });
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));
});

test('RPP-0859 accepts survival only with production-backed import/export under sandbox 8080', () => {
  const accepted = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: buildBasePlan().validation,
    observedImportExport: successfulProductionImportExportArtifact(),
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.releaseReady, true);
  assert.equal(accepted.readyForReleaseMovement, true);
  assert.equal(accepted.acceptedForReleaseGate, true);
  assert.equal(accepted.releasePosture, 'candidate-for-review');
  assert.equal(accepted.topology.sandboxIngressPort, 8080);
  assert.equal(accepted.topology.onlySandbox8080Ingress, true);
  assert.equal(accepted.topology.releaseUrlsUseDockerDns, true);
  assert.equal(accepted.topology.networkInternal, true);
  assert.equal(accepted.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(accepted.importExport.productionBacked, true);
  assert.equal(accepted.importExport.importObserved, true);
  assert.equal(accepted.importExport.exportObserved, true);
  assert.equal(accepted.importExport.ingressRuleObservedDuringImportExport, true);
  assert.equal(accepted.pluginEvidence.driver, pluginDriver);
  assert.equal(accepted.pluginEvidence.owner, pluginOwner);
  assert.equal(accepted.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(accepted.pluginEvidence.survivedImport, true);
  assert.equal(accepted.pluginEvidence.survivedExport, true);
  assert.deepEqual(accepted.graphEvidence.requiredTypes, [...requiredGraphSurfaces]);
  assert.deepEqual(accepted.graphEvidence.missingTypes, []);
  assert.deepEqual(accepted.graphEvidence.survivedTypes, [...requiredGraphSurfaces]);
  assert.match(accepted.artifactHash, sha256Pattern);

  const noProductionBacking = successfulProductionImportExportArtifact();
  noProductionBacking.importExport.productionBacked = false;
  const rejectedBacking = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: buildBasePlan().validation,
    observedImportExport: noProductionBacking,
  });
  assert.equal(rejectedBacking.ok, false);
  assert.ok(rejectedBacking.failures.some((failure) =>
    failure.code === 'PRODUCTION_BACKED_IMPORT_EXPORT_REQUIRED'));

  const partial = successfulProductionImportExportArtifact();
  partial.pluginEvidence.survivedExport = false;
  partial.graphEvidence = partial.graphEvidence.filter((entry) =>
    entry.type !== 'post-parent-page-closure');
  const partialSurvival = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: buildBasePlan().validation,
    observedImportExport: partial,
  });
  assert.equal(partialSurvival.ok, false);
  assert.ok(partialSurvival.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(partialSurvival.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(partialSurvival.graphEvidence.missingTypes, ['post-parent-page-closure']);

  const invalidIngressPlan = clonePlanWith((plan) => {
    plan.publishedPorts[0].hostPort = 8081;
  });
  const invalidIngress = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: invalidIngressPlan.validation,
    observedImportExport: successfulProductionImportExportArtifact(),
  });
  assert.equal(invalidIngress.ok, false);
  assert.equal(invalidIngress.releaseReady, false);
  assert.ok(invalidIngress.failures.some((failure) =>
    failure.code === 'SANDBOX_8080_INGRESS_REQUIRED'));
});

test('RPP-0859 ingress validation rejects public, non-8080, and multiple HTTP surfaces', () => {
  const base = buildBasePlan();
  const localhostAlias = buildBasePlan({ inspectionHost: 'localhost' });
  const publicHost = clonePlanWith((plan) => {
    plan.publishedPorts[0].host = '0.0.0.0';
  });
  const non8080 = clonePlanWith((plan) => {
    plan.publishedPorts[0].hostPort = 8081;
  });
  const multiplePorts = clonePlanWith((plan) => {
    plan.publishedPorts.push({
      service: 'wp-remote-changed',
      host: '127.0.0.1',
      hostPort: 8080,
      containerPort: 80,
      purpose: 'policy rejection fixture only',
    });
  });

  assert.equal(base.validation.ok, true);
  assert.equal(base.validation.checks.onlySandbox8080Ingress, true);
  assert.equal(localhostAlias.validation.ok, true);
  assert.equal(localhostAlias.validation.checks.onlySandbox8080Ingress, true);

  assert.equal(publicHost.validation.ok, false);
  assert.ok(publicHost.validation.failures.some((failure) =>
    failure.code === 'NON_LOCAL_OR_NON_8080_PORT'));
  assert.equal(non8080.validation.ok, false);
  assert.ok(non8080.validation.failures.some((failure) =>
    failure.code === 'NON_LOCAL_OR_NON_8080_PORT'));
  assert.equal(multiplePorts.validation.ok, false);
  assert.ok(multiplePorts.validation.failures.some((failure) =>
    failure.code === 'MULTIPLE_PUBLISHED_HTTP_PORTS'));
});

test('RPP-0859 evidence remains deterministic hash/count/surface-only', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(report, buildSupportReport());
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0859 sandbox 8080 ingress rule proof v3' }));
  assert.deepEqual(report.evidenceLimits, {
    mode: 'hash-count-surface-only',
    payloadsStored: false,
    rawPayloadCount: 0,
    rawUrlPayloadsIncluded: false,
    rawHostPayloadsIncluded: false,
    rawPluginPayloadsIncluded: false,
    rawGraphPayloadsIncluded: false,
    credentialMaterialIncluded: false,
    tunnelOutputIncluded: false,
    liveNetworkProbeCount: 0,
    wordpressRouteBodyCount: 0,
    surfaceCount: 11,
  });
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rawPluginValuesIncluded, false);
  assert.equal(report.redaction.rawGraphValuesIncluded, false);
  assert.equal(report.redaction.tunnelOutputIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'writeScope',
    'builtOn',
    'variant3Distinctives',
    'sandboxIngressRule',
    'candidateScope',
    'topologyCommand',
    'productionArtifactAudit',
    'productionImportExportEvidence',
    'releaseReadyScope',
    'releaseGate',
    'integrationRecommendation',
  ]);
  assert.doesNotMatch(JSON.stringify(report), /"productionBacked":true/);
  assert.doesNotMatch(JSON.stringify(report), /"releaseEligible":true/);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, forbiddenExposurePattern);
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0859 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildSupportReport() {
  const { artifact, plan, probe } = buildMissingDockerCapabilityArtifact();
  const localhostAlias = buildBasePlan({ inspectionHost: 'localhost' });
  const publicHostRejected = clonePlanWith((draft) => {
    draft.publishedPorts[0].host = '0.0.0.0';
  });
  const non8080Rejected = clonePlanWith((draft) => {
    draft.publishedPorts[0].hostPort = 8081;
  });
  const multipleRejected = clonePlanWith((draft) => {
    draft.publishedPorts.push({
      service: 'wp-remote-changed',
      host: '127.0.0.1',
      hostPort: 8080,
      containerPort: 80,
      purpose: 'policy rejection fixture only',
    });
  });

  const writeScope = {
    allowedFiles: [
      'docs/evidence/rpp-0859-sandbox-8080-ingress-rule-proof-v3.md',
      'test/rpp-0859-sandbox-8080-ingress-rule-proof-v3.test.js',
    ],
    progressSurfacesModified: false,
    releaseGateFilesModified: false,
    packageMetadataModified: false,
    sharedScriptsModified: false,
    outsideScopeFilesModified: false,
    networkListenersStarted: false,
    remoteTunnelsStarted: false,
    sandboxIngressPort: 8080,
  };
  const variant3Distinctives = {
    closestTemplate: 'RPP-0839 variant 2',
    generatedCoverageVariant: 3,
    deterministicFixtureNamespace: variant,
    supportOnlyUnlessRealTopologyAvailable: true,
    successCriterionEncodedAsReleaseReadyContract: true,
    pluginAndGraphSurvivalClaimObserved: false,
    productionImportExportRequiredForSuccess: true,
  };
  const sandboxIngressRule = {
    status: 'support-only-rule-encoded',
    onlySandbox8080Ingress: plan.validation.checks.onlySandbox8080Ingress,
    publishedHttpIngressCount: plan.publishedPorts.length,
    permittedHostSurface: 'loopback-only',
    permittedPort: plan.publishedPorts[0].hostPort,
    localhostAliasAccepted: localhostAlias.validation.ok,
    publicHostRejected: publicHostRejected.validation.failures.some((failure) =>
      failure.code === 'NON_LOCAL_OR_NON_8080_PORT'),
    non8080PortRejected: non8080Rejected.validation.failures.some((failure) =>
      failure.code === 'NON_LOCAL_OR_NON_8080_PORT'),
    multiplePublishedPortsRejected: multipleRejected.validation.failures.some((failure) =>
      failure.code === 'MULTIPLE_PUBLISHED_HTTP_PORTS'),
    releaseVerifierTraffic: 'docker-service-dns-only',
    releaseUrlsUseDockerDns: plan.validation.checks.releaseUrlsUseDockerDns,
    networkInternal: plan.validation.checks.internalNetwork,
    remoteTunnelsAllowed: false,
    ingressRejectionCodes: [
      'MULTIPLE_PUBLISHED_HTTP_PORTS',
      'NON_LOCAL_OR_NON_8080_PORT',
    ],
    rawUrlValuesIncluded: false,
  };
  const candidateScope = {
    status: 'sandbox-8080-ingress-rule-candidate-v3',
    supportOnly: true,
    failClosed: true,
    productionBacked: false,
    releaseEligible: false,
    releaseGateMovement: 'none',
    sourcePattern: 'rpp-0839-variant-2-template-plus-rpp-0859-variant-3-generated-contract',
    topologyShape: {
      runtime: 'docker-local-wordpress',
      topologyVariant: dockerTopologyVariant,
      siteRoleCount: 4,
      publishedIngressPort: 8080,
      publishedIngressHostSurface: 'loopback-only',
      publishedIngressCount: 1,
      onlySandbox8080Ingress: true,
      releaseUrlsUseDockerDns: true,
      networkInternal: true,
      noTunnelPolicyEnforced: true,
      packagedFallbackDisabled: true,
      graphProofFlags: {
        featuredImageGraph: true,
        taxonomyGraph: true,
        postTagTaxonomyGraph: true,
        postParentGraph: true,
        commentGraph: true,
      },
      realImportExportObserved: false,
    },
    importExportSurvivalSurface: {
      runtimeRequired: 'real-wordpress-import-export',
      productionBackedRequired: true,
      ingressRuleRequired: 'sandbox-8080-only',
      requiredPluginEvidence: {
        driver: pluginDriver,
        owner: pluginOwner,
        resourceKind: 'plugin-driver-row',
        resourceKeyHash: pluginResourceKeyHash,
        importSurvivalRequired: true,
        exportSurvivalRequired: true,
        livePreconditionHashRequired: true,
      },
      requiredGraphTypes: [...requiredGraphSurfaces],
      requiredGraphSurvival: [...requiredGraphSurvival],
      pluginEvidenceSurvivedImportExport: false,
      graphEvidenceSurvivedImportExport: false,
      ingressRuleObservedDuringImportExport: false,
    },
    candidateClaims: [
      'sandbox-8080-ingress-rule-encoded',
      'public-and-non-8080-ingress-fail-closed',
      'variant-3-plugin-and-graph-survival-contract-defined',
      'production-backed-artifact-requirement-recorded',
      'topology-command-exact-unavailable-capability-recorded',
      'hash-count-surface-only-evidence',
    ],
    excludedFromCandidate: [
      'real-wordpress-import-export-run',
      'docker-wordpress-sites-started',
      'plugin-driver-evidence-import-export-readback',
      'graph-evidence-import-export-readback',
      'sandbox-8080-ingress-readback-from-running-topology',
      'production-backed-release-artifact',
      'release-verifier-accepted-ingress-proof',
    ],
  };
  const topologyCommand = {
    command: artifact.commands.runHarness,
    status: artifact.status,
    exitCode: 2,
    siteStartupStatus: 'not-started',
    sitesStarted: false,
    failClosed: true,
    acceptedForReleaseGate: false,
    releaseMovementAllowed: false,
    exactUnavailableCapability: {
      code: probe.blocker.code,
      capability: 'docker-cli',
      probeCommand: probe.checks.dockerCli.command,
      missingExecutable: true,
      requiredFor: [...topologyRequiredFor],
    },
    runtime: 'docker-local-wordpress',
    topologyVariant: dockerTopologyVariant,
    publishedIngress: {
      hostSurface: 'loopback-only',
      port: 8080,
      publishedPortCount: 1,
    },
    policy: {
      remoteTunnelsAllowed: false,
      packagedFallbackAllowed: false,
      releaseVerifierCommand: dockerReleaseCommand.join(' '),
      onlySandbox8080Ingress: true,
      releaseUrlsUseDockerDns: true,
      networkInternal: true,
    },
    artifactHash: topologyArtifactHash({ candidateScope }, artifact, probe),
  };
  const productionArtifactAudit = {
    status: 'no-accepted-production-backed-rpp0859-artifact-found',
    acceptedProductionBackedArtifactPresent: false,
    repositoryRpp0859ProductionArtifactPresent: false,
    actualProductionImportExportReadbackPresent: false,
    claimAllowed: false,
    checkedEvidencePatterns: [
      'rpp-0839-sandbox-8080-ingress-rule-proof-v2',
      'rpp-0842-docker-wordpress-topology-v3',
      'rpp-0843-external-wordpress-topology-v3',
      'rpp-0860-no-tunnel-policy-proof-v3',
    ],
    primaryGapCode: 'PRODUCTION_BACKED_IMPORT_EXPORT_ARTIFACT_MISSING',
  };
  const productionImportExportEvidence = {
    present: false,
    acceptedReleaseEvidence: false,
    productionBacked: false,
    runtime: null,
    importObserved: false,
    exportObserved: false,
    pluginEvidenceSurvivalObserved: false,
    graphEvidenceSurvivalObserved: false,
    ingressRuleObservedDuringImportExport: false,
    blockedReasonCode: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
    exactUnavailableCapability: 'DOCKER_CLI_MISSING',
  };
  const releaseReadyScope = {
    status: 'not-release-ready',
    requiredEvidence: [
      'docker-wordpress-topology-sites-started',
      'sandbox-8080-ingress-readback-from-running-topology',
      'real-wordpress-import-observed',
      'wordpress-export-after-import-observed',
      'production-backed-import-export-survival-artifact',
      'plugin-driver-evidence-survives-real-wordpress-import-export',
      'graph-evidence-survives-real-wordpress-import-export',
      'release-verifier-accepts-run-without-packaged-fallback',
      'artifact-redaction-scan-passes-for-release-reports',
    ],
    blockers: [
      'docker-cli-unavailable-in-this-sandbox',
      'no-running-topology-ingress-readback',
      'no-real-wordpress-import-export-survival-artifact',
      'no-production-backed-import-export-survival-artifact',
      'candidate-does-not-prove-plugin-survival',
      'candidate-does-not-prove-graph-survival',
      'release-gates-not-moved',
    ],
    readyWhen: 'all-required-evidence-passes-with-productionBacked-true-releaseEligible-true-and-onlySandbox8080Ingress-true',
  };
  const releaseGate = {
    acceptedForReleaseGate: false,
    releaseMovementAllowed: false,
    releaseGatesMoved: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
  };
  const reportCore = {
    schemaVersion: 1,
    rppId,
    proofId,
    variant: variantNumber,
    title: 'Sandbox 8080 ingress rule proof support scope variant 3',
    checkedAt: fixedNow,
    status: 'passed-support-only',
    failClosed: true,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    successTarget: 'plugin-and-graph-evidence-survive-real-wordpress-import-export-while-sandbox-8080-ingress-enforced',
    writeScope,
    builtOn: {
      closestTemplate: {
        rppId: 'RPP-0839',
        proofId: 'rpp-0839-sandbox-8080-ingress-rule-proof-v2',
        variant: 2,
        usedAsTemplateOnly: true,
      },
      dockerTopology: {
        rppId: 'RPP-0802',
        topologyVariant: dockerTopologyVariant,
        command: 'npm run verify:release:docker-local-production',
        releaseVerifierCommand: dockerReleaseCommand.join(' '),
        siteRoleCount: 4,
        publishedIngressPort: 8080,
        publishedIngressHost: 'loopback-only',
        releaseVerifierTraffic: 'docker-service-dns-only',
        remoteTunnelsAllowed: false,
        packagedFallbackAllowed: false,
      },
      currentProductionTopologyEvidence: [
        'RPP-0842-docker-wordpress-topology-v3',
        'RPP-0843-external-wordpress-topology-v3',
        'RPP-0861-three-site-local-production-topology-v4',
      ],
    },
    variant3Distinctives,
    progressReport: {
      recordsCandidateVersusReleaseReadyScope: true,
      candidateLabel: 'candidate',
      releaseReadyLabel: 'release-ready',
      percentMovement: 'none',
      finalReleaseReadinessMovement: 'none',
    },
    sandboxIngressRule,
    candidateScope,
    topologyCommand,
    productionArtifactAudit,
    productionImportExportEvidence,
    releaseReadyScope,
    releaseGate,
    evidenceLimits: {
      mode: 'hash-count-surface-only',
      payloadsStored: false,
      rawPayloadCount: 0,
      rawUrlPayloadsIncluded: false,
      rawHostPayloadsIncluded: false,
      rawPluginPayloadsIncluded: false,
      rawGraphPayloadsIncluded: false,
      credentialMaterialIncluded: false,
      tunnelOutputIncluded: false,
      liveNetworkProbeCount: 0,
      wordpressRouteBodyCount: 0,
      surfaceCount: 11,
    },
    redaction: {
      format: 'hash-count-surface-only',
      rawUrlValuesIncluded: false,
      rawHostValuesIncluded: false,
      credentialMaterialIncluded: false,
      rawPluginValuesIncluded: false,
      rawGraphValuesIncluded: false,
      tunnelOutputIncluded: false,
      scopeComparisonHashCovers: [
        'writeScope',
        'builtOn',
        'variant3Distinctives',
        'sandboxIngressRule',
        'candidateScope',
        'topologyCommand',
        'productionArtifactAudit',
        'productionImportExportEvidence',
        'releaseReadyScope',
        'releaseGate',
        'integrationRecommendation',
      ],
    },
  };
  const withScopeHash = {
    ...reportCore,
    scopeComparisonHash: sha256Evidence(scopeComparisonInput(reportCore)),
  };
  return {
    ...withScopeHash,
    proofHash: sha256Evidence(proofHashInput(withScopeHash)),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildBasePlan();
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

function buildBasePlan(options = {}) {
  return buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0859-docker-work',
    evidenceDir: '/tmp/rpp-0859-docker-evidence',
    env: rpp0859Env,
    ...options,
  });
}

function clonePlanWith(mutator) {
  const plan = JSON.parse(JSON.stringify(buildBasePlan()));
  mutator(plan);
  return {
    ...plan,
    validation: validateTopologyPlan(plan),
  };
}

function evaluateSandbox8080ImportExportReadiness({
  topologyStarted = false,
  ingressValidation = null,
  observedImportExport = null,
  now = fixedNow,
} = {}) {
  const observedValidation = validateObservedImportExportSurvival(observedImportExport);
  const ingressOk = ingressValidation?.ok === true
    && ingressValidation.checks?.onePublishedPort === true
    && ingressValidation.checks?.onlySandbox8080Ingress === true
    && ingressValidation.checks?.internalNetwork === true
    && ingressValidation.checks?.releaseUrlsUseDockerDns === true
    && ingressValidation.checks?.noTunnelCommands === true
    && ingressValidation.checks?.packagedFallbackDisabled === true;
  const failures = [
    ...(topologyStarted ? [] : [{
      code: 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE',
      reason: 'No running Docker or complete external WordPress topology is present.',
    }]),
    ...(ingressOk ? [] : [{
      code: 'SANDBOX_8080_INGRESS_REQUIRED',
      reason: 'The import/export proof must run under exactly one loopback HTTP ingress on port 8080.',
      validationFailureCodes: (ingressValidation?.failures || []).map((failure) => failure.code),
    }]),
    ...observedValidation.failures,
  ];
  const releaseReady = failures.length === 0;

  return {
    event: proofId,
    variant,
    checkedAt: now,
    ok: releaseReady,
    releaseReady,
    readyForReleaseMovement: releaseReady,
    acceptedForReleaseGate: releaseReady,
    releasePosture: releaseReady ? 'candidate-for-review' : 'NO-GO',
    topology: {
      started: topologyStarted,
      sandboxIngressPort: 8080,
      onlySandbox8080Ingress: ingressOk,
      releaseUrlsUseDockerDns: ingressValidation?.checks?.releaseUrlsUseDockerDns === true,
      networkInternal: ingressValidation?.checks?.internalNetwork === true,
      remoteTunnelsAllowed: false,
      packagedFallbackAllowed: false,
    },
    importExport: observedValidation.importExport,
    pluginEvidence: observedValidation.pluginEvidence,
    graphEvidence: observedValidation.graphEvidence,
    artifactHash: observedValidation.sanitizedArtifact
      ? digest({
        variant,
        ingressOk,
        artifact: observedValidation.sanitizedArtifact,
      })
      : null,
    failures,
  };
}

function validateObservedImportExportSurvival(observed) {
  if (!observed) {
    return {
      importExport: {
        runtime: null,
        realWordPress: false,
        productionBacked: false,
        importObserved: false,
        exportObserved: false,
        ingressRuleObservedDuringImportExport: false,
      },
      pluginEvidence: emptyPluginEvidence(),
      graphEvidence: emptyGraphEvidence(),
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress import/export survival artifact was provided.',
      }],
    };
  }

  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const survivedGraphTypes = graphEntries
    .filter((entry) =>
      requiredGraphSurfaces.includes(entry?.type)
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.roundTripHash))
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphSurfaces.filter((type) => !survivedGraphTypes.includes(type));
  const failures = [];

  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0859 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
    });
  }
  if (importExport.productionBacked !== true) {
    failures.push({
      code: 'PRODUCTION_BACKED_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0859 release movement requires a production-backed import/export artifact.',
    });
  }
  if (importExport.importObserved !== true) {
    failures.push({
      code: 'WORDPRESS_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show WordPress import completion.',
    });
  }
  if (importExport.exportObserved !== true) {
    failures.push({
      code: 'WORDPRESS_EXPORT_AFTER_IMPORT_NOT_OBSERVED',
      reason: 'The artifact does not show a WordPress export after import.',
    });
  }
  if (importExport.ingressRuleObservedDuringImportExport !== true) {
    failures.push({
      code: 'INGRESS_RULE_NOT_OBSERVED_DURING_IMPORT_EXPORT',
      reason: 'The artifact does not show the sandbox 8080 ingress rule during import/export.',
    });
  }
  if (![importExport.importedSnapshotHash, importExport.exportedSnapshotHash].every(isSha256)) {
    failures.push({
      code: 'IMPORT_EXPORT_HASH_EVIDENCE_MISSING',
      reason: 'The artifact must carry hash-only imported and exported snapshot evidence.',
    });
  }
  if (
    plugin.driver !== pluginDriver
    || plugin.owner !== pluginOwner
    || plugin.resourceKeyHash !== pluginResourceKeyHash
  ) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_DRIVER_MISMATCH',
      reason: 'The artifact does not carry the required plugin-driver evidence.',
    });
  }
  if (plugin.survivedImport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_IMPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after import.',
    });
  }
  if (plugin.survivedExport !== true) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING',
      reason: 'Plugin evidence was not observed after export.',
    });
  }
  if (!isSha256(plugin.preconditionHash)) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_HASH_MISSING',
      reason: 'Plugin evidence must include a hash-only live precondition.',
    });
  }
  if (missingGraphTypes.length > 0) {
    failures.push({
      code: 'GRAPH_EVIDENCE_SURVIVAL_MISSING',
      reason: `Missing graph survival evidence for: ${missingGraphTypes.join(', ')}`,
    });
  }

  return {
    importExport: {
      runtime: observed.runtime || null,
      realWordPress: importExport.realWordPress === true,
      productionBacked: importExport.productionBacked === true,
      importObserved: importExport.importObserved === true,
      exportObserved: importExport.exportObserved === true,
      ingressRuleObservedDuringImportExport: importExport.ingressRuleObservedDuringImportExport === true,
      importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
        ? importExport.importedSnapshotHash
        : null,
      exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
        ? importExport.exportedSnapshotHash
        : null,
    },
    pluginEvidence: {
      driver: plugin.driver || null,
      owner: plugin.owner || null,
      resourceKeyHash: plugin.resourceKeyHash || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
    },
    graphEvidence: {
      requiredTypes: [...requiredGraphSurfaces],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
    },
    sanitizedArtifact: {
      runtime: observed.runtime || null,
      importExport: {
        realWordPress: importExport.realWordPress === true,
        productionBacked: importExport.productionBacked === true,
        importObserved: importExport.importObserved === true,
        exportObserved: importExport.exportObserved === true,
        ingressRuleObservedDuringImportExport: importExport.ingressRuleObservedDuringImportExport === true,
        importedSnapshotHash: isSha256(importExport.importedSnapshotHash)
          ? importExport.importedSnapshotHash
          : null,
        exportedSnapshotHash: isSha256(importExport.exportedSnapshotHash)
          ? importExport.exportedSnapshotHash
          : null,
      },
      plugin: {
        driver: plugin.driver || null,
        owner: plugin.owner || null,
        resourceKeyHash: plugin.resourceKeyHash || null,
        survivedImport: plugin.survivedImport === true,
        survivedExport: plugin.survivedExport === true,
        preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
      },
      graph: graphEntries.map((entry) => ({
        type: entry?.type || null,
        survivedImport: entry?.survivedImport === true,
        survivedExport: entry?.survivedExport === true,
        preconditionHash: isSha256(entry?.preconditionHash) ? entry.preconditionHash : null,
        roundTripHash: isSha256(entry?.roundTripHash) ? entry.roundTripHash : null,
      })),
    },
    failures,
  };
}

function successfulProductionImportExportArtifact() {
  return {
    runtime: 'real-wordpress-import-export',
    importExport: {
      realWordPress: true,
      productionBacked: true,
      importObserved: true,
      exportObserved: true,
      ingressRuleObservedDuringImportExport: true,
      importedSnapshotHash: sampleHash('imported-snapshot'),
      exportedSnapshotHash: sampleHash('exported-snapshot'),
    },
    pluginEvidence: {
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKeyHash: pluginResourceKeyHash,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash('plugin-precondition'),
    },
    graphEvidence: requiredGraphSurfaces.map((type) => ({
      type,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition`),
      roundTripHash: sampleHash(`${type}-round-trip`),
    })),
  };
}

function emptyPluginEvidence() {
  return {
    driver: pluginDriver,
    owner: pluginOwner,
    resourceKeyHash: pluginResourceKeyHash,
    survivedImport: false,
    survivedExport: false,
    preconditionHash: null,
  };
}

function emptyGraphEvidence() {
  return {
    requiredTypes: [...requiredGraphSurfaces],
    survivedTypes: [],
    missingTypes: [...requiredGraphSurfaces],
  };
}

function topologyArtifactHash(report, artifact, probe) {
  return sha256Evidence({
    command: artifact.commands.runHarness,
    status: artifact.status,
    blockerCode: probe.blocker.code,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    hostSurface: 'loopback-only',
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    publishedPortCount: artifact.topology.publishedPorts.length,
    onlySandbox8080Ingress: artifact.topology.validation.checks.onlySandbox8080Ingress,
    releaseUrlsUseDockerDns: artifact.topology.validation.checks.releaseUrlsUseDockerDns,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    productionBackedRequired: true,
    requiredGraphSurfaces: report.candidateScope.importExportSurvivalSurface.requiredGraphTypes,
    requiredFor: topologyRequiredFor,
    variant3: true,
  });
}

function scopeComparisonInput(report) {
  return {
    writeScope: report.writeScope,
    builtOn: report.builtOn,
    variant3Distinctives: report.variant3Distinctives,
    sandboxIngressRule: report.sandboxIngressRule,
    candidateScope: report.candidateScope,
    topologyCommand: report.topologyCommand,
    productionArtifactAudit: report.productionArtifactAudit,
    productionImportExportEvidence: report.productionImportExportEvidence,
    releaseReadyScope: report.releaseReadyScope,
    releaseGate: report.releaseGate,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function proofHashInput(report) {
  const { proofHash, ...withoutProofHash } = report;
  return withoutProofHash;
}

function sampleHash(label) {
  return digest({ rpp: rppId, variant, label });
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function isSha256(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}
