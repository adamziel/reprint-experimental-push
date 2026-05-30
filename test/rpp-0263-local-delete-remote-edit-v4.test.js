import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  assertEvidenceHasNoRawValues,
  findEvidenceRedactionIssues,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const deletedRowId = 'ID:263';
const deletedRowKey = `row:["wp_posts","${deletedRowId}"]`;
const independentFilePath = 'wp-content/mu-plugins/rpp-0263-independent.php';
const independentFileKey = `file:${independentFilePath}`;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0263 base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        [deletedRowId]: {
          ID: 263,
          post_title: 'rpp-0263-base-private-row-title',
          post_content: 'rpp-0263-base-private-row-body',
          post_status: 'publish',
        },
      },
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function failingDurableJournal() {
  return {
    claimFenced: true,
    claimHash: 'b'.repeat(64),
    events: [],
    nextSequence: 1,
    appendEvent(type, payload) {
      const record = { sequence: this.nextSequence, type, ...payload };
      this.events.push(record);
      this.nextSequence += 1;
      return record;
    },
  };
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function hashOnlyPlanEvidence(plan) {
  return {
    rpp: 'RPP-0263',
    evidenceSource: 'local-focused-delete-edit-v4',
    rawValuesIncluded: false,
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
      change: decision.change,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy || null,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      change: conflict.change,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
    })),
    atomicGroups: plan.atomicGroups.map((group) => ({
      id: group.id,
      status: group.status,
      mutationIds: group.mutationIds,
      blockerIds: group.blockerIds,
    })),
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `missing live-remote precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }
}

function assertSerializedEvidenceOmitsRawValues(evidence, rawValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `${label} leaked raw value: ${rawValue}`);
  }
}

test('RPP-0263 local delete versus remote edit variant 4 keeps serialized plan evidence hash-only', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateLocalFile = '<?php /* rpp-0263-local-private-independent-file */';
  const privateRemoteTitle = 'rpp-0263-remote-private-row-title';
  const privateRemoteBody = 'rpp-0263-remote-private-row-body';
  const rawValues = [
    base.db.wp_posts[deletedRowId].post_title,
    base.db.wp_posts[deletedRowId].post_content,
    privateLocalFile,
    privateRemoteTitle,
    privateRemoteBody,
  ];

  delete local.db.wp_posts[deletedRowId];
  local.files[independentFilePath] = privateLocalFile;
  remote.db.wp_posts[deletedRowId].post_title = privateRemoteTitle;
  remote.db.wp_posts[deletedRowId].post_content = privateRemoteBody;

  const plan = planFor(base, local, remote);
  const confirmDeterministicPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote));
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === deletedRowKey);
  const rowMutation = mutationFor(plan, deletedRowKey);
  const rowPrecondition = preconditionFor(plan, deletedRowKey);
  const independentMutation = mutationFor(plan, independentFileKey);
  const independentPrecondition = preconditionFor(plan, independentFileKey);
  const planEvidence = hashOnlyPlanEvidence(plan);
  const serializedPlanEvidence = JSON.stringify(planEvidence);
  const durableJournal = failingDurableJournal();
  const remoteBeforeJson = JSON.stringify(remote);
  const remoteBeforeHash = sha256Evidence(remote);
  const applyError = captureError(() => applyPlan(remote, plan, { durableJournal }));
  const refusalEvidence = {
    code: applyError.code,
    detailsHash: sha256Evidence(applyError.details),
    remoteBeforeHash,
    remoteAfterHash: sha256Evidence(remote),
    durableJournalEventTypes: durableJournal.events.map((event) => event.type),
  };
  const redactedPlanEvidence = redactEvidence({
    plan,
    hashOnlyPlanEvidence: planEvidence,
    refusal: refusalEvidence,
  });
  const proof = {
    rpp: 'RPP-0263',
    evidenceSource: 'local-focused-delete-edit-v4',
    rawValuesIncluded: false,
    planEvidenceHash: sha256Evidence(planEvidence),
    conflict: {
      resourceKey: conflict?.resourceKey,
      class: conflict?.class,
      resolutionPolicy: conflict?.resolutionPolicy,
      remoteHash: conflict?.remoteHash ? `sha256:${conflict.remoteHash}` : null,
      localChange: conflict?.change.localChange,
      remoteChange: conflict?.change.remoteChange,
      rowMutationEmitted: Boolean(rowMutation),
      rowPreconditionEmitted: Boolean(rowPrecondition),
    },
    independentMutation: {
      resourceKey: independentMutation?.resourceKey,
      action: independentMutation?.action,
      changeKind: independentMutation?.changeKind,
      remoteBeforeHash: independentMutation?.remoteBeforeHash
        ? `sha256:${independentMutation.remoteBeforeHash}`
        : null,
      preconditionHash: independentPrecondition?.expectedHash
        ? `sha256:${independentPrecondition.expectedHash}`
        : null,
    },
    refusal: refusalEvidence,
  };
  proof.proofHash = sha256Evidence({
    planEvidenceHash: proof.planEvidenceHash,
    conflict: proof.conflict,
    independentMutation: proof.independentMutation,
    refusal: proof.refusal,
  });

  assert.equal(plan.status, 'conflict');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 1,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(planEvidence, hashOnlyPlanEvidence(confirmDeterministicPlan));
  assert.ok(conflict, 'missing local-delete/remote-edit row conflict');
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflict.change.base.state, 'present');
  assert.equal(conflict.change.local.state, 'absent');
  assert.equal(conflict.change.remote.state, 'present');
  assert.match(conflict.baseHash, /^[a-f0-9]{64}$/);
  assert.match(conflict.localHash, /^[a-f0-9]{64}$/);
  assert.match(conflict.remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(conflict.change.remote.hash, conflict.remoteHash);
  assert.equal(rowMutation, undefined, 'delete/edit target row must not be mutated');
  assert.equal(rowPrecondition, undefined, 'delete/edit target row must not receive a live precondition');
  assert.ok(independentMutation, 'independent local file mutation should remain auditable');
  assert.equal(independentMutation.action, 'put');
  assert.equal(independentMutation.resourceKey, independentFileKey);
  assert.ok(independentPrecondition, 'independent mutation should keep a live-remote precondition');
  assert.equal(independentPrecondition.expectedHash, independentMutation.remoteBeforeHash);
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.ok(applyError instanceof PushPlanError);
  assert.equal(applyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(applyError.details, { status: 'conflict' });
  assert.equal(JSON.stringify(remote), remoteBeforeJson);
  assert.equal(refusalEvidence.remoteAfterHash, refusalEvidence.remoteBeforeHash);
  assert.deepEqual(durableJournal.events, []);
  assert.equal(remote.db.wp_posts[deletedRowId].post_title, privateRemoteTitle);
  assert.equal(remote.db.wp_posts[deletedRowId].post_content, privateRemoteBody);
  assert.equal(Object.hasOwn(remote.files, independentFilePath), false);

  assert.deepEqual(findEvidenceRedactionIssues(planEvidence), []);
  assert.deepEqual(findEvidenceRedactionIssues(proof), []);
  assert.deepEqual(findEvidenceRedactionIssues(applyError.details), []);
  assert.equal(
    findEvidenceRedactionIssues({ plan }).length > 0,
    true,
    'full plan with mutation payload should require redaction before serialization as evidence',
  );
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(planEvidence, {
    label: 'RPP-0263 hash-only plan evidence',
  }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(redactedPlanEvidence, {
    label: 'RPP-0263 redacted plan evidence',
  }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0263 proof envelope',
  }));
  assert.match(proof.planEvidenceHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.match(refusalEvidence.detailsHash, sha256EvidencePattern);
  assertSerializedEvidenceOmitsRawValues(planEvidence, rawValues, 'RPP-0263 hash-only plan evidence');
  assertSerializedEvidenceOmitsRawValues(redactedPlanEvidence, rawValues, 'RPP-0263 redacted plan evidence');
  assertSerializedEvidenceOmitsRawValues(proof, rawValues, 'RPP-0263 proof envelope');
  assertSerializedEvidenceOmitsRawValues(applyError.details, rawValues, 'RPP-0263 refusal details');
  for (const rawValue of rawValues) {
    assert.equal(serializedPlanEvidence.includes(rawValue), false, `serialized plan evidence leaked ${rawValue}`);
  }
});
