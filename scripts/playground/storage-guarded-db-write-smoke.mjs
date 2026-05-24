#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { ABSENT, digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';
const baseBlueprint = path.join(repoRoot, 'fixtures/playground/remote-base.blueprint.json');

const base = exportSnapshot('base', baseBlueprint);
const positiveLocal = clone(base);
const positiveTargets = mutateGuardedSurfaces(positiveLocal, 'positive');
positiveLocal.files['wp-content/uploads/reprint-push/shared.txt'] = 'storage guard unsupported file positive';

const positivePlan = createPushPlan({
  base,
  local: positiveLocal,
  remote: base,
  now: fixedNow,
});
assert.equal(positivePlan.status, 'ready');
assertGuardedSurfaceCoverage(positivePlan, positiveTargets);

const failureScenarios = [
  createFailureScenario('wp_options', { driftKind: 'value' }),
  createFailureScenario('wp_postmeta', { driftKind: 'value' }),
  createFailureScenario('wp_postmeta', { driftKind: 'marker-empty' }),
  createFailureScenario('wp_posts', { driftKind: 'marker-empty' }),
  createFailureScenario('wp_posts', { driftKind: 'absent' }),
  createFailureScenario('wp_reprint_push_forms_lab', { driftKind: 'value' }),
];

const summary = {
  positive: {},
  failures: [],
  idempotency: {},
  redaction: {},
};

await withPlaygroundServer('storage-guard-positive', baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: positivePlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const apply = await postLab(server, '/apply', {
    plan: positivePlan,
    receipt: dryRun.body.receipt,
  }, { [idempotencyHeader]: 'storage-guard-positive-001' });
  assert.equal(apply.status, 200, JSON.stringify(apply.body, null, 2));
  assert.equal(apply.body.ok, true);
  assert.equal(apply.body.applied, positivePlan.mutations.length);

  const after = await getSnapshot(server);
  for (const mutation of positivePlan.mutations) {
    assert.equal(resourceHash(after.body.snapshot, mutation.resource), mutation.localHash, `positive mutation did not land: ${mutation.resourceKey}`);
  }

  const dbJournal = await getLab(server, '/db-journal?limit=160');
  const entries = journalEntries(dbJournal.body);
  const applied = entries.filter((entry) => journalEvent(entry) === 'mutation-applied').map(mutationEvidence);
  assert.equal(applied.length, positivePlan.mutations.length);
  assertPositiveStorageGuardEvidence(applied, positivePlan);
  assertUnsupportedSurfacesDoNotClaimStorageGuard(applied, positivePlan);
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  summary.positive = {
    applied: apply.body.applied,
    guardedTables: guardedTables(applied),
    unsupportedGuardClaims: applied.filter((evidence) => {
      const mutation = unsupportedMutation(positivePlan, evidence);
      return mutation && mutation.resource.type !== 'file' && evidence.storageGuard;
    }).length,
  };
});

