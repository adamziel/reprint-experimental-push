import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const progressHtmlPath = path.join(repoRoot, 'progress.html');
const progressReportPath = path.join(repoRoot, 'docs/evidence/ao-progress-report.md');
const refreshDocPath = path.join(repoRoot, 'docs/release/progress-surface-refresh.md');
const releaseGateScript = path.join(repoRoot, 'scripts/release/check-release-gates.mjs');
const sourceCommand = 'node scripts/release/check-release-gates.mjs --scope final-release';

function mainTag(html) {
  const match = html.match(/<main\s+([\s\S]*?)>/);
  assert.ok(match, 'missing main tag');
  return match[0];
}

function attributeValue(tag, name) {
  const pattern = new RegExp(`\\s${name}="([^"]*)"`);
  const match = tag.match(pattern);
  assert.ok(match, `missing ${name}`);
  return match[1];
}

function runReleaseGates(now) {
  const result = spawnSync(process.execPath, [
    releaseGateScript,
    '--scope',
    'final-release',
    '--now',
    now,
  ], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });

  assert.ok(result.stdout.trim(), result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout || result.stderr);
  return JSON.parse(result.stdout);
}

test('progress surface mirrors current release-gate snapshot instead of stale literals', () => {
  const html = fs.readFileSync(progressHtmlPath, 'utf8');
  const tag = mainTag(html);
  const generatedAt = attributeValue(tag, 'data-generated-at');
  const report = runReleaseGates(generatedAt);
  const finalGates = report.releaseMovement?.finalGates || report.releaseMovement?.gates;
  const blocking = String(report.totals?.blocking ?? report.releaseMovement?.missingEvidence?.length);

  assert.equal(attributeValue(tag, 'data-release-status'), report.releaseStatus);
  assert.equal(attributeValue(tag, 'data-final-gates'), finalGates);
  assert.equal(attributeValue(tag, 'data-blocking-gates'), blocking);
  assert.equal(attributeValue(tag, 'data-primary-failure-code'), report.primaryFailureCode);
  assert.equal(attributeValue(tag, 'data-source-command'), sourceCommand);
  assert.equal(attributeValue(tag, 'data-refresh-interval-ms'), '600000');
  assert.ok(html.includes(report.statusMarker));
  assert.ok(html.includes(`Final release is <strong>${report.releaseStatus}</strong>`));
  assert.ok(!html.includes('Final release remains <strong>NO-GO</strong>'));

  if (report.releaseStatus === 'NO-GO') {
    assert.ok(html.includes('data-release-status="NO-GO"'));
  }
});

test('progress surface keeps stages, plan, source, and 10-minute updater paths visible', () => {
  const html = fs.readFileSync(progressHtmlPath, 'utf8');
  const report = fs.readFileSync(progressReportPath, 'utf8');
  const refreshDoc = fs.readFileSync(refreshDocPath, 'utf8');

  assert.ok(html.includes('Release Stages'));
  assert.ok(html.includes('Current Plan'));
  assert.ok(html.includes('Source Snapshot'));
  assert.ok(html.includes('Managed watcher'));
  assert.ok(html.includes('refresh every 600000 ms, roughly 10 minutes'));
  assert.ok(html.includes('npm run refresh:progress-surface:watch:start'));
  assert.ok(html.includes('<code>storage-boundary-cas</code> is open'));

  assert.ok(report.includes(`Source of truth: \`${sourceCommand}\``));
  assert.ok(report.includes('| Stage | State | Snapshot | What matters |'));
  assert.ok(report.includes('Both loops repeat every `600000` ms by default'));
  assert.ok(report.includes('| Managed watcher |'));

  assert.ok(refreshDoc.includes('npm run refresh:progress-surface:watch:start'));
  assert.ok(refreshDoc.includes('node --check scripts/release/manage-progress-surface-watch.mjs'));
});
