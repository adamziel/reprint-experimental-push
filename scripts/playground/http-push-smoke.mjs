#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
  remoteChanged: 'fixtures/playground/remote-changed.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);

assert.equal(snapshots.base.meta.fixture, 'remote-base');
assert.equal(snapshots.local.meta.fixture, 'local-edited');
assert.equal(snapshots.remoteChanged.meta.fixture, 'remote-changed');
const readyLocalSnapshot = snapshots.local;

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: readyLocalSnapshot,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.summary.conflicts, 0);
assert.equal(readyPlan.summary.blockers, 0);
assertReadyPlanResources(readyPlan);
assertTargetHashes(readyPlan, snapshots.base, 'expectedHash', 'ready preconditions');

const conflictPlan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.remoteChanged,
  now: fixedNow,
});

assert.equal(conflictPlan.status, 'conflict');
assertConflictEvidence(conflictPlan);

const summary = {
  transport: {
    host: '127.0.0.1',
    servers: [],
  },
  routes: {},
  ready: {},
  stale: {},
  conflict: {},
};

let readyReceipt;

await withPlaygroundServer('ready-base', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const index = await routeIndex(server);
  assert.equal(index.status, 200);
  assertRouteNamespace(index.body);
  summary.routes.index = {
    route: 'GET /wp-json/',
    status: index.status,
    namespace: 'reprint-push-lab/v1',
    exposed: true,
  };

  const initial = await getSnapshot(server);
  summary.routes.snapshot = {
    route: 'GET /wp-json/reprint-push-lab/v1/snapshot',
    status: initial.status,
  };
  const initialJournal = await getLab(server, '/journal?limit=80');
  assert.equal(initialJournal.status, 200);
  summary.routes.journal = {
    route: 'GET /wp-json/reprint-push-lab/v1/journal?limit=80',
    status: initialJournal.status,
  };
  assertSnapshotContentEqual(initial.body.snapshot, snapshots.base, 'ready initial HTTP snapshot');

  const missingKeyBefore = await getSnapshot(server);
  const missingKey = await postLab(server, '/apply', { plan: readyPlan });
  assertHttpFailureNoMutation(server, missingKey, missingKeyBefore.body.snapshot, {
    status: 400,
    code: 'MISSING_IDEMPOTENCY_KEY',
    label: 'missing idempotency key apply',
  });

  const missingBefore = await getSnapshot(server);
  const missingApply = await postLab(
    server,
    '/apply',
    { plan: readyPlan },
    { [idempotencyHeader]: 'http-push-missing-receipt' },
  );
  assertHttpFailureNoMutation(server, missingApply, missingBefore.body.snapshot, {
    status: 428,
    code: 'MISSING_DRY_RUN_RECEIPT',
    label: 'missing receipt apply',
    journalEvent: 'receipt-required',
  });

  const dryRunBefore = await getSnapshot(server);
  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.equal(dryRun.body.applied, 0);
  assert.equal(dryRun.body.receipt?.mode, 'dry-run');
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');
  assert.equal(dryRun.body.verifiedPreconditions.length, readyPlan.mutations.length);
  assertJournalEvent(dryRun.body, 'dry-run-recorded');
  await assertJournalContains(server, 'dry-run-recorded');
  const dryRunAfter = await getSnapshot(server);
  assertTargetSurfaceEqual(dryRunAfter.body.snapshot, dryRunBefore.body.snapshot, 'dry-run target surface');
  assertSnapshotContentEqual(dryRun.body.currentSnapshot, snapshots.base, 'dry-run current snapshot');

  readyReceipt = dryRun.body.receipt;

  const tamperedBefore = await getSnapshot(server);
  const tamperedApply = await postLab(
    server,
    '/apply',
    {
      plan: readyPlan,
      receipt: tamperedReceipt(readyReceipt, (receipt) => {
        receipt.planHash = '0'.repeat(64);
      }),
    },
    { [idempotencyHeader]: 'http-push-tampered-receipt' },
  );
  assertHttpFailureNoMutation(server, tamperedApply, tamperedBefore.body.snapshot, {
    status: 409,
    code: 'RECEIPT_MISMATCH',
    label: 'tampered receipt apply',
    journalEvent: 'receipt-mismatch',
  });

  const applyBefore = await getSnapshot(server);
  assertSnapshotContentEqual(applyBefore.body.snapshot, snapshots.base, 'apply before HTTP snapshot');
  const apply = await postLab(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    { [idempotencyHeader]: 'http-push-ready-apply' },
  );
  assert.equal(apply.status, 200);
  assert.equal(apply.body.ok, true);
  assert.equal(apply.body.mode, 'apply');
  assert.equal(apply.body.applied, readyPlan.mutations.length);
  assert.equal(apply.body.verifiedKeys.length, readyPlan.mutations.length);
  assert.deepEqual(
    apply.body.verifiedKeys,
    readyPlan.mutations.map((mutation) => mutation.resourceKey),
  );
  assertJournalEventsOrdered(apply.body, ['apply-started', 'apply-committed']);
  await assertJournalContains(server, 'apply-committed');

  const applyAfter = await getSnapshot(server);
  assertVisibleSurfaceEqual(applyAfter.body.snapshot, readyLocalSnapshot, 'ready apply final visible surface');
  assertVisibleSurfaceEqual(apply.body.afterSnapshot, readyLocalSnapshot, 'ready apply response final visible surface');
  assertAppliedHashes(readyPlan, applyAfter.body.snapshot);
  assertAppliedFixtureValues(applyAfter.body.snapshot);

  summary.ready = {
    missingReceipt: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: missingApply.status,
      code: missingApply.body.code,
    },
    missingIdempotencyKey: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: missingKey.status,
      code: missingKey.body.code,
    },
    dryRun: {
      route: 'POST /wp-json/reprint-push-lab/v1/dry-run',
      status: dryRun.status,
      receipt: Boolean(readyReceipt?.receiptHash),
      journalEvent: dryRun.body.journal.event,
    },
    tamperedReceipt: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: tamperedApply.status,
      code: tamperedApply.body.code,
    },
    apply: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: apply.status,
      applied: apply.body.applied,
      verified: apply.body.verifiedKeys.length,
      journal: ['apply-started', 'apply-committed'],
      finalMatchesLocal: digest(visibleSurface(applyAfter.body.snapshot)) === digest(visibleSurface(readyLocalSnapshot)),
    },
  };
});

