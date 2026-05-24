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
const readyIdempotencyKey = 'idem-ready-001';

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
assertReadyPlanResources(readyPlan);
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
  routes: {},
  dryRun: {},
  idempotency: {},
  concurrency: {},
  failures: {},
};

let readyReceipt;

await withPlaygroundServer('db-journal-idempotency-base', path.join(repoRoot, fixtures.base), async (server) => {
  summary.transport.servers.push(server.summary);

  const dbJournalRoute = await discoverDbJournalRoute(server);
  summary.routes.dbJournal = dbJournalRoute.summary;

  const dbJournalSchema = await getLab(server, '/db-journal/schema');
  assert.equal(dbJournalSchema.status, 200);
  assert.equal(dbJournalSchema.body.ok, true);
  assertDbJournalSchema(dbJournalSchema.body);
  summary.routes.dbJournalSchema = {
    route: 'GET /wp-json/reprint-push-lab/v1/db-journal/schema',
    status: dbJournalSchema.status,
    table: dbJournalSchema.body.dbJournalSchema?.table ?? null,
  };

  const initialDbJournal = await getDbJournal(server, dbJournalRoute);
  assertDbJournalEvidence(initialDbJournal.body, 'initial DB journal route');
  assertDbJournalHasNoOptionBacking(initialDbJournal.body, 'initial DB journal route');

  const dryRunBefore = await getSnapshot(server);
  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.equal(dryRun.body.applied, 0);
  assert.equal(dryRun.body.receipt?.mode, 'dry-run');
  assert.ok(dryRun.body.receipt?.receiptHash, 'dry-run receipt hash missing');
  assert.equal(dryRun.body.verifiedPreconditions.length, readyPlan.mutations.length);
  await assertNoTargetMutation(server, dryRunBefore.body.snapshot, 'dry-run');
  readyReceipt = dryRun.body.receipt;

  summary.dryRun = {
    route: 'POST /wp-json/reprint-push-lab/v1/dry-run',
    status: dryRun.status,
    receipt: Boolean(readyReceipt?.receiptHash),
    verified: dryRun.body.verifiedPreconditions.length,
  };

  const missingReceiptBefore = await getSnapshot(server);
  const missingReceipt = await postLab(
    server,
    '/apply',
    { plan: readyPlan },
    { [idempotencyHeader]: 'idem-missing-receipt' },
  );
  await assertHttpFailureNoMutation(server, missingReceipt, missingReceiptBefore.body.snapshot, {
    status: 428,
    code: 'MISSING_DRY_RUN_RECEIPT',
    label: 'missing receipt apply',
  });

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
    { [idempotencyHeader]: 'idem-tampered-receipt' },
  );
  await assertHttpFailureNoMutation(server, tamperedApply, tamperedBefore.body.snapshot, {
    status: 409,
    code: 'RECEIPT_MISMATCH',
    label: 'tampered receipt apply',
  });

  const missingKeyBefore = await getSnapshot(server);
  const missingKey = await postLab(server, '/apply', {
    plan: readyPlan,
    receipt: readyReceipt,
  });
  await assertHttpFailureNoMutation(server, missingKey, missingKeyBefore.body.snapshot, {
    status: 400,
    code: 'MISSING_IDEMPOTENCY_KEY',
    label: 'missing idempotency key apply',
  });

  const applyBody = {
    plan: readyPlan,
    receipt: readyReceipt,
  };
  const applyBefore = await getSnapshot(server);
  assertSnapshotContentEqual(applyBefore.body.snapshot, snapshots.base, 'ready apply before HTTP snapshot');

  await postLab(server, '/apply', applyBody, { [idempotencyHeader]: readyIdempotencyKey });
  const afterLostResponseApply = await getSnapshot(server);
  assertVisibleSurfaceEqual(afterLostResponseApply.body.snapshot, snapshots.local, 'lost-response apply final visible surface');
  assertAppliedHashes(readyPlan, afterLostResponseApply.body.snapshot);
  assertAppliedFixtureValues(afterLostResponseApply.body.snapshot);

  const dbJournalAfterApply = await getDbJournal(server, dbJournalRoute);
  const applyEntries = assertDbJournalEvidence(dbJournalAfterApply.body, 'DB journal after apply');
  assertDbJournalHasNoOptionBacking(dbJournalAfterApply.body, 'DB journal after apply');
  assertJournalEvents(applyEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-applied',
    'apply-committed',
  ]);
  assert.equal(countJournalEvents(applyEntries, 'mutation-applied'), readyPlan.mutations.length);
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterApply.body);
  const mutationEventsAfterApply = countJournalEvents(applyEntries, 'mutation-applied');
  const targetDigestAfterApply = digest(visibleSurface(afterLostResponseApply.body.snapshot));

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: readyIdempotencyKey });
  assert.equal(replay.status, 200);
  assert.ok(replay.body.ok, 'idempotency replay should be an ok response');
  assertReplayResponse(replay.body);
  const afterReplay = await getSnapshot(server);
  assert.equal(digest(visibleSurface(afterReplay.body.snapshot)), targetDigestAfterApply, 'replay changed target snapshot');
  const dbJournalAfterReplay = await getDbJournal(server, dbJournalRoute);
  const replayEntries = assertDbJournalEvidence(dbJournalAfterReplay.body, 'DB journal after replay');
  assert.equal(
    countJournalEvents(replayEntries, 'mutation-applied'),
    mutationEventsAfterApply,
    'idempotency replay must not add mutation-applied events',
  );
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterReplay.body);

  const conflictBefore = await getSnapshot(server);
  const conflictBody = {
    plan: changedPlan(readyPlan),
    receipt: tamperedReceipt(readyReceipt, (receipt) => {
      receipt.planId = 'changed-plan-for-idempotency-conflict';
    }),
  };
  const conflict = await postLab(server, '/apply', conflictBody, { [idempotencyHeader]: readyIdempotencyKey });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  const conflictAfter = await getSnapshot(server);
  assertTargetSurfaceEqual(conflictAfter.body.snapshot, conflictBefore.body.snapshot, 'idempotency conflict target surface');
  const dbJournalAfterConflict = await getDbJournal(server, dbJournalRoute);
  const conflictEntries = assertDbJournalEvidence(dbJournalAfterConflict.body, 'DB journal after idempotency conflict');
  assertJournalEventOneOf(conflictEntries, ['idempotency-conflict', 'idempotency-key-conflict']);
  assert.equal(
    countJournalEvents(conflictEntries, 'mutation-applied'),
    mutationEventsAfterApply,
    'idempotency conflict must not add mutation-applied events',
  );
  assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);

  summary.idempotency = {
    apply: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: 200,
      key: readyIdempotencyKey,
      applied: readyPlan.mutations.length,
      dbJournalEvents: ['idempotency-opened', 'apply-started', 'mutation-applied', 'apply-committed'],
      finalMatchesLocal: digest(visibleSurface(afterLostResponseApply.body.snapshot)) === digest(visibleSurface(snapshots.local)),
      firstResponseDiscarded: true,
    },
    replay: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: replay.status,
      code: replay.body.code ?? null,
      replayed: true,
      targetSnapshotUnchanged: true,
      mutationEventsUnchanged: true,
    },
    conflict: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: conflict.status,
      code: conflict.body.code,
      targetSnapshotUnchanged: true,
      journalEvent: 'idempotency-conflict',
    },
  };

  summary.failures = {
    missingReceipt: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: missingReceipt.status,
      code: missingReceipt.body.code,
      targetSnapshotUnchanged: true,
    },
    tamperedReceipt: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: tamperedApply.status,
      code: tamperedApply.body.code,
      targetSnapshotUnchanged: true,
    },
    missingIdempotencyKey: {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      status: missingKey.status,
      code: missingKey.body.code,
      targetSnapshotUnchanged: true,
    },
  };
});

