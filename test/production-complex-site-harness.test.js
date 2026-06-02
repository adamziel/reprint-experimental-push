import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  brewcommerceAssumedRealSiteEnvKey,
  brewcommerceAssumedRealSiteMode,
  buildDockerLocalProductionReleaseEvidenceProvenance,
  buildDockerLocalProductionStorageBoundaryCasEvidence,
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerRunnerAuthSessionSourceScriptPath,
  dockerRunnerEntrypointScriptPath,
  dockerRunnerPlaygroundCliBinaryPath,
  dockerReleaseCommand,
  dockerTopologyVariant,
  forbiddenPackagedFallbackEnvKeys,
  forbiddenTunnelBinaries,
  prepareRunnerPlaygroundCliCache,
  probeDockerPrerequisites,
  renderComposeYaml,
  renderRunnerEntrypointScript,
  renderRunnerPlannerProofScript,
  renderSiteSeedPhp,
  runDockerLocalProductionHarness,
  validateReleaseGateArtifact,
  validateTopologyPlan,
} from '../scripts/docker/production-complex-site-harness.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const graphEnv = Object.freeze({
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: '25',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SCHEMA_META_COUNT: '7',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FILE_COUNT: '5',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FORMS_ROWS: '6',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_POSTS: '4',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_FILES: '2',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_GRAPH_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_TAXONOMY_GRAPH_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_PARENT_GRAPH_PROOF: '1',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF: '1',
});

function buildPassedDockerReleaseEvidence() {
  return {
    ok: true,
    storageBoundaryCas: buildDockerLocalProductionStorageBoundaryCasEvidence(),
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
  };
}

test('Docker prerequisite probe fails closed when the Docker CLI is missing', () => {
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });

  assert.equal(probe.ok, false);
  assert.equal(probe.failClosed, true);
  assert.equal(probe.blocker.code, 'DOCKER_CLI_MISSING');
  assert.match(probe.blocker.reason, /fail closed/);
  assert.equal(probe.checks.dockerCli.missingExecutable, true);
});

