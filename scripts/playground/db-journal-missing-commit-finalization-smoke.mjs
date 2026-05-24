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
const idempotencyKey = 'db-journal-missing-commit-finalize-001';

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);

assert.equal(snapshots.base.meta.fixture, 'remote-base');
assert.equal(snapshots.local.meta.fixture, 'local-edited');

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.summary.conflicts, 0);
assert.equal(readyPlan.summary.blockers, 0);
assert.equal(readyPlan.mutations.length, 8, 'ready fixture plan must keep eight target mutations');
assertTargetHashes(readyPlan, snapshots.base, 'expectedHash', 'ready preconditions');

const summary = {
  transport: {
    host: '127.0.0.1',
    servers: [],
  },
  plan: {
    status: readyPlan.status,
    mutations: readyPlan.mutations.length,
  },
  hook: {
    name: 'labSimulateMissingDbCommit',
    label: 'deterministic lab-only missing DB commit hook; not a process-kill proof',
  },
  firstApply: {},
  conflict: {},
  recovery: {},
  proven: [
    'the first apply response is an intentional lab failure and is not used as success evidence',
    'DB rows persist idempotency-opened/apply-started/mutation-applied without apply-committed',
    'live target hashes all equal durable planned after hashes before finalization',
    'same key with a different body rejects before finalization and does not mutate',
    'same key with the same body appends DB apply-committed with zero fresh mutation work',
  ],
  residualRisks: [
    'this is a lab-only deterministic hook, not proof of production durability, rollback, or exactly-once semantics',
    'real process-kill timing remains covered by the separate process-kill smoke for mixed-state blocking',
  ],
};

