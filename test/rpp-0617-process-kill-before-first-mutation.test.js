import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const baseFixture = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const evidenceTimeoutMs = 45_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';
const idempotencyKey = 'rpp-0617-before-first-mutation-001';
const mutationCount = 4;
const delayAfterDbJournalStartedMs = 5000;
const disallowedBeforeFirstMutationEvents = new Set([
  'mutation-prepared',
  'mutation-storage-write-ready',
  'mutation-precondition-failed',
  'mutation-applied',
  'apply-committed',
  'apply-rejected',
  'apply-replayed',
  'stale-claim-abandoned',
  'stale-claim-retry-started',
]);

test('RPP-0617 hard kill after apply-started and before first mutation leaves durable journal rows after restart', { timeout: 180_000 }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0617-before-first-mutation-'));
  const wpDir = path.join(tmpRoot, 'wordpress');
  fs.mkdirSync(wpDir, { recursive: true });

  let server = null;
  let success = false;
  t.after(async () => {
    if (server) {
      await stopPlaygroundServer(server).catch(() => {});
    }
    if (success) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  const port = await findLocalPort();
  server = await startPlaygroundServer({
    name: 'rpp-0617-before-first-mutation-initial',
    wpDir,
    port,
    blueprintPath: baseFixture,
  });

  const baseSnapshotResponse = await getSnapshot(server);
  const baseSnapshot = baseSnapshotResponse.body.snapshot;
  assert.equal(baseSnapshot.meta.fixture, 'remote-base');

  const plan = createBeforeFirstMutationPlan(baseSnapshot);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.mutations.length, mutationCount);
  assertTargetHashes(plan, baseSnapshot, 'expectedHash', 'process-kill-before-first-mutation preconditions');

  const dryRun = await postLab(server, '/dry-run', { plan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');

  const applyBody = {
    plan,
    receipt: dryRun.body.receipt,
    labDelayAfterDbJournalStartedMs: delayAfterDbJournalStartedMs,
  };

  const beforeApply = await getSnapshot(server);
  assert.deepEqual(publicCounts(classifyTargets(plan, beforeApply.body.snapshot)), {
    old: mutationCount,
    new: 0,
    blockedUnknown: 0,
    total: mutationCount,
  });

  const applyPromise = postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey })
    .then((response) => ({ settled: true, response }))
    .catch((error) => ({ settled: true, error: error.message }));

  const preKillRows = await waitForApplyStartedBeforeFirstMutation(server, evidenceTimeoutMs);
  const preKillOpened = latestRowForEvent(preKillRows, 'idempotency-opened');
  const preKillStarted = latestRowForEvent(preKillRows, 'apply-started');
  assert.ok(preKillOpened, 'pre-kill DB journal missing idempotency-opened');
  assert.ok(preKillStarted, 'pre-kill DB journal missing apply-started');
  assertStartedRowCarriesPlannedHashEvidence(preKillStarted, preKillOpened, mutationCount);
  assertNoBeforeFirstMutationEvents(preKillRows, 'pre-kill DB journal');

  const killResult = await killPlaygroundServer(server, 'SIGKILL');
  assert.equal(killResult.signal, 'SIGKILL', 'Playground server child must report SIGKILL exit signal');
  server.summary.stopped = true;
  assert.equal(await isPortAccepting(server.port), false, 'Playground server port remained open after SIGKILL');

  const applyAfterKill = await promiseWithTimeout(applyPromise, 10_000, { settled: false, timeout: true });
  assert.notEqual(applyAfterKill.response?.body?.ok, true, 'in-flight apply unexpectedly returned success after SIGKILL');

  server = await startPlaygroundServer({
    name: 'rpp-0617-before-first-mutation-restart',
    wpDir,
    port,
    blueprintPath: null,
  });

  const afterRestartSnapshot = await getSnapshot(server);
  const afterRestartClassifications = classifyTargets(plan, afterRestartSnapshot.body.snapshot);
  assert.deepEqual(publicCounts(afterRestartClassifications), {
    old: mutationCount,
    new: 0,
    blockedUnknown: 0,
    total: mutationCount,
  }, 'SIGKILL must happen before the first target mutation persists');

  const afterRestartJournal = await getDbJournal(server);
  assert.equal(afterRestartJournal.status, 200);
  assert.equal(afterRestartJournal.body.ok, true);
  const afterRestartRows = journalEntries(afterRestartJournal.body);
  const restartedOpened = rowBySequence(afterRestartRows, preKillOpened.sequence);
  const restartedStarted = rowBySequence(afterRestartRows, preKillStarted.sequence);
  assert.ok(restartedOpened, 'idempotency-opened row did not survive process restart');
  assert.ok(restartedStarted, 'apply-started row did not survive process restart');
  assert.equal(journalEvent(restartedOpened), 'idempotency-opened');
  assert.equal(journalEvent(restartedStarted), 'apply-started');
  assert.equal(restartedOpened.requestHash, preKillOpened.requestHash);
  assert.equal(restartedStarted.requestHash, preKillStarted.requestHash);
  assertStartedRowCarriesPlannedHashEvidence(restartedStarted, restartedOpened, mutationCount);
  assertNoBeforeFirstMutationEvents(afterRestartRows, 'restarted DB journal');

  const dbOnlyRecovery = classifyTargetsFromStartedRow(plan, afterRestartSnapshot.body.snapshot, restartedStarted);
  assert.deepEqual(dbOnlyRecovery.counts, {
    old: mutationCount,
    new: 0,
    blockedUnknown: 0,
    total: mutationCount,
  });
  assert.equal(dbOnlyRecovery.state, 'old-remote');
  assert.equal(dbOnlyRecovery.usedOptionJournal, false);

  success = true;
});

