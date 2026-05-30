import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/themes/theme/style.css': 'body { color: red; }',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {},
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.mutations = copy.mutations.length;
  copy.summary.decisions = copy.decisions.length;
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '4'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function hashOnlyProofHash(value) {
  return `sha256:${digest(value)}`;
}

function assertNoMutationOrPrecondition(plan, resourceKey) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${resourceKey} emitted a mutation`);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
    false,
    `${resourceKey} emitted a live-remote precondition`,
  );
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues, label) {
  const text = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(text.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0274 already-in-sync create delete and update decisions stay drift-safe', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    'shared-private-rpp0274-created-file-payload',
    'shared-private-rpp0274-option-mode',
    'Shared private RPP-0274 post title',
    'local-private-rpp0274-theme-edit',
    'post-plan-rpp0274-recreated-index',
    'post-plan-rpp0274-created-file-drift',
    '9.9.9-rpp0274-post-plan-plugin-drift',
    'post-plan-rpp0274-option-drift',
    'Post-plan private RPP-0274 row drift',
    'forged-private-rpp0274-created-file-overwrite',
    '7.7.7-rpp0274-forged-plugin-readd',
    'forged-private-rpp0274-option-overwrite',
    'Forged private RPP-0274 row overwrite',
  ];
  const createdFilePath = 'wp-content/uploads/shared-rpp0274.txt';
  const optionRowId = 'option_name:shared_rpp0274_flag';
  const createdOptionRow = {
    option_name: 'shared_rpp0274_flag',
    option_value: { mode: privateValues[1] },
  };
  const alreadyInSyncKeys = [
    'file:index.php',
    `file:${createdFilePath}`,
    'plugin:forms',
    rowKey('wp_options', optionRowId),
    rowKey('wp_posts', 'ID:1'),
  ];
  const localMutationKey = 'file:wp-content/themes/theme/style.css';

  delete local.files['index.php'];
  delete remote.files['index.php'];
  local.files[createdFilePath] = privateValues[0];
  remote.files[createdFilePath] = privateValues[0];
  delete local.plugins.forms;
  delete remote.plugins.forms;
  local.db.wp_options[optionRowId] = cloneJson(createdOptionRow);
  remote.db.wp_options[optionRowId] = cloneJson(createdOptionRow);
  local.db.wp_posts['ID:1'].post_title = privateValues[2];
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];
  local.files['wp-content/themes/theme/style.css'] = privateValues[3];

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const hashOnlyEvidence = {
    command: 'node --test --test-name-pattern=RPP-0274 test/rpp-0274-already-in-sync-decision-v4.test.js',
    behavior: 'already-in-sync create, delete, and update resources stay decision-only and drift-safe',
    status: firstPlan.status,
    summary: firstPlan.summary,
    decisions: alreadyInSyncKeys.map((resourceKey) => {
      const decision = decisionFor(firstPlan, resourceKey);
      return {
        resourceKey,
        decision: decision.decision,
        baseHash: decision.baseHash,
        localHash: decision.localHash,
        remoteHash: decision.change.remote.hash,
        localChange: decision.change.localChange,
        remoteChange: decision.change.remoteChange,
      };
    }),
    mutationKeys: firstPlan.mutations.map((mutation) => mutation.resourceKey),
    preconditionKeys: firstPlan.preconditions.map((precondition) => precondition.resourceKey),
  };
  const evidenceText = JSON.stringify({
    ...hashOnlyEvidence,
    evidenceHash: hashOnlyProofHash(hashOnlyEvidence),
  });

  assert.equal(firstPlan.status, 'ready');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 5,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(
    firstPlan.decisions.map((decision) => [
      decision.resourceKey,
      decision.decision,
      decision.change.localChange,
      decision.change.remoteChange,
    ]),
    [
      ['file:index.php', 'already-in-sync', 'delete', 'delete'],
      [`file:${createdFilePath}`, 'already-in-sync', 'create', 'create'],
      ['plugin:forms', 'already-in-sync', 'delete', 'delete'],
      [rowKey('wp_options', optionRowId), 'already-in-sync', 'create', 'create'],
      [rowKey('wp_posts', 'ID:1'), 'already-in-sync', 'update', 'update'],
    ],
  );
  assert.deepEqual(
    {
      summary: firstPlan.summary,
      decisions: firstPlan.decisions.map((decision) => [
        decision.resourceKey,
        decision.decision,
        decision.baseHash,
        decision.localHash,
        decision.change.remote.hash,
        decision.change.localChange,
        decision.change.remoteChange,
      ]),
      mutations: firstPlan.mutations.map((mutation) => mutation.resourceKey),
      preconditions: firstPlan.preconditions.map((precondition) => precondition.resourceKey),
    },
    {
      summary: replayPlan.summary,
      decisions: replayPlan.decisions.map((decision) => [
        decision.resourceKey,
        decision.decision,
        decision.baseHash,
        decision.localHash,
        decision.change.remote.hash,
        decision.change.localChange,
        decision.change.remoteChange,
      ]),
      mutations: replayPlan.mutations.map((mutation) => mutation.resourceKey),
      preconditions: replayPlan.preconditions.map((precondition) => precondition.resourceKey),
    },
    'already-in-sync variant-4 proof should be deterministic across replayed planning inputs',
  );

  for (const resourceKey of alreadyInSyncKeys) {
    const decision = decisionFor(firstPlan, resourceKey);
    assert.equal(decision.decision, 'already-in-sync');
    assert.match(decision.baseHash, /^[a-f0-9]{64}$/);
    assert.match(decision.localHash, /^[a-f0-9]{64}$/);
    assert.equal(decision.localHash, decision.change.local.hash);
    assert.equal(decision.localHash, decision.change.remote.hash);
    assert.equal(decision.localHash, resourceHash(local, decision.resource));
    assertNoMutationOrPrecondition(firstPlan, resourceKey);
  }

  const localMutation = mutationFor(firstPlan, localMutationKey);
  assert.ok(localMutation, 'missing independent local mutation');
  assert.equal(localMutation.action, 'put');
  assert.deepEqual(
    firstPlan.preconditions.map((precondition) => [
      precondition.mutationId,
      precondition.resourceKey,
      precondition.expectedHash,
      precondition.checkedAgainst,
    ]),
    [[localMutation.id, localMutationKey, localMutation.remoteBeforeHash, 'live-remote']],
  );
  assertHashOnlyEvidenceRedacted(evidenceText, privateValues, 'variant-4 hash-only evidence');

  const applyRemote = cloneJson(remote);
  applyRemote.files['index.php'] = privateValues[4];
  applyRemote.files[createdFilePath] = privateValues[5];
  applyRemote.plugins.forms = { version: privateValues[6], active: true };
  applyRemote.db.wp_options[optionRowId].option_value.mode = privateValues[7];
  applyRemote.db.wp_posts['ID:1'].post_title = privateValues[8];
  const driftedDecisionHashes = Object.fromEntries(alreadyInSyncKeys.map((resourceKey) => {
    const decision = decisionFor(firstPlan, resourceKey);
    return [resourceKey, resourceHash(applyRemote, decision.resource)];
  }));
  const applyEvents = [];
  const result = applyPlan(applyRemote, firstPlan, {
    mutateRemote: true,
    durableJournal: durableJournal(applyEvents),
  });

  assert.equal(result.appliedMutations, 1);
  assert.equal(applyRemote.files['wp-content/themes/theme/style.css'], privateValues[3]);
  assert.equal(applyRemote.files['index.php'], privateValues[4]);
  assert.equal(applyRemote.files[createdFilePath], privateValues[5]);
  assert.deepEqual(applyRemote.plugins.forms, { version: privateValues[6], active: true });
  assert.equal(applyRemote.db.wp_options[optionRowId].option_value.mode, privateValues[7]);
  assert.equal(applyRemote.db.wp_posts['ID:1'].post_title, privateValues[8]);
  for (const resourceKey of alreadyInSyncKeys) {
    const decision = decisionFor(firstPlan, resourceKey);
    assert.equal(
      resourceHash(applyRemote, decision.resource),
      driftedDecisionHashes[resourceKey],
      `${resourceKey} drift should be preserved because the decision is mutation-free`,
    );
  }
  assert.deepEqual(
    applyEvents
      .filter((event) => event.type === 'target-planned')
      .map((event) => event.resourceKey),
    [localMutationKey],
  );
  assert.deepEqual(
    applyEvents
      .filter((event) => event.type === 'mutation-observed')
      .map((event) => event.resourceKey),
    [localMutationKey],
  );
  for (const resourceKey of alreadyInSyncKeys) {
    assert.equal(
      applyEvents.some((event) => event.resourceKey === resourceKey),
      false,
      `${resourceKey} wrote durable mutation evidence`,
    );
  }

  const forgedCases = [
    {
      resourceKey: 'file:index.php',
      action: 'delete',
      value: ABSENT,
      localChange: 'delete',
    },
    {
      resourceKey: `file:${createdFilePath}`,
      action: 'put',
      value: { type: 'file', content: privateValues[9] },
      localChange: 'update',
    },
    {
      resourceKey: 'plugin:forms',
      action: 'put',
      value: { version: privateValues[10], active: false },
      localChange: 'update',
    },
    {
      resourceKey: rowKey('wp_options', optionRowId),
      action: 'put',
      value: {
        option_name: 'shared_rpp0274_flag',
        option_value: { mode: privateValues[11] },
      },
      localChange: 'update',
    },
    {
      resourceKey: rowKey('wp_posts', 'ID:1'),
      action: 'put',
      value: { ID: 1, post_title: privateValues[12], post_status: 'publish' },
      localChange: 'update',
    },
  ];

  for (const forgedCase of forgedCases) {
    const decision = decisionFor(firstPlan, forgedCase.resourceKey);
    const forgedMutation = {
      id: `mutation-rpp-0274-forged-${decision.resource.type}-${forgedCase.action}`,
      resource: decision.resource,
      resourceKey: decision.resourceKey,
      action: forgedCase.action,
      value: serializeResourceValue(forgedCase.value),
      baseHash: decision.baseHash,
      localHash: digest(forgedCase.value),
      remoteBeforeHash: decision.change.remote.hash,
      changeKind: forgedCase.localChange,
      change: {
        localChange: forgedCase.localChange,
        remoteChange: decision.change.remoteChange,
      },
    };
    const forgedPlan = tamperReadyPlan(firstPlan, (plan) => {
      plan.mutations.push(forgedMutation);
      plan.preconditions.push({
        mutationId: forgedMutation.id,
        resource: decision.resource,
        resourceKey: decision.resourceKey,
        expectedHash: forgedMutation.remoteBeforeHash,
        checkedAgainst: 'live-remote',
      });
    });
    const forgedRemote = cloneJson(applyRemote);
    const beforeForgedRemoteHash = digest(forgedRemote);
    const forgedEvents = [];
    const error = captureError(() => applyPlan(forgedRemote, forgedPlan, {
      mutateRemote: true,
      durableJournal: durableJournal(forgedEvents),
    }));
    const issueCodes = (error.details.issues || []).map((issue) => issue.code);

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(
      error.details.issues.some((issue) =>
        issue.code === 'MUTATION_DECISION_RESOURCE_OVERLAP'
        && issue.resourceKey === forgedCase.resourceKey),
      `forged ${forgedCase.resourceKey} mutation did not trip decision-overlap defense`,
    );
    assert.equal(digest(forgedRemote), beforeForgedRemoteHash);
    assert.deepEqual(forgedEvents, []);

    const refusalEvidence = JSON.stringify({
      resourceKey: forgedCase.resourceKey,
      code: error.code,
      issueCodes,
      remoteHashAfterRefusal: hashOnlyProofHash(forgedRemote),
      durableJournalEvents: forgedEvents.map((event) => event.type),
    });
    assertHashOnlyEvidenceRedacted(refusalEvidence, privateValues, 'variant-4 forged refusal evidence');
    assertHashOnlyEvidenceRedacted(error.details, privateValues, 'variant-4 forged refusal details');
  }
});