await withPlaygroundServer('db-journal-missing-commit-finalization', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');

  const applyBody = {
    plan: readyPlan,
    receipt: dryRun.body.receipt,
    labSimulateMissingDbCommit: true,
  };

  const before = await getSnapshot(server);
  assertSnapshotContentEqual(before.body.snapshot, snapshots.base, 'missing-commit before HTTP snapshot');

  const firstApply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(firstApply.status, 500);
  assert.equal(firstApply.body.ok, false);
  assert.equal(firstApply.body.code, 'LAB_SIMULATED_MISSING_DB_COMMIT');
  assert.equal(firstApply.body.idempotency?.freshMutationWork, true);

  const afterFirst = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterFirst.body.snapshot, snapshots.local, 'missing-commit hook final visible surface');
  assertAppliedHashes(readyPlan, afterFirst.body.snapshot);
  const firstDigest = digest(visibleSurface(afterFirst.body.snapshot));

  const dbJournalAfterHook = await getDbJournal(server);
  const hookEntries = journalEntries(dbJournalAfterHook.body);
  assertJournalEvents(hookEntries, ['idempotency-opened', 'apply-started', 'mutation-applied']);
  assert.equal(countJournalEvents(hookEntries, 'mutation-applied'), readyPlan.mutations.length);
  assert.equal(countJournalEvents(hookEntries, 'apply-committed'), 0, 'lab hook must leave DB apply-committed missing');
  assert.equal(countJournalEvents(hookEntries, 'apply-rejected'), 0, 'lab hook must not create a terminal rejection');
  assertStartedEvidence(hookEntries);

  const conflictingBody = {
    plan: changedPlan(readyPlan),
    receipt: tamperedReceipt(dryRun.body.receipt, (receipt) => {
      receipt.planId = 'changed-plan-before-missing-commit-finalization';
    }),
    labSimulateMissingDbCommit: true,
  };
  const conflictBefore = await getSnapshot(server);
  const conflict = await postLab(server, '/apply', conflictingBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  const conflictAfter = await getSnapshot(server);
  assert.equal(digest(visibleSurface(conflictAfter.body.snapshot)), digest(visibleSurface(conflictBefore.body.snapshot)), 'conflict changed target data');
  const dbJournalAfterConflict = await getDbJournal(server);
  assert.equal(countJournalEvents(journalEntries(dbJournalAfterConflict.body), 'apply-committed'), 0, 'conflict must not finalize missing commit');

  const finalized = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.ok, true);
  assert.equal(finalized.body.code, 'BATCH_RECOVERY_FINALIZED');
  assert.equal(finalized.body.idempotency?.freshMutationWork, false);
  assert.equal(finalized.body.idempotency?.finalizedMissingCommit, true);
  assert.equal(finalized.body.recovery?.state, 'fully-updated-remote');
  assert.deepEqual(finalized.body.recovery?.counts, {
    old: 0,
    new: readyPlan.mutations.length,
    blockedUnknown: 0,
    total: readyPlan.mutations.length,
  });

  const afterFinalize = await getSnapshot(server);
  assert.equal(digest(visibleSurface(afterFinalize.body.snapshot)), firstDigest, 'finalization changed target data');

  const dbJournalAfterFinalize = await getDbJournal(server);
  const finalizedEntries = journalEntries(dbJournalAfterFinalize.body);
  assert.equal(countJournalEvents(finalizedEntries, 'apply-committed'), 1, 'finalization must append exactly one DB commit');
  assert.equal(
    countJournalEvents(finalizedEntries, 'mutation-applied'),
    readyPlan.mutations.length,
    'finalization must not rerun or re-record target mutations',
  );

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.code, 'BATCH_ALREADY_COMMITTED');
  assert.equal(replay.body.idempotency?.freshMutationWork, false);

  summary.firstApply = {
    route: 'POST /wp-json/reprint-push-lab/v1/apply',
    status: firstApply.status,
    code: firstApply.body.code,
    targetHashesAllAfter: true,
    dbEventsBeforeRecovery: hookEntries.map(journalEvent),
    dbCommitMissing: true,
  };
  summary.conflict = {
    status: conflict.status,
    code: conflict.body.code,
    targetSnapshotUnchanged: true,
    dbCommitStillMissing: true,
  };
  summary.recovery = {
    finalizeStatus: finalized.status,
    finalizeCode: finalized.body.code,
    freshMutationWork: finalized.body.idempotency?.freshMutationWork,
    recoveryState: finalized.body.recovery?.state,
    dbCommitRows: countJournalEvents(finalizedEntries, 'apply-committed'),
    mutationRowsUnchanged: true,
    replayCode: replay.body.code,
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

  try {
    await waitForServer(child, baseUrl, logs);
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
      workers: 1,
      listenerCheck: assertLocalhostListener(port),
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

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function getDbJournal(server) {
  return getLab(server, '/db-journal?limit=80');
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

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function journalEntries(body) {
  const journal = body.journal ?? body.dbJournal ?? body;
  return journal.entries ?? journal.latestRows ?? body.entries ?? [];
}

function journalEvent(entry) {
  return entry.event ?? entry.eventName ?? entry.event_name ?? entry.type ?? entry.name;
}

function countJournalEvents(entries, event) {
  return entries.filter((entry) => journalEvent(entry) === event).length;
}

function assertJournalEvents(entries, events) {
  for (const event of events) {
    assert.ok(entries.some((entry) => journalEvent(entry) === event), `DB journal missing ${event}`);
  }
}

function assertStartedEvidence(entries) {
  const started = entries.find((entry) => journalEvent(entry) === 'apply-started');
  assert.ok(started, 'DB journal missing apply-started row');
  assert.equal(started.resourceHashEvidence?.acceptedPlanEvidence?.planHash, digest(readyPlan), 'started evidence plan hash mismatch');
  assert.equal(started.resourceHashEvidence?.recoveryTargets?.length, readyPlan.mutations.length, 'started evidence missing target hashes');
  for (const target of started.resourceHashEvidence.recoveryTargets) {
    assert.match(target.beforeHash, /^[a-f0-9]{64}$/, `target before hash missing for ${target.resourceKey}`);
    assert.match(target.afterHash, /^[a-f0-9]{64}$/, `target after hash missing for ${target.resourceKey}`);
    assert.ok(target.resource && typeof target.resource === 'object', `target resource missing for ${target.resourceKey}`);
  }
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

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
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
      `applied hash mismatch: ${mutation.resourceKey}`,
    );
  }
}

function changedPlan(plan) {
  return {
    ...plan,
    id: `${plan.id}-changed`,
    generatedAt: '2026-05-24T00:00:01.000Z',
  };
}

function tamperedReceipt(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  delete next.receiptHash;
  next.receiptHash = digest(next);
  return next;
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