function createBeforeFirstMutationPlan(base) {
  const local = JSON.parse(JSON.stringify(base));
  local.files = { ...(local.files || {}) };
  for (let index = 0; index < mutationCount; index++) {
    const padded = String(index + 1).padStart(2, '0');
    local.files[`wp-content/uploads/reprint-push/rpp-0617-before-first-mutation/file-${padded}.txt`] =
      `rpp-0617-before-first-mutation-${padded}\n`;
  }

  return createPushPlan({
    base,
    local,
    remote: base,
    now: fixedNow,
  });
}

async function startPlaygroundServer({ name, wpDir, port, blueprintPath }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--mount-before-install',
    `${wpDir}:/wordpress`,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '2',
    '--verbosity',
    'quiet',
  ];

  if (blueprintPath) {
    args.push('--blueprint', blueprintPath);
  }

  const child = spawn('npx', args, {
    cwd: repoRoot,
    detached: true,
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
    await stopChildProcessGroup(child);
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
      workers: 2,
      listenerCheck: assertLocalhostListener(port),
      stopped: false,
    },
  };
}

async function stopPlaygroundServer(currentServer) {
  if (currentServer.summary.stopped) {
    return;
  }
  await stopChildProcessGroup(currentServer.child);
  assert.equal(await isPortAccepting(currentServer.port), false, `Playground server still accepts connections on ${currentServer.baseUrl}`);
  currentServer.summary.stopped = true;
}

async function killPlaygroundServer(currentServer, signal) {
  const exitPromise = waitForExit(currentServer.child, 15_000).catch(() => null);
  process.kill(-currentServer.child.pid, signal);
  const exit = await exitPromise;
  const deadline = Date.now() + 15_000;
  while (await isPortAccepting(currentServer.port)) {
    if (Date.now() > deadline) {
      process.kill(-currentServer.child.pid, 'SIGKILL');
      throw new Error(`Playground server still accepts connections after ${signal}`);
    }
    await sleep(250);
  }
  return {
    requestedSignal: signal,
    signal: exit?.signal ?? currentServer.child.signalCode,
    exitCode: exit?.code ?? currentServer.child.exitCode,
  };
}

async function stopChildProcessGroup(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  try {
    await waitForExit(child, 12_000);
  } catch {
    process.kill(-child.pid, 'SIGKILL');
    await waitForExit(child, 12_000).catch(() => {});
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
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);

    function onExit(code, signal) {
      clearTimeout(timer);
      resolve({ code, signal });
    }

    child.once('exit', onExit);
  });
}