test('Docker prerequisite probe distinguishes a missing daemon from a missing CLI', () => {
  const calls = [];
  const probe = probeDockerPrerequisites({
    runCommand: (command, args) => {
      calls.push([command, ...args].join(' '));
      if (args[0] === '--version') {
        return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      }
      if (args[0] === 'compose') {
        return { status: 0, stdout: '2.27.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
  });

  assert.deepEqual(calls, [
    'docker --version',
    'docker compose version --short',
    'docker info --format {{json .ServerVersion}}',
  ]);
  assert.equal(probe.ok, false);
  assert.equal(probe.blocker.code, 'DOCKER_DAEMON_UNAVAILABLE');
  assert.equal(probe.checks.dockerCli.ok, true);
  assert.equal(probe.checks.dockerCompose.ok, true);
  assert.equal(probe.checks.dockerDaemon.ok, false);
});

test('Docker prerequisite probe passes only when CLI, Compose, and daemon are all usable', () => {
  const probe = probeDockerPrerequisites({
    runCommand: (command, args) => {
      if (command !== 'docker') throw new Error(`Unexpected command: ${command}`);
      if (args[0] === '--version') return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      if (args[0] === 'compose') return { status: 0, stdout: '2.27.0', stderr: '' };
      if (args[0] === 'info') return { status: 0, stdout: '"26.1.0"', stderr: '' };
      throw new Error(`Unexpected args: ${args.join(' ')}`);
    },
  });

  assert.equal(probe.ok, true);
  assert.equal(probe.failClosed, false);
  assert.equal(probe.blocker, null);
});

test('Docker topology plan is local-only, private-networked, and release-verifier ready', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    env: graphEnv,
  });

  assert.equal(plan.validation.ok, true);
  assert.deepEqual(plan.publishedPorts, [{
    service: 'wp-source',
    host: '127.0.0.1',
    hostPort: 8080,
    containerPort: 80,
    purpose: 'optional browser-visible inspection only; verifier traffic stays inside the private Docker network',
  }]);
  assert.equal(plan.network.internal, true);
  assert.equal(plan.runnerEgressNetwork.internal, false);
  assert.equal(plan.externalAccounts.required, false);
  assert.equal(plan.releaseEnv.REPRINT_PUSH_SOURCE_URL, 'http://wp-source');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_REMOTE_URL, 'http://wp-source');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_REMOTE_CHANGED_URL, 'http://wp-remote-changed');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_LOCAL_URL, 'http://wp-local-edited');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL, 'http://wp-apply-revalidation-source');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_MODE, 'after-first-read');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_PLAYGROUND_CLI_BINARY, dockerRunnerPlaygroundCliBinaryPath);
  assert.equal(plan.releaseEnv.REPRINT_PUSH_RECOVERY_FILE_JOURNAL_TMP_ROOT, '/workdir/recovery-file-journal');
  assert.match(
    plan.releaseEnv.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND,
    new RegExp(`^'node' '${escapeRegExp(dockerRunnerAuthSessionSourceScriptPath)}' '--source-url=http://wp-source' `),
  );
  assert.doesNotMatch(plan.releaseEnv.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND, new RegExp(escapeRegExp(process.execPath)));
  assert.doesNotMatch(plan.releaseEnv.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND, /\/nix\/store|\/tmp\/reprint/);
  assert.equal(plan.releaseEnv.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT, '25');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF, '1');
  assert.equal(plan.runner.topologyVariant, dockerTopologyVariant);
  assert.match(plan.runner.user, /^\d+:\d+$/);
  assert.deepEqual(plan.runner.releaseCommand, dockerReleaseCommand);
  assert.equal(plan.runner.packagedFallbackAllowed, false);
  assert.equal(plan.sites.find((site) => site.key === 'source')?.url, 'http://wp-source');
  assert.equal(plan.sites.find((site) => site.key === 'source')?.installUrl, 'http://127.0.0.1:8080');
  assert.deepEqual(plan.runner.urls, {
    source: 'http://127.0.0.1:8080',
    'remote-changed': 'http://127.0.0.1:8081',
    'local-edited': 'http://127.0.0.1:8082',
    'apply-revalidation-source': 'http://127.0.0.1:8083',
  });
  assert.deepEqual(plan.runner.proxyRoutes.map(({ key, listenHost, listenPort, targetHost, targetPort }) => ({
    key,
    listenHost,
    listenPort,
    targetHost,
    targetPort,
  })), [
    { key: 'source', listenHost: '127.0.0.1', listenPort: 8080, targetHost: 'wp-source', targetPort: 80 },
    { key: 'remote-changed', listenHost: '127.0.0.1', listenPort: 8081, targetHost: 'wp-remote-changed', targetPort: 80 },
    { key: 'local-edited', listenHost: '127.0.0.1', listenPort: 8082, targetHost: 'wp-local-edited', targetPort: 80 },
    {
      key: 'apply-revalidation-source',
      listenHost: '127.0.0.1',
      listenPort: 8083,
      targetHost: 'wp-apply-revalidation-source',
      targetPort: 80,
    },
  ]);
  for (const key of forbiddenPackagedFallbackEnvKeys) {
    assert.equal(plan.releaseEnv[key], undefined);
  }
  assert.equal(plan.validation.checks.releaseCommandIsVerifyRelease, true);
  assert.equal(plan.validation.checks.packagedFallbackDisabled, true);
  assert.equal(plan.sites.length, 4);
  assert.ok(plan.sites.every((site) => site.url.startsWith('http://wp-')));
});

test('Compose rendering exposes only the sandbox 8080 inspection ingress and contains no tunnel commands', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    env: graphEnv,
  });
  const compose = renderComposeYaml(plan);

  assert.match(compose, /internal: true/);
  assert.match(compose, /reprint_runner_egress:\n    driver: bridge/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /--default-authentication-plugin=mysql_native_password/);
  assert.match(compose, /user: "33:33"/);
  assert.match(compose, /entrypoint:\n      - node\n      - \/workdir\/docker-runner-entrypoint\.mjs/);
  assert.match(compose, /runner:\n    image: "node:20-bookworm"\n    user: "\d+:\d+"/);
  assert.match(compose, /mysqladmin ping -h 127\.0\.0\.1/);
  assert.match(compose, /"127\.0\.0\.1:8080:80"/);
  assert.match(compose, /"\/repo\/reprint-push:\/workspace:ro"/);
  assert.match(compose, /"\/tmp\/reprint-docker-local-production-test:\/workdir"/);
  assert.match(compose, /REPRINT_PUSH_PLAYGROUND_CLI_BINARY: "\/workdir\/playground-cli\/node_modules\/@wp-playground\/cli\/wp-playground\.js"/);
  assert.match(compose, /REPRINT_PUSH_RECOVERY_FILE_JOURNAL_TMP_ROOT: "\/workdir\/recovery-file-journal"/);
  assert.doesNotMatch(compose, /"\/repo\/reprint-push":\/workspace:ro/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:8080/);
  assert.doesNotMatch(compose, /39000|49152/);
  assert.match(compose, /runner:[\s\S]*networks:\n      - reprint_private\n      - reprint_runner_egress/);
  for (const forbidden of forbiddenTunnelBinaries) {
    assert.doesNotMatch(compose.toLowerCase(), forbiddenTunnelPattern(forbidden));
  }
});

