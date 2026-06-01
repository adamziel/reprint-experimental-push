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
  dockerTopologyVariant,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
} from '../scripts/docker/production-complex-site-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0856-plugin-update-hooks-topology-v3.md',
);
const fixedNow = '2026-06-01T00:00:00.000Z';
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;

const pluginUpdateHookSurface = Object.freeze([
  'pre_set_site_transient_update_plugins',
  'upgrader_pre_install',
  'upgrader_post_install',
  'upgrader_process_complete',
  'plugin-version-option-readback',
  'plugin-owned-schema-marker-readback',
]);

const pluginUpdateHookSurfaceDetails = Object.freeze([
  Object.freeze({
    surface: 'updater-transient',
    wordpressSurface: 'pre_set_site_transient_update_plugins',
    requiredProof: 'update-offer-injected-before-upgrader-run',
    releaseReadyStatus: 'required-not-observed',
  }),
  Object.freeze({
    surface: 'pre-install',
    wordpressSurface: 'upgrader_pre_install',
    requiredProof: 'pre-install-callback-observed-through-wordpress-upgrader',
    releaseReadyStatus: 'required-not-observed',
  }),
  Object.freeze({
    surface: 'post-install',
    wordpressSurface: 'upgrader_post_install',
    requiredProof: 'post-install-callback-observed-through-wordpress-upgrader',
    releaseReadyStatus: 'required-not-observed',
  }),
  Object.freeze({
    surface: 'process-complete',
    wordpressSurface: 'upgrader_process_complete',
    requiredProof: 'plugin-update-completion-callback-observed',
    releaseReadyStatus: 'required-not-observed',
  }),
  Object.freeze({
    surface: 'version-readback',
    wordpressSurface: 'plugin-version-option-readback',
    requiredProof: 'pre-update-and-post-update-version-hashes-distinct',
    releaseReadyStatus: 'required-not-observed',
  }),
  Object.freeze({
    surface: 'schema-marker-readback',
    wordpressSurface: 'plugin-owned-schema-marker-readback',
    requiredProof: 'post-update-plugin-owned-schema-marker-hash-readback',
    releaseReadyStatus: 'required-not-observed',
  }),
]);

test('RPP-0856 records plugin update hook topology variant 3 support evidence', () => {
  const { report, text } = loadProgressReport();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0856');
  assert.equal(report.variant, 3);
  assert.equal(report.status, 'passed-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');

  assert.equal(report.builtOn.topologyCommand.command, 'npm run verify:release:docker-local-production');
  assert.equal(
    report.builtOn.topologyCommand.successCriterion,
    'sites-started-or-exact-unavailable-capability-recorded',
  );
  assert.equal(report.builtOn.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.builtOn.topologyCommand.publishedIngressPort, 8080);
  assert.equal(report.builtOn.topologyCommand.remoteTunnelsAllowed, false);
  assert.equal(report.builtOn.topologyCommand.packagedFallbackAllowed, false);
  assert.equal(report.builtOn.pluginUpdateDependencyValidator.rppId, 'RPP-0450');
  assert.equal(report.builtOn.pluginUpdateDependencyValidator.kind, 'plugin-update');
  assert.equal(report.builtOn.pluginUpdateDependencyValidator.dependencyEvidence, 'hash-only');

  assert.deepEqual(report.progressReport, {
    recordsCandidateVersusReleaseReadyScope: true,
    candidateLabel: 'candidate',
    releaseReadyLabel: 'release-ready',
    percentMovement: 'none',
    finalReleaseReadinessMovement: 'none',
  });
  assert.match(text, /## Candidate Scope/);
  assert.match(text, /## Release-Ready Scope/);

  assert.equal(report.candidateScope.status, 'plugin-update-hooks-topology-candidate-v3');
  assert.equal(report.candidateScope.supportOnly, true);
  assert.equal(report.candidateScope.productionBacked, false);
  assert.equal(report.candidateScope.releaseEligible, false);
  assert.equal(report.candidateScope.releaseGateMovement, 'none');
  assert.equal(report.candidateScope.sourcePattern, 'local-support-topology-requirement-record');
  assert.deepEqual(report.candidateScope.variantLineage.precedentRppIds, ['RPP-0816', 'RPP-0836']);
  assert.deepEqual(report.candidateScope.variantLineage.previousVariants, [1, 2]);
  assert.equal(report.candidateScope.variantLineage.unavailableCapabilityPattern, true);
  assert.equal(report.candidateScope.variantLineage.deterministicLocalSupportOnly, true);

  assert.equal(report.candidateScope.hookTopologyRequirements.pluginLifecycle, 'update');
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresWordPressUpdaterRuntime, true);
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresFilesystemWriteAccess, true);
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresActivePluginBeforeUpdate, true);
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresVersionTransitionReadback, true);
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresPostUpdateHookReadback, true);
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresNoPackagedFallback, true);
  assert.equal(report.candidateScope.hookTopologyRequirements.requiresDockerServiceDnsReleaseUrls, true);
  assert.deepEqual(report.candidateScope.hookTopologyRequirements.hookSurface, pluginUpdateHookSurface);
  assert.deepEqual(
    report.candidateScope.hookTopologyRequirements.hookSurfaceDetails,
    pluginUpdateHookSurfaceDetails,
  );
  assert.equal(report.candidateScope.hookTopologyRequirements.candidateHookCount, 6);
  assert.equal(report.candidateScope.hookTopologyRequirements.rawHookPayloadsIncluded, false);

  assert.ok(report.candidateScope.candidateClaims.includes('plugin-update-hook-surface-inventory-recorded'));
  assert.ok(report.candidateScope.candidateClaims.includes('topology-command-startup-or-exact-capability-recorded'));
  assert.ok(report.candidateScope.candidateClaims.includes('variant-3-release-block-contract-recorded'));
  assert.ok(report.candidateScope.candidateClaims.includes('hash-count-surface-only-evidence'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('live-plugin-update-execution'));
  assert.ok(report.candidateScope.excludedFromCandidate.includes('post-update-migration-side-effect-proof'));

  assert.match(report.scopeComparisonHash, hexSha256Pattern);
  assert.equal(report.scopeComparisonHash, digest(scopeComparisonInput(report)));
});

