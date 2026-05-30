import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  getResource,
  resourceHash,
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

function rpp0232Fixture() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = cloneJson(baseSite());
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "rpp0232-local-file-private";',
    'rpp0232-local-post-title-private',
    'rpp0232-local-option-mode-private',
    '<?php echo "rpp0232-stale-file-private";',
    'rpp0232-stale-post-title-private',
    'rpp0232-stale-option-mode-private',
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

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.blockers = [];
  copy.conflicts = [];
  copy.summary.blockers = 0;
  copy.summary.conflicts = 0;
  return copy;
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '2'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function plannedValueHash(mutation) {
  return digest(deserializeResourceValue(mutation.value));
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `hash-only evidence leaked ${privateValue}`);
  }
}

function assertNoTargetOrMutationJournalEvents(events, label) {
  assert.equal(
    events.filter((event) => event.type === 'target-planned' || event.type.includes('mutation')).length,
    0,
    `${label} wrote target or mutation journal evidence before refusal`,
  );
}

function staleRemoteForMutation(fixture, mutation) {
  const remote = cloneJson(fixture.remote);
  const staleValue = fixture.staleValueByResourceKey[mutation.resourceKey];
  assert.equal(typeof staleValue, 'string', `missing stale fixture for ${mutation.resourceKey}`);

  if (mutation.resource.type === 'file') {
    setResource(remote, mutation.resource, { type: 'file', content: staleValue });
    return remote;
  }

  const current = getResource(remote, mutation.resource);
  assert.equal(typeof current, 'object', `${mutation.resourceKey} remote value must be an object`);

  if (mutation.resource.table === 'wp_posts') {
    setResource(remote, mutation.resource, {
      ...current,
      post_title: staleValue,
    });
    return remote;
  }

  if (mutation.resource.table === 'wp_options') {
    setResource(remote, mutation.resource, {
      ...current,
      option_value: {
        ...current.option_value,
        mode: staleValue,
      },
    });
    return remote;
  }

  throw new Error(`No stale mutation helper for ${mutation.resourceKey}`);
}

test('RPP-0232 planner binds every mutation remoteBeforeHash to observed remote resources, not local payloads', () => {
  const fixture = rpp0232Fixture();
  const plan = planFor(fixture);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 3,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(plan.mutations.map((mutation) => mutation.resourceKey), fixture.expectedResourceKeys);
  assert.equal(plan.preconditions.length, plan.mutations.length);

  const proofs = [];
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    const observedRemoteHash = resourceHash(fixture.remote, mutation.resource);
    const observedLocalHash = resourceHash(fixture.local, mutation.resource);
    const mutationPayloadHash = plannedValueHash(mutation);

    assert.ok(precondition, `missing live remote precondition for ${mutation.resourceKey}`);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');

    assert.match(mutation.remoteBeforeHash, SHA256_HEX_PATTERN);
    assert.equal(mutation.remoteBeforeHash, observedRemoteHash, `${mutation.resourceKey} mutation remote hash`);
    assert.equal(precondition.expectedHash, observedRemoteHash, `${mutation.resourceKey} precondition remote hash`);
    assert.equal(mutation.localHash, observedLocalHash, `${mutation.resourceKey} local hash`);
    assert.equal(mutationPayloadHash, observedLocalHash, `${mutation.resourceKey} planned payload hash`);
    assert.notEqual(
      mutation.remoteBeforeHash,
      mutationPayloadHash,
      `${mutation.resourceKey} remoteBeforeHash must not be derived from the local mutation payload`,
    );

    proofs.push({
      resourceKey: mutation.resourceKey,
      remoteBeforeHash: mutation.remoteBeforeHash,
      observedRemoteHash,
      localHash: mutation.localHash,
      plannedValueHash: mutationPayloadHash,
      preconditionHash: precondition.expectedHash,
    });
  }

  assertHashOnlyEvidenceRedacted({ proofs, proofHash: digest(proofs) }, fixture.privateValues);
});

