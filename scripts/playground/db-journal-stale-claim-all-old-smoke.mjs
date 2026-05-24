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
const idempotencyKey = 'db-journal-stale-claim-all-old-001';

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

let readyReceipt = null;

const summary = {
  transport: {
    host: '127.0.0.1',
    servers: [],
  },
  hook: {
    name: 'labSimulateStaleClaimAllOld',
    label: 'deterministic lab-only stale claim hook before mutation execution',
  },
  firstApply: {},
  conflict: {},
  retry: {},
  replay: {},
  retryClaimGuard: {},
  retryStartNegative: {},
  proven: [
    'the lab hook leaves opened/started/abandoned DB rows with no terminal or mutation evidence',
    'same key with different body still conflicts before stale retry work',
    'same key/body retry requires explicit abandonment evidence and all-old live hashes before fresh mutation work',
    'later exact replay is committed replay only and adds no mutation rows',
  ],
};

await withPlaygroundServer('db-journal-stale-claim-all-old', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');
  readyReceipt = dryRun.body.receipt;

  const applyBody = {
    plan: readyPlan,
    receipt: dryRun.body.receipt,
    labSimulateStaleClaimAllOld: true,
  };

  const before = await getSnapshot(server);
  assertVisibleSurfaceEqual(before.body.snapshot, snapshots.base, 'stale-claim before HTTP snapshot');

  const firstApply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(firstApply.status, 500);
  assert.equal(firstApply.body.ok, false);
  assert.equal(firstApply.body.code, 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD');
  assert.equal(firstApply.body.idempotency?.freshMutationWork, false);
  assert.equal(firstApply.body.idempotency?.staleClaimAbandoned, true);
  assertNoForbiddenEvidence(firstApply.body, 'first stale-claim response');

  const afterFirst = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterFirst.body.snapshot, snapshots.base, 'stale-claim hook target surface');

  const dbJournalAfterHook = await getDbJournal(server);
  const hookEntries = journalEntries(dbJournalAfterHook.body);
  assertJournalEvents(hookEntries, ['idempotency-opened', 'apply-started', 'stale-claim-abandoned']);
  assert.equal(countJournalEvents(hookEntries, 'apply-started'), 1, 'first hook must append exactly one apply-started');
  assert.equal(countJournalEvents(hookEntries, 'stale-claim-abandoned'), 1, 'first hook must append abandonment evidence');
  assert.equal(countJournalEvents(hookEntries, 'mutation-prepared'), 0, 'hook must not write mutation-prepared rows');
  assert.equal(countJournalEvents(hookEntries, 'mutation-applied'), 0, 'hook must not write mutation-applied rows');
  assert.equal(countJournalEvents(hookEntries, 'mutation-precondition-failed'), 0, 'hook must not write mutation-precondition-failed rows');
  assert.equal(countJournalEvents(hookEntries, 'apply-committed'), 0, 'hook must not create apply-committed');
  assert.equal(countJournalEvents(hookEntries, 'apply-rejected'), 0, 'hook must not create apply-rejected');
  assertHashOnlyStaleEvidence(hookEntries);

  const conflictingBody = {
    plan: changedPlan(readyPlan),
    receipt: tamperedReceipt(dryRun.body.receipt, (receipt) => {
      receipt.planId = 'changed-plan-before-stale-claim-retry';
    }),
    labSimulateStaleClaimAllOld: true,
  };
  const conflictBefore = await getSnapshot(server);
  const conflict = await postLab(server, '/apply', conflictingBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflict.body.idempotency?.freshMutationWork, false);
  const conflictAfter = await getSnapshot(server);
  assert.equal(digest(visibleSurface(conflictAfter.body.snapshot)), digest(visibleSurface(conflictBefore.body.snapshot)), 'conflict changed target data');
  const dbJournalAfterConflict = await getDbJournal(server);
  const conflictEntries = journalEntries(dbJournalAfterConflict.body);
  assert.equal(countJournalEvents(conflictEntries, 'apply-started'), 1, 'different-body conflict must not append apply-started');
  assert.equal(countJournalEvents(conflictEntries, 'mutation-applied'), 0, 'different-body conflict must not mutate');

  const retry = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.ok, true);
  assert.equal(retry.body.idempotency?.freshMutationWork, true);
  assert.equal(retry.body.idempotency?.staleClaimRetry, true);
  assert.deepEqual(retry.body.idempotency?.recoveryCounts, {
    old: readyPlan.mutations.length,
    new: 0,
    blockedUnknown: 0,
    total: readyPlan.mutations.length,
  });
  assertNoForbiddenEvidence(retry.body.idempotency, 'retry idempotency evidence');

  const afterRetry = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterRetry.body.snapshot, snapshots.local, 'stale-claim retry final visible surface');
  assertAppliedHashes(readyPlan, afterRetry.body.snapshot);
  const afterRetryDigest = digest(visibleSurface(afterRetry.body.snapshot));

  const dbJournalAfterRetry = await getDbJournal(server);
  const retryEntries = journalEntries(dbJournalAfterRetry.body);
  assertJournalEvents(retryEntries, ['stale-claim-retry-started', 'mutation-applied', 'apply-committed']);
  assert.equal(countJournalEvents(retryEntries, 'stale-claim-abandoned'), 1, 'retry must not append another abandoned event');
  assert.equal(countJournalEvents(retryEntries, 'stale-claim-retry-started'), 1, 'retry must append one stale retry evidence row');
  assert.equal(countJournalEvents(retryEntries, 'apply-started'), 2, 'retry must append one normal apply-started after the stale start');
  assert.equal(countJournalEvents(retryEntries, 'mutation-applied'), readyPlan.mutations.length, 'retry must apply exactly one mutation set');
  assert.equal(countJournalEvents(retryEntries, 'mutation-precondition-failed'), 0, 'retry must not record failed preconditions');
  assert.equal(countJournalEvents(retryEntries, 'apply-committed'), 1, 'retry must append one commit');
  assertEventBefore(retryEntries, 'stale-claim-abandoned', 'stale-claim-retry-started');
  assertEventBefore(retryEntries, 'stale-claim-retry-started', 'mutation-applied');
  assertEventBefore(retryEntries, 'mutation-applied', 'apply-committed');
  assertHashOnlyStaleEvidence(retryEntries);

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.code, 'BATCH_ALREADY_COMMITTED');
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  const afterReplay = await getSnapshot(server);
  assert.equal(digest(visibleSurface(afterReplay.body.snapshot)), afterRetryDigest, 'replay changed target data');
  const dbJournalAfterReplay = await getDbJournal(server);
  const replayEntries = journalEntries(dbJournalAfterReplay.body);
  assert.equal(countJournalEvents(replayEntries, 'mutation-applied'), readyPlan.mutations.length, 'replay must not append mutation rows');
  assert.equal(countJournalEvents(replayEntries, 'apply-committed'), 1, 'replay must not append another commit');

  summary.firstApply = {
    status: firstApply.status,
    code: firstApply.body.code,
    dbEvents: hookEntries.map(journalEvent),
    targetStillOld: true,
  };
  summary.conflict = {
    status: conflict.status,
    code: conflict.body.code,
    targetSnapshotUnchanged: true,
  };
  summary.retry = {
    status: retry.status,
    freshMutationWork: retry.body.idempotency?.freshMutationWork,
    staleClaimRetry: retry.body.idempotency?.staleClaimRetry,
    mutationRows: countJournalEvents(retryEntries, 'mutation-applied'),
    committedRows: countJournalEvents(retryEntries, 'apply-committed'),
  };
  summary.replay = {
    status: replay.status,
    code: replay.body.code,
    freshMutationWork: replay.body.idempotency?.freshMutationWork,
  };
});