assert.ok(readyReceipt, 'ready dry-run receipt was not captured');

await withPlaygroundServer(
  'db-journal-concurrent-first-same-body',
  path.join(repoRoot, fixtures.base),
  async (server) => {
    summary.transport.servers.push(server.summary);

    const dbJournalRoute = await discoverDbJournalRoute(server);
    await getDbJournal(server, dbJournalRoute);
    const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.ok, true);

    const applyBody = {
      plan: readyPlan,
      receipt: dryRun.body.receipt,
      labDelayAfterIdempotencyOpenMs: 3000,
    };
    const key = 'idem-concurrent-first-same-body';
    const before = await getSnapshot(server);
    assertSnapshotContentEqual(before.body.snapshot, snapshots.base, 'concurrent same-body before HTTP snapshot');

    const firstApply = labelRequest(
      postLab(server, '/apply', applyBody, { [idempotencyHeader]: key }),
      'same-body winning apply',
    );
    const duplicateApply = labelRequest(
      postLab(server, '/apply', applyBody, { [idempotencyHeader]: key }),
      'same-body duplicate apply',
    );
    const [first, duplicate] = await Promise.all([firstApply, duplicateApply]);
    const responses = [first, duplicate];
    const safeDuplicate = responses.find((response) => response.body.idempotency?.freshMutationWork !== true);
    const winner = responses.find((response) => response.body.idempotency?.freshMutationWork === true);
    assert.ok(safeDuplicate, 'same-body race must have a non-mutating duplicate response');
    assertConcurrentDuplicateSafe(safeDuplicate, 'same-body duplicate first apply');
    assert.ok(winner?.body.ok, 'same-body winning apply should finish ok');
    assert.equal(
      responses.filter((response) => response.body.idempotency?.freshMutationWork === true).length,
      1,
      'concurrent same-body first apply must have exactly one fresh mutation executor',
    );

    const after = await getSnapshot(server);
    assertVisibleSurfaceEqual(after.body.snapshot, snapshots.local, 'same-body concurrent apply final visible surface');
    assertAppliedHashes(readyPlan, after.body.snapshot);

    const dbJournalAfterConcurrent = await getDbJournal(server, dbJournalRoute);
    const entries = assertDbJournalEvidence(dbJournalAfterConcurrent.body, 'DB journal after same-body concurrency');
    assertDbJournalHasNoOptionBacking(dbJournalAfterConcurrent.body, 'DB journal after same-body concurrency');
    assert.equal(countJournalEvents(entries, 'idempotency-opened'), 1, 'same-body race must create one idempotency claim');
    assert.equal(countJournalEvents(entries, 'apply-started'), 1, 'same-body race must start one mutation executor');
    assert.equal(countJournalEvents(entries, 'apply-committed'), 1, 'same-body race must commit once');
    assert.equal(
      countJournalEvents(entries, 'mutation-applied'),
      readyPlan.mutations.length,
      'same-body race must record exactly one mutation set',
    );
    assertJournalEvents(entries, ['idempotency-in-progress']);
    assertEventBefore(entries, 'idempotency-in-progress', 'apply-started', 'same-body duplicate must be recorded before mutation work starts');
    assertStoredJournalHasNoRawFixtureData(dbJournalAfterConcurrent.body);

    const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: key });
    assert.equal(replay.status, 200);
    assertReplayResponse(replay.body);
    const dbJournalAfterReplay = await getDbJournal(server, dbJournalRoute);
    const replayEntries = assertDbJournalEvidence(dbJournalAfterReplay.body, 'DB journal after same-body concurrency replay');
    assert.equal(
      countJournalEvents(replayEntries, 'mutation-applied'),
      readyPlan.mutations.length,
      'same-body post-commit replay must not add mutation-applied events',
    );

    summary.concurrency.sameBody = {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      workers: server.summary.workers,
      duplicateStatus: safeDuplicate.status,
      duplicateCode: safeDuplicate.body.code ?? null,
      freshMutationExecutors: 1,
      openedClaims: 1,
      mutationEvents: readyPlan.mutations.length,
      duplicateBeforeMutationWork: true,
      finalMatchesLocal: true,
    };
  },
  { workers: 2 },
);

