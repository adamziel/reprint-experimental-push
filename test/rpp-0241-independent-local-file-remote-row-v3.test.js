import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

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
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(base, local, remote, now = fixedNow) {
  return createPushPlan({ base, local, remote, now });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function durableJournal(events) {
  return {
    claimFenced: true,
    claimHash: '1'.repeat(64),
    appendEvent(type, payload) {
      const record = { sequence: events.length + 1, type, ...payload };
      events.push(record);
      return record;
    },
  };
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

function assertSummaryMatchesPlan(plan, label) {
  assert.deepEqual(plan.summary, plannerSummaryCounts(plan), `${label} summary must match emitted evidence`);
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${label} must emit exactly one live-remote precondition per mutation`,
  );
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${label} status must match conflicts/blockers`,
  );
}

function assertSha256(value, label) {
  assert.match(value, SHA256_HEX_PATTERN, label);
}

function assertEveryMutationHasLiveRemotePrecondition(plan, remote, label) {
  const preconditionsByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionsByMutationId.has(precondition.mutationId),
      false,
      `${label} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionsByMutationId.set(precondition.mutationId, precondition);
  }

  for (const mutation of plan.mutations) {
    const precondition = preconditionsByMutationId.get(mutation.id);
    assert.ok(precondition, `${label} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey, `${label} precondition resourceKey mismatch`);
    assert.deepEqual(precondition.resource, mutation.resource, `${label} precondition resource mismatch`);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash, `${label} precondition hash mismatch`);
    assert.equal(precondition.checkedAgainst, 'live-remote', `${label} precondition was not live remote`);
    assert.equal(
      resourceHash(remote, mutation.resource),
      mutation.remoteBeforeHash,
      `${label} mutation ${mutation.resourceKey} must bind to the dry-run remote hash`,
    );
    assertSha256(mutation.baseHash, `${label} mutation ${mutation.resourceKey} base hash`);
    assertSha256(mutation.localHash, `${label} mutation ${mutation.resourceKey} local hash`);
    assertSha256(mutation.remoteBeforeHash, `${label} mutation ${mutation.resourceKey} remote hash`);
  }
}

function changeHashEvidence(change) {
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
  const filePrecondition = plan.preconditions.find((entry) => entry.resourceKey === fileKey);
  const rowDecision = decisionFor(plan, rowKey);

  return {
    rpp: 'RPP-0241',
    behavior: 'independent local file plus remote row edit variant 3',
    status: plan.status,
    summary: plan.summary,
    targetFile: fileMutation
      ? {
          mutationId: fileMutation.id,
          resourceKey: fileMutation.resourceKey,
          action: fileMutation.action,
          baseHash: fileMutation.baseHash,
          localHash: fileMutation.localHash,
          remoteBeforeHash: fileMutation.remoteBeforeHash,
          changeKind: fileMutation.changeKind,
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
    remoteRow: rowDecision
      ? {
          id: rowDecision.id,
          resourceKey: rowDecision.resourceKey,
          decision: rowDecision.decision,
          baseHash: rowDecision.baseHash,
          localHash: rowDecision.localHash || rowDecision.change.local.hash,
          remoteHash: rowDecision.remoteHash,
          change: changeHashEvidence(rowDecision.change),
        }
      : null,
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
    preconditionKeys: plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
    decisionKeys: plan.decisions.map((decision) => decision.resourceKey).sort(),
  };
}

function assertHashOnlyEvidenceRedacted(evidence, privateValues, label) {
  const serialized = JSON.stringify(evidence);
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `${label} leaked raw private value ${privateValue}`);
  }
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

