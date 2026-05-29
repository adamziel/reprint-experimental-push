import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { findEvidenceRedactionIssues, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');
const sha256HexPattern = /^[a-f0-9]{64}$/;

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

function rpp0213LocalHashFixture() {
  const pluginOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "rpp0213-local-private-file";',
    'rpp0213-local-private-row-title',
    'rpp0213-local-private-option-mode',
    'rpp0213-invalid-raw-local-hash-secret',
    'rpp0213-forged-mutation-value-secret',
    'rpp0213-stale-local-hash-source-secret',
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
    mutationResourceKeys: [
      'file:index.php',
      pluginOptionResourceKey,
      'row:["wp_posts","ID:1"]',
    ],
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
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
    claimHash: '3'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    'ready localHash fixture should keep preconditions one-for-one with mutations',
  );
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
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
    sha256: sha256Evidence(value),
    valueType: typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannedValueHashEvidence(mutation) {
  try {
    return digest(deserializeMutationValue(mutation));
  } catch {
    return { state: 'invalid-payload' };
  }
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function serializedPlanEvidence(plan, error = null, journalEvents = [], appliedMutationCount = 0) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: hashEvidenceForPlan(mutation.baseHash),
      localHash: hashEvidenceForPlan(mutation.localHash),
      remoteBeforeHash: hashEvidenceForPlan(mutation.remoteBeforeHash),
      plannedValueHash: plannedValueHashEvidence(mutation),
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
      detailsHash: sha256Evidence(error.details),
    } : null,
    journalEventTypes: journalEvents.map((event) => event.type),
    appliedMutationCount,
  };
}

function assertSerializedEvidenceHasNoPrivateValues(evidence, privateValues, label) {
  assert.deepEqual(findEvidenceRedactionIssues(evidence), [], `${label} should already be redacted`);
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked ${privateValue}`);
  }
}

test('RPP-0213 localHash binds mixed resource mutations to planned local snapshots', () => {
  const fixture = rpp0213LocalHashFixture();
  const ready = planFor(fixture.base, fixture.local, fixture.remote);

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

    assert.match(mutation.localHash, sha256HexPattern);
    assert.equal(
      mutation.localHash,
      resourceHash(fixture.local, mutation.resource),
      `${mutation.resourceKey} localHash must bind to the local snapshot`,
    );
    assert.equal(
      mutation.localHash,
      digest(plannedValue),
      `${mutation.resourceKey} localHash must bind to the serialized planned value`,
    );
    assert.equal(mutation.localHash, plannedValueHashEvidence(mutation));
  }

  const evidence = serializedPlanEvidence(ready);
  assertSerializedEvidenceHasNoPrivateValues(evidence, fixture.privateValues, 'RPP-0213 ready plan evidence');
});

test('RPP-0213 executor rejects forged or stale localHash before mutation', () => {
  const fixture = rpp0213LocalHashFixture();
  const ready = planFor(fixture.base, fixture.local, fixture.remote);
  const targetMutation = mutationFor(ready, 'file:index.php');
  const cases = [
    {
      name: 'missing localHash',
      issueCode: 'LOCAL_HASH_MISSING',
      forge(plan) {
        delete mutationFor(plan, targetMutation.resourceKey).localHash;
      },
    },
    {
      name: 'raw forged localHash is redacted',
      issueCode: 'LOCAL_HASH_INVALID',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = fixture.privateValues[3];
      },
    },
    {
      name: 'wrong localHash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = '0'.repeat(64);
      },
    },
    {
      name: 'stale mutation value with old localHash',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).value = serializeResourceValue({
          type: 'file',
          content: fixture.privateValues[4],
        });
      },
    },
    {
      name: 'stale localHash from a different local snapshot',
      issueCode: 'LOCAL_HASH_MISMATCH',
      forge(plan) {
        mutationFor(plan, targetMutation.resourceKey).localHash = digest({
          type: 'file',
          content: fixture.privateValues[5],
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
    assertSerializedEvidenceHasNoPrivateValues(evidence, fixture.privateValues, `RPP-0213 ${testCase.name} evidence`);
    assertSerializedEvidenceHasNoPrivateValues(
      redactEvidence(error.details),
      fixture.privateValues,
      `RPP-0213 ${testCase.name} refusal details`,
    );
  }
});