await withPlaygroundServer('db-journal-stale-claim-retry-claim-guard', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  assert.ok(readyReceipt, 'ready receipt must be captured before retry-claim guard scenario');

  const guardKey = 'db-journal-stale-claim-retry-claim-guard-001';
  const applyBody = {
    plan: readyPlan,
    receipt: readyReceipt,
    labSimulateStaleClaimAllOld: true,
    labSimulateStaleRetryAfterClaim: true,
  };

  const firstApply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: guardKey });
  assert.equal(firstApply.status, 500, `retry-claim guard stale hook failed unexpectedly: ${JSON.stringify(firstApply.body)}`);
  assert.equal(firstApply.body.code, 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD');

  const claimHolder = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: guardKey });
  assert.equal(claimHolder.status, 500);
  assert.equal(claimHolder.body.code, 'LAB_SIMULATED_STALE_RETRY_AFTER_CLAIM');
  assert.equal(claimHolder.body.idempotency?.freshMutationWork, false);
  assert.equal(claimHolder.body.idempotency?.staleClaimRetry, true);

  const afterClaimHolder = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterClaimHolder.body.snapshot, snapshots.base, 'retry claim holder target surface');

  const loser = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: guardKey });
  assert.equal(loser.status, 409);
  assert.equal(loser.body.code, 'IDEMPOTENCY_KEY_IN_PROGRESS');
  assert.equal(loser.body.idempotency?.freshMutationWork, false);
  assert.equal(loser.body.idempotency?.inProgress, true);

  const afterLoser = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterLoser.body.snapshot, snapshots.base, 'retry claim loser target surface');

  const dbJournalAfterGuard = await getDbJournal(server);
  const guardEntries = journalEntries(dbJournalAfterGuard.body);
  assert.equal(countJournalEvents(guardEntries, 'stale-claim-abandoned'), 1, 'guard must have one abandonment marker');
  assert.equal(countJournalEvents(guardEntries, 'stale-claim-retry-started'), 1, 'guard must have one successful retry claim');
  assert.equal(countJournalEvents(guardEntries, 'stale-claim-retry-in-progress'), 1, 'guard loser must append only in-progress evidence');
  assert.equal(countJournalEvents(guardEntries, 'apply-started'), 1, 'guard must not append retry apply-started');
  assert.equal(countJournalEvents(guardEntries, 'mutation-prepared'), 0, 'guard must not prepare mutations');
  assert.equal(countJournalEvents(guardEntries, 'mutation-applied'), 0, 'guard must not mutate');
  assert.equal(countJournalEvents(guardEntries, 'apply-committed'), 0, 'guard must not commit');
  assertHashOnlyStaleEvidence(guardEntries);

  summary.retryClaimGuard = {
    claimHolderStatus: claimHolder.status,
    claimHolderCode: claimHolder.body.code,
    loserStatus: loser.status,
    loserCode: loser.body.code,
    retryStartedRows: countJournalEvents(guardEntries, 'stale-claim-retry-started'),
    retryInProgressRows: countJournalEvents(guardEntries, 'stale-claim-retry-in-progress'),
    retryApplyStartedRows: countJournalEvents(guardEntries, 'apply-started') - 1,
    mutationRows: countJournalEvents(guardEntries, 'mutation-applied'),
  };
});

