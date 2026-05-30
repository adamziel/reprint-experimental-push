import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedFocusedNow = new Date('2026-05-30T00:00:00.000Z');
const fixedGeneratedNow = new Date('2026-05-28T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
      'wp-content/themes/theme/style.css': 'body { color: red; }',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Base Site' },
      },
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish', post_type: 'post' },
      },
    },
  };
}

function planFor({ base, local, remote, now }) {
  return createPushPlan({ base, local, remote, now });
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
    claimHash: '6'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
}

function summaryCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, label);
}

function summarizeChange(change) {
  return {
    localChange: change.localChange,
    remoteChange: change.remoteChange,
    base: { state: change.base.state, hash: change.base.hash },
    local: { state: change.local.state, hash: change.local.hash },
    remote: { state: change.remote.state, hash: change.remote.hash },
  };
}

function hashOnlyTargetEvidence(plan, { fileKey, rowKey }) {
  const fileMutation = mutationFor(plan, fileKey);
  const rowDecision = decisionFor(plan, rowKey);
  const filePrecondition = preconditionFor(plan, fileKey);

  return {
    rpp: 'RPP-0261',
    behavior: 'independent local file plus remote row edit variant 4',
    status: plan.status,
    summary: plan.summary,
    fileMutation: fileMutation
      ? {
          id: fileMutation.id,
          resourceKey: fileMutation.resourceKey,
          action: fileMutation.action,
          changeKind: fileMutation.changeKind,
          baseHash: fileMutation.baseHash,
          localHash: fileMutation.localHash,
          remoteBeforeHash: fileMutation.remoteBeforeHash,
          change: summarizeChange(fileMutation.change),
          precondition: filePrecondition
            ? {
                mutationId: filePrecondition.mutationId,
                resourceKey: filePrecondition.resourceKey,
                expectedHash: filePrecondition.expectedHash,
                checkedAgainst: filePrecondition.checkedAgainst,
              }
            : null,
        }
      : null,
    remoteRowDecision: rowDecision
      ? {
          id: rowDecision.id,
          resourceKey: rowDecision.resourceKey,
          decision: rowDecision.decision,
          baseHash: rowDecision.baseHash,
          localHash: rowDecision.localHash || rowDecision.change.local.hash,
          remoteHash: rowDecision.remoteHash,
          change: summarizeChange(rowDecision.change),
        }
      : null,
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
    preconditionKeys: plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
    decisionKeys: plan.decisions.map((decision) => decision.resourceKey).sort(),
  };
}

function assertRedacted(value, forbiddenValues, label) {
  const serialized = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false, `${label} leaked raw value ${forbiddenValue}`);
  }
}

