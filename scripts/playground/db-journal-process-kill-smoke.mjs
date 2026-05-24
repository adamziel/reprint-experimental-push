#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const baseFixture = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const evidenceTimeoutMs = 45_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';
const idempotencyKey = 'db-journal-process-kill-001';
const crashMutationCount = 160;
const crashFileBytes = 32 * 1024;

const baseSnapshot = exportSnapshot('remote-base', baseFixture);
assert.equal(baseSnapshot.meta.fixture, 'remote-base');

const crashPlan = createProcessKillPlan(baseSnapshot);
assert.equal(crashPlan.status, 'ready');
assert.equal(crashPlan.summary.conflicts, 0);
assert.equal(crashPlan.summary.blockers, 0);
assert.equal(crashPlan.mutations.length, crashMutationCount);
assertTargetHashes(crashPlan, baseSnapshot, 'expectedHash', 'process-kill preconditions');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-db-journal-process-kill-'));
const wpDir = path.join(tmpRoot, 'wordpress');
fs.mkdirSync(wpDir, { recursive: true });

const summary = {
  transport: {
    host: '127.0.0.1',
    persistedWordPressMount: true,
    servers: [],
  },
  plan: {
    status: crashPlan.status,
    mutations: crashPlan.mutations.length,
    syntheticFileMutations: crashMutationCount,
  },
  kill: {},
  restart: {},
  evidence: {},
  retry: {},
  proven: [
    'real SIGKILL of the local Playground server process group during an in-flight DB-journaled REST apply',
    'host-mounted WordPress directory preserves DB rows and target data across restart',
    'DB journal rows after restart show opened/started and no committed state',
    'DB-native planned/pre-write/post-write hash evidence plus live target hashes classify every planned target as old or new, with no silent divergence',
    'retry after missing commit is blocked and does not overwrite partial/ambiguous state',
  ],
  residualRisks: [
    'this smoke does not prove production durability guarantees beyond the local Playground SQLite/host-mount harness',
    'this smoke proves mixed-state blocking after a real kill; all-old retry and all-targets-updated finalization are covered by separate deterministic paths',
  ],
};

let server;
let success = false;

