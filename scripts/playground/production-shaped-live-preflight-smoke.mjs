#!/usr/bin/env node
import assert from 'node:assert/strict';
import process from 'node:process';
import { authenticatedHttpClient } from '../../src/authenticated-http-push-client.js';

const sourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';
const username = process.env.REPRINT_PUSH_USERNAME || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || '';
const applicationPassword = process.env.REPRINT_PUSH_APPLICATION_PASSWORD || process.env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD || '';

if (!sourceUrl) {
  process.stderr.write(
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.\n',
  );
  process.exitCode = 1;
} else if (!username || !applicationPassword) {
  process.stderr.write(
    'REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_LAB_AUTH_ADMIN_USER and REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD before running preflight, dry-run, or apply.\n',
  );
  process.exitCode = 1;
} else {
  const client = authenticatedHttpClient({
    sourceUrl,
    credential: { username, password: applicationPassword },
    routeProfile: 'production-shaped',
  });

  const preflight = await client.signedGet('/preflight');
  assert.equal(preflight.status, 200, `production-shaped preflight HTTP ${preflight.status}`);
  assert.equal(preflight.body.ok, true, 'production-shaped preflight must report ok');
  assert.equal(preflight.body.routeProfile.profile, 'production-shaped');
  assert.match(preflight.body.session.id, /^[A-Za-z0-9_-]{32,160}$/);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        sourceUrl,
        routeProfile: preflight.body.routeProfile,
        session: {
          id: preflight.body.session.id,
          type: preflight.body.session.type,
        },
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
}
