#!/usr/bin/env node
import process from 'node:process';

const signingSecret = process.env.REPRINT_PUSH_SIGNING_SECRET || '';
const applicationPassword = process.env.REPRINT_PUSH_APPLICATION_PASSWORD || '';

if (!signingSecret && !applicationPassword) {
  process.stderr.write(
    'REPRINT_PUSH_SECRET_REQUIRED: production push credentials are missing; provide REPRINT_PUSH_SIGNING_SECRET or REPRINT_PUSH_APPLICATION_PASSWORD before running preflight, dry-run, or apply.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write('production push secret is present; missing-secret gate not triggered.\n');
}