try {
  const port = await findLocalPort();
  server = await startPlaygroundServer({
    name: 'db-journal-process-kill-initial',
    wpDir,
    port,
    blueprintPath: baseFixture,
  });
  summary.transport.servers.push(server.summary);

  const dryRun = await postLab(server, '/dry-run', { plan: crashPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');
  assert.equal(dryRun.body.verifiedPreconditions.length, crashPlan.mutations.length);

  const applyBody = {
    plan: crashPlan,
    receipt: dryRun.body.receipt,
  };

  const beforeApply = await getSnapshot(server);
  assertClassifications(classifyTargets(crashPlan, beforeApply.body.snapshot), {
    old: crashMutationCount,
    new: 0,
    blockedUnknown: 0,
    label: 'before process kill apply',
  });

  const applyPromise = postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey })
    .then((response) => ({ settled: true, response }))
    .catch((error) => ({ settled: true, error: error.message }));

  await waitForDbJournalEvent(server, 'apply-started', evidenceTimeoutMs);
  const preKillMutationEvidence = await waitForDbJournalEvent(server, 'mutation-applied', evidenceTimeoutMs);
  const preKillOptionEvidence = await getOptionMutationEvidence(server);
  const preKillDbJournal = await getDbJournal(server);
  const preKillDbEvents = journalEntries(preKillDbJournal.body).map(journalEvent);
  assert.ok(preKillDbEvents.includes('idempotency-opened'), 'pre-kill DB journal missing idempotency-opened');
  assert.ok(preKillDbEvents.includes('apply-started'), 'pre-kill DB journal missing apply-started');
  assert.ok(preKillDbEvents.includes('mutation-prepared'), 'pre-kill DB journal missing mutation-prepared');
  assert.ok(preKillDbEvents.includes('mutation-applied'), 'pre-kill DB journal missing mutation-applied');
  assert.ok(!preKillDbEvents.includes('apply-committed'), 'apply committed before SIGKILL could be issued');

  const killResult = await killPlaygroundServer(server, 'SIGKILL');
  assert.equal(killResult.signal, 'SIGKILL', 'Playground server child must report SIGKILL exit signal');
  server.summary.stopped = true;
  summary.kill = {
    signal: killResult.signal,
    requestedSignal: killResult.requestedSignal,
    exitCode: killResult.exitCode,
    portClosed: !(await isPortAccepting(server.port)),
    optionMutationEvidenceBeforeKill: preKillOptionEvidence.count,
    dbMutationEvidenceBeforeKill: countJournalEvents(preKillMutationEvidence.entries, 'mutation-applied'),
    dbEventsBeforeKill: preKillDbEvents,
  };

  const applyAfterKill = await promiseWithTimeout(applyPromise, 10_000, { settled: false, timeout: true });
  assert.notEqual(applyAfterKill.response?.body?.ok, true, 'in-flight apply unexpectedly returned success after SIGKILL');

  server = await startPlaygroundServer({
    name: 'db-journal-process-kill-restart',
    wpDir,
    port,
    blueprintPath: null,
  });
  summary.transport.servers.push(server.summary);

  const afterRestartSnapshot = await getSnapshot(server);
  const restartClassifications = classifyTargets(crashPlan, afterRestartSnapshot.body.snapshot);
  assert.ok(restartClassifications.new > 0, 'SIGKILL happened before any planned target mutation persisted');
  assert.ok(restartClassifications.old > 0, 'apply completed every mutation before SIGKILL; not a partial-kill proof');
  assertClassifications(restartClassifications, {
    old: restartClassifications.old,
    new: restartClassifications.new,
    blockedUnknown: 0,
    label: 'after restart live target hashes',
  });

  const dbJournalAfterRestart = await getDbJournal(server);
  const dbRowsAfterRestart = journalEntries(dbJournalAfterRestart.body);
  const dbEventsAfterRestart = dbRowsAfterRestart.map(journalEvent);
  assert.ok(dbEventsAfterRestart.includes('idempotency-opened'), 'restarted DB journal missing idempotency-opened');
  assert.ok(dbEventsAfterRestart.includes('apply-started'), 'restarted DB journal missing apply-started');
  assert.ok(!dbEventsAfterRestart.includes('apply-committed'), 'restarted DB journal falsely reports apply-committed');
  assert.ok(!dbEventsAfterRestart.includes('apply-replayed'), 'restarted DB journal falsely reports replay');
  assert.ok(dbEventsAfterRestart.includes('mutation-prepared'), 'restarted DB journal missing pre-write mutation evidence');
  const dbMutationRowsAfterRestart = countJournalEvents(dbRowsAfterRestart, 'mutation-applied');
  const dbPreparedRowsAfterRestart = countJournalEvents(dbRowsAfterRestart, 'mutation-prepared');
  assert.ok(
    dbMutationRowsAfterRestart <= restartClassifications.new,
    'DB mutation evidence cannot exceed live new target count after SIGKILL',
  );
  assert.ok(
    dbPreparedRowsAfterRestart >= dbMutationRowsAfterRestart,
    'DB pre-write mutation evidence cannot be shorter than DB post-write mutation evidence',
  );

  const dbOnlyRecovery = classifyTargetsFromDbJournal(crashPlan, afterRestartSnapshot.body.snapshot, dbRowsAfterRestart);
  assert.deepEqual(dbOnlyRecovery.counts, publicCounts(restartClassifications), 'DB journal plus live hashes must match live classification counts');
  assert.equal(dbOnlyRecovery.state, 'blocked-recovery', 'partial DB journal recovery must block');
  assert.equal(dbOnlyRecovery.action, 'block-non-mutating', 'partial DB journal recovery must be non-mutating');
  assert.equal(dbOnlyRecovery.usedOptionJournal, false, 'DB recovery proof must not use legacy option journal');

  const optionJournalAfterRestart = await getOptionJournal(server);
  const optionEventsAfterRestart = optionJournalAfterRestart.body.journal.entries.map((entry) => entry.event);
  assert.ok(optionEventsAfterRestart.includes('apply-started'), 'option journal missing apply-started after restart');
  assert.ok(optionEventsAfterRestart.includes('mutation-applied'), 'option journal missing mutation-applied evidence after restart');
  assert.ok(!optionEventsAfterRestart.includes('apply-committed'), 'option journal falsely reports apply-committed after restart');

  const inspect = await postLab(server, '/recovery/inspect', applyBody);
  assert.equal(inspect.status, 200);
  assert.equal(inspect.body.ok, true);
  assert.equal(inspect.body.recovery?.state, 'blocked-recovery');
  assert.deepEqual(inspect.body.recovery?.counts, {
    old: restartClassifications.old,
    new: restartClassifications.new,
    blockedUnknown: 0,
    total: crashMutationCount,
  });
  assertRecoveryTargetsMatchClassifications(inspect.body.recovery, restartClassifications.byResourceKey);

  summary.restart = {
    dbEventsAfterRestart,
    optionEventsAfterRestart,
    dbMutationRowsAfterRestart,
    dbPreparedRowsAfterRestart,
    dbOnlyRecovery,
    liveClassifications: publicCounts(restartClassifications),
    recoveryState: inspect.body.recovery.state,
    recoveryCounts: inspect.body.recovery.counts,
    currentSnapshotHash: inspect.body.recovery.currentSnapshotHash,
  };

  const beforeRetryDigest = digest(visibleSurface(afterRestartSnapshot.body.snapshot));
  const retry = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(retry.body.ok, false, 'retry after missing commit must not succeed');
  assert.ok(
    [
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      'PRECONDITION_FAILED',
      'RECOVERY_REQUIRED',
      'RECOVERY_BLOCKED',
      'BLOCKED_RECOVERY',
    ].includes(retry.body.code),
    `unexpected retry blocker code: ${retry.body.code}`,
  );
  assert.notEqual(retry.body.code, 'BATCH_ALREADY_COMMITTED', 'missing commit must not replay as committed');
  const afterRetrySnapshot = await getSnapshot(server);
  assert.equal(digest(visibleSurface(afterRetrySnapshot.body.snapshot)), beforeRetryDigest, 'retry changed target data');
  const afterRetryClassifications = classifyTargets(crashPlan, afterRetrySnapshot.body.snapshot);
  assert.deepEqual(publicCounts(afterRetryClassifications), publicCounts(restartClassifications), 'retry changed live classifications');

  const dbJournalAfterRetry = await getDbJournal(server);
  const dbEventsAfterRetry = journalEntries(dbJournalAfterRetry.body).map(journalEvent);
  assert.ok(
    dbEventsAfterRetry.includes('apply-rejected')
      || dbEventsAfterRetry.includes('idempotency-in-progress')
      || dbEventsAfterRetry.includes('recovery-blocked'),
    'DB journal should record retry rejection, persisted in-progress claim, or blocked recovery',
  );
  assert.ok(!dbEventsAfterRetry.includes('apply-committed'), 'retry falsely recorded apply-committed');

  summary.retry = {
    status: retry.status,
    code: retry.body.code,
    targetSnapshotUnchanged: true,
    liveClassifications: publicCounts(afterRetryClassifications),
    dbEventsAfterRetry,
  };

  summary.evidence = {
    dbRowsPersistedAcrossRestart: true,
    targetDataPersistedAcrossRestart: true,
    noFalseCommittedState: true,
    targetStateExplainable: true,
    dbOnlyRecoveryProof: true,
  };

  success = true;
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (server) {
    await stopPlaygroundServer(server);
  }
  if (success) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

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

function createProcessKillPlan(base) {
  const local = JSON.parse(JSON.stringify(base));
  local.files = { ...(local.files || {}) };
  for (let index = 0; index < crashMutationCount; index++) {
    const padded = String(index + 1).padStart(3, '0');
    local.files[`wp-content/uploads/reprint-push/process-kill/file-${padded}.txt`] =
      `process-kill-${padded}\n${'x'.repeat(crashFileBytes)}`;
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

async function waitForDbJournalEvent(currentServer, event, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await getDbJournal(currentServer);
    const entries = journalEntries(response.body);
    if (entries.some((entry) => journalEvent(entry) === event)) {
      return { entries };
    }
    assert.ok(!entries.some((entry) => journalEvent(entry) === 'apply-committed'), 'apply committed before expected DB event');
    await sleep(100);
  }
  throw new Error(`Timed out waiting for DB journal event ${event}`);
}

async function waitForOptionJournalEvent(currentServer, event, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await getOptionJournal(currentServer);
    const entries = response.body.journal?.entries || [];
    const count = entries.filter((entry) => entry.event === event).length;
    if (count > 0) {
      return { entries, count };
    }
    assert.ok(!entries.some((entry) => entry.event === 'apply-committed'), 'apply committed before expected option journal event');
    await sleep(100);
  }
  throw new Error(`Timed out waiting for option journal event ${event}`);
}

async function getOptionMutationEvidence(currentServer) {
  const response = await getOptionJournal(currentServer);
  const entries = response.body.journal?.entries || [];
  return {
    entries,
    count: entries.filter((entry) => entry.event === 'mutation-applied').length,
  };
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
  return getLab(currentServer, '/db-journal?limit=500');
}

async function getOptionJournal(currentServer) {
  return getLab(currentServer, '/journal?limit=80');
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

function classifyTargetsFromDbJournal(plan, snapshot, rows) {
  const plannedEvidence = dbPlannedMutationEvidence(rows);
  assert.equal(plannedEvidence.size, plan.mutations.length, 'DB apply-started planned mutation evidence must cover every target');

  const counts = {
    old: 0,
    new: 0,
    blockedUnknown: 0,
    total: plan.mutations.length,
  };
  const targets = [];

  for (const mutation of plan.mutations) {
    const evidence = plannedEvidence.get(mutation.id);
    assert.ok(evidence, `missing DB planned evidence for ${mutation.id}`);
    assert.equal(evidence.resourceKey, mutation.resourceKey, `DB resource key mismatch for ${mutation.id}`);
    assert.equal(evidence.resourceType, mutation.resource.type, `DB resource type mismatch for ${mutation.id}`);

    const currentHash = resourceHash(snapshot, mutation.resource);
    let classification = 'blockedUnknown';
    if (currentHash === evidence.beforeHash) {
      classification = 'old';
      counts.old++;
    } else if (currentHash === evidence.plannedAfterHash) {
      classification = 'new';
      counts.new++;
    } else {
      counts.blockedUnknown++;
    }

    targets.push({
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      resourceType: mutation.resource.type,
      currentHash,
      beforeHash: evidence.beforeHash,
      plannedAfterHash: evidence.plannedAfterHash,
      classification,
    });
  }

  let state = 'blocked-recovery';
  let action = 'block-non-mutating';
  if (counts.blockedUnknown === 0 && counts.old === counts.total) {
    state = 'old-remote';
    action = 'safe-retry-after-revalidation';
  } else if (counts.blockedUnknown === 0 && counts.new === counts.total) {
    state = 'fully-updated-remote';
    action = 'finalization-eligible';
  }

  return {
    source: 'db-journal-plus-live-hashes',
    usedOptionJournal: false,
    state,
    action,
    counts,
    targets,
  };
}

function dbPlannedMutationEvidence(rows) {
  const planned = new Map();
  for (const row of rows) {
    const evidence = row.resourceHashEvidence || {};
    const plannedMutations = Array.isArray(evidence.plannedMutations) ? evidence.plannedMutations : [];
    for (const item of plannedMutations) {
      const mutation = normalizeDbMutationEvidence(item);
      if (mutation.mutationId) {
        planned.set(mutation.mutationId, mutation);
      }
    }
  }
  return planned;
}

function normalizeDbMutationEvidence(item) {
  const mutation = item?.mutation && typeof item.mutation === 'object' ? item.mutation : item;
  return {
    mutationOrder: Number(mutation?.mutationOrder ?? mutation?.index ?? 0),
    mutationId: String(mutation?.mutationId ?? mutation?.id ?? ''),
    resourceKey: String(mutation?.resourceKey ?? ''),
    resourceType: String(mutation?.resourceType ?? mutation?.resource?.type ?? ''),
    beforeHash: String(mutation?.beforeHash ?? mutation?.expectedBeforeHash ?? ''),
    plannedAfterHash: String(mutation?.plannedAfterHash ?? mutation?.afterHash ?? ''),
  };
}

function assertClassifications(actual, expected) {
  assert.equal(actual.old, expected.old, `${expected.label}: old count`);
  assert.equal(actual.new, expected.new, `${expected.label}: new count`);
  assert.equal(actual.blockedUnknown, expected.blockedUnknown, `${expected.label}: blockedUnknown count`);
  assert.equal(actual.total, crashMutationCount, `${expected.label}: total count`);
}

function assertRecoveryTargetsMatchClassifications(recovery, byResourceKey) {
  assert.ok(Array.isArray(recovery?.targets), 'recovery response missing targets');
  for (const target of recovery.targets) {
    const expected = byResourceKey[target.resourceKey];
    assert.ok(expected, `unexpected recovery target ${target.resourceKey}`);
    assert.equal(target.currentHash, expected.currentHash, `current hash mismatch for ${target.resourceKey}`);
    assert.equal(target.classification, expected.classification, `classification mismatch for ${target.resourceKey}`);
  }
}

function publicCounts(classifications) {
  return {
    old: classifications.old,
    new: classifications.new,
    blockedUnknown: classifications.blockedUnknown,
    total: classifications.total,
  };
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
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
