import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  forbiddenTunnelBinaries,
  probeDockerPrerequisites,
  renderComposeYaml,
  renderRunnerPlannerProofScript,
  renderSiteSeedPhp,
  validateTopologyPlan,
} from '../scripts/docker/production-complex-site-harness.mjs';

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
  assert.equal(plan.externalAccounts.required, false);
  assert.equal(plan.releaseEnv.REPRINT_PUSH_SOURCE_URL, 'http://wp-source');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_REMOTE_URL, 'http://wp-source');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_REMOTE_CHANGED_URL, 'http://wp-remote-changed');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_LOCAL_URL, 'http://wp-local-edited');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL, 'http://wp-apply-revalidation-source');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT, '25');
  assert.equal(plan.releaseEnv.REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_COMMENT_GRAPH_PROOF, '1');
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
  assert.match(compose, /"127\.0\.0\.1:8080:80"/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:8080/);
  assert.doesNotMatch(compose, /39000|49152/);
  for (const forbidden of forbiddenTunnelBinaries) {
    assert.doesNotMatch(compose.toLowerCase(), new RegExp(escapeRegExp(forbidden.toLowerCase())));
  }
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
    env: graphEnv,
  });
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });
  const artifact = buildPrerequisiteGateArtifact({ probe, plan, status: 'blocked' });

  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.topology.publishedPorts[0].hostPort, 8080);
  assert.equal(artifact.topology.validation.ok, true);
  assert.ok(artifact.rppEvidence.advancedItems.some((item) => item.startsWith('RPP-0801')));
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressBlockedUntilPrerequisitesPass, true);
});

test('Runner planner proof script preserves the docker runtime and env-shaped complex fixture', () => {
  const script = renderRunnerPlannerProofScript();

  assert.match(script, /complexSiteFixtureShapeFromEnv\(process\.env\)/);
  assert.match(script, /docker-local-wordpress/);
  assert.match(script, /docker-local-production-complex-site-planner-proof/);
  assert.match(script, /REPRINT_PUSH_SOURCE_URL/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
