import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  getResource,
  resourceHash,
  serializeResourceValue,
  setResource,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'basic' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option') {
  return { pluginOwner, resourceKey, driver };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function rpp0238Fixture() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = cloneJson(baseSite());
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "local-private-rpp0238-v2-file";',
    'rpp0238-v2-local-private-row-title',
    'rpp0238-v2-local-private-option-mode',
    '<?php echo "rpp0238-v2-stale-live-remote-file";',
    'rpp0238-v2-stale-live-remote-row-title',
    'rpp0238-v2-stale-live-remote-option-mode',
    'rpp0238-v2-raw-forged-hash-private-value',
    'rpp0238-v2-forged-mutation-payload-private-value',
  ];

  local.files['index.php'] = privateValues[0];
  local.db.wp_posts['ID:1'].post_title = privateValues[1];
  local.db.wp_options['option_name:forms_settings'].option_value.mode = privateValues[2];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(pluginOptionResourceKey, 'forms', 'wp-option'),
    ),
  };

  return {
    base,
    local,
    remote,
    privateValues,
    expectedResourceKeys: [
      'file:index.php',
      pluginOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
    staleValueByResourceKey: {
      'file:index.php': privateValues[3],
      'row:["wp_posts","ID:1"]': privateValues[4],
      [pluginOptionResourceKey]: privateValues[5],
    },
  };
}

function planFor(fixture) {
  return createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutationOrResourceKey) {
  const mutation = typeof mutationOrResourceKey === 'string'
    ? mutationFor(plan, mutationOrResourceKey)
    : mutationOrResourceKey;
  assert.ok(mutation, `missing mutation for ${mutationOrResourceKey}`);
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary = {
    ...copy.summary,
    mutations: copy.mutations.length,
    decisions: copy.decisions.length,
    blockers: 0,
    conflicts: 0,
  };
  return copy;
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '8'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function hashFieldEvidence(value) {
  if (typeof value === 'string' && SHA256_HEX_PATTERN.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: sha256Evidence(value),
    valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannedValueHash(mutation) {
  try {
    return digest(deserializeResourceValue(mutation.value));
  } catch {
    return { state: 'unreadable-planned-value' };
  }
}

function hashOnlyPlanEvidence(label, plan, error, journalEvents, remoteBefore, remoteAfter, appliedMutationCount) {
  const evidence = {
    label,
    status: plan.status,
    summary: plan.summary,
    planHash: sha256Evidence(plan),
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: hashFieldEvidence(mutation.baseHash),
      localHash: hashFieldEvidence(mutation.localHash),
      remoteBeforeHash: hashFieldEvidence(mutation.remoteBeforeHash),
      plannedValueHash: plannedValueHash(mutation),
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: hashFieldEvidence(precondition.expectedHash),
      checkedAgainst: precondition.checkedAgainst,
    })),
    refusal: error ? {
      code: error.code,
      issueCodes: (error.details.issues || []).map((issue) => issue.code).sort(),
      details: error.details,
      detailsHash: sha256Evidence(error.details),
    } : null,
    remoteBeforeHash: sha256Evidence(remoteBefore),
    remoteAfterHash: sha256Evidence(remoteAfter),
    journalEventTypes: journalEvents.map((event) => event.type),
    targetOrMutationJournalEvents: journalEvents.filter(
      (event) => event.type === 'target-planned' || event.type.includes('mutation'),
    ).length,
    appliedMutationCount,
  };

  return {
    ...evidence,
    evidenceHash: sha256Evidence(evidence),
  };
}

