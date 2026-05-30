import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_URI_PATTERN = /^sha256:[a-f0-9]{64}$/;
const themeStylePath = 'wp-content/themes/theme/style.css';
const createdFilePath = 'wp-content/uploads/rpp-0275-remote-created.txt';
const optionRowId = 'option_name:rpp0275_legacy_flag';

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0275-base-index";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
      [themeStylePath]: 'body { color: red; }',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [optionRowId]: {
          option_name: 'rpp0275_legacy_flag',
          option_value: { mode: 'base' },
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0275 base post',
          post_status: 'publish',
        },
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

function plannerSummaryCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '5'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
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

function hashOnlyProofHash(value) {
  return `sha256:${digest(value)}`;
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues, label) {
  const serialized = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

function assertEveryMutationHasLiveRemotePrecondition(plan, label) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} should emit exactly one live-remote precondition per mutation`,
  );

  const preconditionsByMutationId = new Map(
    plan.preconditions.map((precondition) => [precondition.mutationId, precondition]),
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resource key`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
  }
}

function assertNoMutationOrPrecondition(plan, resourceKey) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${resourceKey} emitted a mutation`);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
    false,
    `${resourceKey} emitted a live-remote precondition`,
  );
}

function keepRemoteEvidence(plan, keepRemoteCases) {
  return {
    command: 'node --test test/rpp-0275-keep-remote-decision-v4.test.js',
    caveat: 'Focused local planner/apply proof; release remains gated separately by integration evidence.',
    status: plan.status,
    summary: plan.summary,
    emitted: plannerSummaryCounts(plan),
    decisions: keepRemoteCases.map(({ resourceKey }) => {
      const decision = decisionFor(plan, resourceKey);
      assert.ok(decision, `missing keep-remote decision for ${resourceKey}`);
      return {
        resourceKey,
        resourceType: decision.resource?.type || null,
        decision: decision.decision,
        baseHash: decision.baseHash,
        localHash: decision.change.local.hash,
        remoteHash: decision.remoteHash,
        localChange: decision.change.localChange,
        remoteChange: decision.change.remoteChange,
        baseState: decision.change.base.state,
        localState: decision.change.local.state,
        remoteState: decision.change.remote.state,
      };
    }),
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey),
    preconditionKeys: plan.preconditions.map((precondition) => precondition.resourceKey),
  };
}

test('RPP-0275 keep-remote create delete and update decisions stay drift-safe', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const localMutationKey = `file:${themeStylePath}`;
  const keepRemoteCases = [
    { resourceKey: 'file:index.php', remoteChange: 'update' },
    { resourceKey: `file:${createdFilePath}`, remoteChange: 'create' },
    { resourceKey: 'plugin:forms', remoteChange: 'delete' },
    { resourceKey: rowKey('wp_options', optionRowId), remoteChange: 'delete' },
    { resourceKey: rowKey('wp_posts', 'ID:1'), remoteChange: 'update' },
  ];
  const privateValues = [
    'local-private-rpp0275-theme-edit',
    'remote-private-rpp0275-index-update',
    'remote-private-rpp0275-created-file',
    'Remote private RPP-0275 post update',
    'post-plan-rpp0275-index-drift',
    'post-plan-rpp0275-created-file-drift',
    '9.9.9-rpp0275-plugin-drift',
    'post-plan-rpp0275-option-drift',
    'Post-plan private RPP-0275 post drift',
    'forged-private-rpp0275-index-overwrite',
    'forged-private-rpp0275-created-file-overwrite',
    '7.7.7-rpp0275-plugin-forged',
    'forged-private-rpp0275-option-overwrite',
    'Forged private RPP-0275 row overwrite',
  ];

  local.files[themeStylePath] = privateValues[0];
  remote.files['index.php'] = privateValues[1];
  remote.files[createdFilePath] = privateValues[2];
  delete remote.plugins.forms;
  delete remote.db.wp_options[optionRowId];
  remote.db.wp_posts['ID:1'].post_title = privateValues[3];

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const evidence = keepRemoteEvidence(firstPlan, keepRemoteCases);
  const replayEvidence = keepRemoteEvidence(replayPlan, keepRemoteCases);
  const evidenceText = JSON.stringify({
    ...evidence,
    evidenceHash: hashOnlyProofHash(evidence),
  });

  assert.equal(firstPlan.status, 'ready');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 5,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(firstPlan.summary, plannerSummaryCounts(firstPlan));
  assert.deepEqual(evidence, replayEvidence, 'keep-remote variant-4 proof changed across planning replay');
  assert.match(hashOnlyProofHash(evidence), SHA256_URI_PATTERN);
  assert.deepEqual(
    firstPlan.decisions.map((decision) => [
      decision.resourceKey,
      decision.decision,
      decision.change.localChange,
      decision.change.remoteChange,
    ]),
    keepRemoteCases.map(({ resourceKey, remoteChange }) => [
      resourceKey,
      'keep-remote',
      'unchanged',
      remoteChange,
    ]),
  );

  const localMutation = mutationFor(firstPlan, localMutationKey);
  assert.ok(localMutation, 'missing independent local mutation');
  assert.equal(localMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, 'RPP-0275 ready plan');
  assert.deepEqual(
    firstPlan.preconditions.map((precondition) => [
      precondition.mutationId,
      precondition.resourceKey,
      precondition.expectedHash,
      precondition.checkedAgainst,
    ]),
    [[localMutation.id, localMutationKey, localMutation.remoteBeforeHash, 'live-remote']],
  );

  for (const keepRemoteCase of keepRemoteCases) {
    const decision = decisionFor(firstPlan, keepRemoteCase.resourceKey);
    assert.equal(decision.decision, 'keep-remote');
    assert.equal(decision.change.localChange, 'unchanged');
    assert.equal(decision.change.remoteChange, keepRemoteCase.remoteChange);
    assert.match(decision.baseHash, SHA256_HEX_PATTERN);
    assert.match(decision.remoteHash, SHA256_HEX_PATTERN);
    assert.equal(decision.change.base.hash, decision.baseHash);
    assert.equal(decision.change.local.hash, decision.baseHash);
    assert.equal(decision.change.remote.hash, decision.remoteHash);
    assert.equal(resourceHash(base, decision.resource), decision.baseHash);
    assert.equal(resourceHash(local, decision.resource), decision.baseHash);
    assert.equal(resourceHash(remote, decision.resource), decision.remoteHash);
    assertNoMutationOrPrecondition(firstPlan, keepRemoteCase.resourceKey);
    assertHashOnlyEvidenceRedacted(decision, privateValues, `${keepRemoteCase.resourceKey} decision`);
  }
  assertHashOnlyEvidenceRedacted(evidenceText, privateValues, 'variant-4 hash-only evidence');

  const applyRemote = cloneJson(remote);
  applyRemote.files['index.php'] = privateValues[4];
  applyRemote.files[createdFilePath] = privateValues[5];
  applyRemote.plugins.forms = { version: privateValues[6], active: false };
  applyRemote.db.wp_options[optionRowId] = {
    option_name: 'rpp0275_legacy_flag',
    option_value: { mode: privateValues[7] },
  };
  applyRemote.db.wp_posts['ID:1'].post_title = privateValues[8];
  const driftedDecisionHashes = Object.fromEntries(keepRemoteCases.map(({ resourceKey }) => {
    const decision = decisionFor(firstPlan, resourceKey);
    return [resourceKey, resourceHash(applyRemote, decision.resource)];
  }));
  const applyEvents = [];
  const result = applyPlan(applyRemote, firstPlan, {
    mutateRemote: true,
    durableJournal: durableJournal(applyEvents),
  });

  assert.equal(result.appliedMutations, 1);
  assert.equal(applyRemote.files[themeStylePath], privateValues[0]);
  assert.equal(applyRemote.files['index.php'], privateValues[4]);
  assert.equal(applyRemote.files[createdFilePath], privateValues[5]);
  assert.deepEqual(applyRemote.plugins.forms, { version: privateValues[6], active: false });
  assert.equal(applyRemote.db.wp_options[optionRowId].option_value.mode, privateValues[7]);
  assert.equal(applyRemote.db.wp_posts['ID:1'].post_title, privateValues[8]);
  for (const { resourceKey } of keepRemoteCases) {
    const decision = decisionFor(firstPlan, resourceKey);
    assert.equal(
      resourceHash(applyRemote, decision.resource),
      driftedDecisionHashes[resourceKey],
      `${resourceKey} drift should be preserved because keep-remote is mutation-free`,
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
  for (const { resourceKey } of keepRemoteCases) {
    assert.equal(
      applyEvents.some((event) => event.resourceKey === resourceKey),
      false,
      `${resourceKey} wrote durable mutation evidence`,
    );
  }

  const forgedCases = [
    {
      resourceKey: 'file:index.php',
      value: { type: 'file', content: privateValues[9] },
      localChange: 'update',
    },
    {
      resourceKey: `file:${createdFilePath}`,
      value: { type: 'file', content: privateValues[10] },
      localChange: 'update',
    },
    {
      resourceKey: 'plugin:forms',
      value: { version: privateValues[11], active: true },
      localChange: 'create',
    },
    {
      resourceKey: rowKey('wp_options', optionRowId),
      value: {
        option_name: 'rpp0275_legacy_flag',
        option_value: { mode: privateValues[12] },
      },
      localChange: 'create',
    },
    {
      resourceKey: rowKey('wp_posts', 'ID:1'),
      value: {
        ID: 1,
        post_title: privateValues[13],
        post_status: 'publish',
      },
      localChange: 'update',
    },
  ];

  for (const forgedCase of forgedCases) {
    const decision = decisionFor(firstPlan, forgedCase.resourceKey);
    const forgedMutation = {
      id: `mutation-rpp-0275-forged-${decision.resource.type}-${forgedCase.localChange}`,
      resource: decision.resource,
      resourceKey: decision.resourceKey,
      action: 'put',
      value: serializeResourceValue(forgedCase.value),
      baseHash: decision.baseHash,
      localHash: digest(forgedCase.value),
      remoteBeforeHash: decision.remoteHash,
      changeKind: forgedCase.localChange,
      change: {
        localChange: forgedCase.localChange,
        remoteChange: 'unchanged',
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
      issueCodes: error.details.issues.map((issue) => issue.code),
      remoteHashAfterRefusal: hashOnlyProofHash(forgedRemote),
      durableJournalEvents: forgedEvents.map((event) => event.type),
    });
    assertHashOnlyEvidenceRedacted(refusalEvidence, privateValues, 'variant-4 forged refusal evidence');
    assertHashOnlyEvidenceRedacted(error.details, privateValues, 'variant-4 forged refusal details');
  }
});
