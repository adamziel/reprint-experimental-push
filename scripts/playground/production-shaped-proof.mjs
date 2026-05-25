#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const protocolResult = spawnSync(process.execPath, ['--test', 'test/protocol-fixtures.test.js'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
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
  },
});

assert.equal(smokeResult.status, 1, 'missing-secret smoke must fail with a missing secret');
assert.match(
  smokeResult.stderr,
  /REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_SIGNING_SECRET or REPRINT_PUSH_APPLICATION_PASSWORD before running preflight, dry-run, or apply\./,
);

process.stdout.write(
  JSON.stringify(
    {
      protocol: { status: protocolResult.status },
      missingSecret: {
        status: smokeResult.status,
        code: 'REPRINT_PUSH_SECRET_REQUIRED',
      },
    },
    null,
    2,
  ),
);
process.stdout.write('\n');