await withPlaygroundServer(
  'db-journal-concurrent-first-different-body',
  path.join(repoRoot, fixtures.base),
  async (server) => {
    summary.transport.servers.push(server.summary);

    const dbJournalRoute = await discoverDbJournalRoute(server);
    await getDbJournal(server, dbJournalRoute);
    const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.ok, true);

    const originalBody = {
      plan: readyPlan,
      receipt: dryRun.body.receipt,
      labDelayAfterIdempotencyOpenMs: 3000,
    };
    const differentBody = {
      plan: changedPlan(readyPlan),
      receipt: tamperedReceipt(dryRun.body.receipt, (receipt) => {
        receipt.planId = 'changed-plan-for-concurrent-idempotency-conflict';
      }),
    };
    const key = 'idem-concurrent-first-different-body';
    const before = await getSnapshot(server);
    assertSnapshotContentEqual(before.body.snapshot, snapshots.base, 'concurrent different-body before HTTP snapshot');

    const firstApply = labelRequest(
      postLab(server, '/apply', originalBody, { [idempotencyHeader]: key }),
      'different-body original apply',
    );
    await waitForJournalEvent(server, dbJournalRoute, 'idempotency-opened', 'different-body original idempotency claim');
    const conflictApply = labelRequest(
      postLab(server, '/apply', differentBody, { [idempotencyHeader]: key }),
      'different-body conflicting apply',
    );
    const [first, conflict] = await Promise.all([firstApply, conflictApply]);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.ok, false);
    assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(conflict.body.idempotency?.freshMutationWork, false);

    assert.equal(first.status, 200);
    assert.ok(first.body.ok, 'different-body original apply should finish ok');
    assert.equal(first.body.idempotency?.freshMutationWork, true);

    const after = await getSnapshot(server);
    assertVisibleSurfaceEqual(after.body.snapshot, snapshots.local, 'different-body original apply final visible surface');
    assertAppliedHashes(readyPlan, after.body.snapshot);

    const dbJournalAfterConflict = await getDbJournal(server, dbJournalRoute);
    const entries = assertDbJournalEvidence(dbJournalAfterConflict.body, 'DB journal after different-body concurrency');
    assertDbJournalHasNoOptionBacking(dbJournalAfterConflict.body, 'DB journal after different-body concurrency');
    assert.equal(countJournalEvents(entries, 'idempotency-opened'), 1, 'different-body race must create one idempotency claim');
    assert.equal(countJournalEvents(entries, 'idempotency-key-conflict'), 1, 'different-body race must record one conflict');
    assert.equal(countJournalEvents(entries, 'apply-started'), 1, 'different-body race must start one mutation executor');
    assert.equal(countJournalEvents(entries, 'apply-committed'), 1, 'different-body race must commit original request once');
    assert.equal(
      countJournalEvents(entries, 'mutation-applied'),
      readyPlan.mutations.length,
      'different-body race must record exactly one mutation set',
    );
    assert.equal(
      keyRequestHashes(entries).size,
      2,
      'different-body journal evidence should include original and conflicting request hashes',
    );
    assertEventBefore(entries, 'idempotency-key-conflict', 'apply-started', 'different-body conflict must be recorded before mutation work starts');
    assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);

    summary.concurrency.differentBody = {
      route: 'POST /wp-json/reprint-push-lab/v1/apply',
      workers: server.summary.workers,
      conflictStatus: conflict.status,
      conflictCode: conflict.body.code,
      freshMutationExecutors: 1,
      openedClaims: 1,
      mutationEvents: readyPlan.mutations.length,
      conflictBeforeMutationWork: true,
      originalRequestCommitted: true,
    };
  },
  { workers: 2 },
);

