#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { createPushPlan } from '../src/planner.js';
import { applyPlan } from '../src/apply.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  const encoded = JSON.stringify(value, null, 2) + '\n';
  if (!path || path === '-') {
    process.stdout.write(encoded);
    return;
  }
  fs.writeFileSync(path, encoded);
}

function requirePath(args, key) {
  if (!args[key]) {
    throw new Error(`Missing --${key}`);
  }
  return args[key];
}

function printUsage() {
  process.stderr.write(`Usage:
  reprint-push-lab plan --base base.json --local local.json --remote remote.json [--out plan.json]
  reprint-push-lab apply --remote remote.json --plan plan.json [--out remote-after.json]

The lab works on deterministic JSON snapshots. It is not the production
WordPress transport; it is the executable safety model used to design it.
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  if (command === 'plan') {
    const plan = createPushPlan({
      base: readJson(requirePath(args, 'base')),
      local: readJson(requirePath(args, 'local')),
      remote: readJson(requirePath(args, 'remote')),
    });
    writeJson(args.out || '-', plan);
    return;
  }

  if (command === 'apply') {
    const result = applyPlan(
      readJson(requirePath(args, 'remote')),
      readJson(requirePath(args, 'plan')),
    );
    writeJson(args.out || '-', result.site);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