function assertNoMutationOrPrecondition(plan, resourceKey, label) {
  assert.equal(mutationFor(plan, resourceKey), undefined, `${label} ${resourceKey} emitted a mutation`);
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === resourceKey),
    false,
    `${label} ${resourceKey} emitted a precondition`,
  );
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
  const firstPlan = planFor(base, local, remote, now);
  const replayPlan = planFor(cloneJson(base), cloneJson(local), cloneJson(remote), now);
  const fileMutation = mutationFor(firstPlan, fileKey);
  const rowDecision = decisionFor(firstPlan, rowKey);
  const filePrecondition = firstPlan.preconditions.find((entry) => entry.resourceKey === fileKey);
  const rowPrecondition = firstPlan.preconditions.find((entry) => entry.resourceKey === rowKey);
  const targetEvidence = hashOnlyTargetEvidence(firstPlan, { fileKey, rowKey });
  const replayTargetEvidence = hashOnlyTargetEvidence(replayPlan, { fileKey, rowKey });
  const journalEvents = [];
  const result = applyPlan(cloneJson(remote), firstPlan, { durableJournal: durableJournal(journalEvents) });
  const privateValues = [expectedFileValue, expectedRowTitle];

  assert.equal(firstPlan.status, 'ready', `${label} status`);
  assertSummaryMatchesPlan(firstPlan, label);
  if (expectedSummary) {
    assert.deepEqual(firstPlan.summary, expectedSummary, `${label} summary`);
  }
  assert.deepEqual(targetEvidence, replayTargetEvidence, `${label} hash-only evidence changed on replay`);

  assert.ok(fileMutation, `${label} missing local file mutation`);
  assert.equal(fileMutation.resourceKey, fileKey, `${label} file mutation key`);
  assert.equal(fileMutation.action, 'put', `${label} file mutation action`);
  assert.ok(
    ['create', 'update'].includes(fileMutation.change.localChange),
    `${label} file local change should create or update the local file`,
  );
  assert.equal(fileMutation.change.remoteChange, 'unchanged', `${label} file remote change`);
  assert.ok(filePrecondition, `${label} missing file precondition`);
  assert.equal(filePrecondition.mutationId, fileMutation.id, `${label} file precondition mutation id`);
  assert.equal(filePrecondition.expectedHash, fileMutation.remoteBeforeHash, `${label} file precondition hash`);
  assert.equal(filePrecondition.checkedAgainst, 'live-remote', `${label} file precondition scope`);

  assert.ok(rowDecision, `${label} missing remote row decision`);
  assert.equal(rowDecision.resourceKey, rowKey, `${label} row decision key`);
  assert.equal(rowDecision.decision, 'keep-remote', `${label} row decision`);
  assert.equal(rowDecision.change.localChange, 'unchanged', `${label} row local change`);
  assert.equal(rowDecision.change.remoteChange, 'update', `${label} row remote change`);
  assert.equal(rowDecision.change.base.state, 'present', `${label} row base state`);
  assert.equal(rowDecision.change.local.state, 'present', `${label} row local state`);
  assert.equal(rowDecision.change.remote.state, 'present', `${label} row remote state`);
  assertSha256(rowDecision.baseHash, `${label} row base hash`);
  assertSha256(rowDecision.change.local.hash, `${label} row local hash`);
  assertSha256(rowDecision.remoteHash, `${label} row remote hash`);
  assert.equal(rowDecision.change.base.hash, rowDecision.baseHash, `${label} row base hash mismatch`);
  assert.equal(rowDecision.change.local.hash, rowDecision.baseHash, `${label} row local hash mismatch`);
  assert.equal(rowDecision.change.remote.hash, rowDecision.remoteHash, `${label} row remote hash mismatch`);
  assert.equal(resourceHash(base, rowDecision.resource), rowDecision.baseHash, `${label} row base resource hash`);
  assert.equal(resourceHash(local, rowDecision.resource), rowDecision.baseHash, `${label} row local resource hash`);
  assert.equal(resourceHash(remote, rowDecision.resource), rowDecision.remoteHash, `${label} row remote resource hash`);
  assert.equal(rowPrecondition, undefined, `${label} row precondition should not be emitted`);
  assertNoMutationOrPrecondition(firstPlan, rowKey, label);
  assertEveryMutationHasLiveRemotePrecondition(firstPlan, remote, label);

  assertHashOnlyEvidenceRedacted(targetEvidence, privateValues, `${label} target evidence`);
  assertHashOnlyEvidenceRedacted(rowDecision, privateValues, `${label} row decision`);
  assertHashOnlyEvidenceRedacted(journalEvents, privateValues, `${label} durable journal`);
  assert.equal(
    journalEvents.some((event) => event.resourceKey === rowKey),
    false,
    `${label} row should not appear in planned or observed mutation journal events`,
  );
  assert.deepEqual(
    journalEvents
      .filter((event) => event.resourceKey === fileKey && ['target-planned', 'mutation-observed'].includes(event.type))
      .map((event) => event.type),
    ['target-planned', 'mutation-observed'],
    `${label} file mutation should be planned and observed durably`,
  );

  assert.equal(result.site.files[filePath], expectedFileValue, `${label} applied file value`);
  assert.equal(result.site.db.wp_posts[rowId].post_title, expectedRowTitle, `${label} preserved remote row title`);
  assert.equal(
    resourceHash(result.site, rowDecision.resource),
    resourceHash(remote, rowDecision.resource),
    `${label} changed the unplanned remote row hash`,
  );

  return {
    plan: firstPlan,
    result,
    journalEvents,
    targetEvidence,
    proofHash: digest(targetEvidence),
  };
}