assert.ok(readyReceipt, 'ready dry-run receipt was not captured');

await withPlaygroundServer('stale-remote', path.join(repoRoot, fixtures.remoteChanged), async (server) => {
  summary.transport.servers.push(server.summary);

  const staleBefore = await getSnapshot(server);
  assertSnapshotContentEqual(staleBefore.body.snapshot, snapshots.remoteChanged, 'stale before HTTP snapshot');
  const staleApply = await postLab(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    { [idempotencyHeader]: 'http-push-stale-remote' },
  );
  assert.equal(staleApply.status, 412);
  assert.equal(staleApply.body.ok, false);
  assert.equal(staleApply.body.code, 'PRECONDITION_FAILED');
  assertJournalEvent(staleApply.body, 'precondition-failed');
  assertNoJournalEvent(staleApply.body, 'apply-committed');
  const staleAfter = await getSnapshot(server);
  assertTargetSurfaceEqual(staleAfter.body.snapshot, staleBefore.body.snapshot, 'stale failed apply target surface');
  assertVisibleSurfaceNotEqual(staleAfter.body.snapshot, readyLocalSnapshot, 'stale failure preserved drifted state');
  await assertJournalLacks(server, 'apply-committed');

  summary.stale = {
    route: 'POST /wp-json/reprint-push-lab/v1/apply',
    status: staleApply.status,
    code: staleApply.body.code,
    preservedFixture: staleAfter.body.snapshot.meta.fixture,
    applyCommitted: false,
  };
});

await withPlaygroundServer('conflict-base', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const conflictDryRunBefore = await getSnapshot(server);
  const conflictDryRun = await postLab(server, '/dry-run', { plan: conflictPlan });
  await assertPlanNotReadyNoMutation(server, conflictDryRun, conflictDryRunBefore.body.snapshot, 'conflict dry-run');
  assertConflictClasses(conflictDryRun.body);
  assertConflictEvidence(conflictDryRun.body.audit, { expectDetectionDecisions: false });

  const conflictApplyBefore = await getSnapshot(server);
  const conflictApply = await postLab(
    server,
    '/apply',
    { plan: conflictPlan, receipt: readyReceipt },
    { [idempotencyHeader]: 'http-push-conflict-apply' },
  );
  await assertPlanNotReadyNoMutation(server, conflictApply, conflictApplyBefore.body.snapshot, 'conflict apply');
  assertConflictClasses(conflictApply.body);
  assertConflictEvidence(conflictApply.body.audit, { expectDetectionDecisions: false });

  summary.conflict = {
    dryRun: {
      route: 'POST /wp-json/reprint-push-lab/v1/dry-run',
      status: conflictDryRun.status,
      code: conflictDryRun.body.code,
      classes: conflictClasses(conflictDryRun.body),
    },
    apply: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: conflictApply.status,
      code: conflictApply.body.code,
      classes: conflictClasses(conflictApply.body),
    },
  };
});

