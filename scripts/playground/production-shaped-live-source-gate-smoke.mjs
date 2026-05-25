#!/usr/bin/env node
import process from 'node:process';

const liveSourceUrl = process.env.REPRINT_PUSH_SOURCE_URL || process.env.REPRINT_PUSH_REMOTE_URL || '';

if (!liveSourceUrl) {
  process.stderr.write(
    'REPRINT_PUSH_LIVE_SOURCE_REQUIRED: production push requires a live source URL; provide REPRINT_PUSH_SOURCE_URL before running preflight, dry-run, or apply.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write('production push live source is present; missing-live-source gate not triggered.\n');
}