await withPlaygroundServer('db-journal-stale-claim-retry-start-negative', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  assert.ok(readyReceipt, 'ready receipt must be captured before retry-start negative scenario');

  const negativeKey = 'db-journal-stale-claim-retry-start-negative-001';
  const applyBody = {
    plan: readyPlan,
    receipt: readyReceipt,
    labSimulateStaleClaimAllOld: true,
    labSimulateStaleRetryAfterStarted: true,
  };

  const firstApply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: negativeKey });
  assert.equal(firstApply.status, 500);
  assert.equal(firstApply.body.code, 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD');

  const startedRetry = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: negativeKey });
  assert.equal(startedRetry.status, 500);
  assert.equal(startedRetry.body.code, 'LAB_SIMULATED_STALE_RETRY_AFTER_STARTED');
  assert.equal(startedRetry.body.idempotency?.freshMutationWork, false);

  const afterStartedRetry = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterStartedRetry.body.snapshot, snapshots.base, 'stale retry start hook target surface');

  const blocked = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: negativeKey });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.ok, false);
  assert.equal(blocked.body.code, 'RECOVERY_BLOCKED');
  assert.equal(blocked.body.idempotency?.freshMutationWork, false);
  const afterBlocked = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterBlocked.body.snapshot, snapshots.base, 'stale retry second-start blocked target surface');

  const dbJournalAfterBlocked = await getDbJournal(server);
  const negativeEntries = journalEntries(dbJournalAfterBlocked.body);
  assert.equal(countJournalEvents(negativeEntries, 'stale-claim-abandoned'), 1, 'negative must keep only original abandonment');
  assert.equal(countJournalEvents(negativeEntries, 'stale-claim-retry-started'), 1, 'negative must not reopen stale retry against older abandonment');
  assert.equal(countJournalEvents(negativeEntries, 'apply-started'), 2, 'negative must have original start and one retry start only');
  assert.equal(countJournalEvents(negativeEntries, 'mutation-prepared'), 0, 'negative must not prepare mutations');
  assert.equal(countJournalEvents(negativeEntries, 'mutation-applied'), 0, 'negative must not mutate');
  assert.equal(countJournalEvents(negativeEntries, 'apply-committed'), 0, 'negative must not commit');
  assert.equal(countJournalEvents(negativeEntries, 'recovery-blocked'), 1, 'negative must fall through to blocked recovery');
  assertHashOnlyStaleEvidence(negativeEntries);

  summary.retryStartNegative = {
    startedRetryStatus: startedRetry.status,
    startedRetryCode: startedRetry.body.code,
    laterStatus: blocked.status,
    laterCode: blocked.body.code,
    retryStartedRows: countJournalEvents(negativeEntries, 'stale-claim-retry-started'),
    mutationRows: countJournalEvents(negativeEntries, 'mutation-applied'),
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

async function withPlaygroundServer(name, blueprintPath, run, options = {}) {
  const server = await startPlaygroundServer(name, blueprintPath, options);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath, options = {}) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const workers = options.workers ?? 1;
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
    String(workers),
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
      workers,
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
    headers: body === undefined ? {
      connection: 'close',
      ...headers,
    } : {
      'content-type': 'application/json',
      connection: 'close',
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

function assertEventBefore(entries, beforeEvent, afterEvent) {
  const before = entries.find((entry) => journalEvent(entry) === beforeEvent)?.sequence ?? -1;
  const after = entries.find((entry) => journalEvent(entry) === afterEvent)?.sequence ?? -1;
  assert.ok(before > 0, `DB journal missing ${beforeEvent}`);
  assert.ok(after > 0, `DB journal missing ${afterEvent}`);
  assert.ok(before < after, `${beforeEvent} must be before ${afterEvent}`);
}

function assertHashOnlyStaleEvidence(entries) {
  const staleEntries = entries.filter((entry) => [
    'stale-claim-abandoned',
    'stale-claim-retry-started',
    'stale-claim-retry-in-progress',
  ].includes(journalEvent(entry)));
  assert.ok(staleEntries.length > 0, 'expected stale claim evidence rows');
  for (const entry of staleEntries) {
    assertNoForbiddenEvidence(entry.result, `${journalEvent(entry)} result`);
    assertNoForbiddenEvidence(entry.resourceHashEvidence, `${journalEvent(entry)} evidence`);
    const serialized = JSON.stringify(entry.resourceHashEvidence ?? {});
    assert.ok(!serialized.includes(repoRoot), `${journalEvent(entry)} evidence leaked host repo path`);
    assert.ok(!/"resource"\s*:/.test(serialized), `${journalEvent(entry)} evidence stored raw resource descriptors`);
    assert.ok(!/"recoveryTargets"\s*:/.test(serialized), `${journalEvent(entry)} evidence stored raw recovery targets`);
  }
}

function assertNoForbiddenEvidence(value, label) {
  const forbidden = new Set([
    'value',
    'content',
    'payload',
    'payloads',
    'post_content',
    'option_value',
    'meta_value',
    'currentSnapshot',
    'afterSnapshot',
    'beforeSnapshot',
  ]);
  visit(value, (key, innerValue) => {
    assert.ok(!forbidden.has(key), `${label} leaked forbidden key ${key}`);
    if (typeof innerValue === 'string') {
      assert.ok(!innerValue.includes(repoRoot), `${label} leaked host repo path`);
    }
  });
}

function visit(value, callback, key = '') {
  callback(key, value);
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, callback, String(index)));
    return;
  }
  for (const [innerKey, innerValue] of Object.entries(value)) {
    visit(innerValue, callback, innerKey);
  }
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
  assert.equal(digest(visibleSurface(actual)), digest(visibleSurface(expected)), `${label} digest mismatch`);
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
