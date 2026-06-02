#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROGRESS_HTML = 'progress.html';
const PROGRESS_REPORT = 'docs/evidence/ao-progress-report.md';
const PROGRESS_REFRESH_DOC = 'docs/release/progress-surface-refresh.md';
const RELEASE_GATES_REPORT = 'docs/evidence/ao-release-gates.md';
const GO_NO_GO_RECORD = 'docs/release/go-no-go-release-decision-record.md';
const CHECKLIST_PATH = 'docs/reprint-push-completion-checklist.md';
const GENERATED_HARNESS_DOC = 'docs/generated-push-harness.md';
const WATCH_STATE_PATH = '.tmp/progress-surface-watch.json';
const WATCH_LOG_PATH = '.tmp/progress-surface-watch.log';
const DEFAULT_INTERVAL_MS = 600000;
const SOURCE_OF_TRUTH_COMMAND = 'node scripts/release/check-release-gates.mjs --scope final-release';
const GENERATED_HARNESS_COMMAND = 'node scripts/harness/generated-push-cases.js';
const PROOF_TIMESTAMP = '2026-05-28T03:18:00.000Z';
const PROOF_COMMAND = 'node --test test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const FOCUSED_PROOF_COMMAND = 'node --test test/release-gate-progress-release-timestamp-focused-regression.test.js test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const PRODUCTION_BINDING_CATEGORIES = new Set(['topology', 'auth', 'identity', 'route', 'recovery']);
const CARRY_THROUGH_ANCHORS = [
  {
    title: 'Focused `.agents/RELEASE_GATES.md` status row regression now checks `RPP-0079`',
    command: 'node --test test/release-gate-agents-status-row-focused-regression.test.js test/release-gates-status-row.test.js test/release-gate-status-row-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; generated `.agents/RELEASE_GATES.md` verdict: `0/4`; release status: `NO-GO`.',
  },
  {
    title: 'Focused `verify:release` nonzero failure reason regression now checks `RPP-0080`',
    command: 'node --test test/release-gate-verify-release-failure-focused-regression.test.js test/verify-release-failure-reason.test.js test/release-gate-verify-release-failure-generated.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verify:release marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`; release status: `NO-GO`.',
  },
  {
    title: 'Release verifier missing source URL carry-through now checks `RPP-0081`',
    command: 'node --test test/release-verifier-missing-source-url-carry-through-focused-regression.test.js test/release-gate-missing-source-url-regression.test.js test/release-gate-source-url-generated.test.js test/release-gate-verify-release-failure-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`; source gate: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; release status: `NO-GO`.',
  },
  {
    title: 'Release verifier missing local URL carry-through now checks `RPP-0082`',
    command: 'node --test test/release-verifier-missing-local-url-carry-through-focused-regression.test.js test/release-gate-missing-local-url-regression.test.js test/release-gate-local-url-generated.test.js test/release-verifier-missing-source-url-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_LOCAL_URL_REQUIRED mutationAttempted=false]`; local gate: `REPRINT_PUSH_LOCAL_URL_REQUIRED`; release status: `NO-GO`.',
  },
  {
    title: 'Release verifier missing changed-remote URL carry-through now checks `RPP-0083`',
    command: 'node --test test/release-verifier-missing-remote-changed-url-carry-through-focused-regression.test.js test/release-gate-missing-remote-changed-url-regression.test.js test/release-gate-remote-changed-url-generated.test.js test/release-verifier-missing-local-url-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED mutationAttempted=false]`; changed-remote gate: `REPRINT_PUSH_REMOTE_CHANGED_URL_REQUIRED`; release status: `NO-GO`.',
  },
  {
    title: 'Release verifier packaged fallback rejection carry-through now checks `RPP-0084`',
    command: 'node --test test/release-verifier-packaged-fallback-carry-through-focused-regression.test.js test/release-gate-packaged-fallback-regression.test.js test/release-gate-packaged-fallback-generated.test.js test/release-verifier-missing-remote-changed-url-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED mutationAttempted=false]`; fallback gate: `REPRINT_PUSH_PACKAGED_FALLBACK_REJECTED`; scenario matrix: `negative+positive`.',
  },
  {
    title: 'Release verifier wrong remote alias carry-through now checks `RPP-0085`',
    command: 'node --test test/release-verifier-wrong-remote-alias-carry-through-focused-regression.test.js test/release-gate-wrong-remote-alias-regression.test.js test/release-gate-wrong-remote-alias-generated.test.js test/release-verifier-packaged-fallback-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_SOURCE_URL_MISMATCH mutationAttempted=false]`; remote-alias gate: `REPRINT_PUSH_SOURCE_URL_MISMATCH`; release marker: `[release-gates-ci:held final=20/21 candidate=20/21 reason=REPRINT_PUSH_SOURCE_URL_MISMATCH]`.',
  },
  {
    title: 'Release verifier auth source command readback drift carry-through now checks `RPP-0086`',
    command: 'node --test test/release-verifier-auth-source-readback-carry-through-focused-regression.test.js test/release-gate-auth-source-readback-regression.test.js test/release-gate-auth-source-readback-generated.test.js test/release-verifier-wrong-remote-alias-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED mutationAttempted=false]`; auth-source-readback gate: `PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED`; release marker: `[release-gates-ci:held final=20/21 candidate=20/21 reason=PRODUCTION_AUTH_SESSION_BOUNDARY_REQUIRED]`.',
  },
  {
    title: 'Release verifier missing production secret carry-through now checks `RPP-0087`',
    command: 'node --test test/release-verifier-missing-production-secret-carry-through-focused-regression.test.js test/release-gate-missing-production-secret-regression.test.js test/release-gate-missing-production-secret-generated.test.js test/release-verifier-auth-source-readback-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=REPRINT_PUSH_SECRET_REQUIRED mutationAttempted=false]`; production-secret gate: `REPRINT_PUSH_SECRET_REQUIRED`; release marker: `[release-gates-ci:held final=20/21 candidate=20/21 reason=REPRINT_PUSH_SECRET_REQUIRED]`.',
  },
  {
    title: 'Release verifier Application Password credential binding carry-through now checks `RPP-0088`',
    command: 'node --test test/release-verifier-application-password-binding-carry-through-focused-regression.test.js test/release-gate-application-password-binding-regression.test.js test/release-gate-application-password-binding-generated.test.js test/release-verifier-missing-production-secret-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=APPLICATION_PASSWORD_BINDING_REQUIRED mutationAttempted=false]`; application-password-binding gate: `APPLICATION_PASSWORD_BINDING_REQUIRED`; release marker: `[release-gates-ci:held final=20/21 candidate=20/21 reason=APPLICATION_PASSWORD_BINDING_REQUIRED]`.',
  },
  {
    title: 'Release verifier manage_options capability carry-through now checks `RPP-0089`',
    command: 'node --test test/release-verifier-manage-options-carry-through-focused-regression.test.js test/release-gate-manage-options-capability-regression.test.js test/release-gate-manage-options-generated.test.js test/release-verifier-application-password-binding-carry-through-focused-regression.test.js test/release-gates.test.js test/release-gate-cli.test.js',
    observed: 'Observed status: `pass`; verifier marker: `[verify-release:held exit=1 reason=MANAGE_OPTIONS_CAPABILITY_REQUIRED mutationAttempted=false]`; manage-options gate: `MANAGE_OPTIONS_CAPABILITY_REQUIRED`; release marker: `[release-gates-ci:held final=20/21 candidate=20/21 reason=MANAGE_OPTIONS_CAPABILITY_REQUIRED]`.',
  },
];

