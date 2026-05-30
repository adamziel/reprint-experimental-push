import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import { serializeResourceValue } from '../src/resources.js';

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
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
    claimHash: '2'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function assertNoMutationOrPrecondition(plan, resourceKey) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${resourceKey} emitted a mutation`);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
    false,
    `${resourceKey} emitted a live-remote precondition`,
  );
}

function hashOnlyProofHash(value) {
  return `sha256:${digest(value)}`;
}

test('RPP-0234 already-in-sync resources emit no mutations and reject forged overwrites', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    'shared-private-rpp0234-file-content',
    '2.0.0-rpp0234-shared-private-version',
    'Shared private RPP-0234 title',
    'local-private-rpp0234-theme-edit',
    'post-plan-rpp0234-remote-file-drift',
    '9.9.9-rpp0234-post-plan-plugin-drift',
    'Post-plan private RPP-0234 row drift',
    'forged-private-rpp0234-file-overwrite',
    '7.7.7-rpp0234-forged-plugin-overwrite',
    'Forged private RPP-0234 row overwrite',
  ];
  const alreadyInSyncKeys = [
    'file:index.php',
    'plugin:forms',
    'row:["wp_posts","ID:1"]',
  ];
  const localMutationKey = 'file:wp-content/themes/theme/style.css';

  local.files['index.php'] = privateValues[0];
  remote.files['index.php'] = privateValues[0];
  local.plugins.forms = { version: privateValues[1], active: false };
  remote.plugins.forms = { version: privateValues[1], active: false };
  local.db.wp_posts['ID:1'].post_title = privateValues[2];
  remote.db.wp_posts['ID:1'].post_title = privateValues[2];
  local.files['wp-content/themes/theme/style.css'] = privateValues[3];

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const hashOnlyEvidence = {
    command: 'node --test --test-name-pattern=RPP-0234 test/rpp-0234-already-in-sync-decision-v2.test.js',
    behavior: 'already-in-sync resources are decision-only and cannot be forged into mutations',
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
    decisions: 3,
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
      ['file:index.php', 'already-in-sync', 'update', 'update'],
      ['plugin:forms', 'already-in-sync', 'update', 'update'],
      ['row:["wp_posts","ID:1"]', 'already-in-sync', 'update', 'update'],
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
      ]),
      mutations: replayPlan.mutations.map((mutation) => mutation.resourceKey),
      preconditions: replayPlan.preconditions.map((precondition) => precondition.resourceKey),
    },
    'already-in-sync proof should be deterministic across replayed planning inputs',
  );

  for (const resourceKey of alreadyInSyncKeys) {
    const decision = decisionFor(firstPlan, resourceKey);
    assert.equal(decision.decision, 'already-in-sync');
    assert.match(decision.baseHash, /^[a-f0-9]{64}$/);
    assert.match(decision.localHash, /^[a-f0-9]{64}$/);
    assert.equal(decision.localHash, decision.change.local.hash);
    assert.equal(decision.localHash, decision.change.remote.hash);
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
  for (const privateValue of privateValues) {
    assert.equal(evidenceText.includes(privateValue), false, `hash-only evidence leaked ${privateValue}`);
  }

  const applyRemote = cloneJson(remote);
  applyRemote.files['index.php'] = privateValues[4];
  applyRemote.plugins.forms = { version: privateValues[5], active: false };
  applyRemote.db.wp_posts['ID:1'].post_title = privateValues[6];
  const applyEvents = [];
  const result = applyPlan(applyRemote, firstPlan, {
    mutateRemote: true,
    durableJournal: durableJournal(applyEvents),
  });

  assert.equal(result.appliedMutations, 1);
  assert.equal(applyRemote.files['wp-content/themes/theme/style.css'], privateValues[3]);
  assert.equal(applyRemote.files['index.php'], privateValues[4]);
  assert.deepEqual(applyRemote.plugins.forms, { version: privateValues[5], active: false });
  assert.equal(applyRemote.db.wp_posts['ID:1'].post_title, privateValues[6]);
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
      value: { type: 'file', content: privateValues[7] },
    },
    {
      resourceKey: 'plugin:forms',
      value: { version: privateValues[8], active: false },
    },
    {
      resourceKey: 'row:["wp_posts","ID:1"]',
      value: { ID: 1, post_title: privateValues[9], post_status: 'publish' },
    },
  ];

  for (const forgedCase of forgedCases) {
    const decision = decisionFor(firstPlan, forgedCase.resourceKey);
    const forgedMutation = {
      id: `mutation-rpp-0234-forged-${decision.resource.type}-overwrite`,
      resource: decision.resource,
      resourceKey: decision.resourceKey,
      action: 'put',
      value: serializeResourceValue(forgedCase.value),
      baseHash: decision.baseHash,
      localHash: digest(forgedCase.value),
      remoteBeforeHash: decision.change.remote.hash,
      changeKind: 'update',
      change: {
        localChange: 'update',
        remoteChange: 'update',
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
    const forgedRemote = cloneJson(remote);
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
    for (const privateValue of privateValues) {
      assert.equal(refusalEvidence.includes(privateValue), false, `forged refusal leaked ${privateValue}`);
      assert.equal(JSON.stringify(error.details).includes(privateValue), false, `refusal details leaked ${privateValue}`);
    }
  }
});
