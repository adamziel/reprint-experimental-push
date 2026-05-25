#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
const username = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || process.env.REPRINT_PUSH_USERNAME || '';
const applicationPassword = process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';

if (liveSourceUrl && username && applicationPassword) {
  const livePreflightResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-preflight-smoke.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: liveSourceUrl,
      REPRINT_PUSH_USERNAME: username,
      REPRINT_PUSH_APPLICATION_PASSWORD: applicationPassword,
      NODE_NO_WARNINGS: '1',
    },
  });

  assert.equal(livePreflightResult.status, 0, 'live preflight smoke must pass when live source and auth are present');
  process.stdout.write(livePreflightResult.stdout || '');
  process.stderr.write(livePreflightResult.stderr || '');
  process.exitCode = 0;
  process.stdout.write('\n');
  process.stdout.write(
    JSON.stringify(
      {
        livePreflight: {
          status: livePreflightResult.status,
          code: 'LIVE_PREFLIGHT_OK',
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.exit(0);
}

const protocolResult = spawnSync(process.execPath, ['--test', 'test/protocol-fixtures.test.js'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
  },
});

process.stdout.write(protocolResult.stdout || '');
process.stderr.write(protocolResult.stderr || '');
assert.equal(protocolResult.status, 0, 'protocol fixture test must pass');

const smokeResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-missing-secret-smoke.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    REPRINT_PUSH_SIGNING_SECRET: '',
    REPRINT_PUSH_APPLICATION_PASSWORD: '',
    NODE_NO_WARNINGS: '1',
  },
});

assert.equal(smokeResult.status, 1, 'missing-secret smoke must fail with a missing secret');
assert.match(
  smokeResult.stderr,
  /REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_SIGNING_SECRET or REPRINT_PUSH_APPLICATION_PASSWORD before running preflight, dry-run, or apply\./,
);

const liveSourceResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-source-gate-smoke.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    REPRINT_PUSH_SOURCE_URL: '',
    REPRINT_PUSH_REMOTE_URL: '',
    NODE_NO_WARNINGS: '1',
  },
});

assert.equal(liveSourceResult.status, 1, 'missing-live-source smoke must fail with a missing source URL');
assert.match(
  liveSourceResult.stderr,
  /REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply\./,
);

process.stdout.write(
  JSON.stringify(
    {
      protocol: { status: protocolResult.status },
      missingSecret: {
        status: smokeResult.status,
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
        stderr: smokeResult.stderr.trim(),
      },
      missingLiveSource: {
        status: liveSourceResult.status,
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        stderr: liveSourceResult.stderr.trim(),
      },
    },
    null,
    2,
  ),
);
process.stdout.write('\n');
