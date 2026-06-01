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
  'docs/evidence/rpp-0899-sandbox-8080-ingress-rule-proof-v5.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const rppId = 'RPP-0899';
const proofId = 'rpp-0899-sandbox-8080-ingress-rule-proof-v5';
const variantNumber = 5;
const variant = 'RPP-0899-variant-5';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: rppId,
  variant,
  resource: 'reprint-push-release-state-row',
});
const artifactIdHash = digest({
  rpp: rppId,
  variant,
  artifact: 'sandbox-8080-release-verifier-import-export-survival',
});
const sha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const rpp0899Env = Object.freeze({
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
const validationCommands = Object.freeze([
  'node --check test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js',
  'node --test --test-name-pattern RPP-0899 test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0899-sandbox-8080-ingress-rule-proof-v5.md',
  'git diff --check',
]);
const forbiddenEvidenceTextPattern =
  /https?:\/\/|Bearer\s+|Basic\s+|Set-Cookie|Cookie\s*:|wordpress_logged_in|application[_ -]?password|client[_ -]?secret|access[_ -]?token/i;

test('RPP-0899 support report records sandbox 8080 release-verifier carry-through scope', () => {
  const { report, text } = loadSupportReport();

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
  assert.match(text, /support-only release-verifier carry-through/);
  assert.match(text, /positive branch is a deterministic contract fixture/);

  assert.deepEqual(report.writeScope.allowedFiles, [
    'docs/evidence/rpp-0899-sandbox-8080-ingress-rule-proof-v5.md',
    'test/rpp-0899-sandbox-8080-ingress-rule-proof-v5.test.js',
  ]);
  assert.equal(report.writeScope.progressSurfacesModified, false);
  assert.equal(report.writeScope.checklistFilesModified, false);
  assert.equal(report.writeScope.packageMetadataModified, false);
  assert.equal(report.writeScope.sharedReleaseCodeModified, false);
  assert.equal(report.writeScope.unrelatedTestsOrDocsModified, false);
  assert.equal(report.writeScope.networkListenersStarted, false);
  assert.equal(report.writeScope.remoteTunnelServicesUsed, false);
  assert.equal(report.writeScope.sandboxIngressPort, 8080);

  assert.deepEqual(report.builtOn.closestTemplate, {
    rppId: 'RPP-0879',
    proofId: 'rpp-0879-sandbox-8080-ingress-rule-proof-v4',
    variant: 4,
    usedAsTemplateOnly: true,
  });
  assert.equal(report.builtOn.dockerTopology.rppId, 'RPP-0802');
  assert.equal(report.builtOn.dockerTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.dockerTopology.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.dockerTopology.releaseVerifierCommand, dockerReleaseCommand.join(' '));
  assert.equal(report.builtOn.dockerTopology.publishedIngressPort, 8080);
  assert.equal(report.builtOn.dockerTopology.remoteTunnelServicesAllowed, false);
  assert.deepEqual(report.builtOn.variant5ProductionTopologyPatterns, [
    'RPP-0881-three-site-local-production-topology-v5',
    'RPP-0882-docker-wordpress-topology-v5',
    'RPP-0883-external-wordpress-topology-v5',
    'RPP-0884-brewcommerce-blueprint-import-v5',
  ]);

  assert.deepEqual(report.fixtureArtifactIdentity, {
    fixtureNamespace: variant,
    artifactIdHash,
    pluginDriver,
    pluginOwner,
    pluginResourceKeyHash,
    graphSurfaceCount: requiredGraphSurfaces.length,
    graphSurfaceSetHash: digest([...requiredGraphSurfaces]),
    sameArtifactBindingRequired: true,
  });

  assert.equal(report.sandboxIngressRule.onlySandbox8080Ingress, true);
  assert.equal(report.sandboxIngressRule.publishedHttpIngressCount, 1);
  assert.equal(report.sandboxIngressRule.permittedHostSurface, 'loopback-only');
  assert.equal(report.sandboxIngressRule.permittedPort, 8080);
  assert.equal(report.sandboxIngressRule.publicIngressRejected, true);
  assert.equal(report.sandboxIngressRule.non8080IngressRejected, true);
  assert.equal(report.sandboxIngressRule.multipleHttpIngressRejected, true);
  assert.equal(report.sandboxIngressRule.releaseUrlsUseDockerDns, true);
  assert.equal(report.sandboxIngressRule.networkInternal, true);
  assert.equal(report.sandboxIngressRule.remoteTunnelEvidenceRejected, true);

  assert.deepEqual(report.verifierGuarantees, {
    releaseVerifierCommand: dockerReleaseCommand.join(' '),
    releaseVerifierCarryThroughRequired: true,
    sameArtifactRequired: true,
    productionBackedImportExportRequired: true,
    realWordPressImportExportRequired: true,
    rejectsPublicIngress: true,
    rejectsNon8080Ingress: true,
    rejectsMultipleHttpIngressSurfaces: true,
    rejectsRemoteTunnelEvidence: true,
    rejectsPackagedFallback: true,
    rejectsSplitEvidence: true,
    rejectsMissingRealWordPressImportExport: true,
    acceptedFixtureIsProductionClaim: false,
  });
  assert.deepEqual(report.requiredSurvivalEvidence.requiredGraphTypes, [...requiredGraphSurfaces]);
  assert.deepEqual(report.requiredSurvivalEvidence.requiredGraphSurvival, [...requiredGraphSurvival]);
  assert.equal(report.requiredSurvivalEvidence.requiredPluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(report.productionImportExportEvidence.present, false);
  assert.equal(report.productionImportExportEvidence.blockedReasonCode, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(report.releaseReadyScope.blockers.includes('no-production-backed-import-export-survival-artifact'));
  assert.equal(report.releaseGate.finalReleaseStatus, 'NO-GO');
  assert.deepEqual(report.validationCommands, [...validationCommands]);
  assert.match(report.scopeHash, prefixedSha256Pattern);
  assert.equal(report.scopeHash, sha256Evidence(scopeHashInput(report)));
});

test('RPP-0899 topology command fails closed while preserving 8080-only ingress', () => {
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
    remoteTunnelServicesAllowed: false,
    packagedFallbackAllowed: false,
    releaseVerifierCommand: dockerReleaseCommand.join(' '),
    onlySandbox8080Ingress: true,
    releaseUrlsUseDockerDns: true,
    networkInternal: true,
  });
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));
});