function assertPlanSummary(plan, label) {
  assert.equal(plan.status, 'ready', `${label} plan status`);
  assert.deepEqual(plan.summary, summaryCounts(plan), `${label} summary must match emitted evidence`);
  assert.equal(plan.conflicts.length, 0, `${label} conflicts`);
  assert.equal(plan.blockers.length, 0, `${label} blockers`);
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} must emit exactly one live-remote precondition per mutation`,
  );
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  const preconditionByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for mutation ${precondition.mutationId}`,
    );
    preconditionByMutationId.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition key mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition must be live remote`);
    assert.equal(
      resourceHash(remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${label} mutation ${mutation.resourceKey} remote hash must match dry-run remote`,
    );
    assertSha256(mutation.baseHash, `${label} mutation ${mutation.resourceKey} base hash`);
    assertSha256(mutation.localHash, `${label} mutation ${mutation.resourceKey} local hash`);
    assertSha256(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remote hash`);
  }
}

function assertStaleFileReplayRejected({ label, remote, plan, filePath }) {
  const staleRemote = cloneJson(remote);
  staleRemote.files[filePath] = `stale remote file drift for ${filePath}`;
  const before = digest(staleRemote);

  let error;
  try {
    applyPlan(staleRemote, plan);
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof PushPlanError, `${label} stale replay must throw PushPlanError`);
  assert.equal(error.code, 'PRECONDITION_FAILED', `${label} stale replay code`);
  assert.equal(digest(staleRemote), before, `${label} stale replay mutated the drifted remote`);
}

function generatedIndependentLocalFileRemoteRowTargets(testCase) {
  const fileEntry = Object.entries(testCase.local.files)
    .find(([, value]) => typeof value === 'string' && value.startsWith('independent local '));
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([, row]) => row.post_title?.startsWith('Independent remote '));

  assert.ok(fileEntry, `${testCase.id} missing generated independent local file`);
  assert.ok(rowEntry, `${testCase.id} missing generated independent remote row`);

  return {
    filePath: fileEntry[0],
    fileValue: fileEntry[1],
    rowId: rowEntry[0],
    rowTitle: rowEntry[1].post_title,
  };
}

function assertIndependentLocalFileRemoteRowInvariant({
  label,
  base,
  local,
  remote,
  now,
  filePath,
  rowId,
  expectedFileValue,
  expectedRowTitle,
  expectedSummary,
}) {
  const fileKey = `file:${filePath}`;
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const plan = planFor({ base, local, remote, now });
  const replayPlan = planFor({
    base: cloneJson(base),
    local: cloneJson(local),
    remote: cloneJson(remote),
    now,
  });
  const fileMutation = mutationFor(plan, fileKey);
  const rowDecision = decisionFor(plan, rowKey);
  const filePrecondition = preconditionFor(plan, fileKey);
  const rowPrecondition = preconditionFor(plan, rowKey);
  const targetEvidence = hashOnlyTargetEvidence(plan, { fileKey, rowKey });
  const replayTargetEvidence = hashOnlyTargetEvidence(replayPlan, { fileKey, rowKey });
  const durableEvents = [];
  const applyResult = applyPlan(cloneJson(remote), plan, {
    durableJournal: claimFencedDurableJournal(durableEvents),
  });
  const privateValues = [expectedFileValue, expectedRowTitle];

  assertPlanSummary(plan, label);
  if (expectedSummary) {
    assert.deepEqual(plan.summary, expectedSummary, `${label} exact summary`);
  }
  assert.deepEqual(targetEvidence, replayTargetEvidence, `${label} hash-only evidence must be deterministic`);

  assert.ok(fileMutation, `${label} missing file mutation`);
  assert.equal(fileMutation.resourceKey, fileKey, `${label} file mutation key`);
  assert.equal(fileMutation.action, 'put', `${label} file mutation action`);
  assert.ok(
    ['create', 'update'].includes(fileMutation.change.localChange),
    `${label} file local change must create or update the local file`,
  );
  assert.equal(fileMutation.change.remoteChange, 'unchanged', `${label} file remote change`);
  assert.equal(fileMutation.localHash, resourceHash(local, fileMutation.resource), `${label} file local hash`);
  assert.equal(fileMutation.remoteBeforeHash, resourceHash(remote, fileMutation.resource), `${label} file remote hash`);
  assert.ok(filePrecondition, `${label} missing file precondition`);
  assert.equal(filePrecondition.mutationId, fileMutation.id, `${label} file precondition mutation id`);
  assert.equal(filePrecondition.expectedHash, fileMutation.remoteBeforeHash, `${label} file precondition hash`);
  assert.equal(filePrecondition.checkedAgainst, 'live-remote', `${label} file precondition scope`);

  assert.ok(rowDecision, `${label} missing row decision`);
  assert.equal(rowDecision.resourceKey, rowKey, `${label} row decision key`);
  assert.equal(rowDecision.decision, 'keep-remote', `${label} row decision`);
  assert.equal(rowDecision.change.localChange, 'unchanged', `${label} row local change`);
  assert.equal(rowDecision.change.remoteChange, 'update', `${label} row remote change`);
  assert.equal(rowDecision.change.base.state, 'present', `${label} row base state`);
  assert.equal(rowDecision.change.local.state, 'present', `${label} row local state`);
  assert.equal(rowDecision.change.remote.state, 'present', `${label} row remote state`);
  assert.equal(rowDecision.baseHash, resourceHash(base, rowDecision.resource), `${label} row base hash`);
  assert.equal(rowDecision.change.local.hash, resourceHash(local, rowDecision.resource), `${label} row local hash`);
  assert.equal(rowDecision.remoteHash, resourceHash(remote, rowDecision.resource), `${label} row remote hash`);
  assert.equal(rowDecision.change.local.hash, rowDecision.baseHash, `${label} row must be unchanged locally`);
  assertSha256(rowDecision.baseHash, `${label} row base hash format`);
  assertSha256(rowDecision.remoteHash, `${label} row remote hash format`);
  assert.equal(mutationFor(plan, rowKey), undefined, `${label} row emitted a mutation`);
  assert.equal(rowPrecondition, undefined, `${label} row emitted a precondition`);
  assertEveryMutationHasLiveRemotePrecondition(plan, remote, label);

  assert.equal(applyResult.site.files[filePath], expectedFileValue, `${label} applied local file`);
  assert.equal(applyResult.site.db.wp_posts[rowId].post_title, expectedRowTitle, `${label} preserved remote row`);
  assert.equal(
    resourceHash(applyResult.site, rowDecision.resource),
    resourceHash(remote, rowDecision.resource),
    `${label} changed the unplanned row hash`,
  );
  assert.equal(
    durableEvents.some((event) => event.resourceKey === rowKey),
    false,
    `${label} row should not appear in durable mutation events`,
  );
  assert.deepEqual(
    durableEvents
      .filter((event) => event.resourceKey === fileKey && ['target-planned', 'mutation-observed'].includes(event.type))
      .map((event) => event.type),
    ['target-planned', 'mutation-observed'],
    `${label} file mutation should be planned and observed durably`,
  );
  assertRedacted(targetEvidence, privateValues, `${label} target evidence`);
  assertRedacted(rowDecision, privateValues, `${label} row decision`);
  assertRedacted(durableEvents, privateValues, `${label} durable journal`);
  assertStaleFileReplayRejected({ label, remote, plan, filePath });

  return {
    plan,
    applyResult,
    targetEvidence,
    proofHash: digest(targetEvidence),
  };
}

test('RPP-0261 focused independent local file plus remote row edit preserves row with hash-only evidence, variant 4', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const filePath = 'wp-content/mu-plugins/rpp-0261-local-only.php';
  const privateLocalFile = '<?php /* local-private-rpp0261-v4-file-payload */';
  const privateRemoteTitle = 'remote-private-rpp0261-v4-row-title';

  local.files[filePath] = privateLocalFile;
  remote.db.wp_posts['ID:1'].post_title = privateRemoteTitle;

  const proof = assertIndependentLocalFileRemoteRowInvariant({
    label: 'RPP-0261 focused file/row invariant',
    base,
    local,
    remote,
    now: fixedFocusedNow,
    filePath,
    rowId: 'ID:1',
    expectedFileValue: privateLocalFile,
    expectedRowTitle: privateRemoteTitle,
    expectedSummary: {
      mutations: 1,
      decisions: 1,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
  });

  assert.equal(proof.applyResult.appliedMutations, 1, 'RPP-0261 focused applied mutation count');
  assertSha256(proof.proofHash, 'RPP-0261 focused proof hash');
});

test('RPP-0261 generated independent local file plus remote row edit covers every tier, variant 4', () => {
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-and-remote');
  const proofRows = [];
  const rawGeneratedValues = [];

  assert.deepEqual(
    [...new Set(generatedCases.map((testCase) => testCase.tier))].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'RPP-0261 generated independent local file/remote row fixtures must cover every tier',
  );

  for (const generatedCase of generatedCases) {
    assert.ok(generatedCase.tags.has('independent-merge'), `${generatedCase.id} missing independent merge tag`);
    assert.ok(
      generatedCase.tags.has('independent-file-remote-row'),
      `${generatedCase.id} missing independent file/remote row tag`,
    );

    const validation = validateGeneratedCase(generatedCase);
    assert.equal(validation.status, 'ready', `${generatedCase.id} validation status`);
    assert.equal(validation.applied, true, `${generatedCase.id} validation apply result`);
    assert.equal(validation.unplannedRemotePreserved, true, `${generatedCase.id} remote preservation`);
    assert.equal(validation.staleReplayRejected, true, `${generatedCase.id} stale replay rejected`);
    assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${generatedCase.id} stale code`);
    assert.equal(validation.staleReplayRemoteUnchanged, true, `${generatedCase.id} stale remote state`);

    const { filePath, fileValue, rowId, rowTitle } = generatedIndependentLocalFileRemoteRowTargets(generatedCase);
    rawGeneratedValues.push(fileValue, rowTitle);
    const proof = assertIndependentLocalFileRemoteRowInvariant({
      label: `RPP-0261 generated ${generatedCase.id}`,
      base: generatedCase.base,
      local: generatedCase.local,
      remote: generatedCase.remote,
      now: fixedGeneratedNow,
      filePath,
      rowId,
      expectedFileValue: fileValue,
      expectedRowTitle: rowTitle,
    });

    proofRows.push({
      id: generatedCase.id,
      tier: generatedCase.tier,
      status: validation.status,
      applied: validation.applied,
      staleReplayRejectionCode: validation.staleReplayRejectionCode,
      fileKey: `file:${filePath}`,
      rowKey: `row:["wp_posts","${rowId}"]`,
      fileValueHash: digest(fileValue),
      rowTitleHash: digest(rowTitle),
      proofHash: proof.proofHash,
      mutations: proof.plan.mutations.length,
      decisions: proof.plan.decisions.length,
    });
  }

  const aggregateEvidence = {
    rpp: 'RPP-0261',
    behavior: 'generated independent local file plus remote row edit coverage, variant 4',
    command: 'node --test test/rpp-0261-independent-local-file-remote-row-v4.test.js',
    totalCases: generatedCases.length,
    perTier: Object.fromEntries(
      [...new Set(generatedCases.map((testCase) => testCase.tier))]
        .sort((a, b) => a - b)
        .map((tier) => [tier, generatedCases.filter((testCase) => testCase.tier === tier).length]),
    ),
    statuses: proofRows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {}),
    proofRows,
    evidenceHash: digest(proofRows),
  };

  assert.equal(aggregateEvidence.totalCases, proofRows.length, 'RPP-0261 aggregate case count');
  assert.deepEqual(aggregateEvidence.statuses, { ready: generatedCases.length }, 'RPP-0261 aggregate statuses');
  assertSha256(aggregateEvidence.evidenceHash, 'RPP-0261 aggregate proof hash');
  assertRedacted(aggregateEvidence, rawGeneratedValues, 'RPP-0261 generated aggregate evidence');
});