console.log(JSON.stringify(summary, null, 2));

function exportSnapshot(name, blueprintPath) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ];

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  let listenerCheck;
  try {
    await waitForServer(child, baseUrl, logs);
    listenerCheck = assertLocalhostListener(port);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return {
    name,
    port,
    baseUrl,
    child,
    logs,
    summary: {
      name,
      baseUrl,
      port,
      listenerCheck,
      stopped: false,
    },
  };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);

  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
  server.summary.stopped = true;
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await fetch(`${baseUrl}/wp-json/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${logs.join('')}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);

    function onExit() {
      clearTimeout(timer);
      resolve();
    }

    child.once('exit', onExit);
  });
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function assertLocalhostListener(port) {
  const result = spawnSync('ss', ['-H', '-ltn', 'sport', '=', `:${port}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return {
      tool: 'ss',
      status: 'skipped',
      reason: (result.stderr || result.stdout || 'ss command unavailable').trim(),
    };
  }

  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length > 0, `No listener found for Playground port ${port}`);

  for (const line of lines) {
    const fields = line.split(/\s+/);
    const localAddress = fields[3] || '';
    assert.ok(
      localAddress === `127.0.0.1:${port}` || localAddress === `[127.0.0.1]:${port}`,
      `Playground listener must be 127.0.0.1 only, got: ${line}`,
    );
  }

  return {
    tool: 'ss',
    status: 'checked',
    listeners: lines,
  };
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