function assertSerializedEvidenceRedacted(evidence, privateValues) {
  const serializedEvidence = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(
      serializedEvidence.includes(privateValue),
      false,
      `serialized plan evidence leaked ${privateValue}`,
    );
  }
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote) {
  assert.equal(plan.preconditions.length, plan.mutations.length, 'ready plan preconditions must match mutations');
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing precondition for ${mutation.resourceKey}`);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(mutation.remoteBeforeHash, resourceHash(remote, mutation.resource));
  }
}

function staleRemoteForMutation(fixture, mutation) {
  const staleRemote = cloneJson(fixture.remote);
  const staleValue = fixture.staleValueByResourceKey[mutation.resourceKey];
  assert.equal(typeof staleValue, 'string', `missing stale fixture for ${mutation.resourceKey}`);

  if (mutation.resource.type === 'file') {
    setResource(staleRemote, mutation.resource, { type: 'file', content: staleValue });
    return staleRemote;
  }

  const current = getResource(staleRemote, mutation.resource);
  assert.equal(typeof current, 'object', `${mutation.resourceKey} remote value must be an object`);

  if (mutation.resource.table === 'wp_posts') {
    setResource(staleRemote, mutation.resource, {
      ...current,
      post_title: staleValue,
    });
    return staleRemote;
  }

  if (mutation.resource.table === 'wp_options') {
    setResource(staleRemote, mutation.resource, {
      ...current,
      option_value: {
        ...current.option_value,
        mode: staleValue,
      },
    });
    return staleRemote;
  }

  throw new Error(`No stale helper for ${mutation.resourceKey}`);
}

function issueCodes(error) {
  return (error.details.issues || []).map((issue) => issue.code);
}

test('RPP-0238 forged ready plans reject before mutation and serialize only hash evidence', () => {
  const fixture = rpp0238Fixture();
  const ready = planFor(fixture);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.summary, {
    mutations: 3,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(ready.mutations.map((mutation) => mutation.resourceKey), fixture.expectedResourceKeys);
  assertEveryMutationHasLiveRemotePrecondition(ready, fixture.remote);
  assertSerializedEvidenceRedacted(
    hashOnlyPlanEvidence('ready baseline', ready, null, [], fixture.remote, fixture.remote, 0),
    fixture.privateValues,
  );

  const fileMutation = mutationFor(ready, 'file:index.php');
  const optionMutation = mutationFor(ready, 'row:["wp_options","option_name:forms_settings"]');
  const rowMutation = mutationFor(ready, 'row:["wp_posts","ID:1"]');

  const forgedCases = [
    ...ready.mutations.map((mutation) => ({
      name: `missing live precondition for ${mutation.resourceKey}`,
      issueCode: 'MISSING_LIVE_REMOTE_PRECONDITION',
      forge(plan) {
        plan.preconditions = plan.preconditions.filter(
          (precondition) => precondition.mutationId !== mutation.id,
        );
      },
    })),
    {
      name: 'duplicate live precondition',
      issueCode: 'DUPLICATE_LIVE_REMOTE_PRECONDITION',
      forge(plan) {
        plan.preconditions.push(cloneJson(preconditionFor(plan, fileMutation.resourceKey)));
      },
    },
    {
      name: 'precondition without matching mutation',
      issueCode: 'PRECONDITION_WITHOUT_MUTATION',
      forge(plan) {
        plan.mutations = plan.mutations.filter((mutation) => mutation.id !== optionMutation.id);
      },
    },
    {
      name: 'precondition not checked against live remote',
      issueCode: 'PRECONDITION_NOT_LIVE_REMOTE',
      forge(plan) {
        preconditionFor(plan, rowMutation.resourceKey).checkedAgainst = 'cached-remote';
      },
    },
    {
      name: 'raw private precondition hash mismatch is redacted',
      issueCode: 'PRECONDITION_HASH_MISMATCH',
      forge(plan) {
        preconditionFor(plan, fileMutation.resourceKey).expectedHash = fixture.privateValues[6];
      },
    },
    {
      name: 'raw private mutation remoteBeforeHash is redacted',
      issueCode: 'REMOTE_BEFORE_HASH_INVALID',
      forge(plan) {
        const mutation = mutationFor(plan, optionMutation.resourceKey);
        const precondition = preconditionFor(plan, mutation);
        mutation.remoteBeforeHash = fixture.privateValues[6];
        precondition.expectedHash = fixture.privateValues[6];
      },
    },
    {
      name: 'raw private forged mutation payload is represented only by hash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, fileMutation.resourceKey).value = serializeResourceValue({
          type: 'file',
          content: fixture.privateValues[7],
        });
      },
    },
  ];

  for (const forgedCase of forgedCases) {
    const forgedPlan = tamperReadyPlan(ready, forgedCase.forge);
    const applyRemote = cloneJson(fixture.remote);
    const beforeRemote = cloneJson(applyRemote);
    const beforeRemoteHash = digest(applyRemote);
    const journalEvents = [];
    let appliedMutationCount = 0;
    const error = captureError(() => {
      const result = applyPlan(applyRemote, forgedPlan, {
        mutateRemote: true,
        durableJournal: claimFencedDurableJournal(journalEvents),
      });
      appliedMutationCount = result.appliedMutations;
    });
    const serializedEvidence = hashOnlyPlanEvidence(
      forgedCase.name,
      forgedPlan,
      error,
      journalEvents,
      beforeRemote,
      applyRemote,
      appliedMutationCount,
    );

    assert.ok(error instanceof PushPlanError, forgedCase.name);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', forgedCase.name);
    assert.ok(
      issueCodes(error).includes(forgedCase.issueCode),
      `${forgedCase.name} missing ${forgedCase.issueCode}`,
    );
    assert.equal(digest(applyRemote), beforeRemoteHash, `${forgedCase.name} changed remote hash`);
    assert.deepEqual(applyRemote, beforeRemote, `${forgedCase.name} mutated remote before refusal`);
    assert.equal(appliedMutationCount, 0, `${forgedCase.name} reported applied mutations`);
    assert.deepEqual(journalEvents, [], `${forgedCase.name} wrote durable journal evidence before refusal`);
    assertSerializedEvidenceRedacted(serializedEvidence, fixture.privateValues);
    assertSerializedEvidenceRedacted(error.details, fixture.privateValues);
  }
});

test('RPP-0238 stale ready plans fail before mutation with redacted serialized evidence', () => {
  const fixture = rpp0238Fixture();
  const ready = planFor(fixture);

  assert.equal(ready.status, 'ready');

  for (const mutation of ready.mutations) {
    const staleRemote = staleRemoteForMutation(fixture, mutation);
    const staleActualHash = resourceHash(staleRemote, mutation.resource);
    const beforeRemote = cloneJson(staleRemote);
    const beforeRemoteHash = digest(staleRemote);
    const journalEvents = [];
    let appliedMutationCount = 0;

    assert.notEqual(staleActualHash, mutation.remoteBeforeHash, `${mutation.resourceKey} stale fixture did not drift`);

    const error = captureError(() => {
      const result = applyPlan(staleRemote, ready, {
        mutateRemote: true,
        durableJournal: claimFencedDurableJournal(journalEvents),
      });
      appliedMutationCount = result.appliedMutations;
    });
    const serializedEvidence = hashOnlyPlanEvidence(
      `stale live remote for ${mutation.resourceKey}`,
      ready,
      error,
      journalEvents,
      beforeRemote,
      staleRemote,
      appliedMutationCount,
    );

    assert.ok(error instanceof PushPlanError, mutation.resourceKey);
    assert.equal(error.code, 'PRECONDITION_FAILED', mutation.resourceKey);
    assert.equal(error.details.resourceKey, mutation.resourceKey);
    assert.equal(error.details.expectedHash, mutation.remoteBeforeHash);
    assert.equal(error.details.actualHash, staleActualHash);
    assert.equal(digest(staleRemote), beforeRemoteHash, `${mutation.resourceKey} changed stale remote hash`);
    assert.deepEqual(staleRemote, beforeRemote, `${mutation.resourceKey} mutated stale remote before refusal`);
    assert.equal(appliedMutationCount, 0, `${mutation.resourceKey} reported applied mutations`);
    assert.equal(
      journalEvents.filter((event) => event.type === 'target-planned' || event.type.includes('mutation')).length,
      0,
      `${mutation.resourceKey} wrote target or mutation journal evidence before refusal`,
    );
    assertSerializedEvidenceRedacted(serializedEvidence, fixture.privateValues);
    assertSerializedEvidenceRedacted(error.details, fixture.privateValues);
  }
});