test('Docker WP-CLI invocations include the wp executable', () => {
  const source = fs.readFileSync(new URL('../scripts/docker/production-complex-site-harness.mjs', import.meta.url), 'utf8');

  assert.match(source, /site\.cliService,\n\s+'wp', 'core', 'version'/);
  assert.match(source, /site\.cliService,\n\s+'wp', 'core', 'install'/);
  assert.match(source, /site\.cliService, 'wp', 'eval-file'/);
  assert.match(source, /site\.cliService, 'wp', 'rewrite'/);
  assert.match(source, /site\.cliService, 'wp', 'cache'/);
  assert.match(source, /site\.cliService,\n\s+'wp', 'db', 'query'/);
  assert.doesNotMatch(source, /site\.cliService,\n\s+'core', 'version'/);
});

test('Docker generated workdir is made readable for container mounts', () => {
  const source = fs.readFileSync(new URL('../scripts/docker/production-complex-site-harness.mjs', import.meta.url), 'utf8');

  assert.match(source, /fs\.chmodSync\(workDir, 0o755\)/);
  assert.match(source, /fs\.chmodSync\(path\.join\(workDir, 'seeds'\), 0o755\)/);
  assert.match(source, /fs\.chmodSync\(seedFile, 0o644\)/);
  assert.match(source, /fs\.chmodSync\(path\.join\(workDir, 'docker-runner-entrypoint\.mjs'\), 0o644\)/);
});

test('Docker harness sweeps stale project containers before starting a new proof', () => {
  const source = fs.readFileSync(new URL('../scripts/docker/production-complex-site-harness.mjs', import.meta.url), 'utf8');
  const sweepIndex = source.indexOf("event: 'docker-local-production-orphan-sweep'");
  const downIndex = source.indexOf("compose(['down', '--volumes', '--remove-orphans']", sweepIndex);
  const upIndex = source.indexOf("compose(['up', '-d'", sweepIndex);

  assert.notEqual(sweepIndex, -1);
  assert.ok(downIndex > sweepIndex);
  assert.ok(upIndex > downIndex);
});

test('Docker runner prepares cached Playground CLI without a registry fetch during verify', (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-playground-cli-source-'));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-playground-cli-work-'));
  t.after(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(sourceDir, 'node_modules', '@wp-playground', 'cli'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'node_modules', '@wp-playground', 'cli', 'package.json'),
    '{"name":"@wp-playground/cli","version":"3.1.36"}\n',
  );
  fs.writeFileSync(path.join(sourceDir, 'node_modules', '@wp-playground', 'cli', 'wp-playground.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(sourceDir, 'node_modules', '.bin', 'wp-playground-cli'), '#!/usr/bin/env node\n');
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir,
    env: graphEnv,
  });
  let stdoutText = '';

  const prepared = prepareRunnerPlaygroundCliCache({
    plan,
    env: { REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_PLAYGROUND_CLI_CACHE_DIR: sourceDir },
    stdout: { write: (chunk) => { stdoutText += String(chunk); } },
  });

  assert.equal(prepared.binary, dockerRunnerPlaygroundCliBinaryPath);
  assert.equal(
    fs.existsSync(path.join(workDir, 'playground-cli', 'node_modules', '@wp-playground', 'cli', 'wp-playground.js')),
    true,
  );
  assert.match(stdoutText, /docker-runner-playground-cli-cache-prepared/);
});