test('RPP-0856 topology command starts sites or records exact unavailable capability', () => {
  const { report } = loadProgressReport();
  const { artifact, probe } = buildMissingDockerCapabilityArtifact();
  const validation = validateReleaseGateArtifact(artifact);

  assert.equal(validation.ok, true);
  assert.equal(artifact.commands.runHarness, 'npm run verify:release:docker-local-production');
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(probe.blocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerLocalProductionProof.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.topology.publishedPorts[0].host, '127.0.0.1');
  assert.equal(artifact.topology.publishedPorts[0].hostPort, 8080);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);

  assert.equal(report.topologyCommand.command, artifact.commands.runHarness);
  assert.equal(
    report.topologyCommand.successCriterion,
    'sites-started-or-exact-unavailable-capability-recorded',
  );
  assert.equal(report.topologyCommand.status, artifact.status);
  assert.equal(report.topologyCommand.siteStartupStatus, 'not-started');
  assert.equal(report.topologyCommand.sitesStarted, false);
  assert.equal(report.topologyCommand.failClosed, true);
  assert.equal(report.topologyCommand.acceptedForReleaseGate, false);
  assert.equal(report.topologyCommand.releaseMovementAllowed, false);
  assert.equal(report.topologyCommand.exitCode, 2);
  assert.deepEqual(report.topologyCommand.exactUnavailableCapability, {
    code: probe.blocker.code,
    capability: 'docker-cli',
    probeCommand: probe.checks.dockerCli.command,
    missingExecutable: probe.checks.dockerCli.missingExecutable,
    requiredFor: [
      'docker-wordpress-topology-sites-started',
      'wordpress-plugin-updater-runtime',
      'plugin-update-hook-surface-readback',
    ],
  });
  assert.equal(
    report.topologyCommand.sitesStarted
      || Boolean(report.topologyCommand.exactUnavailableCapability?.code),
    true,
  );
  assert.equal(report.topologyCommand.runtime, artifact.runtime);
  assert.equal(report.topologyCommand.topologyVariant, dockerTopologyVariant);
  assert.equal(report.topologyCommand.siteRoleCount, 4);
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
    releaseVerifierCommand: 'npm run verify:release',
  });
  assert.equal(report.topologyCommand.statusMarker, artifact.evidence.tmuxStatusMarker.marker);
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.topologyCommand.artifactHash, topologyArtifactHash(report, artifact, probe));
});

test('RPP-0856 release movement stays NO-GO until live update hook proof passes', () => {
  const { report } = loadProgressReport();

  assert.equal(report.releaseReadyScope.status, 'not-release-ready');
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('docker-wordpress-topology-sites-started'),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'wordpress-plugin-updater-runs-update-hooks-on-live-topology',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'post-update-version-and-plugin-owned-schema-marker-hash-readback',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes(
      'verify-release-docker-local-production-passes-without-packaged-fallback',
    ),
  );
  assert.ok(
    report.releaseReadyScope.requiredEvidence.includes('no-packaged-fallback-observed-by-release-verifier'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('docker-cli-unavailable-in-this-sandbox'),
  );
  assert.ok(
    report.releaseReadyScope.blockers.includes('candidate-does-not-execute-live-plugin-update-hooks'),
  );
  assert.equal(report.releaseReadyScope.liveUpdateHookReleaseGate.status, 'not-satisfied');
  assert.equal(report.releaseReadyScope.liveUpdateHookReleaseGate.candidateOnlyReleaseMovement, 'blocked');
  assert.equal(report.releaseReadyScope.liveUpdateHookReleaseGate.packagedFallbackCanSatisfyLiveHookProof, false);
  assert.deepEqual(report.releaseReadyScope.liveUpdateHookReleaseGate.releaseMovementBlockedUntil, [
    'docker-wordpress-topology-sites-started',
    'live-plugin-update-hooks-executed-through-wordpress-upgrader',
    'post-update-hook-side-effects-hash-readback',
    'verify-release-docker-local-production-passes-without-packaged-fallback',
  ]);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.integrationRecommendation, 'NO-GO');
});