function parseArgs(argv) {
  const options = {
    now: undefined,
    dryRun: false,
    check: false,
    watch: false,
    intervalMs: DEFAULT_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--now') {
      options.now = requiredValue(argv, ++index, arg);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--check') {
      options.check = true;
      options.dryRun = true;
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--interval-ms') {
      options.intervalMs = Number(requiredValue(argv, ++index, arg));
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1000) {
    throw new Error('--interval-ms must be at least 1000');
  }

  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/release/refresh-progress-surface.mjs [options]

Refreshes progress.html and docs/evidence/ao-progress-report.md from local
release-gate, checklist, and generated-harness state. The command does not
publish, serve, tunnel, or call remote services.

Options:
  --now <iso>        Timestamp to use for the refresh. Default: current time.
  --dry-run          Print the computed summary without writing files.
  --check            Fail if generated files differ from the current files.
  --watch            Repeat the refresh locally. Default interval: 600000 ms.
  --interval-ms <n>  Watch interval in milliseconds.
`);
}

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function currentGeneratedAt(root) {
  const file = path.join(root, PROGRESS_HTML);
  if (!fs.existsSync(file)) {
    return undefined;
  }

  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/\sdata-generated-at="([^"]+)"/);
  return match?.[1];
}

function normalizeNow(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --now value: ${value}`);
  }
  return date.toISOString();
}

function runJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!result.stdout.trim()) {
    throw new Error(`${command} ${args.join(' ')} produced no JSON output: ${result.stderr}`);
  }

  try {
    return {
      status: result.status,
      json: JSON.parse(result.stdout),
      stderr: result.stderr,
    };
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} produced invalid JSON: ${error.message}`);
  }
}

function releaseGateSnapshot(root, refreshIso) {
  const { status, json } = runJson(process.execPath, [
    'scripts/release/check-release-gates.mjs',
    '--scope',
    'final-release',
    '--now',
    refreshIso,
  ], { cwd: root });

  return { exitCode: status, report: json };
}

function generatedHarnessSnapshot(root) {
  const { json } = runJson(process.execPath, ['scripts/harness/generated-push-cases.js'], { cwd: root });
  return json;
}

function checklistSnapshot(root) {
  const text = readText(root, CHECKLIST_PATH);
  const checked = (text.match(/^[-*]\s+\[[xX]]\s+/gm) || []).length;
  const open = (text.match(/^[-*]\s+\[\s]\s+/gm) || []).length;
  return { checked, open, total: checked + open };
}

function bucketSummary(gates) {
  const buckets = new Map();
  for (const gate of gates) {
    const bucket = gate.category || 'uncategorized';
    if (!buckets.has(bucket)) {
      buckets.set(bucket, { bucket, total: 0, passed: 0, missing: 0, failed: 0, blocking: 0 });
    }
    const entry = buckets.get(bucket);
    entry.total += 1;
    if (gate.status === 'passed') entry.passed += 1;
    if (gate.status === 'missing') entry.missing += 1;
    if (gate.status === 'failed') entry.failed += 1;
    if (gate.blocking && gate.status !== 'passed') entry.blocking += 1;
  }
  return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function gateLists(report) {
  const gates = report.evaluation?.gates || [];
  return {
    gates,
    passed: gates.filter((gate) => gate.status === 'passed'),
    blockers: gates.filter((gate) => gate.blocking && gate.status !== 'passed'),
    buckets: bucketSummary(gates),
  };
}

function byId(gates, id) {
  return gates.find((gate) => gate.id === id);
}

function statusMarker(report) {
  return report.statusMarker || `[release-gates-ci:${report.status || 'held'} final=${report.releaseMovement?.finalGates || report.releaseMovement?.gates || 'unknown'} candidate=${report.releaseMovement?.candidateGates || 'unknown'} reason=${report.primaryFailureCode || 'UNKNOWN'}]`;
}

function gateProgress(release, gates) {
  const totals = release.totals || {};
  const movement = release.releaseMovement || {};
  const fraction = String(movement.finalGates || movement.gates || '');
  const match = fraction.match(/^(\d+)\/(\d+)$/);
  const passed = match ? Number(match[1]) : (totals.passed ?? gates.passed.length);
  const total = match ? Number(match[2]) : (totals.gates ?? gates.gates.length);
  const blocking = totals.blocking ?? gates.blockers.length;
  const missing = totals.missing ?? gates.gates.filter((gate) => gate.status === 'missing').length;
  const failed = totals.failed ?? gates.gates.filter((gate) => gate.status === 'failed').length;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((passed / total) * 100))) : 0;
  return {
    passed,
    total,
    blocking,
    missing,
    failed,
    fraction: total > 0 ? `${passed}/${total}` : 'unknown',
    pct,
  };
}

function pct(count, total) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((count / total) * 100))) : 0;
}

function titleCase(value) {
  return String(value)
    .split('-')
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function classifyStage(status) {
  if (status === 'checked' || status === 'ready') return 'ok';
  if (status === 'blocked' || status === 'held') return 'held';
  return 'active';
}

function stageModel(context) {
  const { release, gates, checklist, harness } = context;
  const progress = gateProgress(release, gates);
  const productionBlockers = gates.blockers.filter((gate) => PRODUCTION_BINDING_CATEGORIES.has(gate.category));
  const operatorBlockers = gates.blockers.filter((gate) => gate.category === 'operator-proof');
  const storageGate = byId(gates.gates, 'storage-boundary-cas');
  const storageHeld = storageGate?.status !== 'passed';
  return [
    {
      name: 'Support evidence inventory',
      status: checklist.open === 0 ? 'checked' : 'active',
      meta: `${checklist.checked}/${checklist.total} checklist`,
      detail: `${harness.totalCases} generated harness cases are cataloged (${harness.statuses.ready} ready, ${harness.statuses.conflict} conflict, ${harness.statuses.blocked} blocked). This is support evidence, not release approval.`,
    },
    {
      name: 'Release-gate evaluator',
      status: release.releaseStatus === 'GO' ? 'checked' : 'held',
      meta: `${progress.fraction} backed`,
      detail: `The final-release evaluator is the source of truth. It is read-only, reports mutationAttempted: ${release.mutationAttempted}, and currently names ${release.primaryFailureCode}.`,
    },
    {
      name: 'Production binding',
      status: productionBlockers.length > 0 ? 'blocked' : 'checked',
      meta: `${productionBlockers.length} blockers`,
      detail: 'Bind live topology, credential, identity, route, and recovery evidence to the final-release evaluator before release movement.',
    },
    {
      name: 'Storage boundary CAS',
      status: storageHeld ? 'blocked' : 'checked',
      meta: storageHeld ? (storageGate?.code || 'STORAGE_BOUNDARY_CAS_REQUIRED') : 'backed',
      detail: 'DB/file guarded-write smokes remain useful support proof, but final release needs production-backed storage-boundary CAS for every final target write.',
    },
    {
      name: 'Operator proof and updates',
      status: operatorBlockers.length > 0 ? 'active' : 'checked',
      meta: `${operatorBlockers.length} open`,
      detail: `Refresh this surface locally every ${DEFAULT_INTERVAL_MS} ms during active work, then run the focused progress checks before publishing.`,
    },
    {
      name: 'Final decision',
      status: release.releaseStatus === 'GO' ? 'ready' : 'held',
      meta: release.releaseStatus,
      detail: `The Go/No-Go record and this surface must keep final release ${release.releaseStatus} while the evaluator reports ${statusMarker(release)}.`,
    },
  ];
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function watcherSnapshot(root) {
  const statePath = path.join(root, WATCH_STATE_PATH);
  const logPath = path.join(root, WATCH_LOG_PATH);
  if (!fs.existsSync(statePath)) {
    return {
      state: 'not-started',
      alive: false,
      intervalMs: DEFAULT_INTERVAL_MS,
      statePath: WATCH_STATE_PATH,
      logPath: WATCH_LOG_PATH,
    };
  }

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const alive = processAlive(state.pid);
    return {
      state: alive ? 'running' : 'stale',
      alive,
      pid: state.pid,
      startedAt: state.startedAt,
      intervalMs: state.intervalMs || DEFAULT_INTERVAL_MS,
      statePath: WATCH_STATE_PATH,
      logPath: fs.existsSync(logPath) ? WATCH_LOG_PATH : undefined,
    };
  } catch (error) {
    return {
      state: 'invalid',
      alive: false,
      error: error instanceof Error ? error.message : String(error),
      statePath: WATCH_STATE_PATH,
      logPath: fs.existsSync(logPath) ? WATCH_LOG_PATH : undefined,
    };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMarkdown(context) {
  const { refreshIso, release, gates, checklist, harness, watcher } = context;
  const movement = release.releaseMovement || {};
  const storageGate = byId(gates.gates, 'storage-boundary-cas');
  const progress = gateProgress(release, gates);
  const stages = stageModel(context);
  const firstBlocker = gates.blockers[0];
  const passedIds = gates.passed.map((gate) => `${gate.rpp} ${gate.id}`).join(', ');
  const blockers = gates.blockers.map((gate) => `| ${gate.rpp} | \`${gate.id}\` | ${gate.category} | \`${gate.code}\` | ${gate.reason} |`).join('\n');
  const buckets = gates.buckets.map((bucket) => `| ${bucket.bucket} | ${bucket.passed}/${bucket.total} | ${bucket.blocking} |`).join('\n');
  const stageRows = stages.map((stage) => `| ${stage.name} | ${stage.status} | ${stage.meta} | ${stage.detail} |`).join('\n');
  const carryThroughAnchors = CARRY_THROUGH_ANCHORS.map((anchor) => `
### ${anchor.title}

- Command: \`${anchor.command}\`
- ${anchor.observed}
`).join('\n');

  return `# AO Progress Report

Generated: ${refreshIso}

Status: **${release.releaseStatus}**. This surface is refreshed from local
repository state only; it does not publish, serve, tunnel, or call remote
services. The release evaluator remains read-only and reports
\`mutationAttempted: ${release.mutationAttempted}\`.

Source of truth: \`${SOURCE_OF_TRUTH_COMMAND}\`

## Current State

| Signal | Value |
| --- | --- |
| Release status | \`${release.releaseStatus}\` |
| Final gates | \`${progress.fraction}\` (${progress.pct}% backed) |
| Candidate gates | \`${movement.candidateGates || 'unknown'}\` |
| Primary blocker | \`${release.primaryFailureCode}\` |
| Status marker | \`${statusMarker(release)}\` |
| Blocking gates | ${progress.blocking} |
| First blocker | ${firstBlocker ? `${firstBlocker.rpp} \`${firstBlocker.id}\` / \`${firstBlocker.code}\`` : 'none'} |
| Checklist | ${checklist.checked}/${checklist.total} checked, ${checklist.open} open |
| Generated harness | ${harness.totalCases} cases: ${harness.statuses.ready} ready, ${harness.statuses.conflict} conflict, ${harness.statuses.blocked} blocked |
| Managed watcher | ${watcher.state}, alive: ${watcher.alive}, cadence: ${watcher.intervalMs} ms |
| Storage smokes | DB guarded write: passed; file guarded write: passed |