for (const [scenarioIndex, scenario] of failureScenarios.entries()) {
  await withPlaygroundServer(`storage-guard-drift-${scenario.slug}`, baseBlueprint, async (server) => {
  const dryRun = await postLab(server, '/dry-run', { plan: scenario.plan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);

  const applyBody = {
    plan: scenario.plan,
    receipt: dryRun.body.receipt,
    labDriftBeforeStorageWrite: {
      mutationId: scenario.mutation.id,
      resourceKey: scenario.mutation.resourceKey,
      ...scenario.driftPayload,
    },
  };

  const idempotencyKey = `storage-guard-drift-${scenario.slug}-001`;
  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
  const driftHash = scenario.driftHash;
  assert.equal(apply.status, 412);
  assert.equal(apply.body.ok, false);
  assert.equal(apply.body.code, 'PRECONDITION_FAILED');
  assert.equal(apply.body.preconditionCheck, 'storage-boundary-cas');
  assert.equal(apply.body.preWriteActualHash, scenario.preconditionsByMutation.get(scenario.mutation.id).expectedHash);
  assert.equal(apply.body.actualHash, driftHash);
  assert.equal(apply.body.storageGuard?.boundary, 'wpdb-single-statement-cas');
  assert.equal(apply.body.storageGuard?.logicalTable, scenario.table);
  assert.equal(apply.body.storageGuard?.rowsAffected, 0);
  assert.equal(apply.body.storageGuard?.outcome, 'stale-at-write');
  assert.equal(apply.body.applied, scenario.index);
  assert.ok(apply.body.recovery?.counts?.blockedUnknown >= 1, 'storage drift target must classify as blocked unknown');
  assert.equal(
    apply.body.recovery?.targets?.find((target) => target.mutationId === scenario.mutation.id)?.classification,
    'blocked-unknown',
  );
  assertResponseHasNoRawFixtureData(apply.body);

  const afterFailure = await getSnapshot(server);
  assert.equal(resourceHash(afterFailure.body.snapshot, scenario.mutation.resource), driftHash, 'drifted row value was not preserved');
  assert.notEqual(resourceHash(afterFailure.body.snapshot, scenario.mutation.resource), scenario.mutation.localHash);
  assertLaterMutationsStayedOld(afterFailure.body.snapshot, scenario.plan, scenario.index, scenario.preconditionsByMutation);

  const dbJournal = await getLab(server, '/db-journal?limit=180');
  const failureEntries = journalEntries(dbJournal.body);
  assertJournalEvents(failureEntries, [
    'idempotency-opened',
    'apply-started',
    'mutation-prepared',
    'mutation-precondition-failed',
    'apply-rejected',
  ]);
  assertNoJournalEvent(failureEntries, 'apply-committed');
  assert.equal(countJournalEvents(failureEntries, 'mutation-applied'), scenario.index);
  assertNoMutationAppliedFor(failureEntries, scenario.mutation.id);
  assertNoPreparedAfter(failureEntries, scenario.index);
  const failedEvidence = failureEntries
    .filter((entry) => journalEvent(entry) === 'mutation-precondition-failed')
    .map(mutationEvidence)
    .find((evidence) => evidence.mutationId === scenario.mutation.id);
  assert.ok(failedEvidence, 'missing failed mutation storage evidence');
  assert.equal(failedEvidence.preWriteActualHash, scenario.preconditionsByMutation.get(scenario.mutation.id).expectedHash);
  assert.equal(failedEvidence.actualHash, driftHash);
  assert.equal(failedEvidence.observedHash, driftHash);
  assert.equal(failedEvidence.storageGuard?.logicalTable, scenario.table);
  assert.equal(failedEvidence.storageGuard?.outcome, 'stale-at-write');
  assert.equal(failedEvidence.storageGuard?.rowsAffected, 0);
  assertStoredJournalHasNoRawFixtureData(dbJournal.body);

  let replay = null;
  let conflict = null;
  if (scenarioIndex === 0) {
    replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: idempotencyKey });
    assert.equal(replay.status, 412);
    assert.equal(replay.body.ok, false);
    assert.equal(replay.body.idempotency?.replayed, true);
    assert.equal(replay.body.idempotency?.freshMutationWork, false);
    const afterReplay = await getSnapshot(server);
    assertTargetSurfaceEqual(afterReplay.body.snapshot, afterFailure.body.snapshot, 'replayed rejection must not mutate');

    conflict = await postLab(server, '/apply', {
      ...applyBody,
      labDriftBeforeStorageWrite: {
        ...applyBody.labDriftBeforeStorageWrite,
        value: scenario.conflictValue,
      },
    }, { [idempotencyHeader]: idempotencyKey });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.ok, false);
    assert.equal(conflict.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(conflict.body.idempotency?.freshMutationWork, false);
    const afterConflict = await getSnapshot(server);
    assertTargetSurfaceEqual(afterConflict.body.snapshot, afterFailure.body.snapshot, 'conflict must not mutate');

    const dbJournalAfterConflict = await getLab(server, '/db-journal?limit=180');
    const conflictEntries = journalEntries(dbJournalAfterConflict.body);
    assertJournalEvents(conflictEntries, ['apply-replayed', 'idempotency-key-conflict']);
    assertNoJournalEvent(conflictEntries, 'apply-committed');
    assert.equal(
      conflictEntries.filter((entry) => journalEvent(entry) === 'mutation-applied').length,
      scenario.index,
      'replay/conflict must not add fresh mutation-applied rows',
    );
    assertStoredJournalHasNoRawFixtureData(dbJournalAfterConflict.body);
  }

  summary.failures.push({
    table: scenario.table,
    driftKind: scenario.driftKind,
    mutationIndex: scenario.index,
    mutationId: scenario.mutation.id,
    resourceKey: scenario.mutation.resourceKey,
    status: apply.status,
    code: apply.body.code,
    preWriteActualHash: apply.body.preWriteActualHash,
    expectedHash: scenario.preconditionsByMutation.get(scenario.mutation.id).expectedHash,
    actualHash: apply.body.actualHash,
    rowsAffected: apply.body.storageGuard.rowsAffected,
    mutationAppliedEvents: countJournalEvents(failureEntries, 'mutation-applied'),
    driftPreserved: resourceHash(afterFailure.body.snapshot, scenario.mutation.resource) === driftHash,
    recoveryClassification: apply.body.recovery.targets.find((target) => target.mutationId === scenario.mutation.id)?.classification,
  });
  if (scenarioIndex === 0) {
    summary.idempotency = {
      replayStatus: replay.status,
      replayFreshMutationWork: replay.body.idempotency?.freshMutationWork,
      conflictStatus: conflict.status,
      conflictCode: conflict.body.code,
    };
  }
  summary.redaction = {
    responseAndJournal: true,
  };
  });
}