async function waitForApplyStartedBeforeFirstMutation(currentServer, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await getDbJournal(currentServer);
    const entries = journalEntries(response.body);
    assertNoBeforeFirstMutationEvents(entries, 'DB journal while waiting for apply-started');
    if (entries.some((entry) => journalEvent(entry) === 'apply-started')) {
      return entries;
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for DB journal apply-started before first mutation');
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      listener.close(() => resolve(port));
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

async function getSnapshot(currentServer) {
  const response = await getLab(currentServer, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function getDbJournal(currentServer) {
  return getLab(currentServer, '/db-journal?limit=100');
}

async function getLab(currentServer, pathSuffix) {
  return requestJson(currentServer, 'GET', `/wp-json/reprint-push-lab/v1${pathSuffix}`);
}

async function postLab(currentServer, pathSuffix, body, headers = {}) {
  return requestJson(currentServer, 'POST', `/wp-json/reprint-push-lab/v1${pathSuffix}`, body, headers);
}

async function requestJson(currentServer, method, pathname, body = undefined, headers = {}) {
  const response = await fetch(`${currentServer.baseUrl}${pathname}`, {
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
    const jsonStart = text.lastIndexOf('{"ok"');
    if (jsonStart === -1) {
      throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
    }
    try {
      json = JSON.parse(text.slice(jsonStart));
    } catch {
      throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
    }
  }
  return {
    status: response.status,
    body: json,
  };
}

function journalEntries(body) {
  const journal = body.journal ?? body.dbJournal ?? body;
  return journal.entries ?? journal.latestRows ?? body.entries ?? [];
}

function journalEvent(entry) {
  return entry.event ?? entry.eventName ?? entry.event_name ?? entry.type ?? entry.name;
}

function latestRowForEvent(rows, event) {
  return [...rows].reverse().find((row) => journalEvent(row) === event) || null;
}

function rowBySequence(rows, sequence) {
  return rows.find((row) => row.sequence === sequence) || null;
}

function assertNoBeforeFirstMutationEvents(rows, label) {
  const events = rows.map(journalEvent);
  const unexpected = events.filter((event) => disallowedBeforeFirstMutationEvents.has(event));
  assert.deepEqual(unexpected, [], `${label} already contains post-start or mutation event(s)`);
}

function assertStartedRowCarriesPlannedHashEvidence(started, opened, expectedMutationCount) {
  assert.equal(started.mutationCount, expectedMutationCount);
  assert.equal(started.appliedCount, 0);
  assert.equal(started.requestHash, opened.requestHash);
  assert.equal(started.idempotencyKeyHash, opened.idempotencyKeyHash);

  const evidence = started.resourceHashEvidence;
  assert.ok(evidence && typeof evidence === 'object', 'apply-started row missing resource hash evidence');
  assert.equal(evidence.openedCursor, `db-journal:${opened.sequence}`);
  assert.equal(evidence.mutationCount, expectedMutationCount);
  assert.equal(evidence.plannedMutations?.length, expectedMutationCount);
  assert.equal(evidence.recoveryTargets?.length, expectedMutationCount);
  assert.equal(evidence.verifiedPreconditions?.length, expectedMutationCount);
}

function classifyTargets(plan, snapshot) {
  const byResourceKey = {};
  const counts = {
    old: 0,
    new: 0,
    blockedUnknown: 0,
    total: plan.mutations.length,
    byResourceKey,
  };

  const expectedHashByMutationId = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition.expectedHash]),
  );

  for (const mutation of plan.mutations) {
    const currentHash = resourceHash(snapshot, mutation.resource);
    const oldHash = expectedHashByMutationId.get(mutation.id) ?? mutation.remoteBeforeHash;
    const newHash = mutation.localHash;
    let classification = 'blockedUnknown';
    if (currentHash === oldHash) {
      classification = 'old';
      counts.old++;
    } else if (currentHash === newHash) {
      classification = 'new';
      counts.new++;
    } else {
      counts.blockedUnknown++;
    }
    byResourceKey[mutation.resourceKey] = {
      mutationId: mutation.id,
      currentHash,
      oldHash,
      newHash,
      classification,
    };
  }

  return counts;
}

function classifyTargetsFromStartedRow(plan, snapshot, startedRow) {
  const evidence = startedRow.resourceHashEvidence || {};
  const plannedTargets = Array.isArray(evidence.recoveryTargets) ? evidence.recoveryTargets : [];
  assert.equal(plannedTargets.length, plan.mutations.length, 'apply-started recovery target evidence must cover every planned target');

  const counts = {
    old: 0,
    new: 0,
    blockedUnknown: 0,
    total: plan.mutations.length,
  };
  const targets = [];

  for (const target of plannedTargets) {
    const currentHash = resourceHash(snapshot, target.resource);
    const oldHash = String(target.beforeHash ?? '');
    const newHash = String(target.afterHash ?? '');
    let classification = 'blockedUnknown';
    if (currentHash === oldHash) {
      classification = 'old';
      counts.old++;
    } else if (currentHash === newHash) {
      classification = 'new';
      counts.new++;
    } else {
      counts.blockedUnknown++;
    }
    targets.push({
      mutationId: String(target.mutationId ?? ''),
      resourceKey: String(target.resourceKey ?? ''),
      currentHash,
      beforeHash: oldHash,
      afterHash: newHash,
      classification,
    });
  }

  let state = 'blocked-recovery';
  if (counts.blockedUnknown === 0 && counts.old === counts.total) {
    state = 'old-remote';
  } else if (counts.blockedUnknown === 0 && counts.new === counts.total) {
    state = 'fully-updated-remote';
  }

  return {
    source: 'db-apply-started-row-plus-live-hashes',
    usedOptionJournal: false,
    state,
    counts,
    targets,
  };
}

function publicCounts(classifications) {
  return {
    old: classifications.old,
    new: classifications.new,
    blockedUnknown: classifications.blockedUnknown,
    total: classifications.total,
  };
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

function pushLog(logs, chunk) {
  logs.push(chunk);
  while (logs.join('').length > 20_000) {
    logs.shift();
  }
}

function promiseWithTimeout(promise, timeoutMs, timeoutValue) {
  return Promise.race([
    promise,
    sleep(timeoutMs).then(() => timeoutValue),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