The release model currently has **${progress.total} gates**. In the current
local evaluator snapshot, ${progress.passed} gate(s) pass (${passedIds || 'none'})
and ${progress.blocking} release-blocking gate(s) remain open. Final release is
**${release.releaseStatus}** because the evaluator reports
\`${release.primaryFailureCode}\`.

## Current Plan

1. Keep all local, generated, Docker-local, graph, plugin-driver, recovery, and
   audit evidence as support evidence only.
2. Bind the release run to production-scoped topology, credential, identity,
   route, recovery, storage, and operator evidence.
3. Treat \`storage-boundary-cas\` as an explicit final-release blocker, not as
   covered by adjacent MySQL, SQLite, filesystem, chunking, or benchmark support
   proof, even though the DB/file guarded-write smokes pass locally.
4. Refresh this page and report during active work with the repo-local command
   below, then run the listed validation checks before publishing.

## Stage Map

| Stage | State | Snapshot | What matters |
| --- | --- | --- | --- |
${stageRows}

## ${progress.total}-Gate Release Model

| Bucket | Passed | Blocking now |
| --- | --- | --- |
${buckets}

## Remaining Blockers

| RPP | Gate | Bucket | Code | Reason |
| --- | --- | --- | --- | --- |
${blockers}

### Explicit Storage Blocker

\`${storageGate?.id || 'storage-boundary-cas'}\` is open with
\`${storageGate?.code || 'STORAGE_BOUNDARY_CAS_REQUIRED'}\`.
Required closure is production-backed evidence that every final target write is
guarded at the storage boundary, revalidated before mutation, and rejects
stale-at-write attempts without later mutation. The local DB guarded-write and
file guarded-write smokes pass, but they do not close this final-release gate.

Storage smoke commands recorded for this surface:

- \`npm run test:playground:storage-guarded-db-write\` -> \`pass\`
- \`npm run test:playground:storage-guarded-file-write\` -> \`pass\`

## Refresh Mechanism

One-shot refresh:

\`\`\`sh
npm run refresh:progress-surface
\`\`\`

Active-work loop, roughly every 10 minutes:

\`\`\`sh
npm run refresh:progress-surface:watch
\`\`\`

Managed active-work loop, also every 10 minutes:

\`\`\`sh
npm run refresh:progress-surface:watch:start
npm run refresh:progress-surface:watch:status
npm run refresh:progress-surface:watch:stop
\`\`\`

Both loops repeat every \`${DEFAULT_INTERVAL_MS}\` ms by default, are local-only,
and have no remote network or tunnel dependency. Stop the foreground loop with
Ctrl-C, or use the managed \`stop\` command for the detached watcher. For
deterministic checks use:

\`\`\`sh
npm run check:progress-surface
\`\`\`

## Timestamp Proof Compatibility

Integrated progress timestamp proof for \`RPP-0038\` remains preserved for the
existing release-gate tests.

- Command: \`${PROOF_COMMAND}\`
- Observed status: \`pass\`; progress.html release status: \`NO-GO\`; proof timestamp: \`${PROOF_TIMESTAMP}\`.
- The release remains held until production provenance is supplied.

Focused progress timestamp regression now checks \`RPP-0078\` against the same
progress page anchor.

- Command: \`${FOCUSED_PROOF_COMMAND}\`
- Observed status: \`pass\`; progress.html release status: \`NO-GO\`; proof timestamp: \`${PROOF_TIMESTAMP}\`.

## Carry-Through Regression Anchors

These anchors preserve the release-verifier proof chain while the progress
surface is regenerated from current state.

${carryThroughAnchors}

## Source Files

- \`${PROGRESS_HTML}\`
- \`${PROGRESS_REPORT}\`
- \`${PROGRESS_REFRESH_DOC}\`
- \`${RELEASE_GATES_REPORT}\`
- \`${GO_NO_GO_RECORD}\`
- \`${CHECKLIST_PATH}\`
- \`${GENERATED_HARNESS_DOC}\`
`;
}

