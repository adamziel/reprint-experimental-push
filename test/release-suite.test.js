import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseSuiteSummary,
  loadReleaseSuiteManifest,
  releaseSuiteManifestPath,
} from '../scripts/release-suite.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('release suite manifest keeps four production gates and support evidence separate', () => {
  const manifest = loadReleaseSuiteManifest();

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.releaseGateTotal, 4);
  assert.equal(manifest.gates.length, 4);
  assert.equal(manifest.checkedCommand, 'npm run verify:release-suite');
  assert.equal(manifest.networkPolicy.ingressPort, 8080);
  assert.equal(manifest.networkPolicy.proxyPolicy, 'local-only');
  assert.equal(manifest.networkPolicy.tunnels, 'disallowed');
  assert.ok(manifest.gates.every((gate) => gate.claim && !/production-grade/.test(gate.claim)));
  assert.ok(
    manifest.gates.flatMap((gate) => gate.supportEvidence || []).every(
      (evidence) => evidence.classification === 'support-only',
    ),
  );
});

test('release suite fails closed with 0/4 gates when live production proof is unavailable', () => {
  const summary = buildReleaseSuiteSummary({
    env: {},
    runRelease: false,
    runSupport: false,
    now: new Date('2026-05-27T00:00:00.000Z'),
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(summary.releaseGates, {
    open: 0,
    total: 4,
    status: 'blocked',
    firstBlocker: {
      gate: 'production-owned-push-executor',
      code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      firstMissing: 'api:REPRINT_PUSH_SOURCE_URL production-owned /wp-json/reprint/v1/push/* endpoint',
    },
  });
  assert.equal(summary.gates[0].status, 'blocked');
  assert.equal(summary.gates[0].code, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.ok(summary.supportChecks.length > 0);
  assert.ok(summary.supportChecks.every((check) => check.classification === 'support-only'));
  assert.ok(summary.supportChecks.every((check) => check.status === 'not-run'));
});

test('release suite does not open gates from localhost-shaped credentials alone', () => {
  const summary = buildReleaseSuiteSummary({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'http://127.0.0.1:8080',
      REPRINT_PUSH_USERNAME: 'reprint_push_admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'reprint-push-admin-app-password',
      REPRINT_PUSH_PRODUCTION_OWNED_SOURCE: '1',
    },
    runRelease: false,
    runSupport: false,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseGates.open, 0);
  assert.equal(summary.releaseGates.firstBlocker.gate, 'production-owned-push-executor');
  assert.equal(summary.releaseGates.firstBlocker.code, 'REPRINT_PUSH_PRODUCTION_SOURCE_URL_REQUIRED');
  assert.equal(
    summary.releaseGates.firstBlocker.firstMissing,
    'api:https production-owned /wp-json/reprint/v1/push/* endpoint',
  );
});

test('release suite keeps plugin and performance gates blocked even when live env shape is present but commands are not run', () => {
  const summary = buildReleaseSuiteSummary({
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://source.example.test',
      REPRINT_PUSH_USERNAME: 'reprint_push_admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'reprint-push-admin-app-password',
      REPRINT_PUSH_PRODUCTION_OWNED_SOURCE: '1',
    },
    runRelease: false,
    runSupport: false,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseGates.open, 0);
  assert.equal(summary.gates[0].code, 'RELEASE_GATE_COMMAND_NOT_RUN');
  assert.equal(summary.gates[1].code, 'RELEASE_GATE_COMMAND_NOT_RUN');
  assert.equal(summary.gates[2].code, 'PRODUCTION_PLUGIN_DRIVER_CONTRACT_REQUIRED');
  assert.equal(summary.gates[3].code, 'PRODUCTION_THROUGHPUT_BENCHMARK_REQUIRED');
});

test('release suite cli emits parseable blocked JSON by default', () => {
  const result = spawnSync(process.execPath, ['scripts/release-suite.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
  });

  assert.equal(result.status, 1, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseGates.open, 0);
  assert.equal(summary.releaseGates.total, 4);
  assert.equal(summary.releaseGates.firstBlocker.code, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
});

test('release suite manifest cli prints the checked manifest', () => {
  const result = spawnSync(process.execPath, ['scripts/release-suite.mjs', '--manifest'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.contractId, 'push-production-release-suite-manifest');
  assert.equal(releaseSuiteManifestPath.endsWith('push-production-release-suite-manifest.json'), true);
});
