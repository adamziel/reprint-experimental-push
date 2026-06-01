import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDockerTopologyPlan,
  buildPrerequisiteGateArtifact,
  dockerReleaseCommand,
  dockerTopologyVariant,
  forbiddenPackagedFallbackEnvKeys,
  probeDockerPrerequisites,
  validateReleaseGateArtifact,
  validateTopologyPlan,
} from '../scripts/docker/production-complex-site-harness.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const generatedAt = '2026-06-01T00:00:00.000Z';
const deterministicEnv = Object.freeze({
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_POST_COUNT: '12',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_SCHEMA_META_COUNT: '5',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FILE_COUNT: '3',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_FORMS_ROWS: '4',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_POSTS: '3',
  REPRINT_PUSH_LOCAL_PRODUCTION_COMPLEX_REMOTE_DRIFT_FILES: '1',
});

test('RPP-0802 records exact Docker prerequisite blockers before release verifier movement', () => {
  const missingCli = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });

  assert.equal(missingCli.ok, false);
  assert.equal(missingCli.failClosed, true);
  assert.equal(missingCli.blocker.code, 'DOCKER_CLI_MISSING');
  assert.equal(missingCli.checks.dockerCli.command, 'docker --version');
  assert.equal(missingCli.checks.dockerCli.missingExecutable, true);
  assert.equal(missingCli.checks.dockerCompose, null);
  assert.equal(missingCli.checks.dockerDaemon, null);

  const missingCompose = probeDockerPrerequisites({
    runCommand: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      }
      if (args[0] === 'compose') {
        return { status: 1, stdout: '', stderr: 'docker: unknown command "compose"' };
      }
      throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
    },
  });

  assert.equal(missingCompose.ok, false);
  assert.equal(missingCompose.blocker.code, 'DOCKER_COMPOSE_UNAVAILABLE');
  assert.equal(missingCompose.checks.dockerCli.ok, true);
  assert.equal(missingCompose.checks.dockerCompose.command, 'docker compose version --short');
  assert.equal(missingCompose.checks.dockerCompose.ok, false);
  assert.equal(missingCompose.checks.dockerDaemon, null);

  const missingDaemon = probeDockerPrerequisites({
    runCommand: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      }
      if (args[0] === 'compose') {
        return { status: 0, stdout: '2.27.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
      }
      throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
    },
  });

  assert.equal(missingDaemon.ok, false);
  assert.equal(missingDaemon.blocker.code, 'DOCKER_DAEMON_UNAVAILABLE');
  assert.equal(missingDaemon.checks.dockerCli.ok, true);
  assert.equal(missingDaemon.checks.dockerCompose.ok, true);
  assert.equal(missingDaemon.checks.dockerDaemon.command, 'docker info --format {{json .ServerVersion}}');
  assert.equal(missingDaemon.checks.dockerDaemon.ok, false);
});

test('RPP-0802 blocked Docker artifact holds release movement and never claims packaged fallback', () => {
  const plan = buildRpp0802Plan();
  const probe = probeDockerPrerequisites({
    runCommand: () => ({
      error: Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }),
      stdout: '',
      stderr: '',
    }),
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'blocked',
    verify: { status: 2, signal: null },
    generatedAt,
  });

  assert.equal(artifact.status, 'blocked');
  assert.equal(artifact.ok, false);
  assert.equal(artifact.acceptedForReleaseGate, false);
  assert.equal(artifact.failClosed, true);
  assert.equal(artifact.packagedFallback, false);
  assert.deepEqual(artifact.env, {});
  assert.equal(artifact.evidence.packagedFallback.observed, false);
  assert.equal(artifact.evidence.dockerLocalProductionProof.code, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.ok, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, dockerReleaseCommand.join(' '));
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseCommandIsVerifyRelease, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyValidationOk, true);
  assert.equal(artifact.evidence.verifyReleaseFailure.exitCode, 2);
  assert.equal(artifact.evidence.verifyReleaseFailure.reason, 'DOCKER_CLI_MISSING');
  assert.equal(artifact.releaseGateEvaluation.releaseMovement.allowed, false);
  assert.equal(artifact.releaseGateEvaluation.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, false);
  assert.equal(artifact.rppEvidence.dockerWordPressBlockedUntilPrerequisitesPass, true);
  assert.equal(artifact.rppEvidence.dockerWordPressVerifyReleaseContract.blockerCode, 'DOCKER_CLI_MISSING');
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);

  const artifactFile = writeTempArtifact(artifact);
  const gateResult = runReleaseGateCli(['--evidence-file', artifactFile], {
    cwd: '/repo/reprint-push',
    env: {},
    now: new Date(generatedAt),
  });

  assert.equal(gateResult.exitCode, 1);
  assert.equal(gateResult.report.releaseStatus, 'NO-GO');
  assert.equal(gateResult.report.mutationAttempted, false);
  assert.equal(gateResult.report.releaseMovement.allowed, false);
  assert.equal(gateResult.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
});

