import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts/release/operator-proof-status.mjs');

function readyEvidence(overrides = {}) {
  return deepMerge({
    releaseTimestamp: '2026-05-28T01:02:03.000Z',
    status: 'ready',
    releaseMovement: {
      allowed: true,
      state: 'release-ready',
      gates: '20/20',
      reason: 'all release gates are backed by final release evidence',
    },
    urls: {
      source: 'https://source.example.test/wp-json/reprint-push/v1/preflight?site=source',
      local: 'https://local.example.test/wp-json/reprint-push/v1/preflight?site=local',
      remote: 'https://remote-changed.example.test/wp-json/reprint-push/v1/preflight?site=remote-changed',
    },
    verification: {
      command: 'npm run verify:release',
      exitCode: 0,
      ok: true,
    },
  }, overrides);
}

function blockedEvidence(overrides = {}) {
  return deepMerge(readyEvidence({
    status: 'blocked',
    releaseMovement: {
      allowed: false,
      state: 'held',
      gates: '0/20',
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    },
    verification: {
      command: 'npm run verify:release',
      exitCode: 1,
      ok: false,
      failureReason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    },
  }), overrides);
}

function runWithFile(evidence) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-operator-proof-'));
  const filePath = path.join(tempDir, 'evidence.json');
  fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return spawnSync(process.execPath, [scriptPath, filePath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function runWithStdin(evidence) {
  return spawnSync(process.execPath, [scriptPath, '-'], {
    cwd: repoRoot,
    input: `${JSON.stringify(evidence)}\n`,
    encoding: 'utf8',
  });
}

function parseOperatorOutput(result) {
  assert.equal(result.error, undefined, result.error?.stack);
  const lines = result.stdout.trim().split('\n');
  const marker = lines.at(-1);
  const jsonText = lines.slice(0, -1).join('\n');
  return { status: JSON.parse(jsonText), marker };
}

test('ready release evidence emits stable JSON and a ready marker from a fixture file', () => {
  const result = runWithFile(readyEvidence());
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:READY]');
  assert.equal(status.marker, marker);
  assert.equal(status.status, 'ready');
  assert.equal(status.ok, true);
  assert.equal(status.releaseMovement.allowed, true);
  assert.equal(status.verification.exitCode, 0);
  assert.equal(status.urlEvidence.source.hash.length, 'sha256:'.length + 64);
  assert.equal(status.urlEvidence.local.format, 'hash+redacted');
  assert.equal(status.urlEvidence.remote.redacted, 'https://remote-changed.example.test/<redacted>');
  assert.doesNotMatch(result.stdout, /wp-json\/reprint-push/);
});

test('blocked release evidence emits a blocked marker and machine-readable reason from stdin', () => {
  const result = runWithStdin(blockedEvidence());
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1, 'blocked release status should be nonzero');
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:REPRINT_PUSH_LIVE_SOURCE_REQUIRED]');
  assert.equal(status.status, 'blocked');
  assert.equal(status.ok, false);
  assert.equal(status.reasonCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(status.releaseMovement.allowed, false);
  assert.equal(status.verification.exitCode, 1);
  assert.equal(status.errors.length, 0);
});

test('missing release timestamp fails closed', () => {
  const evidence = readyEvidence({ releaseTimestamp: undefined });
  delete evidence.releaseTimestamp;
  const result = runWithFile(evidence);
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:MISSING_RELEASE_TIMESTAMP]');
  assert.equal(status.reasonCode, 'MISSING_RELEASE_TIMESTAMP');
  assert.equal(status.errors[0].path, '$.releaseTimestamp');
});

test('raw secret-looking values fail closed without echoing the value', () => {
  const evidence = readyEvidence({
    credentials: {
      applicationPassword: 'plain-text-application-password-12345',
    },
  });
  const result = runWithFile(evidence);
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:RAW_SECRET_VALUE]');
  assert.equal(status.reasonCode, 'RAW_SECRET_VALUE');
  assert.deepEqual(status.secretFindings, [
    { path: '$.credentials.applicationPassword', key: 'applicationPassword' },
  ]);
  assert.doesNotMatch(result.stdout, /plain-text-application-password-12345/);
  assert.doesNotMatch(result.stderr, /plain-text-application-password-12345/);
});

test('missing releaseMovement summary fails closed', () => {
  const evidence = readyEvidence();
  delete evidence.releaseMovement;
  const result = runWithFile(evidence);
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:MISSING_RELEASE_MOVEMENT_SUMMARY]');
  assert.equal(status.errors[0].code, 'MISSING_RELEASE_MOVEMENT_SUMMARY');
});

test('missing URL evidence fails closed before release movement can be ready', () => {
  const evidence = readyEvidence();
  delete evidence.urls.local;
  const result = runWithFile(evidence);
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:MISSING_LOCAL_URL_EVIDENCE]');
  assert.equal(status.errors[0].path, '$.urls.local');
});

test('missing verification command result fails closed', () => {
  const evidence = readyEvidence();
  delete evidence.verification;
  const result = runWithFile(evidence);
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:MISSING_VERIFICATION_RESULT]');
  assert.equal(status.verification, null);
});

test('blocked evidence without a nonzero failure reason fails closed', () => {
  const evidence = blockedEvidence({
    releaseMovement: {
      allowed: false,
      state: 'held',
      gates: '0/20',
      reason: undefined,
    },
    verification: {
      command: 'npm run verify:release',
      exitCode: 2,
      ok: false,
      failureReason: undefined,
    },
  });
  const result = runWithStdin(evidence);
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:MISSING_BLOCKED_FAILURE_REASON]');
  assert.equal(status.errors[0].code, 'MISSING_BLOCKED_FAILURE_REASON');
});

test('inconsistent ready and blocked evidence fails closed', () => {
  const result = runWithFile(readyEvidence({
    status: 'ready',
    releaseMovement: {
      allowed: false,
      state: 'held',
      gates: '0/20',
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    },
  }));
  const { status, marker } = parseOperatorOutput(result);

  assert.equal(result.status, 1);
  assert.equal(marker, '[RPP-OPERATOR-PROOF:BLOCKED:INCONSISTENT_READY_BLOCKED_EVIDENCE]');
  assert.equal(status.errors[0].reason, 'ready status requires releaseMovement.allowed=true');
});

function deepMerge(base, overrides) {
  if (!isRecord(overrides)) {
    return structuredClone(base);
  }
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      merged[key] = value;
    } else if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
