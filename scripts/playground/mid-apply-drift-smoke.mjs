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
const idempotencyKey = 'idem-mid-apply-jit-drift';
const driftContent = 'mid-apply external drift content';

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

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.mutations.length, 8, 'ready fixture plan must keep eight target mutations');

const driftIndex = readyPlan.mutations.findIndex(
  (mutation) => mutation.resourceKey === 'file:wp-content/uploads/reprint-push/shared.txt',
);
assert.ok(driftIndex > 0, 'mid-apply drift target must have an earlier mutation to prove partial recovery');
const driftMutation = readyPlan.mutations[driftIndex];
const preconditionsByMutation = new Map(
  readyPlan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
);

const summary = {
  transport: {
    host: '127.0.0.1',
    servers: [],
  },
  drift: {
    mutationIndex: driftIndex,
    mutationId: driftMutation.id,
    resourceKey: driftMutation.resourceKey,
  },
  result: {},
  idempotency: {},
  recovery: {},
  journals: {},
};

await withPlaygroundServer('mid-apply-drift-base', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');

  const applyBody = {
    plan: readyPlan,
    receipt: dryRun.body.receipt,
    labSimulateMissingDbCommit: true,
    labDriftAfterPrepared: {
      mutationId: driftMutation.id,
      resourceKey: driftMutation.resourceKey,
      value: {
        type: 'file',
        content: driftContent,
      },
    },
  };

  const before = await getSnapshot(server);
  assertSnapshotContentEqual(before.body.snapshot, snapshots.base, 'mid-apply drift initial snapshot');

  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'just-in-time');
  assert.equal(apply.body.applied, driftIndex, 'only earlier mutations may land before JIT drift failure');
  assert.equal(apply.body.recovery?.required, true);
  assert.equal(apply.body.recovery?.state, 'blocked-recovery');
  assert.ok(apply.body.recovery?.counts?.new >= 1, 'recovery evidence must show earlier landed mutations as new');
  assert.ok(apply.body.recovery?.counts?.blockedUnknown >= 1, 'drifted target must be blocked unknown');
  assertResponseHasNoRawFixtureData(apply.body);

  const afterFailure = await getSnapshot(server);
  assert.equal(
    afterFailure.body.snapshot.files['wp-content/uploads/reprint-push/shared.txt'],
    driftContent,
    'JIT failure must preserve the external drift value',
  );
  assert.equal(
    afterFailure.body.snapshot.files['wp-content/uploads/reprint-push/local-only.txt'],
    snapshots.local.files['wp-content/uploads/reprint-push/local-only.txt'],
    'earlier mutation should remain landed for recovery evidence',
  );
  assert.equal(
    resourceHash(afterFailure.body.snapshot, driftMutation.resource),
    hashFileContent(driftContent),
    'drift target hash must reflect the external value',
  );
  assert.notEqual(resourceHash(afterFailure.body.snapshot, driftMutation.resource), driftMutation.localHash);
  assert.equal(
    resourceHash(afterFailure.body.snapshot, readyPlan.mutations[0].resource),
    readyPlan.mutations[0].localHash,
    'earlier target should be at the planned new hash',
  );
  assertLaterMutationsStayedOld(afterFailure.body.snapshot, readyPlan, driftIndex, preconditionsByMutation);

  const optionJournal = await getLab(server, '/journal?limit=80');
  assert.equal(optionJournal.status, 200);
  assertStoredJournalHasNoRawFixtureData(optionJournal.body);
  assertNoRawString(optionJournal.body, driftContent, 'option journal');

  const dbJournalAfterFailure = await getLab(server, '/db-journal?limit=120');
  assert.equal(dbJournalAfterFailure.status, 200);
  const failureEntries = assertDbJournalEvidence(dbJournalAfterFailure.body, 'DB journal after JIT failure');
  assertJournalEvents(failureEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-prepared',
    'mutation-applied',
    'mutation-precondition-failed',
    'apply-rejected',
  ]);
  assertNoJournalEvent(failureEntries, 'apply-committed');
  assert.equal(countJournalEvents(failureEntries, 'mutation-applied'), driftIndex);
  assert.equal(countJournalEvents(failureEntries, 'mutation-prepared'), driftIndex + 1);
  assertNoMutationAppliedFor(failureEntries, driftMutation.id);
  assertNoPreparedAfter(failureEntries, driftIndex);
  assertJitHashEvidence(failureEntries, readyPlan, driftMutation, preconditionsByMutation);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterFailure.body);
  assertNoRawString(dbJournalAfterFailure.body, driftContent, 'DB journal');

  const inspectBefore = await getSnapshot(server);
  const inspect = await postLab(server, '/recovery/inspect', {
    plan: readyPlan,
    receipt: dryRun.body.receipt,
  });
  assert.equal(inspect.status, 200);
  assert.equal(inspect.body.ok, true);
  assert.equal(inspect.body.recovery?.state, 'blocked-recovery');
  assert.ok(inspect.body.recovery?.counts?.new >= 1, 'inspect must preserve partial-new evidence');
  assert.ok(inspect.body.recovery?.counts?.blockedUnknown >= 1, 'inspect must keep drift blocked');
  assertResponseHasNoRawFixtureData(inspect.body);
  const inspectAfter = await getSnapshot(server);
  assertTargetSurfaceEqual(inspectAfter.body.snapshot, inspectBefore.body.snapshot, 'recovery inspect must not mutate');

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(replay.status, 412);
  assert.equal(replay.body.ok, false);
  assert.equal(replay.body.code, 'PRECONDITION_FAILED');
  assert.equal(replay.body.idempotency?.replayed, true);
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  assertResponseHasNoRawFixtureData(replay.body);
  const afterReplay = await getSnapshot(server);
  assertTargetSurfaceEqual(afterReplay.body.snapshot, afterFailure.body.snapshot, 'rejected replay must not mutate');

  const dbJournalAfterReplay = await getLab(server, '/db-journal?limit=120');
  const replayEntries = assertDbJournalEvidence(dbJournalAfterReplay.body, 'DB journal after rejected replay');
  assertJournalEvents(replayEntries, ['apply-replayed']);
  assertNoJournalEvent(replayEntries, 'apply-committed');
  assert.equal(countJournalEvents(replayEntries, 'mutation-applied'), driftIndex);
  assert.equal(countJournalEvents(replayEntries, 'mutation-precondition-failed'), 1);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterReplay.body);

  const conflictBody = {
    ...applyBody,
    labDriftAfterPrepared: {
      ...applyBody.labDriftAfterPrepared,
      value: {
        type: 'file',
        content: 'different mid-apply external drift content',
      },
    },
  };
  const conflict = await postLab(server, '/apply', conflictBody, { [idempotencyHeader]: idempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(conflict.body.idempotency?.freshMutationWork, false);
  const afterConflict = await getSnapshot(server);
  assertTargetSurfaceEqual(afterConflict.body.snapshot, afterFailure.body.snapshot, 'different-body conflict must not mutate');

  const dbJournalAfterConflict = await getLab(server, '/db-journal?limit=120');
  const conflictEntries = assertDbJournalEvidence(dbJournalAfterConflict.body, 'DB journal after different-body conflict');
  assertJournalEvents(conflictEntries, ['idempotency-key-conflict']);
  assertNoJournalEvent(conflictEntries, 'apply-committed');
  assert.equal(countJournalEvents(conflictEntries, 'mutation-applied'), driftIndex);

  summary.result = {
    route: 'POST /wp-json/reprint-push-lab/v1/apply',
    status: apply.status,
    code: apply.body.code,
    appliedBeforeFailure: apply.body.applied,
    recoveryState: apply.body.recovery.state,
    recoveryCounts: apply.body.recovery.counts,
    driftPreserved: afterFailure.body.snapshot.files['wp-content/uploads/reprint-push/shared.txt'] === driftContent,
    missingCommitFinalized: false,
  };
  summary.idempotency = {
    replayStatus: replay.status,
    replayed: replay.body.idempotency?.replayed === true,
    replayFreshMutationWork: replay.body.idempotency?.freshMutationWork,
    conflictStatus: conflict.status,
    conflictCode: conflict.body.code,
  };
  summary.recovery = {
    inspectStatus: inspect.status,
    inspectState: inspect.body.recovery.state,
    inspectNonMutating: digest(visibleSurface(inspectAfter.body.snapshot)) === digest(visibleSurface(inspectBefore.body.snapshot)),
  };
  summary.journals = {
    mutationPrepared: countJournalEvents(failureEntries, 'mutation-prepared'),
    mutationApplied: countJournalEvents(failureEntries, 'mutation-applied'),
    preconditionFailed: countJournalEvents(failureEntries, 'mutation-precondition-failed'),
    applyCommitted: countJournalEvents(conflictEntries, 'apply-committed'),
    rawDataRedacted: true,
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
  let response;
  try {
    response = await fetch(`${server.baseUrl}${pathname}`, {
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
  } catch (error) {
    throw new Error(
      `Fetch failed for ${method} ${pathname}: ${error.message}\nRecent Playground logs:\n${server.logs.join('')}`,
      { cause: error },
    );
  }
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

function hashFileContent(content) {
  return digest({
    type: 'file',
    content,
  });
}

function assertLaterMutationsStayedOld(snapshot, plan, failedIndex, preconditionsByMutation) {
  for (const mutation of plan.mutations.slice(failedIndex + 1)) {
    const precondition = preconditionsByMutation.get(mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(
      resourceHash(snapshot, mutation.resource),
      precondition.expectedHash,
      `later mutation changed after JIT failure: ${mutation.resourceKey}`,
    );
  }
}

function assertDbJournalEvidence(body, label) {
  assert.equal(body.ok, true, `${label} did not return ok`);
  const journal = body.journal ?? body.dbJournal ?? body;
  assert.ok(journal && typeof journal === 'object', `${label} missing journal object`);
  assert.ok(journal.schemaVersion ?? journal.schema_version ?? body.schemaVersion ?? body.schema_version, `${label} missing schema version`);
  const dbBacked = journal.storage === 'db'
    || journal.store === 'db'
    || journal.backing === 'db'
    || journal.backend === 'db'
    || journal.driver === 'wpdb'
    || journal.db === true
    || typeof journal.table === 'string'
    || typeof journal.tableName === 'string'
    || typeof journal.table_name === 'string';
  assert.ok(dbBacked, `${label} must be DB-backed`);
  const entries = journalEntries(body);
  assert.ok(Array.isArray(entries), `${label} entries must be an array`);
  return entries;
}

function journalEntries(body) {
  const journal = body.journal ?? body.dbJournal ?? body;
  return journal.entries ?? journal.latestRows ?? body.entries ?? [];
}

function journalEvent(entry) {
  return entry.event ?? entry.eventName ?? entry.event_name ?? entry.type ?? entry.name;
}

function assertJournalEvents(entries, events) {
  for (const event of events) {
    assert.ok(entries.some((entry) => journalEvent(entry) === event), `DB journal entries missing ${event}`);
  }
}

function assertNoJournalEvent(entries, event) {
  assert.ok(!entries.some((entry) => journalEvent(entry) === event), `DB journal must not include ${event}`);
}

function countJournalEvents(entries, event) {
  return entries.filter((entry) => journalEvent(entry) === event).length;
}

function mutationEvidence(entry) {
  return entry.resourceHashEvidence?.mutation ?? {};
}

function assertNoMutationAppliedFor(entries, mutationId) {
  const applied = entries.filter((entry) => journalEvent(entry) === 'mutation-applied');
  assert.ok(
    !applied.some((entry) => mutationEvidence(entry).mutationId === mutationId),
    `mutation-applied must not be written for ${mutationId}`,
  );
}

function assertNoPreparedAfter(entries, failedIndex) {
  const prepared = entries.filter((entry) => journalEvent(entry) === 'mutation-prepared');
  assert.ok(
    !prepared.some((entry) => Number(mutationEvidence(entry).mutationOrder) > failedIndex),
    'later mutation-prepared event written after JIT failure',
  );
}

function assertJitHashEvidence(entries, plan, driftMutation, preconditionsByMutation) {
  const applied = entries
    .filter((entry) => journalEvent(entry) === 'mutation-applied')
    .map(mutationEvidence);
  assert.ok(applied.length > 0, 'expected earlier mutation-applied pre-write evidence');
  for (const evidence of applied) {
    const precondition = preconditionsByMutation.get(evidence.mutationId);
    assert.ok(precondition, `missing precondition for ${evidence.mutationId}`);
    assert.equal(evidence.preWriteExpectedHash, precondition.expectedHash);
    assert.equal(evidence.preWriteActualHash, precondition.expectedHash);
  }

  const failed = entries
    .filter((entry) => journalEvent(entry) === 'mutation-precondition-failed')
    .map(mutationEvidence)
    .find((evidence) => evidence.mutationId === driftMutation.id);
  assert.ok(failed, 'missing JIT precondition failure mutation evidence');
  assert.equal(failed.preWriteExpectedHash, preconditionsByMutation.get(driftMutation.id).expectedHash);
  assert.notEqual(failed.preWriteActualHash, failed.preWriteExpectedHash);
  assert.notEqual(failed.preWriteActualHash, driftMutation.localHash);
  assert.equal(failed.status, 'rejected');
}

function assertStoredJournalHasNoRawFixtureData(body) {
  const forbiddenKeys = new Set([
    'value',
    'content',
    'payload',
    'option_value',
    'post_content',
    'meta_value',
    'currentSnapshot',
    'afterSnapshot',
    'beforeSnapshot',
  ]);
  const forbiddenStrings = [
    driftContent,
    'Local edited content',
    'Created locally after pull',
    'local upload content',
    'local-only upload content',
    'Contact the studio',
    'Newsletter',
    'local-admin@example.test',
    'ops@example.test',
    'Project brief',
    '002-local',
    '2-local',
    '1-local-only',
  ];

  walkJournalValue(body, [], (pathParts, value) => {
    const key = pathParts.at(-1);
    assert.ok(!forbiddenKeys.has(key), `journal stored raw-value field ${pathParts.join('.')}`);
    if (typeof value === 'string') {
      for (const forbidden of forbiddenStrings) {
        assert.ok(!value.includes(forbidden), `journal stored raw fixture value at ${pathParts.join('.')}`);
      }
    }
  });
}

function assertResponseHasNoRawFixtureData(body) {
  assertStoredJournalHasNoRawFixtureData(body);
}

function assertNoRawString(value, raw, label) {
  assert.ok(!JSON.stringify(value).includes(raw), `${label} leaked raw drift content`);
}

function walkJournalValue(value, pathParts, visit) {
  visit(pathParts, value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJournalValue(item, [...pathParts, String(index)], visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, innerValue] of Object.entries(value)) {
      walkJournalValue(innerValue, [...pathParts, key], visit);
    }
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

function assertTargetSurfaceEqual(actual, expected, label) {
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

function pushLog(logs, chunk) {
  logs.push(chunk);
  if (logs.length > 40) {
    logs.splice(0, logs.length - 40);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