test('Topology validation rejects non-8080 ports, public hosts, and tunnel-shaped images', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    env: graphEnv,
  });

  const badPort = validateTopologyPlan({
    ...plan,
    publishedPorts: [{ service: 'wp-source', host: '0.0.0.0', hostPort: 9999, containerPort: 80 }],
  });
  assert.equal(badPort.ok, false);
  assert.ok(badPort.failures.some((failure) => failure.code === 'NON_LOCAL_OR_NON_8080_PORT'));

  const badTunnel = validateTopologyPlan({
    ...plan,
    images: { ...plan.images, node: 'example/ngrok-runner:latest' },
  });
  assert.equal(badTunnel.ok, false);
  assert.ok(badTunnel.failures.some((failure) => failure.code === 'FORBIDDEN_TUNNEL_REFERENCE'));

  const badReleaseCommand = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, releaseCommand: ['npm', 'run', 'verify:release:local-production'] },
  });
  assert.equal(badReleaseCommand.ok, false);
  assert.ok(badReleaseCommand.failures.some((failure) => failure.code === 'DOCKER_RELEASE_COMMAND_NOT_VERIFY_RELEASE'));

  const badPackagedFallback = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only' },
  });
  assert.equal(badPackagedFallback.ok, false);
  assert.ok(badPackagedFallback.failures.some((failure) => failure.code === 'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED'));

  const badRemoteAlias = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_REMOTE_URL: 'https://example.com' },
  });
  assert.equal(badRemoteAlias.ok, false);
  assert.ok(badRemoteAlias.failures.some((failure) =>
    failure.code === 'NON_DOCKER_INTERNAL_RELEASE_URL'
    && failure.key === 'REPRINT_PUSH_REMOTE_URL'));
});

test('Site seed PHP carries complex disposable production content and graph fixtures', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    env: graphEnv,
  });
  const localEdited = plan.sites.find((site) => site.key === 'local-edited');
  const php = renderSiteSeedPhp(localEdited, plan.shape);

  assert.match(php, /Brewcommerce Shared Docker Production Proof/);
  assert.match(php, /Docker Reprint Proof Coffee/);
  assert.match(php, /reprint_push_release_state/);
  assert.match(php, /plugin-driver-boundary/);
  assert.match(php, /Brewcommerce Complex Item/);
  assert.match(php, /reprint-push-post-parent-graph-parent/);
  assert.match(php, /reprint_push_taxonomy_fixture/);
  assert.match(php, /reprint_push_comment_fixture/);
  assert.doesNotMatch(php, /require_once '\/wordpress\/wp-load\.php'/);
});

test('Fail-closed release gate artifact is deterministic enough for audit input', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    evidenceDir: '/tmp/reprint-docker-local-production-evidence-test',
    env: graphEnv,
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
    generatedAt: '2026-05-28T00:00:00.000Z',
  });

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.scope, 'missing');
  assert.deepEqual(artifact.env, {});
  assert.equal(artifact.topology.publishedPorts[0].hostPort, 8080);
  assert.equal(artifact.topology.validation.ok, true);
  assert.equal(artifact.artifactFile, '/tmp/reprint-docker-local-production-evidence-test/release-gate-input.json');
  assert.equal(artifact.evidence.dockerLocalProductionProof.ok, false);
  assert.equal(artifact.evidence.dockerLocalProductionProof.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerLocalProductionProof.externalAccountsRequired, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.ok, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, 'npm run verify:release');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.verifyReleaseFailure.exitCode, 2);
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.releaseGateEvaluation.ok, false);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.releaseGateEvaluation.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.match(
    artifact.releaseGateEvaluation.statusMarker,
    /^\[docker-local-production-release-gates:held final=\d+\/21 candidate=\d+\/21 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED\]$/,
  );
  assert.match(artifact.deterministic.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateReleaseGateArtifact(artifact), {
    ok: true,
    failures: [],
    releaseGateEvaluation: artifact.releaseGateEvaluation,
  });
  assert.ok(artifact.rppEvidence.advancedItems.some((item) => item.startsWith('RPP-0801')));
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressBlockedUntilPrerequisitesPass, true);
  assert.equal(artifact.rppEvidence.dockerWordPressVerifyReleaseContract.command, 'npm run verify:release');
});