test('RPP-0802 topology validation rejects packaged fallback and non-real release runners', () => {
  const plan = buildRpp0802Plan();

  assert.equal(plan.validation.ok, true);
  assert.equal(plan.validation.checks.releaseCommandIsVerifyRelease, true);
  assert.equal(plan.validation.checks.packagedFallbackDisabled, true);
  assert.deepEqual(plan.runner.releaseCommand, dockerReleaseCommand);
  assert.equal(plan.runner.packagedFallbackAllowed, false);
  for (const key of forbiddenPackagedFallbackEnvKeys) {
    assert.equal(plan.releaseEnv[key], undefined);
  }

  const packagedFallbackEnv = validateTopologyPlan({
    ...plan,
    releaseEnv: { ...plan.releaseEnv, REPRINT_PUSH_PACKAGE_SMOKE_MODE: 'driver-guard-only' },
  });
  assert.equal(packagedFallbackEnv.ok, false);
  assert.ok(packagedFallbackEnv.failures.some((failure) => failure.code === 'DOCKER_PACKAGED_FALLBACK_ENV_ENABLED'));

  const packagedFallbackRunner = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, packagedFallbackAllowed: true },
  });
  assert.equal(packagedFallbackRunner.ok, false);
  assert.ok(packagedFallbackRunner.failures.some((failure) => failure.code === 'DOCKER_PACKAGED_FALLBACK_NOT_DISABLED'));

  const nonReleaseRunner = validateTopologyPlan({
    ...plan,
    runner: { ...plan.runner, releaseCommand: ['npm', 'run', 'verify:release:local-production'] },
  });
  assert.equal(nonReleaseRunner.ok, false);
  assert.ok(nonReleaseRunner.failures.some((failure) => failure.code === 'DOCKER_RELEASE_COMMAND_NOT_VERIFY_RELEASE'));
});

test('RPP-0802 pass contract is verify:release on Docker DNS without packaged fallback', () => {
  const plan = buildRpp0802Plan();
  const probe = probeDockerPrerequisites({
    runCommand: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'Docker version 26.1.0', stderr: '' };
      }
      if (args[0] === 'compose') {
        return { status: 0, stdout: '2.27.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { status: 0, stdout: '"26.1.0"', stderr: '' };
      }
      throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
    },
  });
  const artifact = buildPrerequisiteGateArtifact({
    probe,
    plan,
    status: 'passed',
    releaseEvidence: {
      ok: true,
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
    },
    verify: { status: 0, signal: null },
    generatedAt,
  });

  assert.equal(probe.ok, true);
  assert.equal(artifact.status, 'passed');
  assert.equal(artifact.ok, true);
  assert.equal(artifact.acceptedForReleaseGate, true);
  assert.equal(artifact.failClosed, false);
  assert.equal(artifact.packagedFallback, false);
  assert.equal(artifact.evidence.verifyReleaseFailure, undefined);
  assert.equal(artifact.evidence.packagedFallback.observed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.ok, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.command, 'npm run verify:release');
  assert.deepEqual(artifact.evidence.dockerVerifyReleaseTopology.commandArgs, dockerReleaseCommand);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.topologyVariant, dockerTopologyVariant);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseUrlsUseDockerDns, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.releaseCommandIsVerifyRelease, true);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackAllowed, false);
  assert.equal(artifact.evidence.dockerVerifyReleaseTopology.packagedFallbackObserved, false);
  assert.equal(artifact.evidence.sourceUrl.url, 'http://wp-source');
  assert.equal(artifact.evidence.localUrl.url, 'http://wp-local-edited');
  assert.equal(artifact.evidence.remoteChangedUrl.url, 'http://wp-remote-changed');
  assert.equal(artifact.rppEvidence.dockerWordPressReleaseReady, true);
  assert.equal(artifact.rppEvidence.dockerWordPressBlockedUntilPrerequisitesPass, false);
  assert.equal(validateReleaseGateArtifact(artifact).ok, true);
});

function buildRpp0802Plan() {
  return buildDockerTopologyPlan({
    cwd: '/repo/reprint-push',
    workDir: '/tmp/reprint-rpp-0802-docker-work',
    evidenceDir: '/tmp/reprint-rpp-0802-docker-evidence',
    env: deterministicEnv,
  });
}

function writeTempArtifact(artifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0802-gate-artifact-'));
  const artifactFile = path.join(tempDir, 'release-gate-input.json');
  fs.writeFileSync(artifactFile, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifactFile;
}