test('RPP-0856 invariants reject ambiguous non-started topology reports', () => {
  const { report } = loadProgressReport();
  const ambiguous = {
    ...report,
    topologyCommand: {
      ...report.topologyCommand,
      sitesStarted: false,
      exactUnavailableCapability: null,
    },
  };
  const validation = validatePluginUpdateTopologyVariant3Report(ambiguous);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.some((failure) =>
    failure.code === 'PLUGIN_UPDATE_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT'));
});

test('RPP-0856 evidence remains hash/count/surface only', () => {
  const { report, text } = loadProgressReport();

  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0856 plugin update topology progress report' }));
  assert.equal(report.redaction.format, 'hash-count-surface-only');
  assert.equal(report.redaction.rawHookValuesIncluded, false);
  assert.equal(report.redaction.rawUrlValuesIncluded, false);
  assert.equal(report.redaction.credentialMaterialIncluded, false);
  assert.deepEqual(report.redaction.scopeComparisonHashCovers, [
    'candidateScope',
    'topologyCommand',
    'releaseReadyScope',
    'invariants',
    'integrationRecommendation',
  ]);
  assert.equal(report.candidateScope.hookTopologyRequirements.rawHookPayloadsIncluded, false);
  assert.match(report.topologyCommand.artifactHash, prefixedSha256Pattern);
  assert.equal(report.invariants.topologyCommandStartedSitesOrExactCapabilityRecorded, true);
  assert.equal(report.invariants.packagedFallbackDisabled, true);
  assert.equal(report.invariants.releaseRemainsNoGo, true);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(
    text,
    /ngrok|cloudflared|localtunnel|serveo|localhost\.run|lhr\.life|tailscale funnel/i,
  );
});

function loadProgressReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0856 evidence must contain one JSON progress report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function buildMissingDockerCapabilityArtifact() {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/rpp-0856-docker-work',
    evidenceDir: '/tmp/rpp-0856-docker-evidence',
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

function topologyArtifactHash(report, artifact, probe) {
  return `sha256:${digest({
    command: artifact.commands.runHarness,
    successCriterion: report.topologyCommand.successCriterion,
    status: artifact.status,
    blockerCode: probe.blocker.code,
    capability: report.topologyCommand.exactUnavailableCapability.capability,
    topologyVariant: artifact.evidence.dockerVerifyReleaseTopology.topologyVariant,
    hostPort: artifact.topology.publishedPorts[0].hostPort,
    packagedFallbackAllowed: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed,
    packagedFallbackObserved: artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved,
    releaseMovementAllowed: artifact.releaseGateEvaluation.releaseMovement.allowed,
    hookSurface: report.candidateScope.hookTopologyRequirements.hookSurface,
  })}`;
}

function validatePluginUpdateTopologyVariant3Report(report) {
  const failures = [];
  const topologyCommand = report?.topologyCommand || {};
  const capability = topologyCommand.exactUnavailableCapability || {};

  if (topologyCommand.sitesStarted !== true && !capability.code) {
    failures.push({
      code: 'PLUGIN_UPDATE_TOPOLOGY_UNAVAILABLE_CAPABILITY_NOT_EXACT',
    });
  }

  if (topologyCommand.policy?.packagedFallbackAllowed !== false) {
    failures.push({
      code: 'PLUGIN_UPDATE_TOPOLOGY_PACKAGED_FALLBACK_NOT_DISABLED',
    });
  }

  if (topologyCommand.policy?.onlySandbox8080Ingress !== true) {
    failures.push({
      code: 'PLUGIN_UPDATE_TOPOLOGY_8080_INGRESS_NOT_ENFORCED',
    });
  }

  if (report?.integrationRecommendation !== 'NO-GO') {
    failures.push({
      code: 'PLUGIN_UPDATE_TOPOLOGY_RELEASE_POSTURE_NOT_NO_GO',
    });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function scopeComparisonInput(report) {
  return {
    candidateScope: report.candidateScope,
    topologyCommand: report.topologyCommand,
    releaseReadyScope: report.releaseReadyScope,
    invariants: report.invariants,
    integrationRecommendation: report.integrationRecommendation,
  };
}
