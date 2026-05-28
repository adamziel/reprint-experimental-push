#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROW_PATH = '.agents/RELEASE_GATES.md';
const VALID_STATUSES = new Set(['unproven', 'support_only', 'partially_proven', 'proven', 'blocked']);

export function parseAgentsReleaseGatesStatusRow(markdown, options = {}) {
  const rowPath = options.path || DEFAULT_ROW_PATH;
  const scope = options.scope || 'final-release';
  const text = String(markdown || '');
  const releaseVerdict = matchFirst(text, /`release_verdict`:\s*`([^`]+)`/);
  const gateStatuses = parseGateStatuses(text);
  const statusCounts = countStatuses(gateStatuses);
  const lastRefreshed = parseLastRefreshed(text);
  const allGatesProven = gateStatuses.length > 0 && gateStatuses.every((gate) => gate.status === 'proven');
  const releaseStatus = releaseVerdict === '4/4' && allGatesProven ? 'GO' : 'NO-GO';
  const errors = [];

  if (!releaseVerdict) {
    errors.push('missing-release-verdict');
  }
  if (gateStatuses.length === 0) {
    errors.push('missing-gate-statuses');
  }
  for (const gate of gateStatuses) {
    if (!VALID_STATUSES.has(gate.status)) {
      errors.push(`invalid-status:${gate.gate}`);
    }
  }
  if (releaseVerdict === '4/4' && !allGatesProven) {
    errors.push('dishonest-release-verdict');
  }
  if (releaseVerdict !== '4/4' && allGatesProven) {
    errors.push('stale-release-verdict');
  }

  const ok = errors.length === 0;
  const observed = ok ? 'release-gates-status-row-no-go' : errors[0];

  return {
    ok,
    evidence: stripUndefined({
      ok,
      present: true,
      observed,
      code: ok ? undefined : 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
      reason: ok
        ? undefined
        : '.agents/RELEASE_GATES.md status row is stale or inconsistent with evaluator output.',
      path: rowPath,
      releaseVerdict,
      releaseStatus,
      gateStatuses,
      statusCounts,
      lastRefreshed,
      errors,
      scope,
    }),
  };
}

export function readAgentsReleaseGatesStatusRow(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const relativePath = options.path || DEFAULT_ROW_PATH;
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      evidence: {
        ok: false,
        present: false,
        observed: 'missing-agents-release-gates-row',
        code: 'AGENTS_RELEASE_GATES_ROW_REQUIRED',
        reason: '.agents/RELEASE_GATES.md status row evidence is required before release movement.',
        path: relativePath,
        scope: options.scope || 'final-release',
      },
    };
  }
  return parseAgentsReleaseGatesStatusRow(fs.readFileSync(absolutePath, 'utf8'), {
    path: relativePath,
    scope: options.scope || 'final-release',
  });
}

function parseGateStatuses(text) {
  const gatePattern = /^##\s+(GATE-\d+):\s*(.+)$/gm;
  const gates = [];
  let match;
  while ((match = gatePattern.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const end = text.indexOf('\n## ', start);
    const section = text.slice(start, end === -1 ? undefined : end);
    const status = matchFirst(section, /Status:\s*`([^`]+)`/);
    gates.push(stripUndefined({
      gate: match[1],
      title: match[2].trim(),
      status,
    }));
  }
  return gates;
}

function countStatuses(gates) {
  const counts = {};
  for (const gate of gates) {
    counts[gate.status || 'missing'] = (counts[gate.status || 'missing'] || 0) + 1;
  }
  return Object.keys(counts).sort().reduce((sorted, key) => {
    sorted[key] = counts[key];
    return sorted;
  }, {});
}

function parseLastRefreshed(text) {
  const match = text.match(/Last refreshed:\s*([^\n]+)(?:\n`([^`]+)`)?/);
  if (!match) {
    return '';
  }
  return [match[1].trim(), match[2]?.trim()].filter(Boolean).join(' ');
}

function matchFirst(text, regex) {
  return text.match(regex)?.[1]?.trim() || '';
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const report = readAgentsReleaseGatesStatusRow({ rootDir: process.cwd() });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
