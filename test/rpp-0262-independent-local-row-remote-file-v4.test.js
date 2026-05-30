import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash, serializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/themes/theme/style.css': 'body { color: #222; }',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
      },
      wp_posts: {
        'ID:262': {
          ID: 262,
          post_title: 'Base RPP-0262 post',
          post_content: 'Base RPP-0262 body',
          post_status: 'publish',
        },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimOpened: true,
    claimHash: '4'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function hashOnlyChangeEvidence(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: { state: change.base.state, hash: change.base.hash },
    local: { state: change.local.state, hash: change.local.hash },
    remote: { state: change.remote.state, hash: change.remote.hash },
  };
}

function hashOnlyPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: hashOnlyChangeEvidence(mutation.change),
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    decisions: plan.decisions.map((decision) => ({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      baseHash: decision.baseHash,
      localHash: decision.localHash || null,
      remoteHash: decision.remoteHash || null,
      change: hashOnlyChangeEvidence(decision.change),
    })),
  };
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked raw value ${privateValue}`);
  }
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, label);
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  assert.equal(plan.preconditions.length, plan.mutations.length, `${label} precondition count`);

  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition key`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
    assert.equal(resourceHash(remote, mutation.resource), mutation.remoteBeforeHash, `${label} remote hash`);
    assertSha256(mutation.baseHash, `${label} ${mutation.resourceKey} base hash`);
    assertSha256(mutation.localHash, `${label} ${mutation.resourceKey} local hash`);
    assertSha256(mutation.remoteBeforeHash, `${label} ${mutation.resourceKey} remote hash`);
  }
}

function tamperReadyPlan(plan, mutate) {
  const copy = cloneJson(plan);
  mutate(copy);
  copy.status = 'ready';
  copy.conflicts = [];
  copy.blockers = [];
  copy.summary = {
    ...copy.summary,
    mutations: copy.mutations.length,
    decisions: copy.decisions.length,
    conflicts: 0,
    blockers: 0,
    atomicGroups: copy.atomicGroups.length,
  };
  return copy;
}

function forgeRemoteFileMutationPlan({ base, remote, plan, filePath, fileKey, forgedValue }) {
  const forgedMutationId = 'mutation-rpp-0262-forged-remote-file-overwrite';
  const fileResource = { type: 'file', path: filePath, key: fileKey };
  const remoteHash = resourceHash(remote, fileResource);

  return tamperReadyPlan(plan, (copy) => {
    copy.mutations.push({
      id: forgedMutationId,
      resource: fileResource,
      resourceKey: fileKey,
      action: 'put',
      value: serializeResourceValue(forgedValue),
      remoteBeforeHash: remoteHash,
      baseHash: resourceHash(base, fileResource),
      localHash: digest(forgedValue),
      changeKind: 'update',
      change: {
        localChange: 'update',
        remoteChange: 'update',
        base: { state: 'present', hash: resourceHash(base, fileResource) },
        local: { state: 'present', hash: digest(forgedValue) },
        remote: { state: 'present', hash: remoteHash },
      },
      atomicGroupId: null,
    });
    copy.preconditions.push({
      mutationId: forgedMutationId,
      resource: fileResource,
      resourceKey: fileKey,
      expectedHash: remoteHash,
      checkedAgainst: 'live-remote',
    });
  });
}

