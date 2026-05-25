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

  assert.equal(livePreflightResult.status, 0, 'release proof must pass when live source and auth are present');
  process.stdout.write(livePreflightResult.stdout || '');
  process.stderr.write(livePreflightResult.stderr || '');
  process.stdout.write(
    JSON.stringify(
      {
        releaseProof: {
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

const missingSourceResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-live-source-gate-smoke.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    REPRINT_PUSH_SOURCE_URL: '',
    REPRINT_PUSH_REMOTE_URL: '',
    NODE_NO_WARNINGS: '1',
  },
});

assert.equal(missingSourceResult.status, 1, 'release proof must fail with the missing-live-source gate when no source is provided');
assert.match(
  missingSourceResult.stderr,
  /REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply\./,
);

const missingSecretResult = spawnSync(process.execPath, ['scripts/playground/production-shaped-missing-secret-smoke.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    REPRINT_PUSH_SIGNING_SECRET: '',
    REPRINT_PUSH_APPLICATION_PASSWORD: '',
    NODE_NO_WARNINGS: '1',
  },
});

assert.equal(missingSecretResult.status, 1, 'release proof must fail with the missing-secret gate when credentials are absent');
assert.match(
  missingSecretResult.stderr,
  /REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_SIGNING_SECRET or REPRINT_PUSH_APPLICATION_PASSWORD before running preflight, dry-run, or apply\./,
);

process.stdout.write(
  JSON.stringify(
    {
      releaseProof: { status: 0 },
      missingSecret: {
        status: missingSecretResult.status,
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
        stderr: missingSecretResult.stderr.trim(),
      },
      missingLiveSource: {
        status: missingSourceResult.status,
        code: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
        stderr: missingSourceResult.stderr.trim(),
      },
    },
    null,
    2,
  ),
);
process.stdout.write('\n');
