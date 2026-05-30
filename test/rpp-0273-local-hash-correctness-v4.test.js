import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, serializeResourceValue } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp0273-base-file-private";',
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
          option_value: { mode: 'rpp0273-base-option-private' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'rpp0273-base-post-title-private',
          post_status: 'publish',
        },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { pluginOwner, resourceKey, driver, ...extra };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function rpp0273DeleteFixture() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    base.files['index.php'],
    base.db.wp_posts['ID:1'].post_title,
    base.db.wp_options['option_name:forms_settings'].option_value.mode,
    'rpp0273-invalid-raw-local-hash-secret',
    '<?php echo "rpp0273-forged-deleted-file-resurrection";',
  ];

  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(pluginOptionResourceKey, 'forms', 'wp-option', { supportsDelete: true }),
    ),
  };

  return {
    base,
    local,
    remote,
    privateValues,
    mutationResourceKeys: [
      'file:index.php',
      pluginOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
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

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function deserializeMutationValue(mutation) {
  return deserializeResourceValue(mutation.value);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
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

function durableEventsFor(events) {
  return {
    claimFenced: true,
    claimHash: '7'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function hashEvidenceForPlan(value) {
  if (typeof value === 'string' && sha256HexPattern.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: `sha256:${digest(value)}`,
    valueType: typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function serializedPlanEvidence(plan, error = null, journalEvents = [], appliedMutationCount = 0) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      baseHash: hashEvidenceForPlan(mutation.baseHash),
      localHash: hashEvidenceForPlan(mutation.localHash),
      remoteBeforeHash: hashEvidenceForPlan(mutation.remoteBeforeHash),
      plannedValueHash: `sha256:${digest(deserializeMutationValue(mutation))}`,
      plannedResource: redactEvidence(mutation.value),
      change: redactEvidence(mutation.change),
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: hashEvidenceForPlan(precondition.expectedHash),
      checkedAgainst: precondition.checkedAgainst,
    })),
    refusal: error ? {
      code: error.code,
      message: error.message,
      details: redactEvidence(error.details),
      detailsHash: `sha256:${digest(error.details)}`,
    } : null,
    journalEventTypes: journalEvents.map((event) => event.type),
    appliedMutationCount,
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  assert.equal(plan.preconditions.length, plan.mutations.length);
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing live remote precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

function assertSerializedEvidenceHasNoPrivateValues(evidence, privateValues, label) {
  assert.deepEqual(findEvidenceRedactionIssues(evidence), [], `${label} should contain hash/redacted evidence only`);
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0273 localHash binds delete mutations to absent local snapshots', () => {
  const fixture = rpp0273DeleteFixture();
  const ready = planFor(fixture);

  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.summary, {
    mutations: 3,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(ready.mutations.map((mutation) => mutation.resourceKey), fixture.mutationResourceKeys);
  assertEveryMutationHasLiveRemotePrecondition(ready);

  for (const mutation of ready.mutations) {
    const plannedValue = deserializeMutationValue(mutation);

    assert.equal(mutation.action, 'delete', `${mutation.resourceKey} must be a delete mutation`);
    assert.equal(plannedValue, ABSENT, `${mutation.resourceKey} planned value must be absent`);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.equal(
      mutation.localHash,
      resourceHash(fixture.local, mutation.resource),
      `${mutation.resourceKey} localHash must bind to the local delete snapshot`,
    );
    assert.equal(
      mutation.localHash,
      digest(plannedValue),
      `${mutation.resourceKey} localHash must bind to the serialized absent value`,
    );
    assert.notEqual(
      mutation.localHash,
      resourceHash(fixture.base, mutation.resource),
      `${mutation.resourceKey} localHash must not reuse the base/private payload hash`,
    );
  }

  const evidence = serializedPlanEvidence(ready);
  assertSerializedEvidenceHasNoPrivateValues(evidence, fixture.privateValues, 'RPP-0273 ready delete plan evidence');

  const successful = applyPlan(cloneJson(fixture.remote), ready);
  assert.equal(successful.appliedMutations, 3);
  assert.equal(Object.hasOwn(successful.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(successful.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(successful.site.db.wp_options, 'option_name:forms_settings'), false);
});

test('RPP-0273 executor rejects stale localHash delete evidence before mutation', () => {
  const fixture = rpp0273DeleteFixture();
  const ready = planFor(fixture);
  const targetMutation = mutationFor(ready, 'file:index.php');
  const cases = [
    {
      name: 'raw invalid localHash on delete is redacted',
      issueCode: 'LOCAL_HASH_INVALID',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = fixture.privateValues[3];
      },
    },
    {
      name: 'base payload hash reused for delete localHash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = resourceHash(fixture.base, targetMutation.resource);
      },
    },
    {
      name: 'delete payload resurrected with absent localHash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).value = serializeResourceValue({
          type: 'file',
          content: fixture.privateValues[4],
        });
      },
    },
  ];

  assert.equal(ready.status, 'ready');
  assertEveryMutationHasLiveRemotePrecondition(ready);

  for (const testCase of cases) {
    const forged = tamperReadyPlan(ready, testCase.forge);
    const applyRemote = cloneJson(fixture.remote);
    const beforeRemote = JSON.stringify(applyRemote);
    const beforeRemoteHash = digest(applyRemote);
    const journalEvents = [];
    let appliedMutationCount = 0;
    const error = captureError(() => {
      const result = applyPlan(applyRemote, forged, {
        durableJournal: durableEventsFor(journalEvents),
      });
      appliedMutationCount = result.appliedMutations;
    });
    const evidence = serializedPlanEvidence(forged, error, journalEvents, appliedMutationCount);

    assert.ok(error instanceof PushPlanError, testCase.name);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', testCase.name);
    assert.ok(
      error.details.issues.some((issue) => issue.code === testCase.issueCode),
      `${testCase.name} missing ${testCase.issueCode}`,
    );
    assert.equal(JSON.stringify(applyRemote), beforeRemote, `${testCase.name} mutated remote before refusal`);
    assert.equal(digest(applyRemote), beforeRemoteHash, `${testCase.name} changed remote hash before refusal`);
    assert.equal(appliedMutationCount, 0, `${testCase.name} reported applied mutations`);
    assert.deepEqual(journalEvents, [], `${testCase.name} wrote durable journal evidence before refusal`);
    assertSerializedEvidenceHasNoPrivateValues(evidence, fixture.privateValues, `RPP-0273 ${testCase.name} evidence`);
    assertSerializedEvidenceHasNoPrivateValues(
      redactEvidence(error.details),
      fixture.privateValues,
      `RPP-0273 ${testCase.name} refusal details`,
    );
  }
});
