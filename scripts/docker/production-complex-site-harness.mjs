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
  evaluateReleaseGates,
  formatReleaseGateStatusMarker,
  releaseGateSummary,
} from '../../src/release-gates.js';
import { digest } from '../../src/stable-json.js';

export const dockerHarnessEvent = 'docker-local-production-complex-site-harness';
export const dockerHarnessGate = 'GATE-3';
export const dockerHarnessRuntime = 'docker-local-wordpress';
export const dockerReleaseGateInputSchemaVersion = 1;
export const dockerReleaseGateInputProducer = 'docker-local-production-release-gate-input';

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
  const authSessionSourceCommand = buildAuthSessionSourceCommand({
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
    REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
    REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
    REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH: '/snapshot',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SITE_PROOF: '1',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: String(shape.postCount),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SCHEMA_META_COUNT: String(shape.schemaMetaCount),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FILE_COUNT: String(shape.fileCount),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FORMS_ROWS: String(shape.formsLabRows),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_POSTS: String(shape.remoteDriftPosts),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_FILES: String(shape.remoteDriftFiles),
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF: shape.featuredImageGraph ? '1' : '0',
    REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF: shape.taxonomyGraph ? '1' : '0',
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
        'release verifier uses Docker service DNS URLs, not public callback URLs',
      ],
    },
    externalAccounts: {
      required: false,
      credentialSource: 'fixture Application Passwords provisioned by the mounted lab mu-plugin in disposable WordPress containers',
    },
    sites: dockerSiteVariants.map((variant) => ({
      ...variant,
      url: siteUrls[variant.key],
      dbName: 'wordpress',
      dbUser: 'wordpress',
      dbPassword: 'wordpress',
      rootPassword: 'reprint-root',
      seedFile: path.posix.join('/workdir/seeds', `${variant.key}.php`),
    })),
    runner: {
      service: 'runner',
      workingDir: '/workspace',
      releaseCommand: ['npm', 'run', 'verify:release'],
      plannerProofCommand: ['node', '/workdir/docker-runner-planner-proof.mjs'],
      urls: siteUrls,
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
  const releaseEnv = plan?.releaseEnv || {};
  for (const key of [
    'REPRINT_PUSH_SOURCE_URL',
    'REPRINT_PUSH_REMOTE_CHANGED_URL',
    'REPRINT_PUSH_LOCAL_URL',
    'REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL',
  ]) {
    const value = String(releaseEnv[key] || '');
    if (!/^http:\/\/wp-[a-z0-9-]+$/.test(value)) {
      failures.push({ code: 'NON_DOCKER_INTERNAL_RELEASE_URL', key, value });
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
      releaseUrlsUseDockerDns: failures.every((failure) => failure.code !== 'NON_DOCKER_INTERNAL_RELEASE_URL'),
      noTunnelCommands: failures.every((failure) => failure.code !== 'FORBIDDEN_TUNNEL_REFERENCE'),
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
} = {}) {
  const blocker = probe?.blocker || null;
  const releaseGateInput = buildDockerReleaseGateInput({
    probe,
    plan,
    status,
    releaseEvidence,
    verify,
    generatedAt: normalizeIsoTimestamp(generatedAt || probe?.checkedAt),
  });
  const releaseGateEvaluation = buildReleaseGateEvaluationSummary(releaseGateInput);
  const artifact = {
    schemaVersion: dockerReleaseGateInputSchemaVersion,
    event: dockerReleaseGateInputProducer,
    gate: dockerHarnessGate,
    runtime: dockerHarnessRuntime,
    status,
    ok: status === 'passed',
    acceptedForReleaseGate: status === 'passed',
    failClosed: status !== 'passed',
    reason: blocker?.reason || (status === 'passed' ? 'Docker local production proof completed.' : 'Docker prerequisite probe did not pass.'),
    prerequisiteProbe: probe || null,
    artifactFile: plan?.evidence?.releaseGateInputFile || null,
    commands: {
      runHarness: 'npm run verify:release:docker-local-production',
      focusedTests: 'npm run test:docker:production-complex-site-harness',
      releaseGateCheck: 'node ./scripts/release/check-release-gates.mjs --evidence-file <artifact>',
    },
    ...releaseGateInput,
    releaseGateEvaluation,
    topology: plan ? {
      projectName: plan.projectName,
      sites: (plan.sites || []).map((site) => ({ key: site.key, service: site.service, url: site.url })),
      network: plan.network,
      publishedPorts: plan.publishedPorts,
      noTunnelPolicy: plan.noTunnelPolicy,
      validation: plan.validation || validateTopologyPlan(plan),
      shape: plan.shape,
    } : null,
    rppEvidence: {
      advancedItems: [
        'RPP-0801 three-site local production topology exact unavailable capability',
        'RPP-0819 sandbox 8080 ingress rule proof harness contract',
        'RPP-0820 no tunnel policy proof harness contract',
        'RPP-0903 release gate 3 blocks when a required proof fails',
      ],
      dockerWordPressReleaseReady: status === 'passed',
      dockerWordPressBlockedUntilPrerequisitesPass: status !== 'passed',
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
} = {}) {
  const scope = releaseGateScopeForStatus(status);
  const normalizedGeneratedAt = normalizeIsoTimestamp(generatedAt || probe?.checkedAt);
  return {
    scope,
    evidenceScope: scope,
    generatedAt: normalizedGeneratedAt,
    env: {},
    packagedFallback: false,
    evidence: buildDockerReleaseGateEvidence({
      probe,
      plan,
      status,
      releaseEvidence,
      verify,
      scope,
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
      scope,
    },
  };

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

  const sourceUrl = plan.releaseEnv.REPRINT_PUSH_SOURCE_URL;
  const localUrl = plan.releaseEnv.REPRINT_PUSH_LOCAL_URL;
  const remoteChangedUrl = plan.releaseEnv.REPRINT_PUSH_REMOTE_CHANGED_URL;
  const preflightRoute = '/reprint/v1/push/preflight';
  const dryRunRoute = '/reprint/v1/push/dry-run';
  const applyRoute = '/reprint/v1/push/apply';
  const journalRoute = '/reprint/v1/push/journal';
  const recoveryInspectRoute = '/reprint/v1/push/recovery/inspect';
  const recoveryInspectReadOnlyOk = releaseEvidence.verifier?.gate2DurableRecoveryJournal?.ok === true;

  return {
    ...evidence,
    sourceUrl: { ok: true, url: sourceUrl, observed: sourceUrl, scope },
    localUrl: { ok: true, url: localUrl, observed: localUrl, scope },
    remoteChangedUrl: { ok: true, url: remoteChangedUrl, observed: remoteChangedUrl, scope },
    remoteAlias: { ok: true, url: sourceUrl, observed: sourceUrl, scope },
    authSourceCommandReadback: {
      ok: true,
      same: true,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: sourceUrl,
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
  };
}

function releaseGateScopeForStatus(status) {
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
    rppEvidence: artifact.rppEvidence,
    prerequisiteProbe: artifact.prerequisiteProbe ? {
      ...artifact.prerequisiteProbe,
      checkedAt: '<dynamic>',
    } : null,
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
  const generatedAt = normalizeIsoTimestamp(env.REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_GENERATED_AT);
  const plan = buildDockerTopologyPlan({ cwd, workDir, evidenceDir, env, shape });
  const probe = probeDockerPrerequisites({ runCommand });
  stdout.write(`${JSON.stringify({ event: 'docker-local-production-prerequisite-probe', ...probe }, null, 2)}\n`);

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
    return { status: 2, probe, plan, artifact };
  }

  if (!plan.validation.ok) {
    const artifact = buildPrerequisiteGateArtifact({
      probe: {
        ...probe,
        ok: false,
        failClosed: true,
        blocker: {
          code: 'TOPOLOGY_POLICY_INVALID',
          reason: 'Docker prerequisites passed, but the generated topology violates the local-only/no-tunnel policy.',
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
    return { status: 3, probe, plan, artifact };
  }

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(workDir, 'seeds'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'compose.yml'), renderComposeYaml(plan));
  fs.writeFileSync(path.join(workDir, 'docker-runner-planner-proof.mjs'), renderRunnerPlannerProofScript());
  for (const site of plan.sites) {
    fs.writeFileSync(path.join(workDir, 'seeds', `${site.key}.php`), renderSiteSeedPhp(site, shape));
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
    const releaseEvidence = buildComplexSiteReleaseEvidence({
      plannerProof,
      verifyOutput: verify.stdout,
      verifyStatus: verify.status,
      verifySignal: verify.signal,
    });
    const status = verify.status === 0 && releaseEvidence.ok ? 'passed' : 'failed';
    const artifact = {
      ...buildPrerequisiteGateArtifact({ probe, plan, status, releaseEvidence, verify, generatedAt }),
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
  compose([
    'run', '--rm', site.cliService,
    'core', 'install',
    `--url=${site.url}`,
    `--title=${site.title}`,
    '--admin_user=reprint_admin',
    '--admin_password=reprint-admin-password',
    '--admin_email=reprint-admin@example.test',
    '--skip-email',
    '--allow-root',
  ], { timeout: 180_000 });
  compose(['run', '--rm', site.cliService, 'eval-file', site.seedFile, '--allow-root'], { timeout: 180_000 });
  compose(['run', '--rm', site.cliService, 'rewrite', 'structure', '/%postname%/', '--allow-root'], { timeout: 120_000 });
  compose(['run', '--rm', site.cliService, 'cache', 'flush', '--allow-root'], { timeout: 120_000 });
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
    '    environment:',
    '      MYSQL_DATABASE: wordpress',
    '      MYSQL_USER: wordpress',
    '      MYSQL_PASSWORD: wordpress',
    '      MYSQL_ROOT_PASSWORD: reprint-root',
    '    volumes:',
    `      - ${site.dbVolume}:/var/lib/mysql`,
    '    networks:',
    `      - ${plan.network.name}`,
  ];
}

function renderWordPressService(site, plan) {
  const lines = [
    `  ${site.service}:`,
    `    image: ${yamlQuote(plan.images.wordpress)}`,
    '    depends_on:',
    `      - ${site.dbService}`,
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
    `      - ${yamlQuote(plan.cwd)}:/workspace:ro`,
    `      - ${yamlQuote(path.join(plan.cwd, 'scripts/playground/rest-mu-plugins'))}:/var/www/html/wp-content/mu-plugins:ro`,
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
    '    depends_on:',
    `      - ${site.dbService}`,
    `      - ${site.service}`,
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
    `      - ${yamlQuote(plan.cwd)}:/workspace:ro`,
    `      - ${yamlQuote(plan.workDir)}:/workdir`,
    `      - ${yamlQuote(path.join(plan.cwd, 'scripts/playground/rest-mu-plugins'))}:/var/www/html/wp-content/mu-plugins:ro`,
    '    networks:',
    `      - ${plan.network.name}`,
  ];
}

function renderRunnerService(plan) {
  const lines = [
    '  runner:',
    `    image: ${yamlQuote(plan.images.node)}`,
    '    working_dir: /workspace',
    '    depends_on:',
    ...plan.sites.map((site) => `      - ${site.service}`),
    '    environment:',
  ];
  for (const [key, value] of Object.entries(plan.releaseEnv)) {
    lines.push(`      ${key}: ${yamlQuote(value)}`);
  }
  lines.push('    volumes:');
  lines.push(`      - ${yamlQuote(plan.cwd)}:/workspace:ro`);
  lines.push(`      - ${yamlQuote(plan.workDir)}:/workdir`);
  lines.push('    networks:');
  lines.push(`      - ${plan.network.name}`);
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