console.log(JSON.stringify(summary, null, 2));

function mutateGuardedSurfaces(snapshot, tag) {
  const targets = {
    wp_posts: Object.keys(snapshot.db.wp_posts)[0],
    wp_options: Object.keys(snapshot.db.wp_options).find((id) => id === 'option_name:reprint_push_forms_fixture') ?? Object.keys(snapshot.db.wp_options)[0],
    wp_postmeta: Object.keys(snapshot.db.wp_postmeta)[0],
    wp_reprint_push_forms_lab: Object.keys(snapshot.db.wp_reprint_push_forms_lab)[0],
  };
  for (const [table, id] of Object.entries(targets)) {
    assert.ok(id, `missing fixture row for ${table}`);
    snapshot.db[table][id] = mutatedRow(table, snapshot.db[table][id], tag);
  }
  return targets;
}

function createFailureScenario(table, { driftKind }) {
  const local = clone(base);
  const targetId = rowIdForTable(base, table);
  local.db[table][targetId] = mutatedRow(table, base.db[table][targetId], `planned_${table}`);
  if (table !== 'wp_reprint_push_forms_lab') {
    const formsId = rowIdForTable(base, 'wp_reprint_push_forms_lab');
    local.db.wp_reprint_push_forms_lab[formsId] = mutatedRow(
      'wp_reprint_push_forms_lab',
      base.db.wp_reprint_push_forms_lab[formsId],
      `later_${table}`,
    );
  }

  const plan = createPushPlan({
    base,
    local,
    remote: base,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready', `failure plan must be ready for ${table}`);
  const mutation = plan.mutations.find(
    (entry) => entry.resource.type === 'row' && entry.resource.table === table && entry.resource.id === targetId,
  );
  assert.ok(mutation, `failure plan missing target mutation for ${table}:${targetId}`);
  const index = plan.mutations.findIndex((entry) => entry.id === mutation.id);
  assert.ok(index >= 0, `failure plan target index missing for ${table}`);
  if (table !== 'wp_reprint_push_forms_lab') {
    assert.ok(
      plan.mutations.some((entry, entryIndex) => entryIndex > index),
      `failure plan for ${table} must include a later mutation`,
    );
  }

  const driftValue = (driftKind === 'absent' || driftKind === 'marker-empty')
    ? ABSENT
    : mutatedValueForResource(base, mutation.resource, `drifted_${table}`);
  const conflictValue = mutatedValueForResource(base, mutation.resource, `conflict_${table}`);
  const preconditionsByMutation = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
  );

  return {
    table,
    slug: `${table.replace(/^wp_/, '').replaceAll('_', '-')}-${driftKind.replaceAll('_', '-')}`,
    driftKind,
    plan,
    mutation,
    index,
    preconditionsByMutation,
    driftPayload: driftPayloadForScenario(driftKind, mutation),
    driftHash: (driftKind === 'absent' || driftKind === 'marker-empty') ? digest(ABSENT) : digest(driftValue),
    conflictValue,
  };
}

function driftPayloadForScenario(driftKind, mutation) {
  if (driftKind === 'absent') {
    return { absent: true };
  }
  if (driftKind === 'marker-empty') {
    return { clearFixtureMarkerForPostId: postIdForResource(mutation.resource) };
  }
  return {
    value: mutatedValueForResource(base, mutation.resource, `drifted_${mutation.resource.table}`),
  };
}

function postIdForResource(resource) {
  if (resource.table === 'wp_posts') {
    const match = /^ID:(\d+)$/.exec(resource.id);
    assert.ok(match, `unsupported post resource id ${resource.id}`);
    return Number(match[1]);
  }
  if (resource.table === 'wp_postmeta') {
    const match = /^post_id:(\d+):meta_key:/.exec(resource.id);
    assert.ok(match, `unsupported postmeta resource id ${resource.id}`);
    return Number(match[1]);
  }
  throw new Error(`resource has no fixture marker parent: ${resource.table}`);
}

function rowIdForTable(snapshot, table) {
  const id = table === 'wp_options'
    ? Object.keys(snapshot.db.wp_options).find((rowId) => rowId === 'option_name:reprint_push_forms_fixture')
    : Object.keys(snapshot.db[table] ?? {})[0];
  assert.ok(id, `missing fixture row for ${table}`);
  return id;
}

function mutatedValueForResource(snapshot, resource, tag) {
  assert.equal(resource.type, 'row');
  return mutatedRow(resource.table, snapshot.db[resource.table][resource.id], tag);
}

function mutatedRow(table, row, tag) {
  const cleanTag = tag.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  if (table === 'wp_posts') {
    return {
      ...row,
      post_title: `Storage Guard ${tag}`,
      post_content: `storage guard post body ${tag}`,
    };
  }
  if (table === 'wp_options') {
    return {
      ...row,
      option_value: mutateStructuredValue(row.option_value, tag),
    };
  }
  if (table === 'wp_postmeta') {
    return {
      ...row,
      meta_value: mutateStructuredValue(row.meta_value, tag),
    };
  }
  if (table === 'wp_reprint_push_forms_lab') {
    return {
      ...row,
      payload: {
        owner: 'forms',
        mode: `storage-guard-${cleanTag}`,
        version: '2',
        rules: {
          requireConsent: true,
          maxAttachments: '4',
        },
      },
      updated_marker: `sg_${cleanTag}`.slice(0, 32),
    };
  }
  throw new Error(`Unsupported mutation table ${table}`);
}

function mutateStructuredValue(value, tag) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      ...value,
      storageGuardSmoke: tag,
    };
  }
  return {
    owner: 'forms',
    storageGuardSmoke: tag,
    previousHash: digest(value),
  };
}