await withPlaygroundServer('db-journal-stale-remote', path.join(repoRoot, fixtures.remoteChanged), async (server) => {
  summary.transport.servers.push(server.summary);

  const staleBefore = await getSnapshot(server);
  assertSnapshotContentEqual(staleBefore.body.snapshot, snapshots.remoteChanged, 'stale before HTTP snapshot');
  const staleKey = 'idem-stale-remote';
  const staleApply = await postLab(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    { [idempotencyHeader]: staleKey },
  );
  assert.equal(staleApply.status, 412);
  assert.equal(staleApply.body.ok, false);
  assert.equal(staleApply.body.code, 'PRECONDITION_FAILED');
  const staleAfter = await getSnapshot(server);
  assertTargetSurfaceEqual(staleAfter.body.snapshot, staleBefore.body.snapshot, 'stale failed apply target surface');
  assertVisibleSurfaceNotEqual(staleAfter.body.snapshot, snapshots.local, 'stale failure preserved drifted state');

  const staleConflict = await postLab(
    server,
    '/apply',
    {
      plan: changedPlan(readyPlan),
      receipt: tamperedReceipt(readyReceipt, (receipt) => {
        receipt.planId = 'changed-plan-after-stale-rejection';
      }),
    },
    { [idempotencyHeader]: staleKey },
  );
  assert.equal(staleConflict.status, 409);
  assert.equal(staleConflict.body.ok, false);
  assert.equal(staleConflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');

  const staleReplay = await postLab(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    { [idempotencyHeader]: staleKey },
  );
  assert.equal(staleReplay.status, 412);
  assert.equal(staleReplay.body.ok, false);
  assert.equal(staleReplay.body.code, 'PRECONDITION_FAILED');
  assert.equal(staleReplay.body.idempotency?.replayed, true);
  assert.equal(staleReplay.body.idempotency?.freshMutationWork, false);

  summary.failures.staleRemote = {
    route: 'POST /wp-json/reprint-push-lab/v1/apply',
    status: staleApply.status,
    code: staleApply.body.code,
    targetSnapshotUnchanged: true,
    rejectedReplayAfterConflict: staleReplay.body.idempotency?.replayed === true,
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
      workers,
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

async function discoverDbJournalRoute(server) {
  const index = await routeIndex(server);
  assert.equal(index.status, 200);
  assertRouteNamespace(index.body);

  const routes = index.body.routes && typeof index.body.routes === 'object' ? index.body.routes : {};
  const routeKeys = Object.keys(routes).filter((route) => route.startsWith('/reprint-push-lab/v1/'));
  const dbJournalKey = routeKeys.find((route) => /db[-_/]?journal/i.test(route))
    ?? routeKeys.find((route) => /journal[-_/]?db/i.test(route))
    ?? routeKeys.find((route) => /idempotency/i.test(route) && /journal/i.test(route));

  assert.ok(
    dbJournalKey,
    `REST index does not expose a DB journal/idempotency route. Routes: ${routeKeys.join(', ')}`,
  );

  const route = dbJournalKey.replace('/reprint-push-lab/v1', '');
  const endpoints = Array.isArray(routes[dbJournalKey]?.endpoints) ? routes[dbJournalKey].endpoints : [];
  assert.ok(endpoints.length > 0, `${dbJournalKey} is missing REST endpoint schema`);

  return {
    path: route,
    methods: endpoints.flatMap((endpoint) => endpoint.methods || []),
    summary: {
      route: dbJournalKey,
      methods: endpoints.flatMap((endpoint) => endpoint.methods || []),
      schema: true,
    },
  };
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

async function getDbJournal(server, dbJournalRoute) {
  return getLab(server, `${dbJournalRoute.path}?limit=80`);
}

async function waitForJournalEvent(server, dbJournalRoute, event, label, timeoutMs = 5000) {
  const started = Date.now();
  let lastEvents = [];
  while (Date.now() - started < timeoutMs) {
    const journal = await getDbJournal(server, dbJournalRoute);
    const entries = journalEntries(journal.body);
    lastEvents = entries.map(journalEvent);
    if (entries.some((entry) => journalEvent(entry) === event)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${event} in DB journal for ${label}; saw ${lastEvents.join(', ')}`);
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

async function labelRequest(promise, label) {
  try {
    return await promise;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`, { cause: error });
  }
}

function assertRouteNamespace(body) {
  const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
  const routeKeys = body.routes && typeof body.routes === 'object' ? Object.keys(body.routes) : [];
  assert.ok(
    namespaces.includes('reprint-push-lab/v1') || routeKeys.some((route) => route.startsWith('/reprint-push-lab/v1')),
    'REST index does not expose reprint-push-lab/v1',
  );
}

async function assertHttpFailureNoMutation(server, response, expectedSnapshot, { status, code, label }) {
  assert.equal(response.status, status, `${label} HTTP status`);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, code);
  const after = await getSnapshot(server);
  assertTargetSurfaceEqual(after.body.snapshot, expectedSnapshot, `${label} target surface`);
}

async function assertNoTargetMutation(server, expectedSnapshot, label) {
  const after = await getSnapshot(server);
  assertTargetSurfaceEqual(after.body.snapshot, expectedSnapshot, `${label} target surface`);
}

function tamperedReceipt(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  delete next.receiptHash;
  next.receiptHash = digest(next);
  return next;
}

function changedPlan(plan) {
  return {
    ...JSON.parse(JSON.stringify(plan)),
    id: 'changed-plan-for-idempotency-conflict',
  };
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function assertDbJournalEvidence(body, label) {
  assert.equal(body.ok, true, `${label} did not return ok`);
  const journal = body.journal ?? body.dbJournal ?? body;
  assert.ok(journal && typeof journal === 'object', `${label} missing journal object`);

  const schemaVersion = journal.schemaVersion ?? journal.schema_version ?? body.schemaVersion ?? body.schema_version;
  assert.ok(schemaVersion !== undefined, `${label} missing DB journal schema version`);

  const dbBacked = journal.storage === 'db'
    || journal.store === 'db'
    || journal.backing === 'db'
    || journal.backend === 'db'
    || journal.driver === 'wpdb'
    || journal.db === true
    || typeof journal.table === 'string'
    || typeof journal.tableName === 'string'
    || typeof journal.table_name === 'string';
  assert.ok(dbBacked, `${label} must expose DB-backed journal evidence`);

  const entries = journalEntries(body);
  assert.ok(Array.isArray(entries), `${label} entries must be an array`);
  return entries;
}

function assertDbJournalSchema(body) {
  const schema = body.dbJournalSchema ?? body.schema ?? body;
  assert.equal(schema.schemaVersion, 1, 'DB journal schema version');
  assert.match(String(schema.table ?? ''), /reprint_push_lab_push_journal$/, 'DB journal table name');
  assert.equal(schema.appendOnlyEvents, true, 'DB journal append-only event marker');
  assert.ok(schema.columns?.result_json, 'DB journal schema missing stored result column');
}

function assertDbJournalHasNoOptionBacking(body, label) {
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('reprint_push_protocol_journal'), `${label} leaked option journal backing`);
  assert.notEqual(body.journal?.option, 'reprint_push_protocol_journal', `${label} uses option journal evidence`);
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
    assert.ok(
      entries.some((entry) => journalEvent(entry) === event),
      `DB journal entries missing ${event}`,
    );
  }
}

function assertJournalEventOneOf(entries, events) {
  assert.ok(
    entries.some((entry) => events.includes(journalEvent(entry))),
    `DB journal entries missing one of ${events.join(', ')}`,
  );
}

function assertEventBefore(entries, beforeEvent, afterEvent, label) {
  const beforeSequence = firstJournalEventSequence(entries, beforeEvent);
  const afterSequence = firstJournalEventSequence(entries, afterEvent);
  assert.ok(beforeSequence > 0, `${label}: missing ${beforeEvent}`);
  assert.ok(afterSequence > 0, `${label}: missing ${afterEvent}`);
  assert.ok(
    beforeSequence < afterSequence,
    `${label}: expected ${beforeEvent} before ${afterEvent}, got ${beforeSequence} >= ${afterSequence}`,
  );
}

function firstJournalEventSequence(entries, event) {
  const row = entries.find((entry) => journalEvent(entry) === event);
  return row ? Number(row.sequence ?? row.id ?? 0) : 0;
}

function countJournalEvents(entries, event) {
  return entries.filter((entry) => journalEvent(entry) === event).length;
}

function assertReplayResponse(body) {
  const events = [
    journalEvent(body.journal ?? {}),
    ...(body.journal?.recent || []).map(journalEvent),
    ...journalEntries(body).map(journalEvent),
  ];
  const replayed = body.code === 'BATCH_ALREADY_COMMITTED'
    || body.status === 'BATCH_ALREADY_COMMITTED'
    || body.idempotency?.replayed === true
    || body.idempotency?.status === 'replayed'
    || events.includes('idempotency.replayed')
    || events.includes('idempotency-replayed');

  assert.ok(replayed, 'retry must return BATCH_ALREADY_COMMITTED or idempotency replay evidence');
}

function assertConcurrentDuplicateSafe(response, label) {
  const replayed = response.status === 200
    && (response.body.code === 'BATCH_ALREADY_COMMITTED' || response.body.idempotency?.replayed === true);
  const inProgress = response.status === 409
    && response.body.code === 'IDEMPOTENCY_KEY_IN_PROGRESS'
    && response.body.idempotency?.inProgress === true;

  assert.ok(replayed || inProgress, `${label} must replay or return explicit in-progress`);
  assert.notEqual(
    response.body.idempotency?.freshMutationWork,
    true,
    `${label} must not perform fresh mutation work`,
  );
}

function keyRequestHashes(entries) {
  return new Set(entries
    .map((entry) => entry.requestHash ?? entry.request_hash)
    .filter((hash) => typeof hash === 'string' && hash.length > 0));
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
    'Local edited content',
    'Created locally after pull',
    'local upload content',
    'local-only upload content',
    'Contact the studio',
    'Newsletter',
    'local-admin@example.test',
    'ops@example.test',
    'Project brief',
    'schemaVersion',
    '002-local',
    '2-local',
    '1-local-only',
  ];

  walkJournalValue(body, [], (pathParts, value) => {
    const key = pathParts.at(-1);
    assert.ok(!forbiddenKeys.has(key), `DB journal stored raw-value field ${pathParts.join('.')}`);
    if (typeof value === 'string') {
      for (const forbidden of forbiddenStrings) {
        assert.ok(!value.includes(forbidden), `DB journal stored raw fixture value at ${pathParts.join('.')}`);
      }
    }
  });
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
}

function postByTitle(snapshot, title) {
  const entry = Object.values(snapshot.db.wp_posts).find((row) => row.post_title === title);
  assert.ok(entry, `missing post ${title}`);
  return entry;
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
