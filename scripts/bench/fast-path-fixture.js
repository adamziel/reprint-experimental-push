#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildFastPathFixture } from './performance-model.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(buildFastPathFixture(), null, 2)}\n`);
}