test('Passed Docker release artifact records verify:release topology without packaged fallback', (t) => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    evidenceDir: '/tmp/reprint-docker-local-production-evidence-test',
    env: graphEnv,
  });
  const probe = probeDockerPrerequisites({
    runCommand: (command, args) => {
      if (command !== 'docker') throw new Error(`Unexpected command: ${command}`);
      if (args[0] === '--version') return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      if (args[0] === 'compose') return { status: 0, stdout: '2.27.0', stderr: '' };
      if (args[0] === 'info') return { status: 0, stdout: '"26.1.0"', stderr: '' };
      throw new Error(`Unexpected args: ${args.join(' ')}`);
    },
  });
  const releaseEvidence = buildPassedDockerReleaseEvidence();
  const releaseEvidenceProvenance = buildDockerLocalProductionReleaseEvidenceProvenance({
    generatedAt: '2026-05-28T00:00:00.000Z',
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'passed',
    releaseEvidence,
    verify: { status: 0, signal: null },
    generatedAt: '2026-05-28T00:00:00.000Z',
    scope: 'final-release',
    releaseEvidenceProvenance,
  });

  assert.equal(artifact.status, 'passed');
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.packagedFallback, false);
  assert.equal(artifact.evidence.packagedFallback.observed, false);
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_LOCAL_PRODUCTION_FINAL_RELEASE_EVIDENCE');
  assert.equal(artifact.evidence.verifyReleaseFailure.statusMarker, '[RPP-DOCKER-LOCAL-PRODUCTION:PASS]');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.ok, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, 'npm run verify:release');
  assert.deepEqual(artifact.evidence.dockerVerifyReleaseTopology.commandArgs, dockerReleaseCommand);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseCommandIsVerifyRelease, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, true);
  assert.equal(artifact.releaseGateEvaluation.totals.passed, 21);
  assert.equal(artifact.releaseEvidenceProvenance.requiredProductionEvidence.length, 21);
  assert.equal(artifact.releaseEvidenceProvenance.evidenceRows.length, 21);
  assert.equal(
    artifact.releaseEvidenceProvenance.evidenceRows.every((row) => row.sourceKind === 'local-candidate'),
    true,
  );
  assert.equal(
    artifact.releaseEvidenceProvenance.evidenceRows.every((row) => row.operatorScope === 'local-candidate'),
    true,
  );
  assert.equal(artifact.rppEvidence.dockerWordPressVerifyReleaseContract.packagedFallbackAllowed, false);
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressLocalCandidateReady, true);
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-docker-passed-gate-artifact-'));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const artifactFile = path.join(tempDir, 'release-gate-input.json');
  fs.writeFileSync(artifactFile, `${JSON.stringify(artifact, null, 2)}\n`);
  const gateResult = runReleaseGateCli([
    '--evidence-file',
    artifactFile,
    '--scope',
    'final-release',
    '--now',
    '2026-05-28T00:20:00.000Z',
  ], {
    cwd: '/repo/reprint-push',
    env: {},
    now: new Date('2026-05-28T00:20:00.000Z'),
  });

  assert.equal(gateResult.exitCode, 1);
  assert.equal(gateResult.report.ok, false);
  assert.equal(gateResult.report.releaseStatus, 'NO-GO');
  assert.equal(gateResult.report.releaseMovement.allowed, true);
  assert.equal(gateResult.report.primaryFailureBucket, 'provenance');
  assert.equal(gateResult.report.primaryFailureCode, 'PRODUCTION_SOURCE_REQUIRED');
  assert.equal(gateResult.report.releaseEvidenceProvenance.required, true);
  assert.equal(gateResult.report.releaseEvidenceProvenance.ready, false);
  assert.deepEqual(gateResult.report.releaseEvidenceProvenance.summary.productionRequired, {
    total: 21,
    accepted: 0,
    rejected: 21,
  });
});