test('RPP-0232 executor rejects per-mutation forged remoteBeforeHash values before mutation', () => {
  const fixture = rpp0232Fixture();
  const ready = planFor(fixture);

  assert.equal(ready.status, 'ready');

  for (const originalMutation of ready.mutations) {
    const forgedHashFromLocalPlanPayload = originalMutation.localHash;
    assert.notEqual(
      forgedHashFromLocalPlanPayload,
      originalMutation.remoteBeforeHash,
      `${originalMutation.resourceKey} local hash fixture must differ from remoteBeforeHash`,
    );

    const forgedPlan = tamperReadyPlan(ready, (plan) => {
      const forgedMutation = mutationFor(plan, originalMutation.resourceKey);
      const forgedPrecondition = preconditionFor(plan, forgedMutation);
      forgedMutation.remoteBeforeHash = forgedHashFromLocalPlanPayload;
      forgedPrecondition.expectedHash = forgedHashFromLocalPlanPayload;
    });
    const applyRemote = cloneJson(fixture.remote);
    const beforeRemote = JSON.stringify(applyRemote);
    const beforeRemoteHash = digest(applyRemote);
    const journalEvents = [];
    const error = captureError(() => applyPlan(applyRemote, forgedPlan, {
      durableJournal: claimFencedDurableJournal(journalEvents),
    }));
    const refusalEvidence = {
      resourceKey: originalMutation.resourceKey,
      code: error.code,
      details: error.details,
      beforeRemoteHash,
      afterRemoteHash: digest(applyRemote),
      journalEventTypes: journalEvents.map((event) => event.type),
    };

    assert.ok(error instanceof PushPlanError, originalMutation.resourceKey);
    assert.equal(error.code, 'PRECONDITION_FAILED', originalMutation.resourceKey);
    assert.equal(error.details.resourceKey, originalMutation.resourceKey);
    assert.equal(error.details.expectedHash, forgedHashFromLocalPlanPayload);
    assert.equal(error.details.actualHash, resourceHash(fixture.remote, originalMutation.resource));
    assert.equal(JSON.stringify(applyRemote), beforeRemote, `${originalMutation.resourceKey} mutated remote`);
    assert.equal(digest(applyRemote), beforeRemoteHash, `${originalMutation.resourceKey} changed remote hash`);
    assertNoTargetOrMutationJournalEvents(journalEvents, originalMutation.resourceKey);
    assertHashOnlyEvidenceRedacted(refusalEvidence, fixture.privateValues);
  }
});

test('RPP-0232 executor rejects stale observed remote resources for every mutation before mutation', () => {
  const fixture = rpp0232Fixture();
  const ready = planFor(fixture);

  assert.equal(ready.status, 'ready');

  for (const mutation of ready.mutations) {
    const staleRemote = staleRemoteForMutation(fixture, mutation);
    const staleActualHash = resourceHash(staleRemote, mutation.resource);
    const beforeRemote = JSON.stringify(staleRemote);
    const beforeRemoteHash = digest(staleRemote);
    const journalEvents = [];

    assert.notEqual(staleActualHash, mutation.remoteBeforeHash, `${mutation.resourceKey} stale fixture must drift`);

    const error = captureError(() => applyPlan(staleRemote, ready, {
      durableJournal: claimFencedDurableJournal(journalEvents),
    }));
    const refusalEvidence = {
      resourceKey: mutation.resourceKey,
      code: error.code,
      details: error.details,
      beforeRemoteHash,
      afterRemoteHash: digest(staleRemote),
      journalEventTypes: journalEvents.map((event) => event.type),
    };

    assert.ok(error instanceof PushPlanError, mutation.resourceKey);
    assert.equal(error.code, 'PRECONDITION_FAILED', mutation.resourceKey);
    assert.equal(error.details.resourceKey, mutation.resourceKey);
    assert.equal(error.details.expectedHash, mutation.remoteBeforeHash);
    assert.equal(error.details.actualHash, staleActualHash);
    assert.equal(JSON.stringify(staleRemote), beforeRemote, `${mutation.resourceKey} mutated stale remote`);
    assert.equal(digest(staleRemote), beforeRemoteHash, `${mutation.resourceKey} changed stale remote hash`);
    assertNoTargetOrMutationJournalEvents(journalEvents, mutation.resourceKey);
    assertHashOnlyEvidenceRedacted(refusalEvidence, fixture.privateValues);
  }
});