test('RPP-0899 accepts only same-artifact plugin and graph survival under sandbox 8080', () => {
  const accepted = evaluateReleaseVerifierCarryThrough({
    topologyStarted: true,
    topologyPlan: buildBasePlan(),
    evidenceArtifact: successfulReleaseVerifierSurvivalArtifact(),
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.acceptedForReleaseVerifier, true);
  assert.equal(accepted.acceptedForReleaseGate, true);
  assert.equal(accepted.releaseMovementAllowed, false);
  assert.equal(accepted.finalReleaseStatus, 'NO-GO');
  assert.equal(accepted.releasePosture, 'production-backed-artifact-candidate-no-release-movement');
  assert.equal(accepted.topology.sandboxIngressPort, 8080);
  assert.equal(accepted.topology.onlySandbox8080Ingress, true);
  assert.equal(accepted.topology.releaseUrlsUseDockerDns, true);
  assert.equal(accepted.topology.networkInternal, true);
  assert.equal(accepted.releaseVerifier.command, dockerReleaseCommand.join(' '));
  assert.equal(accepted.releaseVerifier.carryThroughAccepted, true);
  assert.equal(accepted.releaseVerifier.packagedFallbackObserved, false);
  assert.equal(accepted.releaseVerifier.remoteTunnelEvidencePresent, false);
  assert.equal(accepted.releaseVerifier.artifactIdHash, artifactIdHash);
  assert.equal(accepted.releaseVerifier.sameArtifactPluginGraphBinding, true);
  assert.equal(accepted.importExport.runtime, 'real-wordpress-import-export');
  assert.equal(accepted.importExport.productionBacked, true);
  assert.equal(accepted.importExport.importObserved, true);
  assert.equal(accepted.importExport.exportObserved, true);
  assert.equal(accepted.importExport.ingressRuleObservedDuringImportExport, true);
  assert.equal(accepted.pluginEvidence.driver, pluginDriver);
  assert.equal(accepted.pluginEvidence.owner, pluginOwner);
  assert.equal(accepted.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(accepted.pluginEvidence.artifactIdHash, artifactIdHash);
  assert.equal(accepted.pluginEvidence.survivedImport, true);
  assert.equal(accepted.pluginEvidence.survivedExport, true);
  assert.deepEqual(accepted.graphEvidence.requiredTypes, [...requiredGraphSurfaces]);
  assert.deepEqual(accepted.graphEvidence.missingTypes, []);
  assert.deepEqual(accepted.graphEvidence.survivedTypes, [...requiredGraphSurfaces]);
  assert.equal(accepted.sameArtifact.pluginAndGraphShareArtifact, true);
  assert.match(accepted.artifactHash, sha256Pattern);
});

test('RPP-0899 rejects public, non-8080, and multiple HTTP ingress surfaces', () => {
  const cases = [
    {
      name: 'public-ingress',
      plan: clonePlanWith((plan) => {
        plan.publishedPorts[0].host = '0.0.0.0';
      }),
      expectedValidationCode: 'NON_LOCAL_OR_NON_8080_PORT',
    },
    {
      name: 'non-8080-ingress',
      plan: clonePlanWith((plan) => {
        plan.publishedPorts[0].hostPort = 8081;
      }),
      expectedValidationCode: 'NON_LOCAL_OR_NON_8080_PORT',
    },
    {
      name: 'multiple-http-ingress-surfaces',
      plan: clonePlanWith((plan) => {
        plan.publishedPorts.push({
          service: 'wp-remote-changed',
          host: '127.0.0.1',
          hostPort: 8080,
          containerPort: 80,
          purpose: 'policy rejection fixture only',
        });
      }),
      expectedValidationCode: 'MULTIPLE_PUBLISHED_HTTP_PORTS',
    },
  ];

  for (const rejection of cases) {
    const evaluated = evaluateReleaseVerifierCarryThrough({
      topologyStarted: true,
      topologyPlan: rejection.plan,
      evidenceArtifact: successfulReleaseVerifierSurvivalArtifact(),
    });

    assert.equal(evaluated.ok, false, rejection.name);
    assert.equal(evaluated.acceptedForReleaseVerifier, false, rejection.name);
    assert.equal(evaluated.acceptedForReleaseGate, false, rejection.name);
    assert.equal(evaluated.releaseMovementAllowed, false, rejection.name);
    assert.ok(evaluated.failures.some((failure) =>
      failure.code === 'SANDBOX_8080_INGRESS_REQUIRED'), rejection.name);
    assert.ok(evaluated.topology.validationFailureCodes.includes(rejection.expectedValidationCode), rejection.name);
  }
});

test('RPP-0899 rejects remote tunnel evidence, packaged fallback, split evidence, and missing real WordPress import/export', () => {
  const remoteTunnelEvidence = successfulReleaseVerifierSurvivalArtifact();
  remoteTunnelEvidence.releaseVerifier.remoteTunnelEvidencePresent = true;

  const packagedFallback = successfulReleaseVerifierSurvivalArtifact();
  packagedFallback.releaseVerifier.status = 'packaged-fallback';
  packagedFallback.releaseVerifier.packagedFallbackObserved = true;
  packagedFallback.releaseVerifier.carryThroughAccepted = false;

  const splitEvidence = successfulReleaseVerifierSurvivalArtifact();
  splitEvidence.pluginEvidence.artifactIdHash = sampleHash('split-plugin-artifact');
  splitEvidence.releaseVerifier.sameArtifactPluginGraphBinding = false;

  const missingRealImportExport = successfulReleaseVerifierSurvivalArtifact();
  missingRealImportExport.runtime = 'local-synthetic-import-export';
  missingRealImportExport.importExport.realWordPress = false;
  missingRealImportExport.importExport.importObserved = false;

  const cases = [
    {
      name: 'remote-tunnel-evidence',
      artifact: remoteTunnelEvidence,
      expectedCodes: ['REMOTE_TUNNEL_EVIDENCE_REJECTED'],
    },
    {
      name: 'packaged-fallback',
      artifact: packagedFallback,
      expectedCodes: ['PACKAGED_FALLBACK_REJECTED', 'RELEASE_VERIFIER_CARRY_THROUGH_MISSING'],
    },
    {
      name: 'split-evidence',
      artifact: splitEvidence,
      expectedCodes: ['PLUGIN_EVIDENCE_ARTIFACT_MISMATCH', 'SPLIT_EVIDENCE_REJECTED'],
    },
    {
      name: 'missing-real-wordpress-import-export',
      artifact: missingRealImportExport,
      expectedCodes: ['REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED', 'WORDPRESS_IMPORT_NOT_OBSERVED'],
    },
    {
      name: 'missing-artifact',
      artifact: null,
      expectedCodes: ['REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING'],
    },
  ];

  for (const rejection of cases) {
    const evaluated = evaluateReleaseVerifierCarryThrough({
      topologyStarted: true,
      topologyPlan: buildBasePlan(),
      evidenceArtifact: rejection.artifact,
    });
    const failureCodes = evaluated.failures.map((failure) => failure.code);

    assert.equal(evaluated.ok, false, rejection.name);
    assert.equal(evaluated.acceptedForReleaseVerifier, false, rejection.name);
    assert.equal(evaluated.acceptedForReleaseGate, false, rejection.name);
    assert.equal(evaluated.releaseMovementAllowed, false, rejection.name);
    for (const expectedCode of rejection.expectedCodes) {
      assert.ok(failureCodes.includes(expectedCode), `${rejection.name} missing ${expectedCode}`);
    }
  }
});

test('RPP-0899 evidence remains deterministic hash/count/surface-only', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0899 sandbox 8080 ingress rule proof v5' }));
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
    surfaceCount: 13,
  });
  assert.deepEqual(report.redaction, {
    format: 'hash-count-surface-only',
    rawUrlValuesIncluded: false,
    rawHostValuesIncluded: false,
    credentialMaterialIncluded: false,
    rawPluginValuesIncluded: false,
    rawGraphValuesIncluded: false,
    tunnelOutputIncluded: false,
    scopeHashCovers: [
      'writeScope',
      'builtOn',
      'fixtureArtifactIdentity',
      'sandboxIngressRule',
      'verifierGuarantees',
      'requiredSurvivalEvidence',
      'topologyCommand',
      'productionImportExportEvidence',
      'releaseReadyScope',
      'releaseGate',
      'integrationRecommendation',
    ],
  });
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.releaseGate.releaseMovementAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /"productionBacked": true|"releaseEligible": true|"finalReleaseStatus": "GO"/);
  assert.doesNotMatch(text, forbiddenEvidenceTextPattern);
  assert.doesNotMatch(text, /"raw"\s*:|"payload"\s*:|"body"\s*:|"content"\s*:|"value"\s*:|"values"\s*:/i);
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0899 evidence must contain one JSON support report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
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
    workDir: '/tmp/rpp-0899-docker-work',
    evidenceDir: '/tmp/rpp-0899-docker-evidence',
    env: rpp0899Env,
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