test('Docker local release provenance cannot be upgraded to production by caller-supplied rows', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    evidenceDir: '/tmp/reprint-docker-local-production-evidence-test',
    env: graphEnv,
  });
  const probe = probeDockerPrerequisites({
    runCommand: (command, args) => {
      if (command !== 'docker') throw new Error(`Unexpected command: ${command}`);
      if (args[0] === '--version') return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      if (args[0] === 'compose') return { status: 0, stdout: '2.27.0', stderr: '' };
      if (args[0] === 'info') return { status: 0, stdout: '"26.1.0"', stderr: '' };
      throw new Error(`Unexpected args: ${args.join(' ')}`);
    },
  });
  const releaseEvidence = buildPassedDockerReleaseEvidence();
  const forgedProductionProvenance = buildDockerLocalProductionReleaseEvidenceProvenance({
    generatedAt: '2026-05-28T00:00:00.000Z',
  });
  forgedProductionProvenance.evidenceRows = forgedProductionProvenance.evidenceRows.map((row) => ({
    ...row,
    sourceKind: 'operator-production',
    operatorScope: 'final-release',
  }));

  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'passed',
    releaseEvidence,
    verify: { status: 0, signal: null },
    generatedAt: '2026-05-28T00:00:00.000Z',
    scope: 'final-release',
    releaseEvidenceProvenance: forgedProductionProvenance,
  });

  assert.equal(artifact.status, 'passed');
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressLocalCandidateReady, true);
  assert.equal(
    artifact.releaseEvidenceProvenance.evidenceRows.every((row) => row.sourceKind === 'local-candidate'),
    true,
  );
  assert.equal(
    artifact.releaseEvidenceProvenance.evidenceRows.every((row) => row.operatorScope === 'local-candidate'),
    true,
  );
});

