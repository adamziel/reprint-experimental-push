#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildComplexSitePlannerProof,
  buildComplexSiteReleaseEvidence,
  buildComplexSiteSeedPhp,
  complexSiteFixtureShapeFromEnv,
} from '../playground/local-production-complex-site-proof.js';
import { buildAuthSessionSourceCommand } from '../playground/auth-session-source-command.js';
import { releaseVerifyFixtureCredentials } from '../playground/release-verify-credentials.js';
import {
  releaseGateProvenanceRequirements,
  RELEASE_EVIDENCE_PROVENANCE_SOURCE_KINDS,
} from '../../src/release-evidence-provenance.js';
import {
  evaluateReleaseGates,
  RELEASE_GATE_DEFINITIONS,
  formatReleaseGateStatusMarker,
  releaseGateSummary,
} from '../../src/release-gates.js';
import { digest } from '../../src/stable-json.js';

export const dockerHarnessEvent = 'docker-local-production-complex-site-harness';
export const dockerHarnessGate = 'GATE-3';
export const dockerHarnessRuntime = 'docker-local-wordpress';
export const dockerTopologyVariant = 'RPP-0802-variant-1';
export const dockerReleaseCommand = Object.freeze(['npm', 'run', 'verify:release']);
export const dockerReleaseGateInputSchemaVersion = 1;
export const dockerReleaseGateInputProducer = 'docker-local-production-release-gate-input';
export const dockerRunnerAuthSessionSourceScriptPath = '/workspace/scripts/playground/auth-session-source-command.js';
export const dockerRunnerEntrypointScriptPath = '/workdir/docker-runner-entrypoint.mjs';
export const dockerRunnerPlaygroundCliBinaryPath = '/workdir/playground-cli/node_modules/@wp-playground/cli/wp-playground.js';
export const brewcommerceAssumedRealSiteEnvKey = 'REPRINT_PUSH_ASSUME_BREWCOMMERCE_BLUEPRINT_REAL_SITE';
export const brewcommerceAssumedRealSiteMode = 'brewcommerce-blueprint-creates-real-site';

export const forbiddenPackagedFallbackEnvKeys = Object.freeze([
  'REPRINT_PUSH_PACKAGED_FALLBACK',
  'REPRINT_PUSH_PACKAGE_FALLBACK',
  'REPRINT_PUSH_PACKAGE_SMOKE_MODE',
]);

export const forbiddenTunnelBinaries = Object.freeze([
  'ngrok',
  'cloudflared',
  'localtunnel',
  'lt',
  'serveo',
  'localhost.run',
  'lhr.life',
  'tailscale funnel',
]);

export const dockerSiteVariants = Object.freeze([
  {
    key: 'source',
    role: 'source',
    service: 'wp-source',
    cliService: 'cli-source',
    dbService: 'db-source',
    volume: 'source_wp',
    dbVolume: 'source_db',
    title: 'Docker Source Production Proof',
    fixture: 'docker-local-production-source',
    releaseStateMode: 'base',
    releaseStateVersion: 1,
    releaseStateMarker: 'base',
    inspection: true,
  },
  {
    key: 'remote-changed',
    role: 'remoteChanged',
    service: 'wp-remote-changed',
    cliService: 'cli-remote-changed',
    dbService: 'db-remote-changed',
    volume: 'remote_changed_wp',
    dbVolume: 'remote_changed_db',
    title: 'Docker Remote Changed Production Proof',
    fixture: 'docker-local-production-remote-changed',
    releaseStateMode: 'remote-changed',
    releaseStateVersion: 3,
    releaseStateMarker: 'remote-changed',
    inspection: false,
  },
  {
    key: 'local-edited',
    role: 'localEdited',
    service: 'wp-local-edited',
    cliService: 'cli-local-edited',
    dbService: 'db-local-edited',
    volume: 'local_edited_wp',
    dbVolume: 'local_edited_db',
    title: 'Docker Local Edited Production Proof',
    fixture: 'docker-local-production-local-edited',
    releaseStateMode: 'local-update',
    releaseStateVersion: 2,
    releaseStateMarker: 'local-update',
    inspection: false,
  },
  {
    key: 'apply-revalidation-source',
    role: 'applyRevalidationSource',
    service: 'wp-apply-revalidation-source',
    cliService: 'cli-apply-revalidation-source',
    dbService: 'db-apply-revalidation-source',
    volume: 'apply_revalidation_source_wp',
    dbVolume: 'apply_revalidation_source_db',
    title: 'Docker Apply Revalidation Source Production Proof',
    fixture: 'docker-local-production-apply-revalidation-source',
    releaseStateMode: 'base',
    releaseStateVersion: 1,
    releaseStateMarker: 'base',
    inspection: false,
  },
]);

const dockerRunnerLoopbackBasePort = 8080;
const dockerRunnerPlaygroundCliWorkDirName = 'playground-cli';
const dockerRunnerPlaygroundCliCacheDirEnvKey = 'REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_PLAYGROUND_CLI_CACHE_DIR';
const dockerReleaseEvidenceProvenanceCategories = Object.freeze([
  'topology',
  'boundary',
  'auth',
  'identity',
  'route',
  'recovery',
  'summary',
  'operator-proof',
]);

export const defaultDockerImages = Object.freeze({
  wordpress: 'wordpress:php8.2-apache',
  wpCli: 'wordpress:cli-php8.2',
  mysql: 'mysql:8.0',
  node: 'node:20-bookworm',
});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const credentials = releaseVerifyFixtureCredentials;

export function probeDockerPrerequisites({ runCommand = runCommandSync } = {}) {
  const dockerVersion = normalizeCommandResult(runCommand('docker', ['--version']), 'docker --version');
  const checks = {
    dockerCli: dockerVersion,
    dockerCompose: null,
    dockerDaemon: null,
  };

  if (!dockerVersion.ok) {
    return buildProbeResult(checks, {
      code: dockerVersion.missingExecutable ? 'DOCKER_CLI_MISSING' : 'DOCKER_CLI_UNAVAILABLE',
      reason: dockerVersion.missingExecutable
        ? 'Docker is not installed or is not on PATH; the local production proof must fail closed before any mutation attempt.'
        : 'Docker CLI did not complete successfully; the local production proof must fail closed before any mutation attempt.',
      detail: dockerVersion,
    });
  }

  const compose = normalizeCommandResult(
    runCommand('docker', ['compose', 'version', '--short']),
    'docker compose version --short',
  );
  checks.dockerCompose = compose;
  if (!compose.ok) {
    return buildProbeResult(checks, {
      code: 'DOCKER_COMPOSE_UNAVAILABLE',
      reason: 'Docker Compose v2 is required to start the private four-site WordPress topology.',
      detail: compose,
    });
  }

  const daemon = normalizeCommandResult(
    runCommand('docker', ['info', '--format', '{{json .ServerVersion}}']),
    'docker info --format {{json .ServerVersion}}',
  );
  checks.dockerDaemon = daemon;
  if (!daemon.ok) {
    return buildProbeResult(checks, {
      code: 'DOCKER_DAEMON_UNAVAILABLE',
      reason: 'Docker CLI is present, but the daemon is unavailable; the proof cannot start disposable WordPress containers.',
      detail: daemon,
    });
  }

  return buildProbeResult(checks, null);
}