test('RPP-0262 focused independent local row plus remote file edit variant 4 rejects forged and stale mutation attempts', () => {
  const rowId = 'ID:262';
  const filePath = 'wp-content/themes/theme/style.css';
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const fileKey = `file:${filePath}`;
  const privateLocalTitle = 'local-private-rpp0262-v4-row-title';
  const privateLocalBody = 'local-private-rpp0262-v4-row-body';
  const privateRemoteFile = 'remote-private-rpp0262-v4-file-payload';
  const privateForgedFile = 'forged-private-rpp0262-v4-file-overwrite';
  const privateStaleTitle = 'stale-private-rpp0262-v4-row-title';
  const privateValues = [
    privateLocalTitle,
    privateLocalBody,
    privateRemoteFile,
    privateForgedFile,
    privateStaleTitle,
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts[rowId].post_title = privateLocalTitle;
  local.db.wp_posts[rowId].post_content = privateLocalBody;
  remote.files[filePath] = privateRemoteFile;

  const firstPlan = planFor(base, local, remote);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const rowMutation = mutationFor(firstPlan, rowKey);
  const fileDecision = decisionFor(firstPlan, fileKey);
  const rowPrecondition = preconditionFor(firstPlan, rowKey);
  const filePrecondition = preconditionFor(firstPlan, fileKey);
  const planEvidence = hashOnlyPlanEvidence(firstPlan);
  const successEvents = [];
  const successResult = applyPlan(cloneJson(remote), firstPlan, {
    durableJournal: claimFencedDurableJournal(successEvents),
  });

  assert.equal(firstPlan.status, 'ready');
  assert.deepEqual(firstPlan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(planEvidence, hashOnlyPlanEvidence(replayPlan));
  assert.ok(rowMutation, 'missing planned local row mutation');
  assert.equal(rowMutation.action, 'put');
  assert.equal(rowMutation.resourceKey, rowKey);
  assert.equal(rowMutation.change.localChange, 'update');
  assert.equal(rowMutation.change.remoteChange, 'unchanged');
  assert.equal(rowMutation.remoteBeforeHash, resourceHash(remote, rowMutation.resource));
  assert.equal(rowMutation.localHash, resourceHash(local, rowMutation.resource));
  assert.equal(rowPrecondition?.mutationId, rowMutation.id);
  assert.equal(rowPrecondition.expectedHash, rowMutation.remoteBeforeHash);
  assert.equal(rowPrecondition.checkedAgainst, 'live-remote');

  assert.ok(fileDecision, 'missing remote file keep-remote decision');
  assert.equal(fileDecision.decision, 'keep-remote');
  assert.equal(fileDecision.resourceKey, fileKey);
  assert.equal(fileDecision.change.localChange, 'unchanged');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assert.equal(fileDecision.baseHash, resourceHash(base, fileDecision.resource));
  assert.equal(fileDecision.remoteHash, resourceHash(remote, fileDecision.resource));
  assert.equal(fileDecision.change.local.hash, fileDecision.baseHash);
  assert.equal(fileDecision.change.remote.hash, fileDecision.remoteHash);
  assert.equal(mutationFor(firstPlan, fileKey), undefined);
  assert.equal(filePrecondition, undefined);
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, remote, 'RPP-0262 focused plan');
  assertHashOnlyEvidenceRedacted(planEvidence, privateValues, 'RPP-0262 plan evidence');
  assertHashOnlyEvidenceRedacted(fileDecision, privateValues, 'RPP-0262 file decision');

  assert.equal(successResult.appliedMutations, 1);
  assert.equal(successResult.site.db.wp_posts[rowId].post_title, privateLocalTitle);
  assert.equal(successResult.site.db.wp_posts[rowId].post_content, privateLocalBody);
  assert.equal(successResult.site.files[filePath], privateRemoteFile);
  assert.deepEqual(
    successEvents
      .filter((event) => ['target-planned', 'mutation-observed'].includes(event.type))
      .map((event) => [event.type, event.resourceKey]),
    [
      ['target-planned', rowKey],
      ['mutation-observed', rowKey],
    ],
  );
  assert.equal(successEvents.some((event) => event.resourceKey === fileKey), false);
  assertHashOnlyEvidenceRedacted(successEvents, privateValues, 'RPP-0262 durable events');

  const forgedPlan = forgeRemoteFileMutationPlan({
    base,
    remote,
    plan: firstPlan,
    filePath,
    fileKey,
    forgedValue: privateForgedFile,
  });
  const forgedRemote = cloneJson(remote);
  const forgedBeforeHash = digest(forgedRemote);
  const forgedEvents = [];
  const forgedError = captureError(() => applyPlan(forgedRemote, forgedPlan, {
    durableJournal: claimFencedDurableJournal(forgedEvents),
  }));

  assert.ok(forgedError instanceof PushPlanError);
  assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    forgedError.details.issues.some((issue) =>
      issue.code === 'MUTATION_DECISION_RESOURCE_OVERLAP'
      && issue.resourceKey === fileKey
      && issue.mutationId === 'mutation-rpp-0262-forged-remote-file-overwrite'),
    'forged file mutation must overlap the keep-remote decision',
  );
  assert.equal(digest(forgedRemote), forgedBeforeHash);
  assert.equal(forgedRemote.files[filePath], privateRemoteFile);
  assert.deepEqual(forgedEvents, []);
  assertHashOnlyEvidenceRedacted(hashOnlyPlanEvidence(forgedPlan), privateValues, 'RPP-0262 forged plan evidence');
  assertHashOnlyEvidenceRedacted(forgedError.details, privateValues, 'RPP-0262 forged refusal');

  const staleRemote = cloneJson(remote);
  staleRemote.db.wp_posts[rowId].post_title = privateStaleTitle;
  const staleActualHash = resourceHash(staleRemote, rowMutation.resource);
  const staleBeforeHash = digest(staleRemote);
  const staleEvents = [];
  const staleError = captureError(() => applyPlan(staleRemote, firstPlan, {
    durableJournal: claimFencedDurableJournal(staleEvents),
  }));

  assert.notEqual(staleActualHash, rowMutation.remoteBeforeHash);
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, rowKey);
  assert.equal(staleError.details.expectedHash, rowMutation.remoteBeforeHash);
  assert.equal(staleError.details.actualHash, staleActualHash);
  assert.equal(digest(staleRemote), staleBeforeHash);
  assert.equal(staleRemote.files[filePath], privateRemoteFile);
  assert.deepEqual(staleEvents, []);
  assertHashOnlyEvidenceRedacted(staleError.details, privateValues, 'RPP-0262 stale refusal');
});