function renderHtml(context) {
  const { refreshIso, release, gates, checklist, harness, watcher } = context;
  const movement = release.releaseMovement || {};
  const storageGate = byId(gates.gates, 'storage-boundary-cas');
  const progress = gateProgress(release, gates);
  const stages = stageModel(context);
  const firstBlocker = gates.blockers[0];
  const releaseClass = release.releaseStatus === 'GO' ? 'ok' : 'held';
  const releasePhrase = release.releaseStatus === 'GO' ? 'release ready' : 'release held';
  const sourceCommand = `${SOURCE_OF_TRUTH_COMMAND} --now ${refreshIso}`;
  const bucketRows = gates.buckets.map((bucket) => `
              <tr>
                <td>${escapeHtml(titleCase(bucket.bucket))}</td>
                <td>${bucket.passed}/${bucket.total}</td>
                <td>${bucket.blocking}</td>
              </tr>`).join('');
  const blockerRows = gates.blockers.map((gate) => `
              <tr${gate.id === 'storage-boundary-cas' ? ' class="storage-row"' : ''}>
                <td>${escapeHtml(gate.rpp)}</td>
                <td><code>${escapeHtml(gate.id)}</code></td>
                <td>${escapeHtml(gate.category)}</td>
                <td><code>${escapeHtml(gate.code)}</code></td>
                <td>${escapeHtml(gate.reason)}</td>
              </tr>`).join('');
  const blockerTableRows = blockerRows || `
              <tr>
                <td colspan="5">No blocking gates in the current evaluator snapshot.</td>
              </tr>`;
  const gateSvgWidth = Math.max(210, gates.gates.length * 10);
  const gateRects = gates.gates.map((gate, index) => `
              <rect x="${index * 10}" y="0" width="7" height="22" rx="1" class="${gate.status === 'passed' ? 'gate-ok' : 'gate-held'}">
                <title>${escapeHtml(`${gate.rpp} ${gate.category} gate: ${gate.status}`)}</title>
              </rect>`).join('');
  const passedGates = gates.passed.length > 0
    ? gates.passed.map((gate) => `<li><code>${escapeHtml(gate.id)}</code> <span>${escapeHtml(gate.rpp)}</span></li>`).join('')
    : '<li>No passed gates in the current evaluator snapshot.</li>';
  const stageItems = stages.map((stage, index) => {
    const className = classifyStage(stage.status);
    return `
          <li class="stage stage-${className}">
            <div class="stage-index">${index + 1}</div>
            <div>
              <div class="stage-top">
                <h3>${escapeHtml(stage.name)}</h3>
                <span class="pill pill-${className}">${escapeHtml(stage.status)}</span>
              </div>
              <p class="stage-meta">${escapeHtml(stage.meta)}</p>
              <p>${escapeHtml(stage.detail)}</p>
            </div>
          </li>`;
  }).join('');
  const planItems = [
    'Keep support evidence separate from production release approval.',
    'Bind production topology, credential, identity, route, recovery, storage, and operator proof into the final-release evaluator.',
    'Treat storage-boundary-cas as an explicit final-release blocker until production CAS evidence is supplied.',
    'Refresh this page locally during active work and validate before any publish proof.',
  ].map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const readyPct = pct(harness.statuses.ready, harness.totalCases);
  const conflictPct = pct(harness.statuses.conflict, harness.totalCases);
  const blockedPct = Math.max(0, 100 - readyPct - conflictPct);
  const firstBlockerText = firstBlocker
    ? `${firstBlocker.rpp} ${firstBlocker.id}: ${firstBlocker.reason}`
    : 'No blocking release gates in the current snapshot.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reprint Push Progress</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #18191c;
      --muted: #5f6670;
      --line: #d9dee5;
      --paper: #ffffff;
      --wash: #eef1f4;
      --wash-strong: #e4e8ed;
      --blue: #1f5f91;
      --cyan: #24788f;
      --green: #23704f;
      --amber: #8b5f16;
      --red: #a63a32;
      --red-wash: #fff0ee;
      --green-wash: #ecf7f1;
      --amber-wash: #fff6df;
      --blue-wash: #eaf3f8;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--wash);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      overflow-x: hidden;
    }

    main {
      width: min(1240px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 48px;
    }

    h1, h2, h3, p { margin: 0; }

    h1 {
      max-width: 760px;
      font-size: 2.35rem;
      line-height: 1.05;
      letter-spacing: 0;
    }

    h2 {
      font-size: 1.03rem;
      line-height: 1.25;
      letter-spacing: 0;
    }

    h3 {
      font-size: 0.94rem;
      line-height: 1.3;
      letter-spacing: 0;
    }

    p, td, th, li { font-size: 0.95rem; }
    p { color: var(--muted); }
    a { color: var(--blue); text-underline-offset: 0.18em; }
    strong, code { overflow-wrap: anywhere; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
      gap: 18px;
      align-items: stretch;
      margin-bottom: 14px;
    }

    .hero-copy,
    .status-rail,
    .panel,
    .metric {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .hero-copy {
      padding: 22px;
      border-top: 5px solid var(--blue);
    }

    .status-rail {
      display: grid;
      align-content: space-between;
      gap: 14px;
      padding: 18px;
      border-top: 5px solid var(--red);
    }

    .status-rail.ok { border-top-color: var(--green); }

    .topbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
    }

    .eyebrow {
      color: var(--cyan);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .lead {
      margin-top: 10px;
      color: #363e47;
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 10px;
      background: #f9fafb;
      color: var(--ink);
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
      max-width: 100%;
    }

    .button:focus-visible {
      outline: 3px solid rgba(31, 95, 145, 0.28);
      outline-offset: 2px;
    }

    .stamp {
      display: inline-flex;
      width: fit-content;
      max-width: 100%;
      border: 1px solid rgba(31, 95, 145, 0.22);
      border-radius: 6px;
      padding: 4px 10px;
      background: var(--blue-wash);
      color: var(--blue);
      font-size: 0.84rem;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .status-word {
      color: var(--red);
      font-size: 2.05rem;
      font-weight: 850;
      line-height: 1;
    }

    .status-word.ok { color: var(--green); }

    .rail-label {
      margin-top: 6px;
      color: var(--muted);
      font-size: 0.86rem;
      font-weight: 700;
    }

    .marker {
      overflow-wrap: anywhere;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px;
      background: #f7f9fb;
      color: #333b45;
      font-size: 0.82rem;
    }

    .progress-bar {
      height: 12px;
      overflow: hidden;
      border-radius: 6px;
      background: var(--wash-strong);
    }

    .progress-fill {
      height: 100%;
      border-radius: inherit;
      background: var(--red);
    }

    .progress-fill.ok { background: var(--green); }

    .gate-map {
      width: 100%;
      height: 22px;
      margin-top: 10px;
    }

    .gate-ok { fill: var(--green); }
    .gate-held { fill: var(--red); }

    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }

    .metric {
      min-height: 92px;
      padding: 13px;
    }

    .metric strong {
      display: block;
      margin-bottom: 4px;
      font-size: 1.55rem;
      line-height: 1;
    }

    .metric span {
      color: var(--muted);
      font-size: 0.88rem;
    }

    .held { color: var(--red); }
    .ok { color: var(--green); }
    .warn { color: var(--amber); }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(340px, 0.76fr);
      gap: 14px;
      align-items: start;
    }

    .panel {
      margin-bottom: 14px;
      padding: 16px;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 14px;
    }

    .panel-head span {
      color: var(--muted);
      font-size: 0.86rem;
      white-space: nowrap;
    }

    .stage-list,
    .plain-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .stage {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }

    .stage:first-child { border-top: 0; padding-top: 0; }

    .stage-index {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: var(--wash-strong);
      color: #39424d;
      font-size: 0.8rem;
      font-weight: 850;
    }

    .stage-ok .stage-index { background: var(--green-wash); color: var(--green); }
    .stage-held .stage-index { background: var(--red-wash); color: var(--red); }
    .stage-active .stage-index { background: var(--amber-wash); color: var(--amber); }

    .stage-top {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 3px;
    }

    .stage-meta {
      margin-bottom: 3px;
      color: #2f3842;
      font-weight: 750;
    }

    .pill {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      min-height: 24px;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .pill-ok { background: var(--green-wash); color: var(--green); }
    .pill-held { background: var(--red-wash); color: var(--red); }
    .pill-active { background: var(--amber-wash); color: var(--amber); }

    .plain-list li {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      gap: 8px;
      color: var(--muted);
    }

    .plain-list li::before {
      content: "";
      width: 7px;
      height: 7px;
      margin-top: 9px;
      border-radius: 4px;
      background: var(--blue);
    }

    .notice {
      border: 1px solid rgba(159, 51, 43, 0.28);
      border-radius: 8px;
      padding: 12px;
      background: var(--red-wash);
    }

    .notice p { color: #5d221d; }

    .source-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .source-box {
      min-width: 0;
      border-top: 1px solid var(--line);
      padding: 11px 0 0;
    }

    .source-box strong {
      display: block;
      margin-bottom: 5px;
      font-size: 0.86rem;
    }

    .harness-stack {
      display: flex;
      height: 10px;
      overflow: hidden;
      margin-top: 10px;
      border-radius: 5px;
      background: var(--wash-strong);
    }

    .harness-ready { background: var(--green); }
    .harness-conflict { background: var(--amber); }
    .harness-blocked { background: var(--red); }

    .grid-two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th, td {
      border-top: 1px solid var(--line);
      padding: 9px 8px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    th {
      color: #2d3540;
      font-size: 0.78rem;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .storage-row td { background: #fff6f4; }

    .passed-list {
      display: grid;
      gap: 7px;
      margin: 0;
      padding-left: 18px;
    }

    .passed-list span {
      color: var(--muted);
      font-size: 0.86rem;
    }

    .proof-item {
      border-top: 1px solid var(--line);
      margin-top: 12px;
      padding-top: 12px;
    }

    .proof-item .status {
      display: inline-flex;
      margin-bottom: 6px;
      border: 1px solid rgba(31, 122, 77, 0.28);
      border-radius: 4px;
      padding: 2px 8px;
      color: var(--green);
      background: var(--green-wash);
      font-size: 0.78rem;
      font-weight: 800;
    }

    @media (max-width: 900px) {
      main {
        width: auto;
        margin: 0 16px;
        padding: 24px 0 48px;
      }

      .hero,
      .layout,
      .metrics,
      .grid-two,
      .source-grid {
        grid-template-columns: 1fr;
      }

      h1 { font-size: 1.9rem; }
      .panel-head { display: block; }
      .panel-head span { display: block; margin-top: 4px; white-space: normal; }
      .stage { grid-template-columns: 1fr; gap: 6px; }
      .stage-index { width: 26px; height: 26px; }
      .button { white-space: normal; }
    }

    @media (max-width: 600px) {
      main {
        width: min(100vw, 390px);
        margin: 0;
        padding: 24px 8px 48px;
      }
    }
  </style>
</head>
<body>
  <main
    data-generated-at="${escapeHtml(refreshIso)}"
    data-release-status="${escapeHtml(release.releaseStatus)}"
    data-final-gates="${escapeHtml(progress.fraction)}"
    data-blocking-gates="${progress.blocking}"
    data-primary-failure-code="${escapeHtml(release.primaryFailureCode)}"
    data-refresh-interval-ms="${DEFAULT_INTERVAL_MS}"
    data-source-command="${escapeHtml(SOURCE_OF_TRUTH_COMMAND)}"
  >
    <section class="hero" aria-labelledby="page-title">
      <div class="hero-copy">
        <div class="topbar">
          <p class="eyebrow">Evidence-led release progress</p>
          <time class="stamp" datetime="${escapeHtml(refreshIso)}">Refreshed: ${escapeHtml(refreshIso)}</time>
        </div>
        <h1 id="page-title">Reprint Push Progress</h1>
        <p class="lead">Final release is <strong>${escapeHtml(release.releaseStatus)}</strong> because the current final-release gate evaluator reports <strong>${escapeHtml(release.primaryFailureCode)}</strong>. We are at <strong>${escapeHtml(progress.fraction)}</strong> gates backed (${progress.pct}%), with ${progress.blocking} release-blocking gate(s) still open.</p>
      </div>
      <aside class="status-rail ${releaseClass}" aria-label="Current release status">
        <div>
          <div class="status-word ${releaseClass}">${escapeHtml(release.releaseStatus)}</div>
          <p class="rail-label">${escapeHtml(releasePhrase)} / ${escapeHtml(progress.fraction)} gates</p>
        </div>
        <div>
          <div class="progress-bar" aria-label="${escapeHtml(progress.fraction)} release gates backed">
            <div class="progress-fill ${releaseClass}" style="width: ${progress.pct}%"></div>
          </div>
          <svg class="gate-map" viewBox="0 0 ${gateSvgWidth} 22" role="img" aria-label="${progress.passed} passed release gates and ${progress.blocking} blocking release gates">
${gateRects}
          </svg>
          <p class="rail-label">${progress.pct}% backed, ${progress.blocking} blocking</p>
        </div>
        <div class="marker">${escapeHtml(statusMarker(release))}</div>
      </aside>
    </section>

    <nav class="actions" aria-label="Evidence links">
      <a class="button" href="${CHECKLIST_PATH}">Checklist</a>
      <a class="button" href="${PROGRESS_REPORT}">Report</a>
      <a class="button" href="${GO_NO_GO_RECORD}">Go/No-Go</a>
      <a class="button" href="${PROGRESS_REFRESH_DOC}">Refresh</a>
      <a class="button" href="${RELEASE_GATES_REPORT}">Gate Evidence</a>
    </nav>

    <section class="metrics" aria-label="Current summary">
      <div class="metric">
        <strong class="${releaseClass}">${escapeHtml(release.releaseStatus)}</strong>
        <span>final release</span>
      </div>
      <div class="metric">
        <strong>${escapeHtml(progress.fraction)}</strong>
        <span>final gates</span>
      </div>
      <div class="metric">
        <strong class="warn">${progress.blocking}</strong>
        <span>blocking gates</span>
      </div>
      <div class="metric">
        <strong class="ok">${checklist.checked}/${checklist.total}</strong>
        <span>RPP checklist</span>
      </div>
    </section>

    <div class="layout">
      <section class="panel" aria-labelledby="stages-title">
        <div class="panel-head">
          <h2 id="stages-title">Release Stages</h2>
          <span>${escapeHtml(progress.fraction)} backed now</span>
        </div>
        <ul class="stage-list">
${stageItems}
        </ul>
      </section>

      <section class="panel" aria-labelledby="plan-title">
        <div class="panel-head">
          <h2 id="plan-title">Current Plan</h2>
          <span>Release movement stays evaluator-led</span>
        </div>
        <ul class="plain-list">
${planItems}
        </ul>
      </section>
    </div>

    <section class="panel" aria-labelledby="source-title">
      <div class="panel-head">
        <h2 id="source-title">Source Snapshot</h2>
        <span>Generated from current local data</span>
      </div>
      <div class="source-grid">
        <div class="source-box">
          <strong>Release gates</strong>
          <p><code>${escapeHtml(sourceCommand)}</code></p>
        </div>
        <div class="source-box">
          <strong>First blocker</strong>
          <p>${escapeHtml(firstBlockerText)}</p>
        </div>
        <div class="source-box">
          <strong>Generated harness</strong>
          <p><code>${escapeHtml(GENERATED_HARNESS_COMMAND)}</code> -> ${harness.totalCases} cases.</p>
          <div class="harness-stack" aria-label="Generated harness status mix">
            <span class="harness-ready" style="width: ${readyPct}%"></span>
            <span class="harness-conflict" style="width: ${conflictPct}%"></span>
            <span class="harness-blocked" style="width: ${blockedPct}%"></span>
          </div>
        </div>
        <div class="source-box">
          <strong>Update cadence</strong>
          <p><code>npm run refresh:progress-surface:watch</code> or managed watcher commands refresh every ${DEFAULT_INTERVAL_MS} ms, roughly 10 minutes.</p>
        </div>
        <div class="source-box">
          <strong>Managed watcher</strong>
          <p>${escapeHtml(watcher.state)}; alive: ${escapeHtml(watcher.alive)}; cadence: ${escapeHtml(watcher.intervalMs)} ms.</p>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="storage-title">
      <div class="panel-head">
        <h2 id="storage-title">Explicit Storage Blocker</h2>
        <span>${escapeHtml(storageGate?.code || 'STORAGE_BOUNDARY_CAS_REQUIRED')}</span>
      </div>
      <div class="notice">
        <p><strong><code>${escapeHtml(storageGate?.id || 'storage-boundary-cas')}</code> is open.</strong> Release movement requires production-backed evidence that every final target write is guarded at the storage boundary, revalidated before mutation, and rejects stale-at-write attempts without later mutation. The DB guarded-write and file guarded-write smokes pass locally as support evidence only.</p>
      </div>
    </section>

    <section class="panel" aria-labelledby="gates-title">
      <div class="panel-head">
        <h2 id="gates-title">${progress.total}-Gate Model</h2>
        <span>${progress.passed} passed / ${progress.blocking} blocking</span>
      </div>
      <div class="grid-two">
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Passed</th>
              <th>Blocking</th>
            </tr>
          </thead>
          <tbody>${bucketRows}
          </tbody>
        </table>
        <div>
          <h3>Passed Gates</h3>
          <ul class="passed-list">
            ${passedGates}
          </ul>
          <p>These passed gates do not close production risk. The release remains held until all blocking gates have final-release evidence.</p>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="blockers-title">
      <div class="panel-head">
        <h2 id="blockers-title">Remaining Blockers</h2>
        <span>All require production-scoped closure</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>RPP</th>
            <th>Gate</th>
            <th>Bucket</th>
            <th>Code</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>${blockerTableRows}
        </tbody>
      </table>
    </section>

    <section class="panel" aria-labelledby="refresh-title">
      <div class="panel-head">
        <h2 id="refresh-title">Refresh Mechanism</h2>
        <span>Local-only, no tunnels</span>
      </div>
      <p>One-shot refresh: <code>npm run refresh:progress-surface</code>. Foreground active-work loop: <code>npm run refresh:progress-surface:watch</code>, which repeats every ${DEFAULT_INTERVAL_MS} ms until Ctrl-C. Managed loop: <code>npm run refresh:progress-surface:watch:start</code>, <code>npm run refresh:progress-surface:watch:status</code>, and <code>npm run refresh:progress-surface:watch:stop</code>. Validation: <code>npm run check:progress-surface</code>. Publishing proof remains separate with <code>npm run publish:progress-page:dry-run</code>.</p>
    </section>

    <section class="panel" aria-labelledby="links-title">
      <div class="panel-head">
        <h2 id="links-title">Drill-In Links</h2>
        <span>Full evidence lives off-page</span>
      </div>
      <ul class="plain-list">
        <li><a href="${RELEASE_GATES_REPORT}">Release gate evidence</a></li>
        <li><a href="${GO_NO_GO_RECORD}">Go/No-Go release decision record</a></li>
        <li><a href="${PROGRESS_REPORT}">Detailed progress report</a></li>
        <li><a href="${PROGRESS_REFRESH_DOC}">Progress refresh instructions</a></li>
        <li><a href="${GENERATED_HARNESS_DOC}">Generated push harness</a></li>
      </ul>

      <div class="proof-item" id="release-proof-timestamp" data-rpp="RPP-0038" data-proof-timestamp="${PROOF_TIMESTAMP}" data-release-status="NO-GO" data-evidence-report="${RELEASE_GATES_REPORT}">
        <span class="status">Release timestamp proof</span>
        <p>Evidence toward <code>RPP-0038</code> links \`${PROOF_COMMAND}\` observed status \`pass\` to the generated proof timestamp <time datetime="${PROOF_TIMESTAMP}">${PROOF_TIMESTAMP}</time>; release remains held and \`NO-GO\`.</p>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

function renderRefreshDoc() {
  return `# Progress Surface Refresh

This repo-local workflow refreshes \`progress.html\` and
\`docs/evidence/ao-progress-report.md\` during active work. It uses only local
commands inside the sandbox. It does not start a public tunnel, publish to a
remote branch, or assume any long-running remote network service.

## One-Shot Refresh

\`\`\`sh
npm run refresh:progress-surface
\`\`\`

The refresh command reads:

- \`node scripts/release/check-release-gates.mjs --scope final-release\`
- \`node scripts/harness/generated-push-cases.js\`
- \`docs/reprint-push-completion-checklist.md\`

Then it rewrites the progress report and page with the current local snapshot.

## Active Work Loop

\`\`\`sh
npm run refresh:progress-surface:watch
\`\`\`

The watch command repeats the same local refresh every \`600000\` ms, roughly
10 minutes. Stop it with Ctrl-C. To use a different cadence:

\`\`\`sh
node scripts/release/refresh-progress-surface.mjs --watch --interval-ms 300000
\`\`\`

For unattended local refreshes, use the managed watcher. It records a PID and
log under \`.tmp/\` so stale loops can be inspected and stopped cleanly:

\`\`\`sh
npm run refresh:progress-surface:watch:start
npm run refresh:progress-surface:watch:status
npm run refresh:progress-surface:watch:stop
\`\`\`

## Validation

\`\`\`sh
npm run check:progress-surface
node --test test/progress-surface-refresh.test.js
node --test test/progress-html-release-timestamp.test.js test/release-gate-progress-release-timestamp-focused-regression.test.js
node scripts/release/artifact-redaction-scan.mjs progress.html docs/evidence/ao-progress-report.md docs/release/progress-surface-refresh.md
node --check scripts/release/refresh-progress-surface.mjs
node --check scripts/release/manage-progress-surface-watch.mjs
git diff --check -- progress.html docs/evidence/ao-progress-report.md docs/release/progress-surface-refresh.md scripts/release/refresh-progress-surface.mjs scripts/release/manage-progress-surface-watch.mjs test/progress-surface-refresh.test.js package.json
\`\`\`

\`npm run publish:progress-page:dry-run\` is still the separate publish-readiness
proof. Run it only when the refreshed page should be checked against the Pages
publish workflow.
`;
}

function writeOrCompare(root, files, options) {
  const changed = [];
  for (const [relativePath, nextText] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    const previousText = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : undefined;
    if (previousText !== nextText) {
      changed.push(relativePath);
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, nextText);
      }
    }
  }
  return changed;
}

function buildContext(root, refreshIso) {
  const releaseSnapshot = releaseGateSnapshot(root, refreshIso);
  const release = releaseSnapshot.report;
  const gates = gateLists(release);
  return {
    root,
    refreshIso,
    releaseGateExitCode: releaseSnapshot.exitCode,
    release,
    gates,
    checklist: checklistSnapshot(root),
    harness: generatedHarnessSnapshot(root),
    watcher: watcherSnapshot(root),
  };
}

function refreshOnce(root, options) {
  const refreshIso = normalizeNow(options.now || (options.check && currentGeneratedAt(root)) || new Date().toISOString());
  const context = buildContext(root, refreshIso);
  const files = {
    [PROGRESS_HTML]: renderHtml(context),
    [PROGRESS_REPORT]: renderMarkdown(context),
    [PROGRESS_REFRESH_DOC]: renderRefreshDoc(),
  };
  const changed = writeOrCompare(root, files, options);
  const summary = {
    ok: !options.check || changed.length === 0,
    dryRun: options.dryRun,
    check: options.check,
    generatedAt: refreshIso,
    releaseStatus: context.release.releaseStatus,
    primaryFailureCode: context.release.primaryFailureCode,
    finalGates: context.release.releaseMovement?.finalGates || context.release.releaseMovement?.gates,
    candidateGates: context.release.releaseMovement?.candidateGates,
    blockingGates: context.release.totals?.blocking ?? context.gates.blockers.length,
    checklist: context.checklist,
    generatedCases: context.harness.totalCases,
    watcher: context.watcher,
    changed,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (options.check && changed.length > 0) {
    process.exitCode = 1;
  }
}

async function watch(root, options) {
  const run = () => {
    const runOptions = { ...options, now: new Date().toISOString(), dryRun: false, check: false };
    refreshOnce(root, runOptions);
  };

  run();
  const timer = setInterval(run, options.intervalMs);
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

try {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  if (options.watch) {
    await watch(root, options);
  } else {
    refreshOnce(root, options);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