async function isPortAccepting(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function routeIndex(server) {
  return requestJson(server, 'GET', '/wp-json/');
}

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function getLab(server, pathSuffix) {
  return requestJson(server, 'GET', `/wp-json/reprint-push-lab/v1${pathSuffix}`);
}

async function postLab(server, pathSuffix, body, headers = {}) {
  return requestJson(server, 'POST', `/wp-json/reprint-push-lab/v1${pathSuffix}`, body, headers);
}

async function requestJson(server, method, pathname, body = undefined, headers = {}) {
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? headers : {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

function assertRouteNamespace(body) {
  const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
  const routeKeys = body.routes && typeof body.routes === 'object' ? Object.keys(body.routes) : [];
  assert.ok(
    namespaces.includes('reprint-push-lab/v1') || routeKeys.some((route) => route.startsWith('/reprint-push-lab/v1')),
    'REST index does not expose reprint-push-lab/v1',
  );
}

async function assertHttpFailureNoMutation(server, response, expectedSnapshot, { status, code, label, journalEvent }) {
  assert.equal(response.status, status, `${label} HTTP status`);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, code);
  if (journalEvent) {
    assertJournalEvent(response.body, journalEvent);
    await assertJournalContains(server, journalEvent);
  }
  assertNoJournalEvent(response.body, 'apply-started');
  assertNoJournalEvent(response.body, 'apply-committed');
  const after = await getSnapshot(server);
  assertTargetSurfaceEqual(after.body.snapshot, expectedSnapshot, `${label} target surface`);
}

async function assertPlanNotReadyNoMutation(server, response, expectedSnapshot, label) {
  assert.equal(response.status, 409, `${label} HTTP status`);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'PLAN_NOT_READY');
  assertJournalEvent(response.body, 'plan-not-ready');
  assertNoJournalEvent(response.body, 'apply-started');
  assertNoJournalEvent(response.body, 'apply-committed');
  const after = await getSnapshot(server);
  assertTargetSurfaceEqual(after.body.snapshot, expectedSnapshot, `${label} target surface`);
}

async function assertJournalContains(server, event) {
  const response = await getLab(server, '/journal?limit=80');
  assert.equal(response.status, 200);
  const entries = response.body.journal?.entries || [];
  assert.ok(entries.some((entry) => entry.event === event), `journal route missing ${event}`);
}

async function assertJournalLacks(server, event) {
  const response = await getLab(server, '/journal?limit=80');
  assert.equal(response.status, 200);
  const entries = response.body.journal?.entries || [];
  assert.ok(!entries.some((entry) => entry.event === event), `journal route should not include ${event}`);
}

function tamperedReceipt(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  delete next.receiptHash;
  next.receiptHash = digest(next);
  return next;
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function assertSnapshotContentEqual(actual, expected, label) {
  assert.deepEqual(snapshotContent(actual), snapshotContent(expected), `${label} content mismatch`);
  assert.equal(digest(snapshotContent(actual)), digest(snapshotContent(expected)), `${label} content digest mismatch`);
}

function snapshotContent(snapshot) {
  return {
    meta: {
      source: snapshot.meta.source,
      fixture: snapshot.meta.fixture,
      table_prefix: snapshot.meta.table_prefix,
    },
    ...visibleSurface(snapshot),
  };
}

function assertTargetSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
}

function assertVisibleSurfaceNotEqual(actual, expected, label) {
  assert.notEqual(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} mismatch`);
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}

function assertReadyPlanResources(plan) {
  const expectedReadyKeys = [
    'file:wp-content/uploads/reprint-push/local-only.txt',
    'file:wp-content/uploads/reprint-push/shared.txt',
    'row:["wp_options","option_name:reprint_push_forms_fixture"]',
    'row:["wp_options","option_name:reprint_push_plugin_payload"]',
    'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_posts","ID:1001"]',
    'row:["wp_posts","ID:2001"]',
  ];
  const readyKeys = plan.mutations.map((mutation) => mutation.resourceKey).sort();
  assert.deepEqual(readyKeys, [...expectedReadyKeys].sort(), 'ready mutations should match fixture-scoped resources');
  assertNoReadyMutation(plan, 'plugin:reprint-push-forms-fixture');
  assertNoReadyMutation(plan, 'row:["wp_reprint_push_forms_lab","id:1"]');
}

function assertNoReadyMutation(plan, resourceKey) {
  assert.ok(
    !plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    `${resourceKey} must remain detection-only in ready plans`,
  );
}

function assertConflictEvidence(audit, { expectDetectionDecisions = true } = {}) {
  assertEvidenceEntry(
    audit.conflicts,
    'row:["wp_options","option_name:reprint_push_forms_fixture"]',
    'plugin-data-conflict',
  );
  assertEvidenceEntry(
    audit.conflicts,
    'row:["wp_options","option_name:reprint_push_plugin_payload"]',
    'plugin-data-conflict',
  );
  assertEvidenceEntry(
    audit.conflicts,
    'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]',
    'plugin-data-conflict',
  );
  if (!expectDetectionDecisions) {
    return;
  }
  assertEvidenceEntry(audit.decisions, 'plugin:reprint-push-forms-fixture', 'keep-remote');
  assertEvidenceEntry(audit.decisions, 'row:["wp_reprint_push_forms_lab","id:1"]', 'keep-remote');
}

function assertEvidenceEntry(entries = [], resourceKey, expectedClassOrDecision) {
  const entry = entries.find((item) => item.resourceKey === resourceKey);
  assert.ok(entry, `missing audit evidence for ${resourceKey}`);
  assert.equal(entry.class ?? entry.decision, expectedClassOrDecision);
}

function assertTargetHashes(plan, snapshot, preconditionHashField, label) {
  for (const precondition of plan.preconditions) {
    assert.equal(
      resourceHash(snapshot, precondition.resource),
      precondition[preconditionHashField],
      `${label}: ${precondition.resourceKey}`,
    );
  }
}

function assertAppliedHashes(plan, snapshot) {
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(snapshot, mutation.resource),
      mutation.localHash,
      `applied hash mismatch for ${mutation.resourceKey}`,
    );
  }
}

function assertAppliedFixtureValues(snapshot) {
  assert.equal(snapshot.meta.fixture, 'remote-base');

  const sharedPost = postByTitle(snapshot, 'Shared base post');
  assert.equal(sharedPost.post_content, 'Local edited content');
  assert.equal(sharedPost.post_status, 'publish');

  const localPost = postByTitle(snapshot, 'Local-only draft');
  assert.equal(localPost.post_content, 'Created locally after pull');
  assert.equal(localPost.post_status, 'draft');

  assert.equal(snapshot.files['wp-content/uploads/reprint-push/shared.txt'], 'local upload content');
  assert.equal(snapshot.files['wp-content/uploads/reprint-push/local-only.txt'], 'local-only upload content');

  const pluginPayload = snapshot.db.wp_options['option_name:reprint_push_plugin_payload'];
  assert.equal(pluginPayload.__pluginOwner, 'forms');
  assert.deepEqual(pluginPayload.option_value, {
    mode: 'local-edited',
    owner: 'forms',
    version: 2,
  });

  const formsFixture = snapshot.db.wp_options['option_name:reprint_push_forms_fixture'];
  assert.equal(formsFixture.__pluginOwner, 'forms');
  assert.deepEqual(formsFixture.option_value, {
    enabled: true,
    flags: {
      captcha: true,
      honeypot: true,
    },
    forms: {
      contact: {
        active: true,
        fields: ['email', 'message', 'phone'],
        limits: {
          daily: '40',
          perIp: '4',
        },
        title: 'Contact the studio',
        version: '2',
      },
      newsletter: {
        active: true,
        fields: ['email', 'source'],
        segments: ['general', 'product', 'local'],
        title: 'Newsletter',
        version: '1',
      },
    },
    owner: 'forms',
    revision: '002-local',
    routing: {
      notify: ['local-admin@example.test', 'ops@example.test'],
      storeSubmissions: true,
    },
  });

  const sharedSchema = snapshot.db.wp_postmeta['post_id:1001:meta_key:_reprint_push_forms_schema'];
  assert.equal(sharedSchema.__pluginOwner, 'forms');
  assert.deepEqual(sharedSchema.meta_value, {
    fields: [
      {
        enabled: true,
        key: 'email',
        label: 'Email address',
        type: 'email',
      },
      {
        enabled: true,
        key: 'message',
        label: 'Project brief',
        type: 'textarea',
      },
      {
        enabled: false,
        key: 'phone',
        label: 'Phone',
        type: 'tel',
      },
    ],
    form: 'contact',
    notifications: {
      admin: true,
      copyToSender: true,
    },
    owner: 'forms',
    required: ['email', 'message', 'phone'],
    schemaVersion: '2-local',
  });

  const customTableRow = snapshot.db.wp_reprint_push_forms_lab['id:1'];
  assert.equal(customTableRow.__pluginOwner, 'forms');
  assert.deepEqual(customTableRow.payload, {
    mode: 'base',
    owner: 'forms',
    rules: {
      maxAttachments: '2',
      requireConsent: true,
    },
    version: '1',
  });
}

function postByTitle(snapshot, title) {
  const entry = Object.values(snapshot.db.wp_posts).find((row) => row.post_title === title);
  assert.ok(entry, `missing post ${title}`);
  return entry;
}

function assertJournalEvent(result, event) {
  assert.equal(result.journal?.event, event, `expected current journal event ${event}`);
  assert.equal(result.journal?.option, 'reprint_push_protocol_journal');
  assert.ok(Array.isArray(result.journal?.recent), 'missing bounded journal evidence');
  assert.ok(result.journal.recent.length <= 5, 'journal evidence must stay bounded');
  assert.ok(
    result.journal.recent.some((entry) => entry.event === event),
    `journal recent entries missing ${event}`,
  );
}

function assertNoJournalEvent(result, event) {
  assert.ok(
    !(result.journal?.recent || []).some((entry) => entry.event === event),
    `journal recent entries should not include ${event}`,
  );
}

function assertJournalEventsOrdered(result, events) {
  for (const event of events) {
    assert.ok(
      result.journal?.recent?.some((entry) => entry.event === event),
      `journal recent entries missing ${event}`,
    );
  }

  const positions = events.map((event) =>
    result.journal.recent.findIndex((entry) => entry.event === event)
  );

  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index - 1] < positions[index],
      `journal event ${events[index - 1]} must precede ${events[index]}`,
    );
  }

  assertJournalEvent(result, events.at(-1));
}

function assertConflictClasses(result) {
  const classes = conflictClasses(result);
  assert.ok(classes.includes('row-conflict'), 'missing row conflict audit');
  assert.ok(classes.includes('file-conflict'), 'missing file conflict audit');
  assert.ok(classes.includes('plugin-data-conflict'), 'missing plugin-data conflict audit');
}

function conflictClasses(result) {
  return [...new Set((result.audit?.conflicts || []).map((conflict) => conflict.class))].sort();
}

function pushLog(logs, chunk) {
  logs.push(chunk);
  while (logs.join('').length > 20_000) {
    logs.shift();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
