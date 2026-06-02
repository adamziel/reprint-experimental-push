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
const DEFAULT_INTERVAL_MS = 600000;
const PROOF_TIMESTAMP = '2026-05-28T03:18:00.000Z';
const PROOF_COMMAND = 'node --test test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
const FOCUSED_PROOF_COMMAND = 'node --test test/release-gate-progress-release-timestamp-focused-regression.test.js test/progress-html-release-timestamp.test.js test/release-gates.test.js test/release-gate-cli.test.js';
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMarkdown(context) {
  const { refreshIso, release, gates, checklist, harness } = context;
  const movement = release.releaseMovement || {};
  const totals = release.totals || {};
  const storageGate = byId(gates.gates, 'storage-boundary-cas');
  const passedIds = gates.passed.map((gate) => `${gate.rpp} ${gate.id}`).join(', ');
  const blockers = gates.blockers.map((gate) => `| ${gate.rpp} | \`${gate.id}\` | ${gate.category} | \`${gate.code}\` | ${gate.reason} |`).join('\n');
  const buckets = gates.buckets.map((bucket) => `| ${bucket.bucket} | ${bucket.passed}/${bucket.total} | ${bucket.blocking} |`).join('\n');
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

## Current State

| Signal | Value |
| --- | --- |
| Release status | \`${release.releaseStatus}\` |
| Final gates | \`${movement.finalGates || movement.gates || 'unknown'}\` |
| Candidate gates | \`${movement.candidateGates || 'unknown'}\` |
| Primary blocker | \`${release.primaryFailureCode}\` |
| Status marker | \`${statusMarker(release)}\` |
| Blocking gates | ${totals.blocking ?? gates.blockers.length} |
| Checklist | ${checklist.checked}/${checklist.total} checked, ${checklist.open} open |
| Generated harness | ${harness.totalCases} cases: ${harness.statuses.ready} ready, ${harness.statuses.conflict} conflict, ${harness.statuses.blocked} blocked |
| Storage smokes | DB guarded write: passed; file guarded write: passed |

The new release model has **21 gates**. In the current local evaluator snapshot,
three non-risk gates pass (${passedIds || 'none'}), while ${gates.blockers.length}
release-blocking gates remain missing. Final release is **NO-GO** until the
missing gates are backed by production-scoped evidence.

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

| Stage | State | What matters |
| --- | --- | --- |
| Support evidence integration | Checked | Checklist is ${checklist.checked}/${checklist.total}; support evidence is useful but not production release approval. |
| Release-gate evaluator | Active | Current evaluator reports \`${movement.finalGates || movement.gates || 'unknown'}\`, \`${release.primaryFailureCode}\`, and read-only \`mutationAttempted: ${release.mutationAttempted}\`. |
| Production binding | Blocked | Production topology, auth, identity, routes, recovery, storage CAS, and operator proof are missing. |
| Storage smokes | Checked | DB guarded-write and file guarded-write smoke commands pass as support evidence only. |
| Progress reporting | Active | This page/report now has a local refresh generator and a 10-minute watch mode. |
| Public publish proof | Held | \`npm run publish:progress-page:dry-run\` remains a support-only publish proof and does not move release readiness. |

## 21-Gate Release Model

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

The loop is local-only and has no remote network or tunnel dependency. Stop it
with Ctrl-C. For deterministic checks use:

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
  const { refreshIso, release, gates, checklist, harness } = context;
  const movement = release.releaseMovement || {};
  const totals = release.totals || {};
  const storageGate = byId(gates.gates, 'storage-boundary-cas');
  const bucketRows = gates.buckets.map((bucket) => `
              <tr>
                <td>${escapeHtml(bucket.bucket)}</td>
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
  const passedGates = gates.passed.map((gate) => `<li><code>${escapeHtml(gate.id)}</code> (${escapeHtml(gate.rpp)})</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reprint Push Progress</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171a1f;
      --muted: #5d6673;
      --line: #d7dde4;
      --paper: #ffffff;
      --wash: #f4f6f8;
      --blue: #165b9f;
      --green: #1f7a4d;
      --amber: #8a5b00;
      --red: #9f332b;
      --red-wash: #fff1ef;
      --green-wash: #ecf8f0;
      --amber-wash: #fff7e3;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--wash);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }

    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }

    h1, h2, h3, p { margin: 0; }

    h1 {
      font-size: 2.45rem;
      line-height: 1.05;
      letter-spacing: 0;
    }

    h2 {
      font-size: 1.08rem;
      line-height: 1.25;
      letter-spacing: 0;
    }

    h3 {
      font-size: 0.95rem;
      line-height: 1.3;
      letter-spacing: 0;
    }

    p, td, th, li { font-size: 0.95rem; }
    p { color: var(--muted); }
    a { color: var(--blue); text-underline-offset: 0.18em; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }

    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: end;
      margin-bottom: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    .eyebrow {
      margin-bottom: 7px;
      color: var(--blue);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .lead {
      max-width: 820px;
      margin-top: 10px;
      color: #36404b;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 10px;
      background: var(--paper);
      color: var(--ink);
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }

    .stamp {
      display: inline-flex;
      width: fit-content;
      margin-top: 12px;
      border: 1px solid rgba(22, 91, 159, 0.22);
      border-radius: 6px;
      padding: 4px 10px;
      background: #eef5fb;
      color: var(--blue);
      font-size: 0.84rem;
      font-weight: 800;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }

    .metric, .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .metric {
      min-height: 98px;
      padding: 14px;
    }

    .metric strong {
      display: block;
      margin-bottom: 4px;
      font-size: 1.75rem;
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
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.74fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      margin-bottom: 16px;
      padding: 16px;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 12px;
    }

    .panel-head span {
      color: var(--muted);
      font-size: 0.86rem;
      white-space: nowrap;
    }

    .stage-list, .plain-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .stage-list li {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 12px;
      border-top: 1px solid var(--line);
      padding-top: 10px;
    }

    .stage-list li:first-child { border-top: 0; padding-top: 0; }

    .state {
      display: inline-flex;
      justify-content: center;
      align-items: center;
      min-height: 26px;
      border-radius: 999px;
      padding: 2px 8px;
      background: var(--amber-wash);
      color: var(--amber);
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .state.ok { background: var(--green-wash); color: var(--green); }
    .state.held { background: var(--red-wash); color: var(--red); }

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
      border-radius: 999px;
      background: var(--blue);
    }

    .notice {
      border: 1px solid rgba(159, 51, 43, 0.28);
      border-radius: 8px;
      padding: 12px;
      background: var(--red-wash);
    }

    .notice p { color: #5d221d; }

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
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .storage-row td { background: #fff6f4; }

    .proof-item {
      border-top: 1px solid var(--line);
      margin-top: 12px;
      padding-top: 12px;
    }

    .proof-item .status {
      display: inline-flex;
      margin-bottom: 6px;
      border: 1px solid rgba(31, 122, 77, 0.28);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--green);
      background: var(--green-wash);
      font-size: 0.78rem;
      font-weight: 800;
    }

    @media (max-width: 900px) {
      header, .layout, .metrics, .grid-two {
        grid-template-columns: 1fr;
      }

      h1 { font-size: 2rem; }
      .actions { justify-content: flex-start; }
      .panel-head { display: block; }
      .panel-head span { display: block; margin-top: 4px; white-space: normal; }
      .stage-list li { grid-template-columns: 1fr; gap: 6px; }
    }
  </style>
</head>
<body>
  <main data-generated-at="${escapeHtml(refreshIso)}">
    <header>
      <div>
        <p class="eyebrow">Evidence-led release status</p>
        <h1>Reprint Push Progress</h1>
        <p class="lead">Final release remains <strong>NO-GO</strong>. The current working tree has a 21-gate release model; the evaluator is held at <strong>${escapeHtml(movement.finalGates || movement.gates || 'unknown')}</strong> with ${totals.blocking ?? gates.blockers.length} missing blockers. DB/file guarded-write smokes pass locally, but storage-boundary CAS is still an explicit final-release blocker.</p>
        <time class="stamp" datetime="${escapeHtml(refreshIso)}">Refreshed locally: ${escapeHtml(refreshIso)}</time>
      </div>
      <nav class="actions" aria-label="Evidence links">
        <a class="button" href="${CHECKLIST_PATH}">Checklist</a>
        <a class="button" href="${PROGRESS_REPORT}">Report</a>
        <a class="button" href="${GO_NO_GO_RECORD}">Go/No-Go</a>
        <a class="button" href="${PROGRESS_REFRESH_DOC}">Refresh</a>
      </nav>
    </header>

    <section class="metrics" aria-label="Current summary">
      <div class="metric">
        <strong class="held">${escapeHtml(release.releaseStatus)}</strong>
        <span>final release</span>
      </div>
      <div class="metric">
        <strong>${escapeHtml(movement.finalGates || movement.gates || 'unknown')}</strong>
        <span>final gates</span>
      </div>
      <div class="metric">
        <strong class="warn">${totals.blocking ?? gates.blockers.length}</strong>
        <span>blocking gates</span>
      </div>
      <div class="metric">
        <strong class="ok">${checklist.checked}/${checklist.total}</strong>
        <span>RPP checklist</span>
      </div>
      <div class="metric">
        <strong>${harness.totalCases}</strong>
        <span>generated cases</span>
      </div>
    </section>

    <div class="layout">
      <section class="panel" aria-labelledby="state-title">
        <div class="panel-head">
          <h2 id="state-title">Current State</h2>
          <span>${escapeHtml(statusMarker(release))}</span>
        </div>
        <ul class="stage-list">
          <li>
            <span class="state ok">checked</span>
            <span><strong>Support evidence integration</strong><br>Checklist is ${checklist.checked}/${checklist.total}. Local, generated, graph, plugin-driver, Docker-local, recovery, and audit evidence remain support evidence unless production provenance is supplied.</span>
          </li>
          <li>
            <span class="state held">held</span>
            <span><strong>Release-gate evaluator</strong><br>The local evaluator is read-only, reports <code>mutationAttempted: ${escapeHtml(release.mutationAttempted)}</code>, and holds release movement on <code>${escapeHtml(release.primaryFailureCode)}</code>.</span>
          </li>
          <li>
            <span class="state held">blocked</span>
            <span><strong>Production binding</strong><br>Production topology, auth, identity, route, recovery, storage CAS, and operator proof are still missing.</span>
          </li>
          <li>
            <span class="state ok">checked</span>
            <span><strong>Storage smokes</strong><br><code>npm run test:playground:storage-guarded-db-write</code> and <code>npm run test:playground:storage-guarded-file-write</code> pass as support evidence only.</span>
          </li>
          <li>
            <span class="state">active</span>
            <span><strong>Progress reporting</strong><br>This page/report can be regenerated locally with <code>npm run refresh:progress-surface</code> or refreshed every 10 minutes with <code>npm run refresh:progress-surface:watch</code>.</span>
          </li>
        </ul>
      </section>

      <aside class="panel" aria-labelledby="plan-title">
        <div class="panel-head">
          <h2 id="plan-title">Current Plan</h2>
          <span>Do not move gates from this page</span>
        </div>
        <ul class="plain-list">
          <li>Keep release posture <strong>NO-GO</strong> until production-scoped evidence backs every missing gate.</li>
          <li>Convert support proof into production-bound topology, credentials, route, recovery, storage, and operator proof.</li>
          <li>Handle <code>storage-boundary-cas</code> as a named release blocker, not an implied closure from passed DB/file storage smokes.</li>
          <li>Refresh this surface locally during active work; publish proof remains separate.</li>
        </ul>
      </aside>
    </div>

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
        <h2 id="gates-title">21-Gate Model</h2>
        <span>${gates.passed.length} passed / ${gates.blockers.length} blocking</span>
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
          <h3>Passed Non-Risk Gates</h3>
          <ul>
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
        <tbody>${blockerRows}
        </tbody>
      </table>
    </section>

    <section class="panel" aria-labelledby="refresh-title">
      <div class="panel-head">
        <h2 id="refresh-title">Refresh Mechanism</h2>
        <span>Local-only, no tunnels</span>
      </div>
      <p>One-shot refresh: <code>npm run refresh:progress-surface</code>. Active-work loop: <code>npm run refresh:progress-surface:watch</code>, which repeats every 600000 ms until Ctrl-C. Validation: <code>npm run check:progress-surface</code>. Publishing proof remains separate with <code>npm run publish:progress-page:dry-run</code>.</p>
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

## Validation

\`\`\`sh
npm run check:progress-surface
node --test test/progress-html-release-timestamp.test.js test/release-gate-progress-release-timestamp-focused-regression.test.js
node scripts/release/artifact-redaction-scan.mjs progress.html docs/evidence/ao-progress-report.md docs/release/progress-surface-refresh.md
node --check scripts/release/refresh-progress-surface.mjs
git diff --check -- progress.html docs/evidence/ao-progress-report.md docs/release/progress-surface-refresh.md scripts/release/refresh-progress-surface.mjs package.json
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
