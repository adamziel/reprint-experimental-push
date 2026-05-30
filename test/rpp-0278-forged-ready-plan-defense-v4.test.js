import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
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
  copy.summary = {
    ...copy.summary,
    mutations: copy.mutations.length,
    decisions: copy.decisions.length,
    blockers: 0,
    conflicts: 0,
  };
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

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '7'.repeat(64),
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

function valueType(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
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
    valueType: valueType(value),
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannedValueHash(mutation) {
  try {
    return sha256Evidence(deserializeResourceValue(mutation.value));
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
  const serializedEvidence = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(
      serializedEvidence.includes(privateValue),
      false,
      `serialized plan evidence leaked ${privateValue}`,
    );
  }
}

function issueByCode(error, code) {
  const issue = (error.details.issues || []).find((candidate) => candidate.code === code);
  assert.ok(issue, `missing ${code}`);
  return issue;
}

test('RPP-0278 forged ready missing-precondition evidence redacts raw invalid hashes', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateValues = [
    '<?php echo "rpp0278-v4-local-private-file";',
    'rpp0278-v4-raw-private-remote-before-hash',
  ];

  local.files['index.php'] = privateValues[0];

  const ready = planFor(base, local, remote);
  const targetMutation = mutationFor(ready, 'file:index.php');
  assert.ok(targetMutation, 'missing file mutation');
  const targetPrecondition = preconditionFor(ready, targetMutation);
  assert.ok(targetPrecondition, 'missing file live-remote precondition');

  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.match(targetMutation.remoteBeforeHash, SHA256_HEX_PATTERN);
  assert.match(targetMutation.localHash, SHA256_HEX_PATTERN);
  assert.equal(targetPrecondition.resourceKey, targetMutation.resourceKey);
  assert.equal(targetPrecondition.expectedHash, targetMutation.remoteBeforeHash);
  assert.equal(targetPrecondition.checkedAgainst, 'live-remote');
  assertSerializedEvidenceRedacted(
    hashOnlyPlanEvidence('ready baseline', ready, null, [], remote, remote, 0),
    privateValues,
  );

  const forgedPlan = tamperReadyPlan(ready, (plan) => {
    const forgedMutation = mutationFor(plan, targetMutation.resourceKey);
    forgedMutation.remoteBeforeHash = privateValues[1];
    plan.preconditions = plan.preconditions.filter(
      (precondition) => precondition.mutationId !== forgedMutation.id,
    );
  });
  const applyRemote = cloneJson(remote);
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
    'forged invalid remoteBeforeHash without live precondition',
    forgedPlan,
    error,
    journalEvents,
    beforeRemote,
    applyRemote,
    appliedMutationCount,
  );

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
  assert.equal(digest(applyRemote), beforeRemoteHash, 'forged plan changed remote hash');
  assert.deepEqual(applyRemote, beforeRemote, 'forged plan mutated remote before refusal');
  assert.equal(appliedMutationCount, 0, 'forged plan reported applied mutations');
  assert.deepEqual(journalEvents, [], 'forged plan wrote durable journal evidence before refusal');

  const expectedRedactedHash = {
    state: 'invalid',
    sha256: digest(privateValues[1]),
    valueType: 'string',
    characterCount: privateValues[1].length,
  };
  assert.deepEqual(
    issueByCode(error, 'REMOTE_BEFORE_HASH_INVALID').remoteBeforeHash,
    expectedRedactedHash,
  );
  assert.deepEqual(
    issueByCode(error, 'MISSING_LIVE_REMOTE_PRECONDITION').expectedHash,
    expectedRedactedHash,
  );
  assertSerializedEvidenceRedacted(serializedEvidence, privateValues);
  assertSerializedEvidenceRedacted(error.details, privateValues);
});