test('Release gate artifact is stable across run-local paths and can be consumed directly by the gate checker', () => {
  const makeArtifact = (workDir, evidenceDir, checkedAt) => {
    const plan = buildDockerTopologyPlan({
      cwd: '/repo/reprint-push',
      workDir,
      evidenceDir,
      env: graphEnv,
    });
    const probe = {
      ok: false,
      failClosed: true,
      checkedAt,
      checks: {
        dockerCli: {
          command: 'docker --version',
          ok: false,
          status: null,
          signal: null,
          stdout: '',
          stderr: '',
          missingExecutable: true,
          error: { code: 'ENOENT', message: 'spawn docker ENOENT' },
        },
        dockerCompose: null,
        dockerDaemon: null,
      },
      blocker: {
        code: 'DOCKER_CLI_MISSING',
        reason: 'Docker is not installed or is not on PATH; the local production proof must fail closed before any mutation attempt.',
        detail: {
          command: 'docker --version',
          ok: false,
          status: null,
          signal: null,
          stdout: '',
          stderr: '',
          missingExecutable: true,
          error: { code: 'ENOENT', message: 'spawn docker ENOENT' },
        },
      },
    };
    return buildPrerequisiteGateArtifact({
      probe,
      plan,
      status: 'blocked',
      generatedAt: '2026-05-28T00:00:00.000Z',
    });
  };
  const left = makeArtifact('/tmp/reprint-left-work', '/tmp/reprint-left-evidence', '2026-05-28T00:00:01.000Z');
  const right = makeArtifact('/tmp/reprint-right-work', '/tmp/reprint-right-evidence', '2026-05-28T00:00:02.000Z');

  assert.notEqual(left.artifactFile, right.artifactFile);
  assert.equal(left.deterministic.canonicalSha256, right.deterministic.canonicalSha256);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-docker-gate-artifact-'));
  const artifactFile = path.join(tempDir, 'release-gate-input.json');
  fs.writeFileSync(artifactFile, `${JSON.stringify(left, null, 2)}\n`);
  const result = runReleaseGateCli(['--evidence-file', artifactFile], {
    cwd: '/repo/reprint-push',
    env: {},
    now: new Date('2026-05-28T00:00:00.000Z'),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.gateState, 'held');
  assert.ok(
    result.report.evaluation.gates.some((gate) =>
      gate.id === 'verify-release-failure-reason'
      && gate.status === 'candidate'
      && gate.evidence.exitCode === 2),
  );
});

test('Assumed BrewCommerce real-site path stays fail-closed without Docker execution', async (t) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-docker-assumed-work-'));
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-docker-assumed-evidence-'));
  t.after(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  });
  let stdoutText = '';
  let stderrText = '';

  const result = await runDockerLocalProductionHarness({
    cwd: '/repo/reprint-push',
    env: {
      ...graphEnv,
      [brewcommerceAssumedRealSiteEnvKey]: '1',
      REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_WORKDIR: workDir,
      REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_DIR: evidenceDir,
      REPRINT_PUSH_DOCKER_LOCAL_PRODUCTION_EVIDENCE_GENERATED_AT: '2026-06-01T09:05:00.000Z',
    },
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
    stdout: { write: (chunk) => { stdoutText += String(chunk); } },
    stderr: { write: (chunk) => { stderrText += String(chunk); } },
  });

  const artifact = result.artifact;
  const artifactFile = path.join(evidenceDir, 'release-gate-input.json');

  assert.equal(result.status, 2);
  assert.equal(stderrText, '');
  assert.match(stdoutText, /brewcommerce-blueprint-assumed-real-site-support-only/);
  assert.match(stdoutText, /\[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED\]/);
  assert.equal(fs.existsSync(artifactFile), true);
  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.scope, 'final-release');
  assert.equal(artifact.ok, false);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.assumption.mode, brewcommerceAssumedRealSiteMode);
  assert.equal(artifact.prerequisiteProbe.blocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.brewcommerceBlueprintAssumedRealSite.ok, true);
  assert.equal(artifact.evidence.brewcommerceBlueprintAssumedRealSite.dockerExecuted, false);
  assert.equal(artifact.evidence.dockerLocalProductionProof.dockerExecuted, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.dockerExecuted, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyValidationOk, true);
  assert.equal(artifact.releaseGateEvaluation.ok, false);
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.releaseEvidenceProvenance.requiredProductionEvidence.length, 21);
  assert.equal(artifact.releaseEvidenceProvenance.evidenceRows.length, 21);
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);

  const gateResult = runReleaseGateCli([
    '--evidence-file',
    artifactFile,
    '--scope',
    'final-release',
    '--now',
    '2026-06-01T09:20:00.000Z',
  ], {
    cwd: '/repo/reprint-push',
    env: {},
    now: new Date('2026-06-01T09:20:00.000Z'),
  });

  assert.equal(gateResult.exitCode, 1);
  assert.equal(gateResult.report.ok, false);
  assert.equal(gateResult.report.releaseStatus, 'NO-GO');
  assert.equal(gateResult.report.releaseMovement.allowed, false);
  assert.equal(gateResult.report.releaseEvidenceProvenance.required, true);
  assert.equal(gateResult.report.releaseEvidenceProvenance.ready, false);
  assert.equal(gateResult.report.releaseEvidenceProvenance.summary.productionRequired.total, 21);
  assert.equal(gateResult.report.releaseEvidenceProvenance.summary.productionRequired.accepted, 0);
  assert.equal(gateResult.report.releaseEvidenceProvenance.summary.productionRequired.rejected, 21);
});

test('Runner planner proof script preserves the docker runtime and env-shaped complex fixture', () => {
  const script = renderRunnerPlannerProofScript();

  assert.match(script, /complexSiteFixtureShapeFromEnv\(process\.env\)/);
  assert.match(script, /docker-local-wordpress/);
  assert.match(script, /docker-local-production-complex-site-planner-proof/);
  assert.match(script, /REPRINT_PUSH_SOURCE_URL/);
});

test('Runner entrypoint proxies production-shaped verifier URLs through container loopback', () => {
  const plan = buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-docker-local-production-test',
    env: graphEnv,
  });
  const script = renderRunnerEntrypointScript(plan);

  assert.equal(dockerRunnerEntrypointScriptPath, '/workdir/docker-runner-entrypoint.mjs');
  assert.match(script, /createServer/);
  assert.match(script, /"listenHost": "127\.0\.0\.1"/);
  assert.match(script, /"listenPort": 8080/);
  assert.match(script, /"targetHost": "wp-source"/);
  assert.match(script, /spawn\(command\[0\], command\.slice\(1\)/);
  assert.doesNotMatch(script, /0\.0\.0\.0/);
});

function forbiddenTunnelPattern(value) {
  const escaped = escapeRegExp(value.toLowerCase());
  if (value === 'lt') {
    return new RegExp(`(^|[\\s"'/:])${escaped}($|[\\s"'/:])`);
  }
  return new RegExp(escaped);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