test('RPP-0241 focused independent local file plus remote row edit stays hash-only and unplanned-safe, variant 3', () => {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);
  const privateLocalFile = 'local-private-rpp0241-v3-file-payload';
  const privateRemoteTitle = 'remote-private-rpp0241-v3-row-title';

  local.files['wp-content/themes/theme/style.css'] = privateLocalFile;
  remote.db.wp_posts['ID:1'].post_title = privateRemoteTitle;

  const proof = assertIndependentLocalFileRemoteRowInvariant({
    label: 'RPP-0241 focused file/row invariant',
    base,
    local,
    remote,
    now: fixedNow,
    filePath: 'wp-content/themes/theme/style.css',
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

  assertSha256(proof.proofHash, 'RPP-0241 focused proof hash');
  assert.equal(proof.result.appliedMutations, 1);
});

test('RPP-0241 generated independent local file plus remote row edit covers every tier, variant 3', () => {
  const generatedCases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-and-remote');
  const proofRows = [];
  const rawGeneratedValues = [];

  assert.deepEqual(
    [...new Set(generatedCases.map((testCase) => testCase.tier))].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'RPP-0241 generated independent local file/remote row fixtures must cover every tier',
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
    assert.equal(
      validation.unplannedRemotePreserved,
      true,
      `${generatedCase.id} must preserve unplanned remote rows`,
    );
    assert.equal(validation.staleReplayRejected, true, `${generatedCase.id} stale replay rejection`);
    assert.equal(
      validation.staleReplayRejectionCode,
      'PRECONDITION_FAILED',
      `${generatedCase.id} stale replay rejection code`,
    );
    assert.equal(validation.staleReplayRemoteUnchanged, true, `${generatedCase.id} stale replay remote state`);

    const { filePath, fileValue, rowId, rowTitle } = generatedIndependentLocalFileRemoteRowTargets(generatedCase);
    rawGeneratedValues.push(fileValue, rowTitle);
    const proof = assertIndependentLocalFileRemoteRowInvariant({
      label: `RPP-0241 generated ${generatedCase.id}`,
      base: generatedCase.base,
      local: generatedCase.local,
      remote: generatedCase.remote,
      now: fixedGeneratedHarnessNow,
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
    rpp: 'RPP-0241',
    behavior: 'generated independent local file plus remote row edit coverage, variant 3',
    command: 'node --test test/rpp-0241-independent-local-file-remote-row-v3.test.js',
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

  assert.equal(aggregateEvidence.totalCases, proofRows.length);
  assert.deepEqual(aggregateEvidence.statuses, { ready: generatedCases.length });
  assertSha256(aggregateEvidence.evidenceHash, 'RPP-0241 aggregate proof hash');
  assertHashOnlyEvidenceRedacted(aggregateEvidence, rawGeneratedValues, 'RPP-0241 generated aggregate evidence');
});
