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
  'docs/evidence/rpp-0819-sandbox-8080-ingress-rule-proof-v1.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const proofId = 'rpp-0819-sandbox-8080-ingress-rule-proof-v1';
const variant = 'RPP-0819-variant-1';
const pluginDriver = 'reprint-push-release-state';
const pluginOwner = 'reprint-push';
const pluginResourceKeyHash = digest({
  rpp: 'RPP-0819',
  resource: 'reprint-push-release-state-row',
});
const sha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const rpp0819Env = Object.freeze({
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
const topologyRequiredFor = Object.freeze([
  'docker-wordpress-topology-start',
  'sandbox-8080-ingress-readback',
  'real-wordpress-import-export-cycle',
  'plugin-evidence-import-export-readback',
  'graph-evidence-import-export-readback',
]);

test('RPP-0819 support report records sandbox 8080 ingress and import/export survival scope', () => {
  const { report, text } = loadSupportReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0819');
  assert.equal(report.proofId, proofId);
  assert.equal(report.variant, 1);
  assert.equal(report.title, 'Sandbox 8080 ingress rule proof support scope');
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

  assert.equal(report.builtOn.dockerTopology.rppId, 'RPP-0802');
  assert.equal(report.builtOn.dockerTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.dockerTopology.command, 'npm run verify:release:docker-local-production');
  assert.equal(report.builtOn.dockerTopology.releaseVerifierCommand, dockerReleaseCommand.join(' '));
  assert.equal(report.builtOn.dockerTopology.publishedIngressPort, 8080);
  assert.equal(report.builtOn.dockerTopology.publishedIngressHost, 'loopback-only');
  assert.equal(report.builtOn.dockerTopology.remoteTunnelsAllowed, false);
  assert.equal(report.builtOn.dockerTopology.packagedFallbackAllowed, false);
  assert.equal(report.builtOn.importExportSurvivalContract.rppId, 'RPP-0804');
  assert.equal(report.builtOn.importExportSurvivalContract.requiresRealWordPressImportExport, true);
  assert.equal(report.builtOn.importExportSurvivalContract.requiresPluginAndGraphSurvival, true);

  assert.deepEqual(report.progressReport, {
    recordsCandidateVersusReleaseReadyScope: true,
    candidateLabel: 'candidate',
    releaseReadyLabel: 'release-ready',
    percentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.sandboxIngressRule.status, 'support-only-rule-encoded');
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

  const survival = report.candidateScope.importExportSurvivalSurface;
  assert.equal(report.candidateScope.status, 'sandbox-8080-ingress-rule-candidate');
  assert.equal(report.candidateScope.failClosed, true);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.topologyShape.siteRoleCount, 4);
  assert.equal(report.candidateScope.topologyShape.onlySandbox8080Ingress, true);
  assert.equal(report.candidateScope.topologyShape.releaseUrlsUseDockerDns, true);
  assert.equal(report.candidateScope.topologyShape.networkInternal, true);
  assert.equal(report.candidateScope.topologyShape.realImportExportObserved, false);
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
  assert.equal(survival.pluginEvidenceSurvivedImportExport, false);
  assert.equal(survival.graphEvidenceSurvivedImportExport, false);
  assert.ok(report.candidateScope.excludedFromCandidate.includes('real-wordpress-import-export-run'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('release-verifier-accepted-ingress-proof'));

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('sandbox-8080-ingress-readback-from-running-topology'));
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('plugin-driver-evidence-survives-real-wordpress-import-export'));
  assert.ok(report.releaseReadyScope.requiredEvidence.includes('graph-evidence-survives-real-wordpress-import-export'));
  assert.ok(report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'));
  assert.ok(report.releaseReadyScope.blockers.includes('no-real-wordpress-import-export-survival-artifact'));

  assert.match(report.scopeComparisonHash, sha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0819 topology command fails closed while preserving the 8080-only ingress contract', () => {
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
    probeCommand: probe.checks.dockerCli.command,
    missingExecutable: probe.checks.dockerCli.missingExecutable,
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

  assert.equal(report.productionImportExportEvidence.present, false);
  assert.equal(report.productionImportExportEvidence.acceptedReleaseEvidence, false);
  assert.equal(report.productionImportExportEvidence.ingressRuleObservedDuringImportExport, false);
  assert.equal(report.productionImportExportEvidence.blockedReasonCode, 'REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING');
});

test('RPP-0819 accepts import/export survival only with sandbox 8080 ingress enforced', () => {
  const accepted = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: buildBasePlan().validation,
    observedImportExport: successfulRealImportExportArtifact(),
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
  assert.equal(accepted.importExport.importObserved, true);
  assert.equal(accepted.importExport.exportObserved, true);
  assert.equal(accepted.pluginEvidence.driver, pluginDriver);
  assert.equal(accepted.pluginEvidence.owner, pluginOwner);
  assert.equal(accepted.pluginEvidence.resourceKeyHash, pluginResourceKeyHash);
  assert.equal(accepted.pluginEvidence.survivedImport, true);
  assert.equal(accepted.pluginEvidence.survivedExport, true);
  assert.deepEqual(accepted.graphEvidence.requiredTypes, [...requiredGraphSurfaces]);
  assert.deepEqual(accepted.graphEvidence.missingTypes, []);
  assert.deepEqual(accepted.graphEvidence.survivedTypes, [...requiredGraphSurfaces]);
  assert.match(accepted.artifactHash, sha256Pattern);

  const invalidIngressPlan = clonePlanWith((plan) => {
    plan.publishedPorts[0].hostPort = 8081;
  });
  const invalidIngress = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: invalidIngressPlan.validation,
    observedImportExport: successfulRealImportExportArtifact(),
  });

  assert.equal(invalidIngress.ok, false);
  assert.equal(invalidIngress.releaseReady, false);
  assert.equal(invalidIngress.releasePosture, 'NO-GO');
  assert.ok(invalidIngress.failures.some((failure) =>
    failure.code === 'SANDBOX_8080_INGRESS_REQUIRED'));

  const partial = successfulRealImportExportArtifact();
  partial.pluginEvidence.survivedExport = false;
  partial.graphEvidence = partial.graphEvidence.filter((entry) =>
    entry.type !== 'post-parent-page-closure');
  const partialSurvival = evaluateSandbox8080ImportExportReadiness({
    topologyStarted: true,
    ingressValidation: buildBasePlan().validation,
    observedImportExport: partial,
  });

  assert.equal(partialSurvival.ok, false);
  assert.equal(partialSurvival.releaseReady, false);
  assert.ok(partialSurvival.failures.some((failure) =>
    failure.code === 'PLUGIN_EVIDENCE_EXPORT_SURVIVAL_MISSING'));
  assert.ok(partialSurvival.failures.some((failure) =>
    failure.code === 'GRAPH_EVIDENCE_SURVIVAL_MISSING'));
  assert.deepEqual(partialSurvival.graphEvidence.missingTypes, ['post-parent-page-closure']);
});

test('RPP-0819 ingress validation rejects public, non-8080, and multiple HTTP ingress surfaces', () => {
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

test('RPP-0819 evidence remains deterministic hash/count/surface-only support evidence', () => {
  const { report, text } = loadSupportReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0819 sandbox 8080 ingress rule proof' }));
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
    surfaceCount: 9,
  });
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.rawHostValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.equal(report.redaction.rawPluginValuesIncluded, false);
  assert.equal(report.redaction.rawGraphValuesIncluded, false);
  assert.equal(report.redaction.tunnelOutputIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'sandboxIngressRule',
    'candidateScope',
    'topologyCommand',
    'productionImportExportEvidence',
    'releaseReadyScope',
    'releaseGate',
    'integrationRecommendation',
  ]);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel|Bearer\s+|Basic\s+|Cookie\s*:|Set-Cookie|application_password/i,
  );
});

function loadSupportReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0819 evidence must contain one JSON support report block');
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
    workDir: '/tmp/rpp-0819-docker-work',
    evidenceDir: '/tmp/rpp-0819-docker-evidence',
    env: rpp0819Env,
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
        importObserved: false,
        exportObserved: false,
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
      reason: 'RPP-0819 requires real WordPress import/export, not local Playground or synthetic substitute evidence.',
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
      importObserved: importExport.importObserved === true,
      exportObserved: importExport.exportObserved === true,
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
        importObserved: importExport.importObserved === true,
        exportObserved: importExport.exportObserved === true,
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

function successfulRealImportExportArtifact() {
  return {
    runtime: 'real-wordpress-import-export',
    importExport: {
      realWordPress: true,
      importObserved: true,
      exportObserved: true,
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
  return `sha256:${digest({
    command: artifact.commands.runHarness,
    status: artifact.status,
    blockerCode: probe.blocker.code,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    hostSurface: report.topologyCommand.publishedIngress.hostSurface,
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    publishedPortCount: artifact.topology.publishedPorts.length,
    onlySandbox8080Ingress: artifact.topology.validation.checks.onlySandbox8080Ingress,
    releaseUrlsUseDockerDns: artifact.topology.validation.checks.releaseUrlsUseDockerDns,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    requiredGraphSurfaces: report.candidateScope.importExportSurvivalSurface.requiredGraphTypes,
    requiredFor: report.topologyCommand.exactUnavailableCapability.requiredFor,
  })}`;
}

function scopeComparisonInput(report) {
  return {
    sandboxIngressRule: report.sandboxIngressRule,
    candidateScope: report.candidateScope,
    topologyCommand: report.topologyCommand,
    productionImportExportEvidence: report.productionImportExportEvidence,
    releaseReadyScope: report.releaseReadyScope,
    releaseGate: report.releaseGate,
    integrationRecommendation: report.integrationRecommendation,
  };
}

function sampleHash(label) {
  return digest({ rpp: variant, label });
}

function isSha256(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}