function assertGuardedSurfaceCoverage(plan, targets) {
  for (const [table, id] of Object.entries(targets)) {
    assert.ok(
      plan.mutations.some((mutation) => mutation.resource.type === 'row' && mutation.resource.table === table && mutation.resource.id === id),
      `plan missing guarded update mutation for ${table}:${id}`,
    );
  }
  assert.ok(
    plan.mutations.some((mutation) => mutation.resource.type === 'file'),
    'plan missing unsupported file mutation',
  );
}

function assertPositiveStorageGuardEvidence(evidenceEntries, plan) {
  const byMutation = new Map(evidenceEntries.map((evidence) => [evidence.mutationId, evidence]));
  for (const mutation of plan.mutations.filter((entry) => entry.resource.type === 'row')) {
    const evidence = byMutation.get(mutation.id);
    assert.ok(evidence, `missing mutation evidence for ${mutation.id}`);
    assert.equal(evidence.preconditionCheck, 'storage-boundary-cas');
    assert.equal(evidence.preWriteExpectedHash, evidence.preWriteActualHash);
    assert.equal(evidence.storageGuard?.boundary, 'wpdb-single-statement-cas');
    assert.equal(evidence.storageGuard?.operation, 'update');
    assert.equal(evidence.storageGuard?.outcome, 'applied');
    assert.equal(evidence.storageGuard?.rowsAffected, 1);
    assert.equal(evidence.storageGuard?.logicalTable, mutation.resource.table);
    assert.match(evidence.storageGuard?.expectedResourceHash ?? '', /^[a-f0-9]{64}$/);
    assert.match(evidence.storageGuard?.expectedStorageHash ?? '', /^[a-f0-9]{64}$/);
    assert.match(evidence.storageGuard?.sqlShapeHash ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(evidence.storageGuard?.comparedColumns));
  }
}