function evaluateReleaseVerifierCarryThrough({
  topologyStarted = false,
  topologyPlan = null,
  evidenceArtifact = null,
  now = fixedNow,
} = {}) {
  const validation = topologyPlan?.validation || (topologyPlan ? validateTopologyPlan(topologyPlan) : null);
  const observedValidation = validateReleaseVerifierSurvivalArtifact(evidenceArtifact);
  const ingressOk = validation?.ok === true
    && validation.checks?.onePublishedPort === true
    && validation.checks?.onlySandbox8080Ingress === true
    && validation.checks?.internalNetwork === true
    && validation.checks?.releaseUrlsUseDockerDns === true
    && validation.checks?.noTunnelCommands === true
    && validation.checks?.packagedFallbackDisabled === true;
  const failures = [
    ...(topologyStarted ? [] : [{
      code: 'REAL_WORDPRESS_RUNTIME_UNAVAILABLE',
      reason: 'No running Docker or complete external WordPress topology is present.',
    }]),
    ...(ingressOk ? [] : [{
      code: 'SANDBOX_8080_INGRESS_REQUIRED',
      reason: 'The proof must run under exactly one loopback HTTP ingress on port 8080.',
      validationFailureCodes: (validation?.failures || []).map((failure) => failure.code),
    }]),
    ...observedValidation.failures,
  ];
  const accepted = failures.length === 0;

  return {
    event: proofId,
    variant,
    checkedAt: now,
    ok: accepted,
    acceptedForReleaseVerifier: accepted,
    acceptedForReleaseGate: accepted,
    releaseMovementAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    releasePosture: accepted ? 'production-backed-artifact-candidate-no-release-movement' : 'NO-GO',
    topology: {
      started: topologyStarted,
      sandboxIngressPort: 8080,
      publishedHttpIngressCount: topologyPlan?.publishedPorts?.length || 0,
      onlySandbox8080Ingress: ingressOk,
      releaseUrlsUseDockerDns: validation?.checks?.releaseUrlsUseDockerDns === true,
      networkInternal: validation?.checks?.internalNetwork === true,
      remoteTunnelServicesAllowed: false,
      packagedFallbackAllowed: false,
      validationFailureCodes: (validation?.failures || []).map((failure) => failure.code),
    },
    releaseVerifier: observedValidation.releaseVerifier,
    importExport: observedValidation.importExport,
    pluginEvidence: observedValidation.pluginEvidence,
    graphEvidence: observedValidation.graphEvidence,
    sameArtifact: observedValidation.sameArtifact,
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

function validateReleaseVerifierSurvivalArtifact(observed) {
  if (!observed) {
    return {
      releaseVerifier: emptyReleaseVerifier(),
      importExport: emptyImportExport(),
      pluginEvidence: emptyPluginEvidence(),
      graphEvidence: emptyGraphEvidence(),
      sameArtifact: emptySameArtifact(),
      sanitizedArtifact: null,
      failures: [{
        code: 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING',
        reason: 'No real WordPress import/export survival artifact was provided.',
      }],
    };
  }

  const releaseVerifier = observed.releaseVerifier || {};
  const importExport = observed.importExport || {};
  const plugin = observed.pluginEvidence || {};
  const graphEntries = Array.isArray(observed.graphEvidence) ? observed.graphEvidence : [];
  const validArtifactId = isSha256(observed.artifactIdHash) ? observed.artifactIdHash : null;
  const pluginArtifactMatches = plugin.artifactIdHash === observed.artifactIdHash;
  const releaseVerifierArtifactMatches = releaseVerifier.artifactIdHash === observed.artifactIdHash;
  const graphArtifactMismatches = graphEntries
    .filter((entry) => requiredGraphSurfaces.includes(entry?.type) && entry.artifactIdHash !== observed.artifactIdHash)
    .map((entry) => entry.type);
  const survivedGraphTypes = graphEntries
    .filter((entry) =>
      requiredGraphSurfaces.includes(entry?.type)
      && entry.artifactIdHash === observed.artifactIdHash
      && entry.survivedImport === true
      && entry.survivedExport === true
      && isSha256(entry.preconditionHash)
      && isSha256(entry.importedHash)
      && isSha256(entry.exportedHash)
      && isSha256(entry.roundTripHash))
    .map((entry) => entry.type);
  const missingGraphTypes = requiredGraphSurfaces.filter((type) => !survivedGraphTypes.includes(type));
  const failures = [];

  if (!validArtifactId) {
    failures.push({
      code: 'SAME_ARTIFACT_ID_MISSING',
      reason: 'The artifact must include a hash-only same-artifact binding id.',
    });
  }
  if (observed.runtime !== 'real-wordpress-import-export' || importExport.realWordPress !== true) {
    failures.push({
      code: 'REAL_WORDPRESS_IMPORT_EXPORT_REQUIRED',
      reason: 'RPP-0899 requires real WordPress import/export evidence.',
    });
  }
  if (importExport.productionBacked !== true) {
    failures.push({
      code: 'PRODUCTION_BACKED_IMPORT_EXPORT_REQUIRED',
      reason: 'Release verifier acceptance requires production-backed import/export evidence.',
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
    releaseVerifier.command !== dockerReleaseCommand.join(' ')
    || releaseVerifier.status !== 'accepted'
    || releaseVerifier.carryThroughAccepted !== true
  ) {
    failures.push({
      code: 'RELEASE_VERIFIER_CARRY_THROUGH_MISSING',
      reason: 'The release verifier did not accept the same import/export survival artifact.',
    });
  }
  if (releaseVerifier.packagedFallbackObserved === true || releaseVerifier.packagedFallbackAllowed !== false) {
    failures.push({
      code: 'PACKAGED_FALLBACK_REJECTED',
      reason: 'Packaged fallback evidence cannot satisfy RPP-0899.',
    });
  }
  if (releaseVerifier.remoteTunnelEvidencePresent === true || observed.topology?.remoteTunnelEvidencePresent === true) {
    failures.push({
      code: 'REMOTE_TUNNEL_EVIDENCE_REJECTED',
      reason: 'Remote tunnel evidence cannot satisfy the sandbox 8080 ingress rule.',
    });
  }
  if (!releaseVerifierArtifactMatches) {
    failures.push({
      code: 'RELEASE_VERIFIER_ARTIFACT_MISMATCH',
      reason: 'The release verifier is not bound to the import/export artifact id.',
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
  if (!pluginArtifactMatches) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_ARTIFACT_MISMATCH',
      reason: 'Plugin survival evidence is not bound to the same artifact id.',
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
  if (![plugin.preconditionHash, plugin.importedHash, plugin.exportedHash].every(isSha256)) {
    failures.push({
      code: 'PLUGIN_EVIDENCE_HASH_MISSING',
      reason: 'Plugin evidence must include hash-only precondition, import, and export readbacks.',
    });
  }
  if (missingGraphTypes.length > 0) {
    failures.push({
      code: 'GRAPH_EVIDENCE_SURVIVAL_MISSING',
      reason: `Missing graph survival evidence for: ${missingGraphTypes.join(', ')}`,
    });
  }
  if (
    releaseVerifier.sameArtifactPluginGraphBinding !== true
    || !pluginArtifactMatches
    || !releaseVerifierArtifactMatches
    || graphArtifactMismatches.length > 0
  ) {
    failures.push({
      code: 'SPLIT_EVIDENCE_REJECTED',
      reason: 'Plugin, graph, import/export, and release verifier evidence must share one artifact id.',
      graphArtifactMismatches,
    });
  }

  return {
    releaseVerifier: {
      command: releaseVerifier.command || null,
      status: releaseVerifier.status || null,
      carryThroughAccepted: releaseVerifier.carryThroughAccepted === true,
      packagedFallbackAllowed: releaseVerifier.packagedFallbackAllowed === true,
      packagedFallbackObserved: releaseVerifier.packagedFallbackObserved === true,
      remoteTunnelEvidencePresent: releaseVerifier.remoteTunnelEvidencePresent === true,
      artifactIdHash: releaseVerifier.artifactIdHash || null,
      sameArtifactPluginGraphBinding: releaseVerifier.sameArtifactPluginGraphBinding === true,
      reportHash: isSha256(releaseVerifier.reportHash) ? releaseVerifier.reportHash : null,
    },
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
      artifactIdHash: plugin.artifactIdHash || null,
      resourceKeyHash: plugin.resourceKeyHash || null,
      survivedImport: plugin.survivedImport === true,
      survivedExport: plugin.survivedExport === true,
      preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
      importedHash: isSha256(plugin.importedHash) ? plugin.importedHash : null,
      exportedHash: isSha256(plugin.exportedHash) ? plugin.exportedHash : null,
    },
    graphEvidence: {
      requiredTypes: [...requiredGraphSurfaces],
      survivedTypes: survivedGraphTypes,
      missingTypes: missingGraphTypes,
      artifactMismatchTypes: graphArtifactMismatches,
    },
    sameArtifact: {
      artifactIdHash: validArtifactId,
      releaseVerifierMatchesArtifact: releaseVerifierArtifactMatches,
      pluginMatchesArtifact: pluginArtifactMatches,
      graphArtifactMismatchTypes: graphArtifactMismatches,
      pluginAndGraphShareArtifact: failures.every((failure) =>
        ![
          'RELEASE_VERIFIER_ARTIFACT_MISMATCH',
          'PLUGIN_EVIDENCE_ARTIFACT_MISMATCH',
          'SPLIT_EVIDENCE_REJECTED',
        ].includes(failure.code)),
    },
    sanitizedArtifact: {
      artifactIdHash: validArtifactId,
      runtime: observed.runtime || null,
      releaseVerifier: {
        command: releaseVerifier.command || null,
        status: releaseVerifier.status || null,
        carryThroughAccepted: releaseVerifier.carryThroughAccepted === true,
        packagedFallbackAllowed: releaseVerifier.packagedFallbackAllowed === true,
        packagedFallbackObserved: releaseVerifier.packagedFallbackObserved === true,
        remoteTunnelEvidencePresent: releaseVerifier.remoteTunnelEvidencePresent === true,
        artifactIdHash: releaseVerifier.artifactIdHash || null,
        sameArtifactPluginGraphBinding: releaseVerifier.sameArtifactPluginGraphBinding === true,
        reportHash: isSha256(releaseVerifier.reportHash) ? releaseVerifier.reportHash : null,
      },
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
        artifactIdHash: plugin.artifactIdHash || null,
        driver: plugin.driver || null,
        owner: plugin.owner || null,
        resourceKeyHash: plugin.resourceKeyHash || null,
        survivedImport: plugin.survivedImport === true,
        survivedExport: plugin.survivedExport === true,
        preconditionHash: isSha256(plugin.preconditionHash) ? plugin.preconditionHash : null,
        importedHash: isSha256(plugin.importedHash) ? plugin.importedHash : null,
        exportedHash: isSha256(plugin.exportedHash) ? plugin.exportedHash : null,
      },
      graph: graphEntries.map((entry) => ({
        type: entry?.type || null,
        artifactIdHash: entry?.artifactIdHash || null,
        survivedImport: entry?.survivedImport === true,
        survivedExport: entry?.survivedExport === true,
        preconditionHash: isSha256(entry?.preconditionHash) ? entry.preconditionHash : null,
        importedHash: isSha256(entry?.importedHash) ? entry.importedHash : null,
        exportedHash: isSha256(entry?.exportedHash) ? entry.exportedHash : null,
        roundTripHash: isSha256(entry?.roundTripHash) ? entry.roundTripHash : null,
      })),
    },
    failures,
  };
}

function successfulReleaseVerifierSurvivalArtifact() {
  return {
    schemaVersion: 1,
    artifactIdHash,
    runtime: 'real-wordpress-import-export',
    releaseVerifier: {
      command: dockerReleaseCommand.join(' '),
      status: 'accepted',
      carryThroughAccepted: true,
      packagedFallbackAllowed: false,
      packagedFallbackObserved: false,
      remoteTunnelEvidencePresent: false,
      artifactIdHash,
      sameArtifactPluginGraphBinding: true,
      reportHash: sampleHash('release-verifier-report'),
    },
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
      artifactIdHash,
      driver: pluginDriver,
      owner: pluginOwner,
      resourceKeyHash: pluginResourceKeyHash,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash('plugin-precondition'),
      importedHash: sampleHash('plugin-imported'),
      exportedHash: sampleHash('plugin-exported'),
    },
    graphEvidence: requiredGraphSurfaces.map((type) => ({
      type,
      artifactIdHash,
      survivedImport: true,
      survivedExport: true,
      preconditionHash: sampleHash(`${type}-precondition`),
      importedHash: sampleHash(`${type}-imported`),
      exportedHash: sampleHash(`${type}-exported`),
      roundTripHash: sampleHash(`${type}-round-trip`),
    })),
  };
}

function emptyReleaseVerifier() {
  return {
    command: null,
    status: null,
    carryThroughAccepted: false,
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    remoteTunnelEvidencePresent: false,
    artifactIdHash: null,
    sameArtifactPluginGraphBinding: false,
    reportHash: null,
  };
}

function emptyImportExport() {
  return {
    runtime: null,
    realWordPress: false,
    productionBacked: false,
    importObserved: false,
    exportObserved: false,
    ingressRuleObservedDuringImportExport: false,
    importedSnapshotHash: null,
    exportedSnapshotHash: null,
  };
}

function emptyPluginEvidence() {
  return {
    driver: pluginDriver,
    owner: pluginOwner,
    artifactIdHash: null,
    resourceKeyHash: pluginResourceKeyHash,
    survivedImport: false,
    survivedExport: false,
    preconditionHash: null,
    importedHash: null,
    exportedHash: null,
  };
}

function emptyGraphEvidence() {
  return {
    requiredTypes: [...requiredGraphSurfaces],
    survivedTypes: [],
    missingTypes: [...requiredGraphSurfaces],
    artifactMismatchTypes: [],
  };
}

function emptySameArtifact() {
  return {
    artifactIdHash: null,
    releaseVerifierMatchesArtifact: false,
    pluginMatchesArtifact: false,
    graphArtifactMismatchTypes: [],
    pluginAndGraphShareArtifact: false,
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
    sameArtifactBindingRequired: report.fixtureArtifactIdentity.sameArtifactBindingRequired,
    productionBackedRequired: true,
    requiredGraphSurfaces: report.requiredSurvivalEvidence.requiredGraphTypes,
    requiredFor: topologyRequiredFor,
    variant5: true,
  });
}

function scopeHashInput(report) {
  return {
    writeScope: report.writeScope,
    builtOn: report.builtOn,
    fixtureArtifactIdentity: report.fixtureArtifactIdentity,
    sandboxIngressRule: report.sandboxIngressRule,
    verifierGuarantees: report.verifierGuarantees,
    requiredSurvivalEvidence: report.requiredSurvivalEvidence,
    topologyCommand: report.topologyCommand,
    productionImportExportEvidence: report.productionImportExportEvidence,
    releaseReadyScope: report.releaseReadyScope,
    releaseGate: report.releaseGate,
    integrationRecommendation: report.integrationRecommendation,
  };
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