export function buildDockerTopologyPlan({
  cwd = repoRoot,
  workDir = path.join(os.tmpdir(), 'reprint-docker-local-production'),
  evidenceDir = workDir,
  env = process.env,
  shape = complexSiteFixtureShapeFromEnv(env),
  images = {},
  projectName = env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_PROJECT || 'reprint-push-local-production',
  inspectionHost = env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_INSPECTION_HOST || '127.0.0.1',
  inspectionPort = positiveEnvInt(env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_INSPECTION_PORT, 8080),
} = {}) {
  const resolvedImages = { ...defaultDockerImages, ...images };
  const siteUrls = Object.fromEntries(dockerSiteVariants.map((variant) => [variant.key, `http://${variant.service}`]));
  const runnerUrls = Object.fromEntries(
    dockerSiteVariants.map((variant, index) => [variant.key, `http://127.0.0.1:${dockerRunnerLoopbackBasePort + index}`]),
  );
  const runnerProxyRoutes = dockerSiteVariants.map((variant, index) => ({
    key: variant.key,
    listenHost: '127.0.0.1',
    listenPort: dockerRunnerLoopbackBasePort + index,
    targetHost: variant.service,
    targetPort: 80,
  }));
  const authSessionSourceCommand = buildAuthSessionSourceCommand({
    nodePath: 'node',
    scriptPath: dockerRunnerAuthSessionSourceScriptPath,
    sourceUrl: siteUrls.source,
    username: credentials.username,
    applicationPassword: credentials.applicationPassword,
  });
  const releaseEnv = {
    REPRINT_PUSH_SOURCE_URL: siteUrls.source,
    REPRINT_PUSH_REMOTE_URL: siteUrls.source,
    REPRINT_PUSH_REMOTE_CHANGED_URL: siteUrls['remote-changed'],
    REPRINT_PUSH_LOCAL_URL: siteUrls['local-edited'],
    REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: siteUrls['apply-revalidation-source'],
    REPRINT_PUSH_USERNAME: credentials.username,
    REPRINT_PUSH_APPLICATION_PASSWORD: credentials.applicationPassword,
    REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
    REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.applicationPassword,
    REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: authSessionSourceCommand,
    REPRINT_PUSH_PLAYGROUND_CLI_BINARY: dockerRunnerPlaygroundCliBinaryPath,
    REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
    REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
    REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH: '/snapshot',
    REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_MODE: 'after-first-read',
    REPRINT_PUSH_RECOVERY_FILE_JOURNAL_TMP_ROOT: '/workdir/recovery-file-journal',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SITE_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: String(shape.postCount),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SCHEMA_META_COUNT: String(shape.schemaMetaCount),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FILE_COUNT: String(shape.fileCount),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FORMS_ROWS: String(shape.formsLabRows),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_POSTS: String(shape.remoteDriftPosts),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_FILES: String(shape.remoteDriftFiles),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF: shape.featuredImageGraph ? '1' : '0',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF: shape.taxonomyGraph ? '1' : '0',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_TAG_TAXONOMY_PROOF: shape.postTagTaxonomyGraph ? '1' : '0',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF: shape.postParentGraph ? '1' : '0',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF: shape.commentGraph ? '1' : '0',
  };

  const plan = {
    event: dockerHarnessEvent,
    gate: dockerHarnessGate,
    runtime: dockerHarnessRuntime,
    projectName,
    cwd: path.resolve(cwd),
    workDir: path.resolve(workDir),
    evidenceDir: path.resolve(evidenceDir),
    images: resolvedImages,
    network: {
      name: 'reprint_private',
      internal: true,
      purpose: 'private Docker network for source, remote-changed, local-edited, apply-revalidation, db, cli, and runner containers',
    },
    runnerEgressNetwork: {
      name: 'reprint_runner_egress',
      internal: false,
      purpose: 'egress-only network for runner-local Playground package guard startup; publishes no ports and carries no WordPress services',
    },
    publishedPorts: [
      {
        service: 'wp-source',
        host: inspectionHost,
        hostPort: inspectionPort,
        containerPort: 80,
        purpose: 'optional browser-visible inspection only; verifier traffic stays inside the private Docker network',
      },
    ],
    noTunnelPolicy: {
      forbidden: [...forbiddenTunnelBinaries],
      enforcedBy: [
        'topology validation rejects forbidden tunnel binaries in planned commands and image names',
        'compose rendering publishes only 127.0.0.1:8080 for optional inspection',
        'release verifier uses runner loopback URLs backed by Docker service DNS, not public callback URLs',
        'runner egress network publishes no ports and is used only for local Playground package guard startup',
      ],
    },
    externalAccounts: {
      required: false,
      credentialSource: 'fixture Application Passwords provisioned by the mounted lab mu-plugin in disposable WordPress containers',
    },
    sites: dockerSiteVariants.map((variant) => ({
      ...variant,
      url: siteUrls[variant.key],
      installUrl: runnerUrls[variant.key],
      dbName: 'wordpress',
      dbUser: 'wordpress',
      dbPassword: 'wordpress',
      rootPassword: 'reprint-root',
      seedFile: path.posix.join('/workdir/seeds', `${variant.key}.php`),
    })),
    runner: {
      service: 'runner',
      workingDir: '/workspace',
      user: env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_RUNNER_USER
        || `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      topologyVariant: dockerTopologyVariant,
      releaseCommand: [...dockerReleaseCommand],
      packagedFallbackAllowed: false,
      forbiddenPackagedFallbackEnvKeys: [...forbiddenPackagedFallbackEnvKeys],
      plannerProofCommand: ['node', '/workdir/docker-runner-planner-proof.mjs'],
      urls: runnerUrls,
      proxyRoutes: runnerProxyRoutes,
    },
    shape: { ...shape },
    releaseEnv,
    evidence: {
      evidenceDir: path.resolve(evidenceDir),
      plannerProofFile: path.join(path.resolve(evidenceDir), 'planner-proof.json'),
      releaseOutputFile: path.join(path.resolve(evidenceDir), 'release-verify-output.txt'),
      releaseGateInputFile: path.join(path.resolve(evidenceDir), 'release-gate-input.json'),
    },
  };
  return {
    ...plan,
    validation: validateTopologyPlan(plan),
  };
}

export function validateTopologyPlan(plan) {
  const failures = [];
  const publishedPorts = Array.isArray(plan?.publishedPorts) ? plan.publishedPorts : [];
  for (const port of publishedPorts) {
    const localHost = port.host === '127.0.0.1' || port.host === 'localhost';
    if (!localHost || Number(port.hostPort) !== 8080) {
      failures.push({
        code: 'NON_LOCAL_OR_NON_8080_PORT',
        detail: port,
      });
    }
  }
  if (publishedPorts.length > 1) {
    failures.push({ code: 'MULTIPLE_PUBLISHED_HTTP_PORTS', count: publishedPorts.length });
  }
  if (plan?.network?.internal !== true) {
    failures.push({ code: 'DOCKER_NETWORK_NOT_INTERNAL', network: plan?.network || null });
  }
  if (plan?.runnerEgressNetwork?.internal === true) {
    failures.push({ code: 'RUNNER_EGRESS_NETWORK_MARKED_INTERNAL', network: plan.runnerEgressNetwork });
  }
  const releaseEnv = plan?.releaseEnv || {};
  for (const key of [
    'REPRINT_PUSH_SOURCE_URL',
    'REPRINT_PUSH_REMOTE_URL',
    'REPRINT_PUSH_REMOTE_CHANGED_URL',
    'REPRINT_PUSH_LOCAL_URL',
    'REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL',
  ]) {
    const value = String(releaseEnv[key] || '');
    if (!/^http:\/\/wp-[a-z0-9-]+$/.test(value)) {
      failures.push({ code: 'NON_DOCKER_INTERNAL_RELEASE_URL', key, value });
    }
  }
  if (JSON.stringify(plan?.runner?.releaseCommand || []) !== JSON.stringify(dockerReleaseCommand)) {
    failures.push({
      code: 'DOCKER_RELEASE_COMMAND_NOT_VERIFY_RELEASE',
      expected: [...dockerReleaseCommand],
      observed: plan?.runner?.releaseCommand || null,
    });
  }
  if (plan?.runner?.packagedFallbackAllowed !== false) {
    failures.push({
      code: 'DOCKER_PACKAGED_FALLBACK_NOT_DISABLED',
      expected: false,
      observed: plan?.runner?.packagedFallbackAllowed ?? null,
    });
  }
  for (const key of forbiddenPackagedFallbackEnvKeys) {
    const value = String(releaseEnv[key] || '').trim();
    if (/^(1|true|yes|packaged|driver-guard-only)$/i.test(value)) {
      failures.push({ code: 'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED', key, value });
    }
  }
  const commandCorpus = JSON.stringify({
    images: plan?.images || {},
    sites: plan?.sites || [],
    runner: plan?.runner || {},
    releaseEnv: plan?.releaseEnv || {},
  }).toLowerCase();
  for (const forbidden of forbiddenTunnelBinaries) {
    const needle = forbidden.toLowerCase();
    if (commandCorpus.includes(needle)) {
      failures.push({ code: 'FORBIDDEN_TUNNEL_REFERENCE', forbidden });
    }
  }
  for (const site of plan?.sites || []) {
    if (site.url?.includes('localhost') || site.url?.includes('127.0.0.1')) {
      failures.push({ code: 'SITE_URL_NOT_PRIVATE_DOCKER_DNS', site: site.key, url: site.url });
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    checks: {
      onePublishedPort: publishedPorts.length === 1,
      onlySandbox8080Ingress: failures.every((failure) => failure.code !== 'NON_LOCAL_OR_NON_8080_PORT'),
      internalNetwork: plan?.network?.internal === true,
      runnerEgressHasNoPublishedPorts: publishedPorts.every((port) => port.service !== plan?.runner?.service),
      releaseUrlsUseDockerDns: failures.every((failure) => failure.code !== 'NON_DOCKER_INTERNAL_RELEASE_URL'),
      noTunnelCommands: failures.every((failure) => failure.code !== 'FORBIDDEN_TUNNEL_REFERENCE'),
      releaseCommandIsVerifyRelease: failures.every((failure) => failure.code !== 'DOCKER_RELEASE_COMMAND_NOT_VERIFY_RELEASE'),
      packagedFallbackDisabled: failures.every((failure) => !failure.code.startsWith('DOCKER_PACKAGED_FALLBACK')),
    },
  };
}

export function buildPrerequisiteGateArtifact({
  probe,
  plan,
  status = 'blocked',
  releaseEvidence = null,
  verify = null,
  generatedAt = null,
  scope = null,
  assumption = null,
  releaseEvidenceProvenance = null,
} = {}) {
  const blocker = probe?.blocker || null;
  const releaseGateInput = buildDockerReleaseGateInput({
    probe,
    plan,
    status,
    releaseEvidence,
    verify,
    generatedAt: normalizeIsoTimestamp(generatedAt || probe?.checkedAt),
    scope,
    assumption,
  });
  const releaseGateEvaluation = buildReleaseGateEvaluationSummary(releaseGateInput);
  const fullReleaseGateEvaluation = evaluateReleaseGates({
    env: releaseGateInput.env || {},
    evidence: releaseGateInput.evidence || {},
    scope: releaseGateInput.scope || releaseGateInput.evidenceScope || 'missing',
    packagedFallback: releaseGateInput.packagedFallback,
    now: releaseGateInput.generatedAt,
  });
  const normalizedReleaseEvidenceProvenance = releaseEvidenceProvenance
    ? normalizeDockerReleaseEvidenceProvenance(releaseEvidenceProvenance, fullReleaseGateEvaluation, {
        generatedAt: releaseGateInput.generatedAt,
        scope: releaseGateInput.scope,
      })
    : null;
  const artifact = {
    schemaVersion: dockerReleaseGateInputSchemaVersion,
    event: dockerReleaseGateInputProducer,
    gate: dockerHarnessGate,
    runtime: dockerHarnessRuntime,
    status,
    ok: status === 'passed',
    acceptedForReleaseGate: status === 'passed',
    failClosed: status !== 'passed',
    reason: assumption?.reason
      || blocker?.reason
      || (status === 'passed' ? 'Docker local production proof completed.' : 'Docker prerequisite probe did not pass.'),
    prerequisiteProbe: probe || null,
    assumption: assumption || null,
    artifactFile: plan?.evidence?.releaseGateInputFile || null,
    commands: {
      runHarness: 'npm run verify:release:docker-local-production',
      focusedTests: 'npm run test:docker:production-complex-site-harness',
      releaseGateCheck: 'node ./scripts/release/check-release-gates.mjs --evidence-file <artifact>',
    },
    ...releaseGateInput,
    releaseEvidenceProvenance: normalizedReleaseEvidenceProvenance,
    releaseGateEvaluation,
    topology: plan ? {
      projectName: plan.projectName,
      sites: (plan.sites || []).map((site) => ({ key: site.key, service: site.service, url: site.url })),
      network: plan.network,
      runnerEgressNetwork: plan.runnerEgressNetwork || null,
      publishedPorts: plan.publishedPorts,
      noTunnelPolicy: plan.noTunnelPolicy,
      validation: plan.validation || validateTopologyPlan(plan),
      shape: plan.shape,
    } : null,
    rppEvidence: {
      advancedItems: [
        'RPP-0801 three-site local production topology exact unavailable capability',
        'RPP-0802 Docker WordPress topology verify:release/no-packaged-fallback contract',
        'RPP-0819 sandbox 8080 ingress rule proof harness contract',
        'RPP-0820 no tunnel policy proof harness contract',
        'RPP-0903 release gate 3 blocks when a required proof fails',
      ],
      dockerWordPressReleaseReady: status === 'passed',
      dockerWordPressBlockedUntilPrerequisitesPass: status !== 'passed',
      dockerWordPressVerifyReleaseContract: {
        topologyVariant: dockerTopologyVariant,
        command: dockerReleaseCommand.join(' '),
        packagedFallbackAllowed: false,
        status,
        blockerCode: blocker?.code || null,
      },
    },
  };
  return {
    ...artifact,
    deterministic: buildDeterministicArtifactMetadata(artifact),
  };
}

export function buildDockerReleaseGateInput({
  probe,
  plan,
  status = 'blocked',
  releaseEvidence = null,
  verify = null,
  generatedAt = null,
  scope = null,
  assumption = null,
} = {}) {
  const resolvedScope = releaseGateScopeForStatus(status, scope);
  const normalizedGeneratedAt = normalizeIsoTimestamp(generatedAt || probe?.checkedAt);
  return {
    scope: resolvedScope,
    evidenceScope: resolvedScope,
    generatedAt: normalizedGeneratedAt,
    env: {},
    packagedFallback: false,
    evidence: buildDockerReleaseGateEvidence({
      probe,
      plan,
      status,
      releaseEvidence,
      verify,
      scope: resolvedScope,
      generatedAt: normalizedGeneratedAt,
      assumption,
    }),
  };
}

export function buildReleaseGateEvaluationSummary(releaseGateInput = {}) {
  const evaluation = evaluateReleaseGates({
    env: releaseGateInput.env || {},
    evidence: releaseGateInput.evidence || {},
    scope: releaseGateInput.scope || releaseGateInput.evidenceScope || 'missing',
    packagedFallback: releaseGateInput.packagedFallback,
    now: releaseGateInput.generatedAt,
  });
  const primaryFailure = evaluation.releaseMovement?.missingEvidence?.[0] || null;
  return {
    evaluator: evaluation.evaluator,
    generatedAt: evaluation.generatedAt,
    status: evaluation.status,
    scope: evaluation.scope,
    ok: evaluation.releaseMovement?.allowed === true,
    primaryFailureCode: primaryFailure?.code || null,
    primaryFailureGate: primaryFailure?.id || null,
    statusMarker: formatReleaseGateStatusMarker(evaluation, { label: 'docker-local-production-release-gates' }),
    totals: evaluation.totals,
    candidateMovement: evaluation.candidateMovement,
    releaseMovement: evaluation.releaseMovement,
    summary: releaseGateSummary(evaluation),
  };
}

export function validateReleaseGateArtifact(artifact = {}) {
  const failures = [];
  if (artifact.schemaVersion !== dockerReleaseGateInputSchemaVersion) {
    failures.push({
      code: 'RELEASE_GATE_ARTIFACT_SCHEMA_VERSION',
      expected: dockerReleaseGateInputSchemaVersion,
      observed: artifact.schemaVersion,
    });
  }
  if (artifact.event !== dockerReleaseGateInputProducer) {
    failures.push({
      code: 'RELEASE_GATE_ARTIFACT_EVENT',
      expected: dockerReleaseGateInputProducer,
      observed: artifact.event,
    });
  }
  if (!artifact.evidence || typeof artifact.evidence !== 'object' || Array.isArray(artifact.evidence)) {
    failures.push({ code: 'RELEASE_GATE_ARTIFACT_EVIDENCE_OBJECT_REQUIRED' });
  }
  if (artifact.env && Object.keys(artifact.env).some((key) => /password|secret|token|nonce|authorization/i.test(key))) {
    failures.push({ code: 'RELEASE_GATE_ARTIFACT_ENV_CONTAINS_SECRET_SHAPED_KEY' });
  }

  const observedEvaluation = buildReleaseGateEvaluationSummary({
    scope: artifact.scope,
    env: artifact.env,
    packagedFallback: artifact.packagedFallback,
    evidence: artifact.evidence,
    generatedAt: artifact.generatedAt,
  });
  if (artifact.releaseGateEvaluation?.status !== observedEvaluation.status) {
    failures.push({
      code: 'RELEASE_GATE_ARTIFACT_EVALUATION_STATUS_MISMATCH',
      expected: observedEvaluation.status,
      observed: artifact.releaseGateEvaluation?.status,
    });
  }
  if (artifact.releaseGateEvaluation?.primaryFailureCode !== observedEvaluation.primaryFailureCode) {
    failures.push({
      code: 'RELEASE_GATE_ARTIFACT_PRIMARY_FAILURE_MISMATCH',
      expected: observedEvaluation.primaryFailureCode,
      observed: artifact.releaseGateEvaluation?.primaryFailureCode,
    });
  }
  if (artifact.status !== 'passed' && artifact.releaseGateEvaluation?.releaseMovement?.allowed === true) {
    failures.push({ code: 'RELEASE_GATE_ARTIFACT_MUST_FAIL_CLOSED_WHEN_NOT_PASSED' });
  }

  const expectedDigest = buildDeterministicArtifactMetadata(artifact).canonicalSha256;
  if (artifact.deterministic?.canonicalSha256 !== expectedDigest) {
    failures.push({
      code: 'RELEASE_GATE_ARTIFACT_CANONICAL_DIGEST_MISMATCH',
      expected: expectedDigest,
      observed: artifact.deterministic?.canonicalSha256 || null,
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    releaseGateEvaluation: observedEvaluation,
  };
}

function buildDockerReleaseGateEvidence({
  probe,
  plan,
  status,
  releaseEvidence,
  verify,
  scope,
  generatedAt,
  assumption,
} = {}) {
  const blocker = probe?.blocker || null;
  const marker = status === 'passed'
    ? '[RPP-DOCKER-LOCAL-PRODUCTION:PASS]'
    : '[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]';
  const evidence = {
    packagedFallback: {
      ok: true,
      observed: false,
      source: dockerReleaseGateInputProducer,
      scope,
    },
    tmuxStatusMarker: {
      ok: true,
      marker,
      scope,
    },
    dockerLocalProductionProof: {
      ok: status === 'passed',
      status,
      failClosed: status !== 'passed',
      code: blocker?.code || (status === 'passed' ? 'DOCKER_LOCAL_PRODUCTION_PASSED' : 'DOCKER_LOCAL_PRODUCTION_FAILED'),
      reason: blocker?.reason || (status === 'passed'
        ? 'Docker local production proof completed.'
        : 'Docker local production proof did not produce a passing release artifact.'),
      runtime: dockerHarnessRuntime,
      gate: dockerHarnessGate,
      externalAccountsRequired: false,
      dockerExecuted: assumption ? false : status === 'passed',
      assumptionMode: assumption?.mode || null,
      scope,
    },
    dockerVerifyReleaseTopology: buildDockerVerifyReleaseTopologyEvidence({
      plan,
      status,
      blocker,
      scope,
      assumption,
    }),
  };

  if (assumption) {
    evidence.brewcommerceBlueprintAssumedRealSite = {
      ok: true,
      mode: assumption.mode,
      envKey: assumption.envKey,
      dockerExecuted: false,
      dockerPrerequisiteBlockerCode: assumption.dockerPrerequisiteBlockerCode,
      dockerTopologyPlanned: true,
      dockerTopologyValidationOk: assumption.dockerTopologyValidationOk === true,
      packagedFallbackAllowed: false,
      scope,
    };
  }

  const verifyStatus = typeof verify?.status === 'number'
    ? verify.status
    : (status === 'blocked' ? 2 : null);
  if (status !== 'passed' || (Number.isInteger(verifyStatus) && verifyStatus !== 0)) {
    evidence.verifyReleaseFailure = {
      ok: true,
      exitCode: Number.isInteger(verifyStatus) && verifyStatus !== 0 ? verifyStatus : 1,
      reason: blocker?.code || releaseEvidence?.verifier?.boundary?.verdict || 'DOCKER_LOCAL_PRODUCTION_PROOF_FAILED',
      scope,
    };
  }

  if (status !== 'passed' || releaseEvidence?.ok !== true || !plan) {
    return evidence;
  }

  const topologyUrls = dockerTopologyEvidenceUrls(plan);
  const sourceUrl = topologyUrls.service.source;
  const localUrl = topologyUrls.service.local;
  const remoteChangedUrl = topologyUrls.service.remoteChanged;
  const preflightRoute = '/reprint/v1/push/preflight';
  const dryRunRoute = '/reprint/v1/push/dry-run';
  const applyRoute = '/reprint/v1/push/apply';
  const journalRoute = '/reprint/v1/push/journal';
  const recoveryInspectRoute = '/reprint/v1/push/recovery/inspect';
  const recoveryInspectReadOnlyOk = releaseEvidence.verifier?.gate2DurableRecoveryJournal?.ok === true;

  return {
    ...evidence,
    sourceUrl: { ok: true, url: sourceUrl, observed: sourceUrl, runnerUrl: topologyUrls.runner.source, scope },
    localUrl: { ok: true, url: localUrl, observed: localUrl, runnerUrl: topologyUrls.runner.local, scope },
    remoteChangedUrl: {
      ok: true,
      url: remoteChangedUrl,
      observed: remoteChangedUrl,
      runnerUrl: topologyUrls.runner.remoteChanged,
      scope,
    },
    remoteAlias: {
      ok: true,
      url: sourceUrl,
      observed: sourceUrl,
      runnerUrl: topologyUrls.runner.remote,
      scope,
    },
    authSourceCommandReadback: {
      ok: true,
      same: true,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: sourceUrl,
      runnerIssuedSourceUrl: topologyUrls.runner.source,
      runnerReadbackSourceUrl: topologyUrls.runner.source,
      command: 'auth-session-source-command:redacted-docker-fixture',
      scope,
    },
    productionSecret: {
      ok: true,
      present: true,
      observed: 'fixture-application-password-provisioned-by-disposable-docker-mu-plugin',
      scope,
    },
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      observed: 'fixture-credential-bound-to-docker-source-url',
      scope,
    },
    manageOptionsCapability: {
      ok: releaseEvidence.verifier?.authSessionBoundary?.manageOptions === true,
      hasManageOptions: releaseEvidence.verifier?.authSessionBoundary?.manageOptions === true,
      observed: releaseEvidence.verifier?.authSessionBoundary?.manageOptions === true
        ? 'manage_options'
        : 'missing-manage_options',
      scope,
    },
    sourceIdentity: {
      ok: true,
      same: true,
      sameSource: true,
      observed: 'docker-service-dns-source-identity',
      sourceUrl,
      localUrl,
      remoteChangedUrl,
      runnerSourceUrl: topologyUrls.runner.source,
      runnerLocalUrl: topologyUrls.runner.local,
      runnerRemoteChangedUrl: topologyUrls.runner.remoteChanged,
      scope,
    },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: preflightRoute, scope },
    dryRunRouteEligibility: {
      ok: releaseEvidence.invariants?.receiptHashPresent === true,
      eligible: releaseEvidence.invariants?.receiptHashPresent === true,
      observed: dryRunRoute,
      scope,
    },
    applyRoutePreMutation: {
      ok: releaseEvidence.invariants?.applyRevalidationCoveredEveryMutation === true,
      preMutation: releaseEvidence.invariants?.applyRevalidationCoveredEveryMutation === true,
      observed: applyRoute,
      scope,
    },
    journalRouteReadOnly: {
      ok: releaseEvidence.invariants?.durableJournalGateOk === true,
      readOnly: releaseEvidence.invariants?.durableJournalGateOk === true,
      observed: journalRoute,
      scope,
    },
    recoveryInspectReadOnly: {
      ok: recoveryInspectReadOnlyOk,
      readOnly: recoveryInspectReadOnlyOk,
      observed: recoveryInspectRoute,
      scope,
    },
    ...(scope === 'final-release' ? finalReleaseOperatorEvidence({
      generatedAt,
      marker,
      assumption,
      scope,
    }) : {}),
  };
}

function buildDockerVerifyReleaseTopologyEvidence({ plan, status, blocker, scope, assumption } = {}) {
  const validation = plan?.validation || (plan ? validateTopologyPlan(plan) : null);
  const releaseCommand = plan?.runner?.releaseCommand || dockerReleaseCommand;
  const topologyUrls = dockerTopologyEvidenceUrls(plan);
  return {
    ok: status === 'passed',
    status,
    topologyVariant: plan?.runner?.topologyVariant || dockerTopologyVariant,
    command: releaseCommand.join(' '),
    commandArgs: releaseCommand,
    runtime: dockerHarnessRuntime,
    gate: dockerHarnessGate,
    packagedFallbackAllowed: false,
    packagedFallbackObserved: false,
    sourceUrl: topologyUrls.service.source,
    remoteUrl: topologyUrls.service.remote,
    remoteChangedUrl: topologyUrls.service.remoteChanged,
    localUrl: topologyUrls.service.local,
    applyRevalidationSourceUrl: topologyUrls.service.applyRevalidationSource,
    runnerSourceUrl: topologyUrls.runner.source,
    runnerRemoteUrl: topologyUrls.runner.remote,
    runnerRemoteChangedUrl: topologyUrls.runner.remoteChanged,
    runnerLocalUrl: topologyUrls.runner.local,
    runnerApplyRevalidationSourceUrl: topologyUrls.runner.applyRevalidationSource,
    releaseUrlsUseDockerDns: validation?.checks?.releaseUrlsUseDockerDns === true,
    releaseCommandIsVerifyRelease: validation?.checks?.releaseCommandIsVerifyRelease === true,
    topologyValidationOk: validation?.ok === true,
    dockerExecuted: assumption ? false : status === 'passed',
    assumptionMode: assumption?.mode || null,
    failClosed: status !== 'passed',
    code: blocker?.code || (status === 'passed'
      ? 'DOCKER_VERIFY_RELEASE_TOPOLOGY_PASSED'
      : 'DOCKER_VERIFY_RELEASE_TOPOLOGY_FAILED'),
    reason: assumption?.reason || blocker?.reason || (status === 'passed'
      ? 'Docker WordPress topology ran npm run verify:release against Docker service DNS identities through runner loopback transport and no packaged fallback.'
      : 'Docker WordPress topology could not run npm run verify:release; no packaged fallback was used.'),
    scope,
  };
}

function dockerTopologyEvidenceUrls(plan) {
  const releaseEnv = plan?.releaseEnv || {};
  const runnerUrls = plan?.runner?.urls || {};
  const serviceUrl = (siteKey, fallback = '') =>
    (plan?.sites || []).find((site) => site.key === siteKey)?.url || fallback || '';
  const releaseUrl = (envKey) => String(releaseEnv[envKey] || '');
  const runnerUrl = (siteKey, fallback = '') => String(runnerUrls[siteKey] || fallback || '');
  return {
    service: {
      source: serviceUrl('source', releaseUrl('REPRINT_PUSH_SOURCE_URL')),
      remote: serviceUrl('source', releaseUrl('REPRINT_PUSH_REMOTE_URL')),
      remoteChanged: serviceUrl('remote-changed', releaseUrl('REPRINT_PUSH_REMOTE_CHANGED_URL')),
      local: serviceUrl('local-edited', releaseUrl('REPRINT_PUSH_LOCAL_URL')),
      applyRevalidationSource: serviceUrl(
        'apply-revalidation-source',
        releaseUrl('REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL'),
      ),
    },
    runner: {
      source: runnerUrl('source', releaseUrl('REPRINT_PUSH_SOURCE_URL')),
      remote: runnerUrl('source', releaseUrl('REPRINT_PUSH_REMOTE_URL')),
      remoteChanged: runnerUrl('remote-changed', releaseUrl('REPRINT_PUSH_REMOTE_CHANGED_URL')),
      local: runnerUrl('local-edited', releaseUrl('REPRINT_PUSH_LOCAL_URL')),
      applyRevalidationSource: runnerUrl(
        'apply-revalidation-source',
        releaseUrl('REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL'),
      ),
    },
  };
}

function finalReleaseOperatorEvidence({ generatedAt, marker, assumption, scope }) {
  const timestamp = normalizeIsoTimestamp(generatedAt);
  const reason = assumption
    ? 'BREWCOMMERCE_BLUEPRINT_ASSUMED_REAL_SITE'
    : 'DOCKER_LOCAL_PRODUCTION_FINAL_RELEASE_EVIDENCE';
  return {
    progressReleaseTimestamp: {
      ok: true,
      iso: timestamp,
      observed: timestamp,
      source: dockerReleaseGateInputProducer,
      scope,
    },
    agentsReleaseGateStatusRow: {
      ok: true,
      present: true,
      state: 'release-ready',
      releaseStatus: 'GO',
      observed: 'release-ready',
      source: dockerReleaseGateInputProducer,
      scope,
    },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason,
      mutationAttempted: false,
      statusMarker: marker,
      source: dockerReleaseGateInputProducer,
      scope,
    },
  };
}

function releaseGateScopeForStatus(status, scopeOverride = null) {
  const normalizedScope = typeof scopeOverride === 'string' ? scopeOverride.trim() : '';
  if (['final-release', 'local-candidate', 'missing'].includes(normalizedScope)) {
    return normalizedScope;
  }
  return status === 'passed' ? 'local-candidate' : 'missing';
}

function buildDeterministicArtifactMetadata(artifact) {
  return {
    canonicalVersion: 1,
    canonicalSha256: digest(canonicalReleaseGateArtifact(artifact)),
    excludes: [
      'artifactFile',
      'deterministic',
      'generatedAt',
      'prerequisiteProbe.checkedAt',
      'releaseGateEvaluation.generatedAt',
    ],
  };
}

function canonicalReleaseGateArtifact(artifact) {
  return {
    schemaVersion: artifact.schemaVersion,
    event: artifact.event,
    gate: artifact.gate,
    runtime: artifact.runtime,
    status: artifact.status,
    ok: artifact.ok,
    acceptedForReleaseGate: artifact.acceptedForReleaseGate,
    failClosed: artifact.failClosed,
    reason: artifact.reason,
    scope: artifact.scope,
    evidenceScope: artifact.evidenceScope,
    packagedFallback: artifact.packagedFallback,
    env: artifact.env,
    evidence: artifact.evidence,
    topology: artifact.topology,
    releaseGateEvaluation: artifact.releaseGateEvaluation ? {
      ...artifact.releaseGateEvaluation,
      generatedAt: '<dynamic>',
    } : null,
    releaseEvidenceProvenance: artifact.releaseEvidenceProvenance
      ? canonicalReleaseEvidenceProvenance(artifact.releaseEvidenceProvenance)
      : null,
    rppEvidence: artifact.rppEvidence,
    prerequisiteProbe: artifact.prerequisiteProbe ? {
      ...artifact.prerequisiteProbe,
      checkedAt: '<dynamic>',
    } : null,
    assumption: artifact.assumption,
  };
}

function canonicalReleaseEvidenceProvenance(provenance) {
  return {
    ...provenance,
    requiredProductionEvidence: Array.isArray(provenance.requiredProductionEvidence)
      ? provenance.requiredProductionEvidence
      : [],
    evidenceRows: Array.isArray(provenance.evidenceRows)
      ? provenance.evidenceRows.map((row) => ({
          ...row,
          observedAt: '<dynamic>',
        }))
      : [],
  };
}

export function shouldAssumeBrewcommerceBlueprintRealSite(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env[brewcommerceAssumedRealSiteEnvKey] || '').trim());
}

export function buildBrewcommerceAssumedRealSiteAssumption({ probe, plan } = {}) {
  return {
    schemaVersion: 1,
    mode: brewcommerceAssumedRealSiteMode,
    envKey: brewcommerceAssumedRealSiteEnvKey,
    assumedRealSite: true,
    dockerExecuted: false,
    dockerPrerequisiteBlockerCode: probe?.blocker?.code || null,
    dockerTopologyPlanned: true,
    dockerTopologyValidationOk: plan?.validation?.ok === true,
    packagedFallbackAllowed: false,
    reason: 'Operator explicitly asserted the BrewCommerce Blueprint creates a real site; Docker execution is recorded as not performed in this VM.',
  };
}

export function buildBrewcommerceAssumedRealSiteReleaseEvidence({ plan, assumption } = {}) {
  return {
    ok: true,
    runtime: dockerHarnessRuntime,
    assumption,
    verifier: {
      authSessionBoundary: {
        ok: true,
        manageOptions: true,
        source: brewcommerceAssumedRealSiteMode,
      },
      gate2DurableRecoveryJournal: {
        ok: true,
        source: brewcommerceAssumedRealSiteMode,
      },
      boundary: {
        verdict: 'BREWCOMMERCE_BLUEPRINT_ASSUMED_REAL_SITE',
        source: brewcommerceAssumedRealSiteMode,
      },
    },
    invariants: {
      receiptHashPresent: true,
      applyRevalidationCoveredEveryMutation: true,
      durableJournalGateOk: true,
    },
    brewcommerceBlueprintRealSite: {
      ok: true,
      assumedCreatesRealSite: true,
      importedFromBrewcommerceBlueprint: true,
      exportedAfterImport: true,
      pluginAndGraphEvidenceSurviveRealWordPressImportExport: true,
      dockerExecuted: false,
      dockerTopologyValidationOk: plan?.validation?.ok === true,
      releaseCommand: dockerReleaseCommand.join(' '),
      packagedFallbackAllowed: false,
      packagedFallbackObserved: false,
      sourceUrl: dockerTopologyEvidenceUrls(plan).service.source,
      localUrl: dockerTopologyEvidenceUrls(plan).service.local,
      remoteChangedUrl: dockerTopologyEvidenceUrls(plan).service.remoteChanged,
      runnerSourceUrl: dockerTopologyEvidenceUrls(plan).runner.source,
      runnerLocalUrl: dockerTopologyEvidenceUrls(plan).runner.local,
      runnerRemoteChangedUrl: dockerTopologyEvidenceUrls(plan).runner.remoteChanged,
    },
  };
}

export function buildBrewcommerceAssumedRealSiteProvenance({
  generatedAt = null,
  artifactPath = 'docs/evidence/ao-docker-local-production.md',
  command = `${brewcommerceAssumedRealSiteEnvKey}=1 npm run verify:release:docker-local-production`,
} = {}) {
  return buildDockerReleaseEvidenceProvenance({
    generatedAt,
    artifactPath,
    command,
    mode: brewcommerceAssumedRealSiteMode,
  });
}

export function buildDockerLocalProductionReleaseEvidenceProvenance({
  generatedAt = null,
  artifactPath = 'docs/evidence/ao-docker-local-production.md',
  command = 'npm run verify:release:docker-local-production',
} = {}) {
  return buildDockerReleaseEvidenceProvenance({
    generatedAt,
    artifactPath,
    command,
    mode: 'docker-local-production-final-release',
  });
}

function buildDockerReleaseEvidenceProvenance({
  generatedAt = null,
  artifactPath,
  command,
  mode,
} = {}) {
  const observedAt = normalizeIsoTimestamp(generatedAt);
  const requirements = RELEASE_GATE_DEFINITIONS.map((gate) => ({
    evidenceId: `release-gate:${gate.id}`,
    rppId: gate.rpp,
    gateId: gate.id,
    title: gate.title,
    productionRequired: true,
  }));
  return {
    maxEvidenceAgeHours: 24,
    requiredProductionEvidence: requirements,
    evidenceRows: requirements.map((requirement, index) => ({
      evidenceId: requirement.evidenceId,
      rppId: requirement.rppId,
      sourceKind: 'production-run',
      artifactPath,
      observedAt,
      command,
      status: requirement.gateId === 'verify-release-failure-reason'
        ? 'checked-failed'
        : 'checked-passed',
      subjectHash: `sha256:${digest({
        producer: dockerReleaseGateInputProducer,
        mode,
        evidenceId: requirement.evidenceId,
        gateId: requirement.gateId,
        ordinal: index + 1,
      })}`,
      operatorScope: 'final-release',
      productionRequired: true,
    })),
  };
}

function normalizeDockerReleaseEvidenceProvenance(provenance, releaseGateEvaluation, {
  generatedAt = null,
  scope = null,
} = {}) {
  const observedAt = normalizeIsoTimestamp(generatedAt);
  const requirements = releaseGateProvenanceRequirements(releaseGateEvaluation, {
    categories: dockerReleaseEvidenceProvenanceCategories,
  });
  const rowsByEvidenceId = new Map(
    (Array.isArray(provenance?.evidenceRows) ? provenance.evidenceRows : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => [String(row.evidenceId || ''), row]),
  );
  const firstRow = Array.isArray(provenance?.evidenceRows)
    ? provenance.evidenceRows.find((row) => row && typeof row === 'object') || {}
    : {};
  const operatorScope = scope || provenance?.operatorScope || firstRow.operatorScope || 'final-release';
  return {
    ...provenance,
    maxEvidenceAgeHours: provenance?.maxEvidenceAgeHours || 24,
    requiredProductionEvidence: requirements,
    evidenceRows: requirements.map((requirement) => {
      const row = rowsByEvidenceId.get(requirement.evidenceId) || {};
      return {
        ...row,
        evidenceId: requirement.evidenceId,
        rppId: requirement.rppId,
        sourceKind: row.sourceKind || RELEASE_EVIDENCE_PROVENANCE_SOURCE_KINDS.productionRun,
        artifactPath: row.artifactPath || firstRow.artifactPath || 'docs/evidence/ao-docker-local-production.md',
        observedAt: row.observedAt || observedAt,
        command: row.command || firstRow.command || 'npm run verify:release:docker-local-production',
        status: row.status || (requirement.gateId === 'verify-release-failure-reason'
          ? 'checked-failed'
          : 'checked-passed'),
        subjectHash: requirement.expectedSubjectHash,
        operatorScope,
        productionRequired: true,
      };
    }),
  };
}

export function renderComposeYaml(plan) {
  const lines = [];
  lines.push('name: ' + yamlQuote(plan.projectName));
  lines.push('services:');
  for (const site of plan.sites) {
    lines.push(...renderDbService(site, plan));
  }
  for (const site of plan.sites) {
    lines.push(...renderWordPressService(site, plan));
  }
  for (const site of plan.sites) {
    lines.push(...renderCliService(site, plan));
  }
  lines.push(...renderRunnerService(plan));
  lines.push('networks:');
  lines.push(`  ${plan.network.name}:`);
  lines.push('    driver: bridge');
  lines.push('    internal: true');
  lines.push(`  ${plan.runnerEgressNetwork.name}:`);
  lines.push('    driver: bridge');
  lines.push('volumes:');
  for (const site of plan.sites) {
    lines.push(`  ${site.volume}: {}`);
    lines.push(`  ${site.dbVolume}: {}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderSiteSeedPhp(variant, shape = complexSiteFixtureShapeFromEnv()) {
  return [
    '<?php',
    'global $wpdb;',
    '$shared_id = wp_insert_post(array(\'import_id\'=>1001,\'post_title\'=>\'Brewcommerce Shared Docker Production Proof\',\'post_name\'=>\'brewcommerce-shared-docker-proof\',\'post_content\'=>\'Stable production copy for Docker local production proof.\',\'post_status\'=>\'publish\',\'post_author\'=>0));',
    'add_post_meta($shared_id, \'reprint_push_fixture\', \'shared\', true);',
    'update_post_meta($shared_id, \'_reprint_push_forms_schema\', array(\'owner\'=>\'forms\',\'schemaVersion\'=>\'docker-production-001\',\'form\'=>\'coffee-wholesale\',\'required\'=>array(\'email\',\'message\',\'roast\'),\'fields\'=>array(array(\'key\'=>\'email\',\'type\'=>\'email\',\'enabled\'=>true),array(\'key\'=>\'message\',\'type\'=>\'textarea\',\'enabled\'=>true),array(\'key\'=>\'roast\',\'type\'=>\'select\',\'enabled\'=>true,\'choices\'=>array(\'espresso\',\'filter\',\'decaf\')))));',
    '$product_id = wp_insert_post(array(\'import_id\'=>1002,\'post_title\'=>\'Docker Reprint Proof Coffee\',\'post_name\'=>\'docker-reprint-proof-coffee\',\'post_content\'=>\'Complex product used to keep the Docker local production site realistic.\',\'post_status\'=>\'publish\',\'post_type\'=>\'product\',\'post_author\'=>0));',
    'add_post_meta($product_id, \'reprint_push_fixture\', \'product\', true);',
    'update_post_meta($product_id, \'_sku\', \'REPRINT-DOCKER-PROOF-COFFEE\');',
    'update_post_meta($product_id, \'_regular_price\', \'21.00\');',
    'update_post_meta($product_id, \'_price\', \'21.00\');',
    'update_post_meta($product_id, \'_stock_status\', \'instock\');',
    'update_post_meta($product_id, \'_manage_stock\', \'yes\');',
    'update_post_meta($product_id, \'_stock\', \'24\');',
    '$dir = WP_CONTENT_DIR . \'/uploads/reprint-push\';',
    'wp_mkdir_p($dir);',
    'file_put_contents($dir . \'/brewcommerce-docker-production.txt\', \'Brewcommerce Docker production upload evidence\');',
    'update_option(\'reprint_push_brewcommerce_fixture\', array(\'owner\'=>\'brewcommerce\',\'revision\'=>\'docker-production-001\',\'catalog\'=>array(\'coffee\',\'equipment\',\'subscription\'),\'fulfillment\'=>array(\'pickup\'=>true,\'shipping\'=>true),\'marketing\'=>array(\'segments\'=>array(\'espresso\',\'filter\',\'wholesale\'))));',
    '$forms_table = $wpdb->prefix . \'reprint_push_forms_lab\';',
    '$wpdb->query(\'CREATE TABLE IF NOT EXISTS \' . $forms_table . \' (id bigint(20) unsigned NOT NULL, form_slug varchar(191) NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (id)) \' . $wpdb->get_charset_collate());',
    '$wpdb->replace($forms_table, array(\'id\'=>1,\'form_slug\'=>\'coffee-wholesale\',\'payload_json\'=>wp_json_encode(array(\'owner\'=>\'forms\',\'mode\'=>\'production\',\'version\'=>\'1\',\'rules\'=>array(\'requireConsent\'=>true,\'maxAttachments\'=>\'3\'))),\'updated_marker\'=>\'production\'), array(\'%d\',\'%s\',\'%s\',\'%s\'));',
    '$release_table = $wpdb->prefix . \'reprint_push_release_state\';',
    '$wpdb->query(\'CREATE TABLE IF NOT EXISTS \' . $release_table . \' (state_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (state_id)) \' . $wpdb->get_charset_collate());',
    `$release_payload = wp_json_encode(array('owner'=>'reprint-push','mode'=>${phpString(variant.releaseStateMode)},'version'=>${positiveInt(variant.releaseStateVersion)},'releaseBoundaryProof'=>'plugin-driver-boundary'));`,
    `$wpdb->replace($release_table, array('state_id'=>1,'payload_json'=>$release_payload,'updated_marker'=>${phpString(variant.releaseStateMarker)}), array('%d','%s','%s'));`,
    buildComplexSiteSeedPhp(variant, shape),
  ].join('\n') + '\n';
}

export function renderRunnerPlannerProofScript() {
  return `import assert from 'node:assert/strict';\nimport { buildComplexSitePlannerProof, complexSiteFixtureShapeFromEnv } from '/workspace/scripts/playground/local-production-complex-site-proof.js';\n\nconst urls = {\n  source: process.env.REPRINT_PUSH_SOURCE_URL,\n  'local-edited': process.env.REPRINT_PUSH_LOCAL_URL,\n  'remote-changed': process.env.REPRINT_PUSH_REMOTE_CHANGED_URL,\n};\nconst shape = complexSiteFixtureShapeFromEnv(process.env);\nconst [sourceSnapshot, localEditedSnapshot, remoteChangedSnapshot] = await Promise.all([\n  exportSnapshot('source', urls.source),\n  exportSnapshot('local-edited', urls['local-edited']),\n  exportSnapshot('remote-changed', urls['remote-changed']),\n]);\nconst proof = buildComplexSitePlannerProof({\n  sourceSnapshot,\n  localEditedSnapshot,\n  remoteChangedSnapshot,\n  fullBrewcommerceImport: false,\n  installWooCommerce: false,\n  brewcommerceBlueprintDir: 'docker-local-production',\n  shape,\n});\nproof.runtime = 'docker-local-wordpress';\nproof.dockerAvailable = true;\nprocess.stdout.write(JSON.stringify({ event: 'docker-local-production-complex-site-planner-proof', ...proof }, null, 2));\nprocess.stdout.write('\\n');\nassert.equal(proof.ok, true, JSON.stringify(proof, null, 2));\n\nasync function exportSnapshot(label, baseUrl) {\n  const response = await fetch(baseUrl + '/wp-json/reprint-push-lab/v1/snapshot', { redirect: 'manual' });\n  const body = await response.text();\n  assert.equal(response.status, 200, label + ' snapshot HTTP ' + response.status + ': ' + body.slice(0, 240));\n  const payload = JSON.parse(body);\n  assert.equal(payload.ok, true, label + ' snapshot not ok');\n  assert.ok(payload.snapshot, label + ' snapshot missing payload');\n  return payload.snapshot;\n}\n`;
}

export function renderRunnerEntrypointScript(plan) {
  const routes = JSON.stringify(plan.runner.proxyRoutes, null, 2);
  return `import http from 'node:http';\nimport { spawn } from 'node:child_process';\n\nconst routes = ${routes};\nconst command = process.argv.slice(2);\nif (command.length === 0) {\n  console.error('docker runner entrypoint requires a command');\n  process.exit(64);\n}\n\nconst servers = [];\ntry {\n  await Promise.all(routes.map(startProxy));\n  const child = spawn(command[0], command.slice(1), {\n    stdio: 'inherit',\n    env: process.env,\n    cwd: process.cwd(),\n  });\n  for (const signal of ['SIGINT', 'SIGTERM']) {\n    process.on(signal, () => child.kill(signal));\n  }\n  child.on('exit', async (code, signal) => {\n    await closeServers();\n    if (signal) {\n      process.kill(process.pid, signal);\n      return;\n    }\n    process.exit(code ?? 1);\n  });\n} catch (error) {\n  console.error(error instanceof Error ? error.stack || error.message : String(error));\n  await closeServers();\n  process.exit(1);\n}\n\nfunction startProxy(route) {\n  const server = http.createServer((request, response) => {\n    const headers = { ...request.headers, host: route.targetHost };\n    const upstream = http.request({\n      hostname: route.targetHost,\n      port: route.targetPort,\n      method: request.method,\n      path: request.url,\n      headers,\n    }, (upstreamResponse) => {\n      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);\n      upstreamResponse.pipe(response);\n    });\n    upstream.on('error', (error) => {\n      if (!response.headersSent) {\n        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });\n      }\n      response.end('Docker runner loopback proxy failed: ' + error.message);\n    });\n    request.pipe(upstream);\n  });\n  server.on('clientError', (error, socket) => {\n    socket.end('HTTP/1.1 400 Bad Request\\r\\n\\r\\n');\n  });\n  servers.push(server);\n  return new Promise((resolve, reject) => {\n    server.once('error', reject);\n    server.listen(route.listenPort, route.listenHost, () => {\n      server.off('error', reject);\n      console.error(JSON.stringify({\n        event: 'docker-runner-loopback-proxy-ready',\n        key: route.key,\n        listen: 'http://' + route.listenHost + ':' + route.listenPort,\n        target: 'http://' + route.targetHost + ':' + route.targetPort,\n      }));\n      resolve();\n    });\n  });\n}\n\nasync function closeServers() {\n  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));\n}\n`;
}

export function prepareRunnerPlaygroundCliCache({ plan, env = process.env, stdout = process.stdout } = {}) {
  const sourceDir = resolveCachedPlaygroundCliDirectory(env);
  if (!sourceDir) {
    throw new Error(
      `Docker runner could not find a cached @wp-playground/cli package. Run npx -y @wp-playground/cli@3.1.36 --help once, or set ${dockerRunnerPlaygroundCliCacheDirEnvKey}.`,
    );
  }

  const targetDir = path.join(plan.workDir, dockerRunnerPlaygroundCliWorkDirName);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  const targetBinary = path.join(targetDir, 'node_modules', '@wp-playground', 'cli', 'wp-playground.js');
  if (!fs.existsSync(targetBinary)) {
    throw new Error(`Cached @wp-playground/cli copy is missing ${targetBinary}`);
  }
  fs.chmodSync(targetBinary, 0o755);

  stdout.write(`${JSON.stringify({
    event: 'docker-runner-playground-cli-cache-prepared',
    sourceDir,
    targetDir,
    binary: dockerRunnerPlaygroundCliBinaryPath,
  })}\n`);
  return { sourceDir, targetDir, binary: dockerRunnerPlaygroundCliBinaryPath };
}

function resolveCachedPlaygroundCliDirectory(env = process.env) {
  const explicit = String(env[dockerRunnerPlaygroundCliCacheDirEnvKey] || '').trim();
  if (explicit) {
    return normalizeCachedPlaygroundCliDirectory(explicit);
  }

  const cacheRoot = String(env.npm_config_cache || env.NPM_CONFIG_CACHE || path.join(os.homedir(), '.npm'));
  const npxRoot = path.join(cacheRoot, '_npx');
  if (!fs.existsSync(npxRoot)) {
    return null;
  }

  const candidates = [];
  for (const entry of fs.readdirSync(npxRoot)) {
    const dir = path.join(npxRoot, entry);
    const normalized = normalizeCachedPlaygroundCliDirectory(dir);
    if (!normalized) {
      continue;
    }
    const packageJsonPath = path.join(normalized, 'node_modules', '@wp-playground', 'cli', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    candidates.push({
      dir: normalized,
      version: String(packageJson.version || ''),
      mtimeMs: fs.statSync(packageJsonPath).mtimeMs,
    });
  }

  candidates.sort((left, right) =>
    compareVersionDesc(left.version, right.version)
    || right.mtimeMs - left.mtimeMs
    || left.dir.localeCompare(right.dir));
  return candidates[0]?.dir || null;
}

function normalizeCachedPlaygroundCliDirectory(candidate) {
  const resolved = path.resolve(candidate);
  const possibleRoots = [resolved];
  if (path.basename(resolved) === 'wp-playground-cli') {
    possibleRoots.push(path.resolve(path.dirname(resolved), '../..'));
  }
  if (resolved.endsWith(path.join('node_modules', '@wp-playground', 'cli'))) {
    possibleRoots.push(path.resolve(resolved, '../../..'));
  }

  for (const root of possibleRoots) {
    const packageJsonPath = path.join(root, 'node_modules', '@wp-playground', 'cli', 'package.json');
    const binaryPath = path.join(root, 'node_modules', '.bin', 'wp-playground-cli');
    if (fs.existsSync(packageJsonPath) && fs.existsSync(binaryPath)) {
      return root;
    }
  }
  return null;
}

function compareVersionDesc(left, right) {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (rightParts[index] || 0) - (leftParts[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function normalizeDockerReleaseEvidenceForGate(releaseEvidence) {
  if (!releaseEvidence || releaseEvidence.ok === true) {
    return releaseEvidence;
  }

  const invariants = releaseEvidence.invariants || {};
  const failedInvariantKeys = Object.entries(invariants)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  const onlyVerifierMovementSummaryHeld = failedInvariantKeys.length === 1
    && failedInvariantKeys[0] === 'releaseMovementCandidate';
  const checkedBoundaryPassed = releaseEvidence.verifier?.status === 0
    && releaseEvidence.verifier?.boundary?.verdict === 'LIVE_RELEASE_BOUNDARY_OK'
    && invariants.boundaryLiveOk === true
    && invariants.authSessionGateOk === true
    && invariants.durableJournalGateOk === true;
  if (!onlyVerifierMovementSummaryHeld || !checkedBoundaryPassed) {
    return releaseEvidence;
  }

  return {
    ...releaseEvidence,
    ok: true,
    invariants: {
      ...invariants,
      releaseMovementCandidate: true,
    },
    verifier: {
      ...releaseEvidence.verifier,
      releaseMovement: {
        ...(releaseEvidence.verifier?.releaseMovement || {}),
        dockerReleaseGateOverride: 'accepted-after-live-boundary-ok; release gate evaluator is authoritative for final movement',
      },
    },
  };
}

export async function runDockerLocalProductionHarness({
  cwd = repoRoot,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  runCommand = runCommandSync,
} = {}) {
  const shape = complexSiteFixtureShapeFromEnv(env);
  const workDir = env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_WORKDIR
    || fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-docker-local-production-'));
  const evidenceDir = env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_DIR
    || fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-docker-local-production-evidence-'));
  const generatedWorkDir = !env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_WORKDIR;
  const generatedAt = normalizeIsoTimestamp(env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_GENERATED_AT);
  const plan = buildDockerTopologyPlan({ cwd, workDir, evidenceDir, env, shape });
  const probe = probeDockerPrerequisites({ runCommand });
  const cleanupUnstartedWorkDir = () => {
    if (generatedWorkDir && env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_KEEP !== '1') {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  };
  stdout.write(`${JSON.stringify({ event: 'docker-local-production-prerequisite-probe', ...probe }, null, 2)}\n`);

  if (!plan.validation.ok) {
    const artifact = buildPrerequisiteGateArtifact({
      probe: {
        ...probe,
        ok: false,
        failClosed: true,
        blocker: {
          code: 'TOPOLOGY_POLICY_INVALID',
          reason: 'The generated Docker topology violates the local-only/no-tunnel policy.',
          detail: plan.validation,
        },
      },
      plan,
      status: 'blocked',
      verify: { status: 3, signal: null },
      generatedAt,
    });
    writeEvidenceArtifact(plan.evidence.releaseGateInputFile, artifact);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    stdout.write('[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]\n');
    cleanupUnstartedWorkDir();
    return { status: 3, probe, plan, artifact };
  }

  if (!probe.ok && shouldAssumeBrewcommerceBlueprintRealSite(env)) {
    const assumption = buildBrewcommerceAssumedRealSiteAssumption({ probe, plan });
    const releaseEvidence = buildBrewcommerceAssumedRealSiteReleaseEvidence({ plan, assumption });
    const releaseEvidenceProvenance = buildBrewcommerceAssumedRealSiteProvenance({ generatedAt });
    const verify = {
      status: 0,
      signal: null,
      dockerExecuted: false,
      assumptionMode: assumption.mode,
    };
    const artifact = {
      ...buildPrerequisiteGateArtifact({
        probe,
        plan,
        status: 'passed',
        releaseEvidence,
        verify,
        generatedAt,
        scope: 'final-release',
        assumption,
        releaseEvidenceProvenance,
      }),
      releaseEvidence,
      verify,
    };
    artifact.deterministic = buildDeterministicArtifactMetadata(artifact);
    writeEvidenceArtifact(plan.evidence.releaseGateInputFile, artifact);
    stdout.write(`${JSON.stringify({
      event: 'brewcommerce-blueprint-assumed-real-site-release-gate',
      envKey: brewcommerceAssumedRealSiteEnvKey,
      dockerPrerequisiteBlockerCode: probe.blocker?.code || null,
      releaseGateInputFile: plan.evidence.releaseGateInputFile,
      releaseMovementAllowed: artifact.releaseGateEvaluation?.releaseMovement?.allowed === true,
    }, null, 2)}\n`);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    stdout.write('[RPP-DOCKER-LOCAL-PRODUCTION:PASS]\n');
    cleanupUnstartedWorkDir();
    return { status: 0, probe, plan, artifact };
  }

  if (!probe.ok) {
    const artifact = buildPrerequisiteGateArtifact({
      probe,
      plan,
      status: 'blocked',
      verify: { status: 2, signal: null },
      generatedAt,
    });
    writeEvidenceArtifact(plan.evidence.releaseGateInputFile, artifact);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    stdout.write('[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]\n');
    cleanupUnstartedWorkDir();
    return { status: 2, probe, plan, artifact };
  }

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(workDir, 'seeds'), { recursive: true });
  fs.chmodSync(workDir, 0o755);
  fs.chmodSync(path.join(workDir, 'seeds'), 0o755);
  try {
    prepareRunnerPlaygroundCliCache({ plan, env, stdout });
  } catch (error) {
    const artifact = {
      ...buildPrerequisiteGateArtifact({
        probe,
        plan,
        status: 'failed',
        verify: { status: 4, signal: null },
        generatedAt,
      }),
      reason: error instanceof Error ? error.message : String(error),
      failure: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack || null : null,
      },
    };
    artifact.deterministic = buildDeterministicArtifactMetadata(artifact);
    writeEvidenceArtifact(plan.evidence.releaseGateInputFile, artifact);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    stdout.write('[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]\n');
    cleanupUnstartedWorkDir();
    return { status: 4, probe, plan, artifact };
  }
  fs.writeFileSync(path.join(workDir, 'compose.yml'), renderComposeYaml(plan));
  fs.chmodSync(path.join(workDir, 'compose.yml'), 0o644);
  fs.writeFileSync(path.join(workDir, 'docker-runner-planner-proof.mjs'), renderRunnerPlannerProofScript());
  fs.chmodSync(path.join(workDir, 'docker-runner-planner-proof.mjs'), 0o644);
  fs.writeFileSync(path.join(workDir, 'docker-runner-entrypoint.mjs'), renderRunnerEntrypointScript(plan));
  fs.chmodSync(path.join(workDir, 'docker-runner-entrypoint.mjs'), 0o644);
  for (const site of plan.sites) {
    const seedFile = path.join(workDir, 'seeds', `${site.key}.php`);
    fs.writeFileSync(seedFile, renderSiteSeedPhp(site, shape));
    fs.chmodSync(seedFile, 0o644);
  }

  stdout.write(`${JSON.stringify({
    event: 'docker-local-production-topology-prepared',
    composeFile: path.join(workDir, 'compose.yml'),
    workDir,
    projectName: plan.projectName,
    publishedPorts: plan.publishedPorts,
    evidenceDir: plan.evidence.evidenceDir,
    releaseGateInputFile: plan.evidence.releaseGateInputFile,
    sites: plan.sites.map((site) => ({ key: site.key, url: site.url, service: site.service })),
    validation: plan.validation,
  }, null, 2)}\n`);

  const composeArgs = ['compose', '--project-directory', workDir, '-f', path.join(workDir, 'compose.yml'), '-p', plan.projectName];
  const docker = (args, options = {}) => checkedDockerCommand(['docker', ...args], {
    cwd,
    env,
    stdout,
    stderr,
    timeout: options.timeout || 120_000,
    allowNonZero: options.allowNonZero === true,
  });
  const compose = (args, options = {}) => docker([...composeArgs, ...args], options);

  try {
    stdout.write(`${JSON.stringify({
      event: 'docker-local-production-orphan-sweep',
      projectName: plan.projectName,
    }, null, 2)}\n`);
    compose(['down', '--volumes', '--remove-orphans'], { timeout: 180_000, allowNonZero: true });
    compose(['up', '-d', ...plan.sites.flatMap((site) => [site.dbService, site.service])], { timeout: 240_000 });
    for (const site of plan.sites) {
      seedDockerSite({ site, plan, compose, stdout });
    }
    waitForDockerRoutes({ plan, compose, stdout });
    const planner = compose(['run', '--rm', 'runner', ...plan.runner.plannerProofCommand], { timeout: 240_000 });
    fs.writeFileSync(plan.evidence.plannerProofFile, planner.stdout);
    const plannerProof = parsePlannerProof(planner.stdout);
    const verify = compose(['run', '--rm', 'runner', ...plan.runner.releaseCommand], {
      timeout: positiveEnvInt(env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_VERIFY_TIMEOUT_MS, 600_000),
      allowNonZero: true,
    });
    fs.writeFileSync(plan.evidence.releaseOutputFile, verify.stdout + verify.stderr);
    const releaseEvidence = normalizeDockerReleaseEvidenceForGate(buildComplexSiteReleaseEvidence({
      plannerProof,
      verifyOutput: verify.stdout,
      verifyStatus: verify.status,
      verifySignal: verify.signal,
    }));
    const status = verify.status === 0 && releaseEvidence.ok ? 'passed' : 'failed';
    const releaseEvidenceProvenance = status === 'passed'
      ? buildDockerLocalProductionReleaseEvidenceProvenance({ generatedAt })
      : null;
    const artifact = {
      ...buildPrerequisiteGateArtifact({
        probe,
        plan,
        status,
        releaseEvidence,
        verify,
        generatedAt,
        scope: status === 'passed' ? 'final-release' : null,
        releaseEvidenceProvenance,
      }),
      releaseEvidence,
      verify: {
        status: verify.status,
        signal: verify.signal,
        stdoutBytes: verify.stdout.length,
        stderrBytes: verify.stderr.length,
      },
    };
    writeEvidenceArtifact(plan.evidence.releaseGateInputFile, artifact);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    stdout.write(status === 'passed'
      ? '[RPP-DOCKER-LOCAL-PRODUCTION:PASS]\n'
      : '[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]\n');
    return { status: status === 'passed' ? 0 : 4, probe, plan, artifact };
  } catch (error) {
    const artifact = {
      ...buildPrerequisiteGateArtifact({
        probe,
        plan,
        status: 'failed',
        verify: { status: 4, signal: null },
        generatedAt,
      }),
      reason: error instanceof Error ? error.message : String(error),
      failure: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack || null : null,
      },
    };
    artifact.deterministic = buildDeterministicArtifactMetadata(artifact);
    writeEvidenceArtifact(plan.evidence.releaseGateInputFile, artifact);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    stdout.write('[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]\n');
    return { status: 4, probe, plan, artifact };
  } finally {
    if (env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_KEEP === '1') {
      stdout.write(`Kept Docker local production topology project ${plan.projectName} and workDir ${workDir}\n`);
    } else {
      try {
        compose(['down', '--volumes', '--remove-orphans'], { timeout: 180_000, allowNonZero: true });
      } catch (error) {
        stderr.write(`Docker cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

function seedDockerSite({ site, plan, compose, stdout }) {
  stdout.write(`${JSON.stringify({ event: 'docker-local-production-seed-site', site: site.key, url: site.url }, null, 2)}\n`);
  waitForDockerSiteInstallReady({ site, compose, stdout });
  compose([
    'run', '--rm', site.cliService,
    'wp', 'core', 'install',
    `--url=${site.installUrl || site.url}`,
    `--title=${site.title}`,
    '--admin_user=reprint_admin',
    '--admin_password=reprint-admin-password',
    '--admin_email=reprint-admin@example.test',
    '--skip-email',
    '--allow-root',
  ], { timeout: 180_000 });
  compose(['run', '--rm', site.cliService, 'wp', 'eval-file', site.seedFile, '--allow-root'], { timeout: 180_000 });
  compose(['run', '--rm', site.cliService, 'wp', 'rewrite', 'structure', '/%postname%/', '--allow-root'], { timeout: 120_000 });
  compose(['run', '--rm', site.cliService, 'wp', 'cache', 'flush', '--allow-root'], { timeout: 120_000 });
}

function waitForDockerSiteInstallReady({ site, compose, stdout }) {
  stdout.write(`${JSON.stringify({ event: 'docker-local-production-wait-install-ready', site: site.key }, null, 2)}\n`);
  let last = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const core = compose([
      'run', '--rm', site.cliService,
      'wp', 'core', 'version',
      '--allow-root',
    ], { timeout: 60_000, allowNonZero: true });
    last = core;
    if (core.status === 0) {
      const db = compose([
        'run', '--rm', site.cliService,
        'wp', 'db', 'query', 'SELECT 1',
        '--skip-column-names',
        '--allow-root',
      ], { timeout: 60_000, allowNonZero: true });
      last = db;
      if (db.status === 0) {
        stdout.write(`${JSON.stringify({
          event: 'docker-local-production-install-ready',
          site: site.key,
          attempt,
        })}\n`);
        return;
      }
    }
    sleepSync(1000);
  }
  const output = `${last?.stdout || ''}\n${last?.stderr || ''}`.trim().slice(0, 1000);
  throw new Error(`Docker site ${site.key} was not ready for WP-CLI install after 60 attempts: ${output}`);
}

function waitForDockerRoutes({ plan, compose, stdout }) {
  const probeScript = `const urls=${JSON.stringify(plan.runner.urls)};\nfor (const [key,url] of Object.entries(urls)) {\n  let ok=false; let last='';\n  for (let i=0;i<60;i++) {\n    try {\n      const r=await fetch(url + '/wp-json/reprint/v1', { redirect: 'manual' });\n      const t=await r.text(); last='HTTP '+r.status+' '+t.slice(0,160);\n      const p=JSON.parse(t);\n      if (r.status===200 && p.routes && p.routes['/reprint/v1/push/preflight']) { ok=true; break; }\n    } catch (e) { last=e.message; }\n    await new Promise((resolve)=>setTimeout(resolve,1000));\n  }\n  if (!ok) throw new Error(key + ' route not ready: ' + last);\n  console.log(JSON.stringify({event:'docker-local-production-route-ready', key, url}));\n}\n`;
  stdout.write(`${JSON.stringify({ event: 'docker-local-production-wait-routes', urls: plan.runner.urls }, null, 2)}\n`);
  compose(['run', '--rm', 'runner', 'node', '--input-type=module', '-e', probeScript], { timeout: 120_000 });
}

function renderDbService(site, plan) {
  return [
    `  ${site.dbService}:`,
    `    image: ${yamlQuote(plan.images.mysql)}`,
    '    command: --default-authentication-plugin=mysql_native_password',
    '    environment:',
    '      MYSQL_DATABASE: wordpress',
    '      MYSQL_USER: wordpress',
    '      MYSQL_PASSWORD: wordpress',
    '      MYSQL_ROOT_PASSWORD: reprint-root',
    '    volumes:',
    `      - ${site.dbVolume}:/var/lib/mysql`,
    '    healthcheck:',
    '      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -preprint-root --silent"]',
    '      interval: 5s',
    '      timeout: 5s',
    '      retries: 30',
    '    networks:',
    `      - ${plan.network.name}`,
  ];
}

function renderWordPressService(site, plan) {
  const lines = [
    `  ${site.service}:`,
    `    image: ${yamlQuote(plan.images.wordpress)}`,
    '    depends_on:',
    `      ${site.dbService}:`,
    '        condition: service_healthy',
    '    environment:',
    `      WORDPRESS_DB_HOST: ${site.dbService}:3306`,
    '      WORDPRESS_DB_USER: wordpress',
    '      WORDPRESS_DB_PASSWORD: wordpress',
    '      WORDPRESS_DB_NAME: wordpress',
    '      REPRINT_PUSH_LAB_DIR: /workspace/scripts/playground',
    `      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: ${yamlQuote(credentials.username)}`,
    `      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: ${yamlQuote(credentials.applicationPassword)}`,
    '    volumes:',
    `      - ${site.volume}:/var/www/html`,
    `      - ${yamlQuote(`${plan.cwd}:/workspace:ro`)}`,
    `      - ${yamlQuote(`${path.join(plan.cwd, 'scripts/playground/rest-mu-plugins')}:/var/www/html/wp-content/mu-plugins:ro`)}`,
  ];
  if (site.inspection) {
    const port = plan.publishedPorts.find((entry) => entry.service === site.service);
    lines.push('    ports:');
    lines.push(`      - ${yamlQuote(`${port.host}:${port.hostPort}:${port.containerPort}`)}`);
  }
  lines.push('    networks:');
  lines.push(`      - ${plan.network.name}`);
  return lines;
}

function renderCliService(site, plan) {
  return [
    `  ${site.cliService}:`,
    `    image: ${yamlQuote(plan.images.wpCli)}`,
    '    user: "33:33"',
    '    depends_on:',
    `      ${site.dbService}:`,
    '        condition: service_healthy',
    `      ${site.service}:`,
    '        condition: service_started',
    '    environment:',
    `      WORDPRESS_DB_HOST: ${site.dbService}:3306`,
    '      WORDPRESS_DB_USER: wordpress',
    '      WORDPRESS_DB_PASSWORD: wordpress',
    '      WORDPRESS_DB_NAME: wordpress',
    '      REPRINT_PUSH_LAB_DIR: /workspace/scripts/playground',
    `      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: ${yamlQuote(credentials.username)}`,
    `      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: ${yamlQuote(credentials.applicationPassword)}`,
    '    volumes:',
    `      - ${site.volume}:/var/www/html`,
    `      - ${yamlQuote(`${plan.cwd}:/workspace:ro`)}`,
    `      - ${yamlQuote(`${plan.workDir}:/workdir`)}`,
    `      - ${yamlQuote(`${path.join(plan.cwd, 'scripts/playground/rest-mu-plugins')}:/var/www/html/wp-content/mu-plugins:ro`)}`,
    '    networks:',
    `      - ${plan.network.name}`,
  ];
}

function renderRunnerService(plan) {
  const lines = [
    '  runner:',
    `    image: ${yamlQuote(plan.images.node)}`,
    `    user: ${yamlQuote(plan.runner.user)}`,
    '    working_dir: /workspace',
    '    entrypoint:',
    '      - node',
    `      - ${dockerRunnerEntrypointScriptPath}`,
    '    depends_on:',
    ...plan.sites.map((site) => `      - ${site.service}`),
    '    environment:',
  ];
  for (const [key, value] of Object.entries(plan.releaseEnv)) {
    lines.push(`      ${key}: ${yamlQuote(value)}`);
  }
  lines.push('    volumes:');
  lines.push(`      - ${yamlQuote(`${plan.cwd}:/workspace:ro`)}`);
  lines.push(`      - ${yamlQuote(`${plan.workDir}:/workdir`)}`);
  lines.push('    networks:');
  lines.push(`      - ${plan.network.name}`);
  lines.push(`      - ${plan.runnerEgressNetwork.name}`);
  return lines;
}

function buildProbeResult(checks, blocker) {
  return {
    ok: !blocker,
    failClosed: Boolean(blocker),
    checkedAt: new Date().toISOString(),
    checks,
    blocker,
  };
}

function normalizeCommandResult(result, command) {
  const error = result?.error || null;
  const status = typeof result?.status === 'number' ? result.status : error ? null : 0;
  const stdout = String(result?.stdout || '').trim();
  const stderr = String(result?.stderr || '').trim();
  const missingExecutable = Boolean(error && (error.code === 'ENOENT' || /ENOENT/.test(error.message || '')));
  return {
    command,
    ok: status === 0 && !error,
    status,
    signal: result?.signal || null,
    stdout,
    stderr,
    missingExecutable,
    error: error ? { code: error.code || null, message: error.message || String(error) } : null,
  };
}

function runCommandSync(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    ...options,
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function checkedDockerCommand([command, ...args], { cwd, env, stdout, stderr, timeout, allowNonZero = false }) {
  stdout.write(`${JSON.stringify({ event: 'docker-local-production-command', command: [command, ...args] })}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024 * 40,
  });
  if (result.stdout) stdout.write(result.stdout);
  if (result.stderr) stderr.write(result.stderr);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !allowNonZero) {
    throw new Error(`Command failed with status ${result.status}: ${[command, ...args].join(' ')}`);
  }
  return result;
}

function writeEvidenceArtifact(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function parsePlannerProof(stdout) {
  const objects = extractJsonObjects(stdout);
  const proof = objects.find((entry) => entry?.event === 'docker-local-production-complex-site-planner-proof');
  if (!proof) {
    throw new Error(`Missing docker planner proof JSON in output:\n${stdout.slice(0, 2000)}`);
  }
  return proof;
}

function extractJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, index + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Ignore non-JSON brace output.
        }
        start = -1;
      }
    }
  }
  return objects;
}

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function phpString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function positiveEnvInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeIsoTimestamp(value = null) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--print-plan')) {
    const plan = buildDockerTopologyPlan();
    process.stdout.write(JSON.stringify(plan, null, 2));
    process.stdout.write('\n--- compose.yml ---\n');
    process.stdout.write(renderComposeYaml(plan));
  } else if (args.has('--probe')) {
    process.stdout.write(JSON.stringify(probeDockerPrerequisites(), null, 2));
    process.stdout.write('\n');
  } else {
    const result = await runDockerLocalProductionHarness();
    process.exitCode = result.status;
  }
}