function assertUnsupportedSurfacesDoNotClaimStorageGuard(evidenceEntries, plan) {
  const byMutation = new Map(evidenceEntries.map((evidence) => [evidence.mutationId, evidence]));
  for (const mutation of plan.mutations.filter((entry) => entry.resource.type !== 'row')) {
    const evidence = byMutation.get(mutation.id);
    assert.ok(evidence, `missing unsupported mutation evidence for ${mutation.id}`);
    if (mutation.resource.type === 'file' && evidence.storageGuard) {
      assert.equal(evidence.preconditionCheck, 'storage-boundary-cas');
      assert.equal(evidence.storageGuard.boundary, 'filesystem-compare-rename');
      assert.equal(evidence.storageGuard.operation, 'update');
      assert.equal(evidence.storageGuard.outcome, 'applied');
      assert.equal(evidence.storageGuard.logicalPath, mutation.resource.path);
      continue;
    }
    assert.equal(evidence.storageGuard, undefined, `unsupported surface claimed storageGuard: ${mutation.resourceKey}`);
    assert.equal(evidence.preconditionCheck, 'just-in-time');
  }
}

function guardedTables(evidenceEntries) {
  return Array.from(new Set(
    evidenceEntries
      .map((evidence) => evidence.storageGuard?.logicalTable)
      .filter(Boolean),
  )).sort();
}

function unsupportedMutation(plan, evidence) {
  return plan.mutations.find((mutation) => mutation.id === evidence.mutationId && mutation.resource.type !== 'row');
}

function assertLaterMutationsStayedOld(snapshot, plan, failedIndex, preconditionsByMutation) {
  for (const mutation of plan.mutations.slice(failedIndex + 1)) {
    const precondition = preconditionsByMutation.get(mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(
      resourceHash(snapshot, mutation.resource),
      precondition.expectedHash,
      `later mutation changed after storage guard failure: ${mutation.resourceKey}`,
    );
  }
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
    'later mutation-prepared event written after storage guard failure',
  );
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
    'storage guard unsupported file positive',
    'storage guard post body positive',
    'storage guard post body planned',
    'storage guard post body drifted',
    'storage guard post body conflict',
    'storageGuardSmoke',
    'storage-guard-',
    'sg_',
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

function journalEntries(body) {
  const journal = body.journal ?? body.dbJournal ?? body;
  return journal.entries ?? journal.latestRows ?? body.entries ?? [];
}

function journalEvent(entry) {
  return entry.event ?? entry.eventName ?? entry.event_name ?? entry.type ?? entry.name;
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
  const child = spawn('npx', [
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
  ], {
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
    assertLocalhostListener(port);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return { name, port, baseUrl, child, logs };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
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

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
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
    throw new Error(`Fetch failed for ${method} ${pathname}: ${error.message}\nRecent Playground logs:\n${server.logs.join('')}`, { cause: error });
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return { status: response.status, body: json };
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
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
    return;
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

function pushLog(logs, chunk) {
  logs.push(chunk);
  if (logs.length > 40) {
    logs.splice(0, logs.length - 40);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
