import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  MIN_GENERATED_PUSH_CASES,
  generateDriverDeleteSupportFlagCases,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateDriverDeleteSupportFlagCase,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, getResource, resourceHash, setResource } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';
const atomicDependencyPluginFile = `wp-content/plugins/${atomicDependencyPlugin}/${atomicDependencyPlugin}.php`;
const atomicDependentPluginFile = `wp-content/plugins/${atomicDependentPlugin}/${atomicDependentPlugin}.php`;
const atomicFixtureOptionRowId = 'option_name:reprint_push_atomic_fixture_data';

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

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: 'c'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

const requiredFamilies = [
  'local-file-update',
  'remote-only-post-update',
  'independent-local-and-remote',
  'independent-local-row-remote-file',
  'direct-row-conflict',
  'local-delete',
  'same-independent-content',
  'same-independent-content-target',
  'large-ready-plan-tier',
  'large-ready-plan',
  'large-ready-plan-target',
  'supported-plugin-option',
  'unsupported-plugin-owned-row',
  'plugin-owner-context-drift',
  'file-topology-conflict',
  'directory-descendant-conflict',
  'directory-descendant-ready',
  'same-plan-post-parent-graph',
  'same-plan-post-author-graph',
  'stale-post-author-graph',
  'stale-graph-reference',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'wp-comments-commentmeta-graph-stale',
  'wp-comments-commentmeta-graph',
  'wp-comments-create',
  'wp-commentmeta-create',
  'wp-comments-remote-drift',
  'supported-forms-lab-table',
  'forms-lab-delete-blocked',
  'atomic-plugin-stack-ready',
  'atomic-plugin-missing-dependency',
  'atomic-plugin-install-stack-v1',
  'atomic-plugin-stack-ready-v1',
  'atomic-plugin-stack-missing-dependency-v1',
  'atomic-plugin-install-stack-v2',
  'atomic-plugin-stack-ready-v2',
  'atomic-plugin-stack-missing-dependency-v2',
  'atomic-plugin-install-stack-v3',
  'atomic-plugin-stack-ready-v3',
  'atomic-plugin-stack-missing-dependency-v3',
  'plugin-file-update',
  'plugin-context-metadata-drift',
  'remote-delete-local-unchanged',
  'local-create',
  'delete-edit-conflict',
  'file-create-update-delete-mix-ready',
  'file-create-update-delete-mix-conflict',
  'file-create-update-delete-mix',
  'file-type-swap-ready',
  'file-type-swap-conflict',
  'file-type-swap',
  'type-swap-ready',
  'type-swap-conflict',
  'row-create-update-delete-mix-ready',
  'row-create-update-delete-mix-conflict',
  'row-create-update-delete-mix',
  'row-create',
  'row-update',
  'row-delete',
  'wp-options-scalar-ready',
  'wp-options-scalar-conflict',
  'wp-options-scalar',
  'scalar-option-update',
  'scalar-option-string',
  'scalar-option-number',
  'wp-options-serialized-ready',
  'wp-options-serialized-conflict',
  'wp-options-serialized',
  'wp-options-serialized-change',
  'wp-options-update',
  'serialized-option',
  'serialized-option-update',
  'serialized-option-object',
  'serialized-option-array',
  'wp-posts-create-update-delete-ready',
  'wp-posts-create-update-delete-conflict',
  'wp-posts-create-update-delete',
  'wp-posts-create',
  'wp-posts-update',
  'wp-posts-delete',
  'wp-postmeta-create-update-delete-ready',
  'wp-postmeta-create-update-delete-conflict',
  'wp-postmeta-create-update-delete',
  'wp-postmeta-create',
  'wp-postmeta-update',
  'wp-postmeta-delete',
  'wp-comments-commentmeta-graph-ready',
  'wp-comments-commentmeta-graph-stale',
  'wp-comments-commentmeta-graph',
  'wp-commentmeta-create',
  'wp-comments-remote-drift',
  'commentmeta-comment-graph',
  'wp-terms-termmeta-graph-ready',
  'wp-terms-termmeta-graph-stale',
  'wp-terms-termmeta-graph',
  'wp-termmeta-create',
  'termmeta-term-graph',
  'wp-users-usermeta-graph-ready',
  'wp-users-usermeta-graph-stale',
  'wp-users-usermeta-graph',
  'wp-users-create',
  'wp-usermeta-create',
  'wp-users-remote-drift',
  'usermeta-user-graph',
  'wp-term-taxonomy-graph-ready',
  'wp-term-taxonomy-graph-stale',
  'wp-term-taxonomy-graph',
  'wp-terms-create',
  'wp-term-taxonomy-create',
  'wp-terms-remote-drift',
  'term-taxonomy-term-graph',
  'wp-term-relationships-graph',
  'wp-term-relationships-graph-target',
  'wp-term-relationships-graph-ready',
  'wp-term-relationships-graph-stale',
  'wp-term-relationships-remote-drift',
  'wp-term-relationships-create',
  'term-relationship-object-graph',
  'term-relationship-taxonomy-graph',
  'plugin-owned-option-change-ready',
  'plugin-owned-option-change-conflict',
  'plugin-owned-option-change',
  'plugin-owned-option-update',
  'comment-user-graph-ready',
  'comment-user-graph-stale',
  'comment-user-graph',
  'comment-user',
  'comment-user-ready',
  'comment-user-stale-target',
  'wp-comments-create',
  'wp-users-create',
  'wp-users-remote-drift',
  'expected-blocked',
  'same-plan-user-meta-graph',
  'independent-file-remote-row',
  'independent-row-remote-file',
  'featured-image-attachment-ready',
  'featured-image-attachment-stale',
  'featured-image-attachment',
  'featured-image-graph',
  'featured-image-ready',
  'featured-image-stale-target',
  'attachment-post-create',
  'same-plan-graph',
  'post-author-graph',
  'post-author-ready',
  'post-author-stale',
  'plugin-owned-supported',
  'plugin-owned-unsupported',
  'plugin-owned-custom-table-change',
  'plugin-owned-custom-table-variant1',
  'plugin-owned-custom-table-update',
  'file-topology',
  'directory-descendant',
  'directory-delete-with-remote-descendant',
  'directory-delete-no-remote-descendant',
  'type-change',
  'expected-conflict',
  'atomic-ready',
  'atomic-blocked',
];

test('generated push harness covers 300+ general cases from trivial to highly complex', () => {
  const report = runGeneratedPushHarness();
  const { summary } = report;

  assert.equal(summary.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.ok(summary.totalCases >= MIN_GENERATED_PUSH_CASES);
  assert.equal(Object.keys(summary.tiers).length, 10);
  for (let tier = 0; tier <= 9; tier++) {
    assert.ok(summary.tiers[tier] > 0, `missing tier ${tier}`);
  }

  for (const family of requiredFamilies) {
    assert.ok(summary.featureFamilies[family] > 0, `missing generated family ${family}`);
  }

  assert.ok(summary.statuses.ready > 0, 'expected ready generated cases');
  assert.ok(summary.statuses.conflict > 0, 'expected conflict generated cases');
  assert.ok(summary.statuses.blocked > 0, 'expected blocked generated cases');
  assert.ok(summary.maxResourceCount >= 45, 'high-complexity cases need broad resource surfaces');
  assert.ok(summary.maxMutationCount >= 15, 'high-complexity cases need substantial mutation plans');
  assert.ok(summary.statusByTier.ready[9] > 0, 'tier 9 must include ready/apply cases');
  assert.ok(summary.maxReadyResourceCount >= 45, 'ready cases need high-complexity resource surfaces');
  assert.ok(summary.maxReadyMutationCount >= 15, 'ready cases need substantial mutation plans');
  assert.ok(summary.totalMutations > summary.totalCases, 'harness should exercise more mutations than cases');
  assert.ok(summary.totalConflicts > 0);
  assert.ok(summary.totalBlockers > 0);
  assert.ok(
    summary.statusByFeatureFamily['same-plan-post-author-graph'].ready > 0,
    'post_author same-plan user mapping needs ready generated cases',
  );
  assert.ok(
    summary.statusByFeatureFamily['stale-post-author-graph'].blocked > 0,
    'post_author stale user mapping needs blocked generated cases',
  );
  assert.ok(
    summary.statusByFeatureFamily['post-author-graph'].ready > 0,
    'post_author mapping tag needs ready coverage',
  );
  assert.ok(
    summary.statusByFeatureFamily['post-author-graph'].blocked > 0,
    'post_author mapping tag needs stale/blocked coverage',
  );
  assert.ok(summary.totalDecisions > 0);
});

test('RPP-0221 generated harness preserves independent local files and remote rows', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.independentLocalFileRemoteRow;

  assert.ok(coverage, 'missing independent local file plus remote row target coverage');
  assert.equal(coverage.family, 'independent-local-and-remote');
  assert.equal(coverage.total, report.summary.featureFamilies['independent-local-and-remote']);
  assert.deepEqual(coverage.statuses, { ready: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-and-remote')
    .at(-1);
  assert.ok(generatedCase, 'missing generated independent local/remote case');
  assert.ok(generatedCase.tags.has('independent-merge'));

  const { filePath, fileValue, rowId, rowTitle } = generatedIndependentLocalRemoteTargets(generatedCase);
  const fileKey = `file:${filePath}`;
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const fileMutation = plan.mutations.find((mutation) => mutation.resourceKey === fileKey);
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === fileKey);
  const evidence = JSON.stringify(hashOnlyGeneratedPlanEvidence(plan));

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.ok(fileMutation, `${generatedCase.id} missing local file mutation`);
  assert.equal(fileMutation.action, 'put');
  assert.equal(rowDecision?.decision, 'keep-remote');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(precondition?.expectedHash, fileMutation.remoteBeforeHash);
  assert.equal(evidence.includes(fileValue), false, 'hash-only generated evidence leaked local file value');
  assert.equal(evidence.includes(rowTitle), false, 'hash-only generated evidence leaked remote row value');

  const result = applyPlan(cloneJson(generatedCase.remote), plan);
  assert.equal(result.site.files[filePath], fileValue);
  assert.equal(result.site.db.wp_posts[rowId].post_title, rowTitle);
});

test('RPP-0222 generated harness preserves independent local rows and remote files', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.independentLocalRowRemoteFile;

  assert.ok(coverage, 'missing independent local row plus remote file target coverage');
  assert.equal(coverage.family, 'independent-local-row-remote-file');
  assert.equal(coverage.total, report.summary.featureFamilies['independent-local-row-remote-file']);
  assert.deepEqual(coverage.statuses, { ready: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-row-remote-file')
    .at(-1);
  assert.ok(generatedCase, 'missing generated independent row/file case');
  assert.ok(generatedCase.tags.has('independent-merge'));
  assert.ok(generatedCase.tags.has('independent-row-remote-file'));

  const { rowId, rowTitle, filePath, fileValue } = generatedIndependentRowRemoteFileTargets(generatedCase);
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const fileKey = `file:${filePath}`;
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const rowMutation = plan.mutations.find((mutation) => mutation.resourceKey === rowKey);
  const fileDecision = plan.decisions.find((decision) => decision.resourceKey === fileKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === rowKey);
  const evidence = JSON.stringify(hashOnlyGeneratedPlanEvidence(plan));

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.ok(rowMutation, `${generatedCase.id} missing local row mutation`);
  assert.equal(rowMutation.action, 'put');
  assert.equal(fileDecision?.decision, 'keep-remote');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === fileKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === fileKey), false);
  assert.equal(precondition?.expectedHash, rowMutation.remoteBeforeHash);
  assert.equal(evidence.includes(rowTitle), false, 'hash-only generated evidence leaked local row value');
  assert.equal(evidence.includes(fileValue), false, 'hash-only generated evidence leaked remote file value');

  const result = applyPlan(cloneJson(generatedCase.remote), plan);
  assert.equal(result.site.db.wp_posts[rowId].post_title, rowTitle);
  assert.equal(result.site.files[filePath], fileValue);
});

test('RPP-0223 generated harness refuses local delete versus remote edit cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.localDeleteRemoteEdit;

  assert.ok(coverage, 'missing local delete versus remote edit target coverage');
  assert.equal(coverage.family, 'delete-edit-conflict');
  assert.equal(coverage.total, report.summary.featureFamilies['delete-edit-conflict']);
  assert.deepEqual(coverage.statuses, { conflict: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'delete-edit-conflict')
    .at(-1);
  assert.ok(generatedCase, 'missing generated delete/edit case');
  assert.ok(generatedCase.tags.has('delete-edit'));
  assert.ok(generatedCase.tags.has('expected-conflict'));

  const { rowId, remoteTitle } = generatedDeleteEditTargets(generatedCase);
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === rowKey);
  const evidence = JSON.stringify(hashOnlyGeneratedPlanEvidence(plan));
  const remoteReplay = cloneJson(generatedCase.remote);
  const beforeReplay = JSON.stringify(remoteReplay);
  const error = captureError(() => applyPlan(remoteReplay, plan));

  assert.equal(plan.status, 'conflict');
  assert.equal(validation.status, 'conflict');
  assert.equal(validation.applied, false);
  assert.ok(conflict, `${generatedCase.id} missing row delete/edit conflict`);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(JSON.stringify(conflict).includes(remoteTitle), false);
  assert.equal(evidence.includes(remoteTitle), false, 'hash-only generated evidence leaked remote row value');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remoteReplay), beforeReplay, 'conflict apply mutated generated remote');
});

test('RPP-0118 same independent content target applies without unplanned remote overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.sameIndependentContent;

  assert.ok(coverage, 'missing same independent content target coverage');
  assert.equal(coverage.family, 'same-independent-content');
  assert.equal(coverage.total, report.summary.featureFamilies['same-independent-content']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'target should include ready same independent content cases');
  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });

  const sameCase = generatePushHarnessCases()
    .find((testCase) => testCase.family === 'same-independent-content');

  assert.ok(sameCase, 'missing generated same independent content case');
  assert.ok(sameCase.tags.has('same-independent-content-target'));
  const sameShape = assertSameIndependentContentShape(sameCase);

  const result = validateGeneratedCase(sameCase);
  const plan = createPushPlan({
    base: sameCase.base,
    local: sameCase.local,
    remote: sameCase.remote,
    now: fixedGeneratedHarnessNow,
  });

  assert.equal(result.status, 'ready');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === sameShape.resourceKey),
    false,
    'identical independent edits should not need a mutation for the synchronized row',
  );
  assert.ok(result.decisions >= 1, 'same independent content should record an already-in-sync decision');
  assert.equal(result.applied, true, 'same independent content should apply through the harness');
  assert.equal(result.unplannedRemotePreserved, true, 'same independent content must preserve unplanned remote data');
});

test('RPP-0138 same independent content variant 2 proves ready preservation without unplanned overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.sameIndependentContent;

  assert.ok(coverage, 'missing same independent content target coverage');

  const firstEvidence = generatedSameIndependentContentVariant2Evidence(coverage);
  const replayEvidence = generatedSameIndependentContentVariant2Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0138 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'same-independent-content');
  assert.equal(coverage.total, report.summary.featureFamilies['same-independent-content']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 same independent evidence changed between runs');
  assert.equal(firstEvidence.target, 'sameIndependentContent');
  assert.equal(firstEvidence.family, 'same-independent-content');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.sameResource.decision, 'already-in-sync');
    assert.equal(entry.sameResource.localHash, entry.sameResource.remoteHash);
    assert.equal(entry.sameResource.appliedHash, entry.sameResource.remoteHash);
    assert.notEqual(entry.sameResource.baseHash, entry.sameResource.localHash);
    assert.equal(entry.sameResource.plannedMutation, false);
    assert.equal(entry.sameResource.plannedPrecondition, false);
    assert.match(entry.sameResource.decisionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Shared independent'), false, 'variant 2 evidence leaked shared row title');
});

test('RPP-0119 remote-only preservation rejects stale replay before mutation with hash-only evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.remoteOnlyPreservation;

  assert.ok(coverage, 'missing remote-only preservation target coverage');
  assert.equal(coverage.family, 'remote-only-post-update');
  assert.equal(coverage.total, 9);
  assert.deepEqual(coverage.statuses, { ready: 9 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    report.summary.statusByFeatureFamily['remote-only-post-update'].ready,
    10,
    'remote-only generated family should still include the zero-mutation tier-0 preservation case',
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'remote-only-post-update')
    .at(-1);
  assert.ok(generatedCase, 'missing generated remote-only preservation case');
  assert.ok(generatedCase.tags.has('remote-preserve'));

  const { rowId, remoteTitle } = generatedRemoteOnlyPostUpdateTargets(generatedCase);
  const rowKey = generatedRowResourceKey('wp_posts', rowId);
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const staleMutationIndex = plan.mutations.findIndex((mutation, index) =>
    index > 0 && mutation.action === 'put' && mutation.resource.type === 'file');

  assert.ok(staleMutationIndex > 0, `${generatedCase.id} should have a later file mutation for preflight proof`);
  const staleMutation = plan.mutations[staleMutationIndex];
  const stalePrecondition = plan.preconditions.find((entry) => entry.mutationId === staleMutation.id);
  const plannedFileValue = deserializeResourceValue(staleMutation.value);
  const plannedFilePayload = plannedFileValue.content;
  const stalePrivatePayload = 'stale-private-rpp0119-late-precondition';
  const staleRemote = cloneJson(generatedCase.remote);

  assert.ok(rowDecision, `${generatedCase.id} should record the remote-only row decision`);
  assert.ok(stalePrecondition, `${generatedCase.id} should record the stale mutation precondition`);
  assert.equal(typeof plannedFilePayload, 'string');

  setResource(staleRemote, staleMutation.resource, { type: 'file', content: stalePrivatePayload });
  const staleBeforeHash = digest(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, plan));
  const staleAfterHash = digest(staleRemote);
  const hashOnlyEvidence = {
    target: 'RPP-0119',
    caseId: generatedCase.id,
    family: generatedCase.family,
    status: plan.status,
    summary: plan.summary,
    remoteOnlyDecision: {
      resourceKey: rowDecision.resourceKey,
      decision: rowDecision.decision,
      remoteHash: rowDecision.remoteHash,
      change: rowDecision.change,
    },
    staleReplay: {
      code: staleError.code,
      resourceKey: staleError.details.resourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
      detailsHash: `sha256:${digest(staleError.details)}`,
      remoteBeforeHash: staleBeforeHash,
      remoteAfterHash: staleAfterHash,
    },
    plan: hashOnlyGeneratedPlanEvidence(plan),
  };
  const evidenceJson = JSON.stringify(hashOnlyEvidence);
  const applied = applyPlan(cloneJson(generatedCase.remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.equal(validation.staleReplayRejected, true);
  assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(validation.staleReplayRemoteUnchanged, true);
  assert.ok(plan.mutations.length > 1, `${generatedCase.id} should carry planned local mutations`);
  assert.equal(rowDecision?.decision, 'keep-remote');
  assert.equal(rowDecision.change.localChange, 'unchanged');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(stalePrecondition?.resourceKey, staleMutation.resourceKey);
  assert.equal(stalePrecondition.expectedHash, staleMutation.remoteBeforeHash);
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, staleMutation.resourceKey);
  assert.equal(staleError.details.expectedHash, stalePrecondition.expectedHash);
  assert.match(staleError.details.actualHash, /^[a-f0-9]{64}$/);
  assert.equal(staleAfterHash, staleBeforeHash, 'stale replay mutated remote before refusal');
  assert.match(hashOnlyEvidence.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceJson.includes(remoteTitle), false, 'hash-only evidence leaked remote-only row title');
  assert.equal(evidenceJson.includes(plannedFilePayload), false, 'hash-only evidence leaked local file payload');
  assert.equal(evidenceJson.includes(stalePrivatePayload), false, 'hash-only evidence leaked stale replay payload');
  assert.equal(JSON.stringify(rowDecision).includes(remoteTitle), false, 'decision evidence leaked remote-only row title');
  assert.equal(applied.site.db.wp_posts[rowId].post_title, remoteTitle);
});

function assertSameIndependentContentShape(testCase) {
  const sharedRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, localRow]) => testCase.base.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]
      && localRow.post_title.startsWith('Shared independent ')
      && testCase.remote.db.wp_posts[id].post_title === localRow.post_title
      && testCase.base.db.wp_posts[id].post_title !== localRow.post_title);

  assert.equal(sharedRows.length, 1, `${testCase.id} should include one same independent post update`);
  return {
    rowId: sharedRows[0][0],
    resourceKey: generatedRowResourceKey('wp_posts', sharedRows[0][0]),
  };
}

function generatedSameIndependentContentVariant2Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'same-independent-content'
      || !testCase.tags.has('same-independent-content-target')) {
      continue;
    }

    const evidence = generatedSameIndependentContentCaseEvidence(testCase);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, evidence.status);
    cases.push(evidence);
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 2 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 2 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 2 target recount should match summary total');

  return {
    target: 'sameIndependentContent',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedSameIndependentContentCaseEvidence(testCase) {
  const shape = assertSameIndependentContentShape(testCase);
  const resource = {
    type: 'row',
    table: 'wp_posts',
    id: shape.rowId,
    key: shape.resourceKey,
  };
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const result = validateGeneratedCase(testCase);
  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.resourceKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const baseHash = resourceHash(testCase.base, resource);
  const localHash = resourceHash(testCase.local, resource);
  const remoteHash = resourceHash(testCase.remote, resource);
  const appliedHash = resourceHash(applied.site, resource);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);

  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
  assert.equal(result.applied, true, `${testCase.id} should apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
  assert.ok(decision, `${testCase.id} should record an already-in-sync decision for ${shape.resourceKey}`);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
  assert.equal(localHash, remoteHash, `${testCase.id} local and remote same-content hashes should match`);
  assert.notEqual(baseHash, localHash, `${testCase.id} same-content row should differ from base`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should not overwrite the same-content remote row`);
  assert.equal(plannedMutation, false, `${testCase.id} should not mutate the already-synchronized row`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the already-synchronized row`);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    tags: [...testCase.tags].sort(),
    planSummary: {
      mutations: plan.summary.mutations,
      decisions: plan.summary.decisions,
      conflicts: plan.summary.conflicts,
      blockers: plan.summary.blockers,
    },
    sameResource: {
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      decisionHash: `sha256:${digest(decision)}`,
      plannedMutation,
      plannedPrecondition,
    },
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      plannedMutation,
      plannedPrecondition,
      planSummary: plan.summary,
    })}`,
  };
}

test('RPP-0120 large ready plan tier target exposes deterministic ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.largeReadyPlanTier;

  assert.ok(coverage, 'missing large ready plan tier target coverage');
  assert.equal(coverage.family, 'large-ready-plan-tier');
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-tier']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.equal(report.summary.featureFamilies['large-ready-plan-target'], 10);

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'large-ready-plan-tier');
  assert.equal(cases.length, 10);

  for (const testCase of cases) {
    assert.ok(testCase.tags.has('large-ready-plan-target'));
    assertLargeReadyPlanShape(testCase);

    const result = validateGeneratedCase(testCase);
    assert.equal(result.status, 'ready');
    assert.ok(result.mutations >= 24 + testCase.tier, `${testCase.id} should have a large ready mutation plan`);
    assert.equal(result.decisions, 2, `${testCase.id} should record remote-preservation decisions`);
    assert.equal(result.applied, true, `${testCase.id} should apply through the harness`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} must preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay must fail before mutation`);
  }
});

function assertLargeReadyPlanShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated large ready create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated large ready update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base large ready delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);
  const remotePreserveRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([, row]) => row.post_title.startsWith('Base large ready remote preserve '));
  const fileCreates = Object.keys(testCase.local.files)
    .filter((path) => path.includes('/large-ready-create-') && !testCase.base.files[path]);
  const fileUpdates = Object.entries(testCase.local.files)
    .filter(([path, value]) => path.includes('/large-ready-update-')
      && testCase.base.files[path]
      && String(value).startsWith('generated large ready file update '));
  const fileDeletes = Object.keys(testCase.base.files)
    .filter((path) => path.includes('/large-ready-delete-')
      && !testCase.local.files[path]
      && testCase.remote.files[path]);
  const remotePreserveFiles = Object.keys(testCase.base.files)
    .filter((path) => path.includes('/large-ready-remote-preserve-'));
  const taxonomyRows = Object.keys(testCase.local.db.wp_term_taxonomy)
    .filter((id) => !testCase.base.db.wp_term_taxonomy[id]);
  const commentRows = Object.keys(testCase.local.db.wp_comments)
    .filter((id) => !testCase.base.db.wp_comments[id]);

  assert.ok(createRows.length >= 4, `${testCase.id} should create multiple post rows`);
  assert.ok(updateRows.length >= 4, `${testCase.id} should update multiple post rows`);
  assert.ok(deleteRows.length >= 3, `${testCase.id} should delete multiple post rows`);
  assert.ok(fileCreates.length >= 3, `${testCase.id} should create multiple files`);
  assert.ok(fileUpdates.length >= 3, `${testCase.id} should update multiple files`);
  assert.ok(fileDeletes.length >= 2, `${testCase.id} should delete multiple files`);
  assert.equal(remotePreserveRows.length, 1, `${testCase.id} should include one remote-only row`);
  assert.equal(remotePreserveFiles.length, 1, `${testCase.id} should include one remote-only file`);
  assert.deepEqual(
    testCase.local.db.wp_posts[remotePreserveRows[0][0]],
    testCase.base.db.wp_posts[remotePreserveRows[0][0]],
    `${testCase.id} remote-only row should be unchanged locally`,
  );
  assert.notDeepEqual(
    testCase.remote.db.wp_posts[remotePreserveRows[0][0]],
    testCase.base.db.wp_posts[remotePreserveRows[0][0]],
    `${testCase.id} remote-only row should drift remotely`,
  );
  assert.equal(
    testCase.local.files[remotePreserveFiles[0]],
    testCase.base.files[remotePreserveFiles[0]],
    `${testCase.id} remote-only file should be unchanged locally`,
  );
  assert.notEqual(
    testCase.remote.files[remotePreserveFiles[0]],
    testCase.base.files[remotePreserveFiles[0]],
    `${testCase.id} remote-only file should drift remotely`,
  );
  assert.ok(taxonomyRows.length >= 1, `${testCase.id} should include same-plan taxonomy graph rows`);
  assert.ok(commentRows.length >= 2, `${testCase.id} should include same-plan comment graph rows`);
}

test('RPP-0230 generated planner summary counts match emitted evidence deterministically', () => {
  const firstEvidence = generatedPlannerSummaryEvidence();
  const replayEvidence = generatedPlannerSummaryEvidence();
  const report = runGeneratedPushHarness();
  const aggregate = aggregateGeneratedPlannerEvidence(firstEvidence);
  const reportTotals = reportPlannerSummaryTotals(report.summary);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0230 test/generated-push-harness.test.js',
    caveat: 'Local deterministic Node generated-harness proof; release remains gated separately.',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };

  assert.deepEqual(firstEvidence, replayEvidence, 'generated planner summary evidence changed between runs');
  assert.deepEqual(
    reportComparablePlannerSummaryTotals(aggregate),
    reportTotals,
    'generated report totals diverged from emitted planner evidence',
  );
  assert.equal(aggregate.totalPreconditions, aggregate.totalMutations);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(evidenceEnvelope).includes('confidential'), false);
});

test('RPP-0456 generated driver delete support flag coverage is redacted', () => {
  const cases = generateDriverDeleteSupportFlagCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'delete-supported-applies',
    'delete-unsupported-blocked',
    'forged-delete-support-flag-rejected',
  ]);
  assert.equal(cases.every((testCase) => testCase.tags.has('driver-delete-support-flag')), true);
  assert.equal(cases.every((testCase) => testCase.dataResourceKey.startsWith('row:["wp_options"')), true);

  const results = cases.map(validateDriverDeleteSupportFlagCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'delete-supported-applies': 'applied-delete',
    'delete-unsupported-blocked': 'blocked-unsupported-delete',
    'forged-delete-support-flag-rejected': 'rejected-forged-unsupported-delete',
  });

  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  assert.equal(byVariant['delete-supported-applies'].status, 'ready');
  assert.equal(byVariant['delete-supported-applies'].appliedMutations, 1);
  assert.equal(byVariant['delete-unsupported-blocked'].status, 'blocked');
  assert.equal(byVariant['delete-unsupported-blocked'].mutations, 0);
  assert.equal(byVariant['delete-unsupported-blocked'].remotePreserved, true);
  assert.equal(
    byVariant['forged-delete-support-flag-rejected'].rejectionCode,
    'UNSUPPORTED_PLUGIN_OWNED_RESOURCE',
  );
  for (const result of results) {
    assert.equal(result.evidenceScope, 'local-generated');
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate, 'NO-GO');
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }
});

test('RPP-0233 generated ready fixtures reject forged localHash evidence', () => {
  const selectedFamilies = [
    'file-create-update-delete-mix-ready',
    'row-create-update-delete-mix-ready',
    'wp-posts-create-update-delete-ready',
    'supported-plugin-option',
  ];
  const cases = generatePushHarnessCases();

  for (const family of selectedFamilies) {
    const testCase = cases.find((entry) => entry.family === family);
    assert.ok(testCase, `missing generated ${family} case`);
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });

    assert.equal(plan.status, 'ready', `${family} should be a ready fixture`);
    assert.ok(plan.mutations.length > 0, `${family} should emit at least one mutation`);
    for (const mutation of plan.mutations) {
      assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
      assert.equal(
        mutation.localHash,
        digest(deserializeResourceValue(mutation.value)),
        `${family} mutation ${mutation.resourceKey} localHash must bind to planned value`,
      );
      if (!mutation.wordpressGraphIdentity) {
        assert.equal(
          mutation.localHash,
          resourceHash(testCase.local, mutation.resource),
          `${family} mutation ${mutation.resourceKey} localHash must match local resource snapshot`,
        );
      }
    }

    const target = plan.mutations[0];
    const forged = cloneJson(plan);
    forged.mutations.find((mutation) => mutation.id === target.id).localHash = '0'.repeat(64);
    const remote = cloneJson(testCase.remote);
    const beforeRemoteHash = digest(remote);
    const error = captureError(() => applyPlan(remote, forged));

    assert.ok(error instanceof PushPlanError, `${family} forged localHash should reject`);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(
      error.details.issues.some((issue) => issue.code === 'LOCAL_HASH_MISMATCH'),
      `${family} should report a localHash mismatch`,
    );
    assert.equal(digest(remote), beforeRemoteHash, `${family} forged plan mutated remote before refusal`);

    const serializedEvidence = JSON.stringify({
      family,
      refusal: {
        code: error.code,
        details: error.details,
        detailsHash: `sha256:${digest(error.details)}`,
      },
      mutations: plan.mutations.map((mutation) => ({
        id: mutation.id,
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        plannedValueHash: digest(deserializeResourceValue(mutation.value)),
      })),
    });
    for (const mutation of plan.mutations) {
      assert.equal(
        serializedEvidence.includes(JSON.stringify(mutation.value)),
        false,
        `${family} hash-only evidence leaked mutation payload for ${mutation.resourceKey}`,
      );
    }
  }
});

test('RPP-0237 generated conflict plans reject apply, forged ready status, and stale mutation attempts', () => {
  const firstEvidence = generatedConflictApplyRefusalEvidence();
  const replayEvidence = generatedConflictApplyRefusalEvidence();
  const aggregate = aggregateGeneratedConflictApplyRefusalEvidence(firstEvidence);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0237 test/generated-push-harness.test.js',
    caveat: 'Generated local planner/apply proof only; release remains gated separately.',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated conflict refusal evidence changed between runs');
  assert.ok(aggregate.totalConflictCases > 0, 'generated harness must include conflict cases');
  assert.ok(aggregate.totalPlannedMutations > 0, 'conflict generated cases should include independent planned mutations');
  assert.ok(aggregate.totalStaleAttempts > 0, 'generated proof must exercise stale mutation attempts');
  assert.equal(aggregate.totalAppliedMutations, 0, 'conflict apply refusals must not report applied mutations');
  assert.equal(aggregate.totalMutationJournalEvents, 0, 'conflict refusals must not write mutation journal events');
  assert.equal(
    aggregate.forgedIssueCodes.READY_PLAN_HAS_CONFLICTS,
    aggregate.totalConflictCases,
    'forged ready conflict evidence must fail closed for every generated conflict plan',
  );
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated remote'), false);
  assert.equal(evidenceText.includes('confidential'), false);
  assert.equal(evidenceText.includes('payload'), false);
});

test('RPP-0240 generated atomic group blockers propagate before apply mutation', () => {
  const firstEvidence = generatedAtomicBlockerPropagationEvidence();
  const replayEvidence = generatedAtomicBlockerPropagationEvidence();
  const aggregate = aggregateGeneratedAtomicBlockerPropagationEvidence(firstEvidence);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0240 test/generated-push-harness.test.js',
    caveat: 'Generated local atomic blocker proof only; release remains gated separately.',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated atomic blocker evidence changed between runs');
  assert.ok(aggregate.totalCases > 0, 'generated proof must include atomic blocker cases');
  assert.ok(aggregate.totalBlockedGroups > 0, 'generated proof must include blocked atomic groups');
  assert.ok(aggregate.totalDirectBlockers > 0, 'generated proof must include source blockers');
  assert.equal(
    aggregate.totalPropagatedBlockers,
    aggregate.totalGroupMutations,
    'each grouped mutation should receive an atomic propagation blocker',
  );
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.equal(aggregate.totalMutationJournalEvents, 0);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated dependent'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('payload'), false);
});

test('RPP-0116 atomic plugin install stack variant 1 emits ready and non-ready generated model evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStackV1;
  const firstEvidence = generatedAtomicPluginInstallStackV1Evidence();
  const replayEvidence = generatedAtomicPluginInstallStackV1Evidence();
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0116 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.ok(coverage, 'missing atomic plugin install stack variant 1 target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v1']);
  assert.ok(coverage.statuses.ready > 0, 'variant 1 target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 1 target should include non-ready atomic plugin stack cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 1 generated model evidence changed between runs');
  assert.equal(firstEvidence.target, 'atomicPluginInstallStackV1');
  assert.equal(firstEvidence.totalCases, 2);
  assert.equal(firstEvidence.readyCases, 1);
  assert.equal(firstEvidence.nonReadyCases, 1);

  const readyCase = firstEvidence.cases.find((entry) => entry.status === 'ready');
  const nonReadyCase = firstEvidence.cases.find((entry) => entry.status !== 'ready');

  assert.ok(readyCase, 'variant 1 evidence must include a ready case');
  assert.ok(nonReadyCase, 'variant 1 evidence must include a non-ready case');
  assert.equal(readyCase.atomicGroup.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.atomicGroup.dependencySources[0], 'same-atomic-group');
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    'ready variant 1 case should install dependency plugin metadata inside the same atomic group',
  );
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.atomicGroup.status, 'blocked');
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
    'non-ready variant 1 case should expose missing dependency evidence',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'atomic-group-blocker-propagation'
        && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)),
    'non-ready variant 1 case should propagate the atomic blocker to grouped plugin metadata',
  );
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('generated dependency'), false);
  assert.equal(evidenceText.includes('generated dependent'), false);
});

test('RPP-0136 atomic plugin install stack variant 2 emits ready and non-ready generated model evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStackV2;
  const firstEvidence = generatedAtomicPluginInstallStackV2Evidence();
  const replayEvidence = generatedAtomicPluginInstallStackV2Evidence();
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0136 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.ok(coverage, 'missing atomic plugin install stack variant 2 target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v2']);
  assert.ok(coverage.statuses.ready > 0, 'variant 2 target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 2 target should include non-ready atomic plugin stack cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 generated model evidence changed between runs');
  assert.equal(firstEvidence.target, 'atomicPluginInstallStackV2');
  assert.equal(firstEvidence.totalCases, 2);
  assert.equal(firstEvidence.readyCases, 1);
  assert.equal(firstEvidence.nonReadyCases, 1);

  const variantCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('atomic-plugin-install-stack-v2'));
  assert.equal(variantCases.length, coverage.total);
  assert.ok(
    variantCases.some((testCase) =>
      testCase.family === 'atomic-plugin-stack-ready'
        && testCase.tags.has('atomic-plugin-stack-ready-v2')),
    'variant 2 tag set should include a ready generated case',
  );
  assert.ok(
    variantCases.some((testCase) =>
      testCase.family === 'atomic-plugin-missing-dependency'
        && testCase.tags.has('atomic-plugin-stack-missing-dependency-v2')),
    'variant 2 tag set should include a non-ready generated case',
  );

  const readyCase = firstEvidence.cases.find((entry) => entry.status === 'ready');
  const nonReadyCase = firstEvidence.cases.find((entry) => entry.status !== 'ready');

  assert.ok(readyCase, 'variant 2 evidence must include a ready case');
  assert.ok(nonReadyCase, 'variant 2 evidence must include a non-ready case');
  assert.equal(readyCase.atomicGroup.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.atomicGroup.dependencySources[0], 'same-atomic-group');
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(fileResourceKey(atomicDependencyPluginFile)),
    'ready variant 2 case should install the dependency plugin file inside the atomic group',
  );
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    'ready variant 2 case should install dependency plugin metadata inside the atomic group',
  );
  assert.ok(
    readyCase.atomicGroup.resources.includes(rowResourceKey('wp_options', atomicFixtureOptionRowId)),
    'ready variant 2 case should keep plugin-owned option data inside the atomic group',
  );
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.atomicGroup.status, 'blocked');
  assert.equal(
    nonReadyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    false,
    'non-ready variant 2 case must not synthesize dependency plugin metadata outside the local intent',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
    'non-ready variant 2 case should expose missing dependency evidence',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'atomic-group-blocker-propagation'
        && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)),
    'non-ready variant 2 case should propagate the atomic blocker to grouped plugin metadata',
  );
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('generated dependency'), false);
  assert.equal(evidenceText.includes('generated dependent'), false);
});

test('RPP-0156 atomic plugin install stack target emits ready and non-ready redacted coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStack;

  assert.ok(coverage, 'missing atomic plugin install stack target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v3']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready atomic plugin stack cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.match(`sha256:${digest(coverage)}`, /^sha256:[a-f0-9]{64}$/);

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('atomic-plugin-install-stack-v3'));
  const readyCases = targetCases.filter((testCase) => testCase.family === 'atomic-plugin-stack-ready');
  const missingDependencyCases = targetCases.filter((testCase) => testCase.family === 'atomic-plugin-missing-dependency');

  assert.equal(readyCases.length, 10, 'expected one ready atomic plugin stack case per tier');
  assert.equal(missingDependencyCases.length, 10, 'expected one missing-dependency atomic plugin case per tier');

  for (const testCase of readyCases) {
    const shape = assertAtomicPluginStackShape(testCase, { missingDependency: false });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(testCase);
    const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);
    const groupResourceKeys = new Set(group.resources);
    const groupMutations = plan.mutations.filter((mutation) => mutation.atomicGroupId === group.id);
    const dependencyPluginMutation = groupMutations.find((mutation) =>
      mutation.resourceKey === pluginResourceKey(atomicDependencyPlugin));

    assert.equal(plan.status, 'ready', `${testCase.id} atomic plugin stack should be ready`);
    assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
    assert.equal(result.applied, true, `${testCase.id} ready atomic stack should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} stale replay should reject`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay must fail before mutation`);
    assert.equal(group.status, 'ready');
    assert.equal(group.requireAtomic, true);
    assert.equal(group.blockers.length, 0);
    assert.equal(group.conflicts.length, 0);
    assert.equal(group.dependencyRequirements[0].source, 'same-atomic-group');
    assert.equal(group.dependencyRequirements[0].resourceKey, pluginResourceKey(atomicDependencyPlugin));
    assert.match(group.dependencyRequirements[0].expectedHash, /^[a-f0-9]{64}$/);
    assert.ok(dependencyPluginMutation, `${testCase.id} should plan dependency plugin install in same group`);
    assert.equal(group.dependencyRequirements[0].mutationId, dependencyPluginMutation.id);

    for (const resourceKey of shape.expectedResourceKeys) {
      assert.ok(groupResourceKeys.has(resourceKey), `${testCase.id} missing atomic resource ${resourceKey}`);
      assert.ok(
        groupMutations.some((mutation) => mutation.resourceKey === resourceKey),
        `${testCase.id} missing atomic mutation for ${resourceKey}`,
      );
    }

    const staleRemote = cloneJson(testCase.remote);
    setResource(staleRemote, dependencyPluginMutation.resource, { version: '9.9.9', active: false });
    const beforeHash = digest(staleRemote);
    const error = captureError(() => applyPlan(staleRemote, plan));

    assert.ok(error instanceof PushPlanError, `${testCase.id} stale dependency replay should throw`);
    assert.equal(error.code, 'PRECONDITION_FAILED');
    assert.equal(digest(staleRemote), beforeHash, `${testCase.id} stale replay changed remote before refusal`);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    assert.deepEqual(applied.site.plugins[atomicDependencyPlugin], testCase.local.plugins[atomicDependencyPlugin]);
    assert.deepEqual(applied.site.plugins[atomicDependentPlugin], testCase.local.plugins[atomicDependentPlugin]);
    assert.deepEqual(applied.site.files[atomicDependencyPluginFile], testCase.local.files[atomicDependencyPluginFile]);
    assert.deepEqual(applied.site.files[atomicDependentPluginFile], testCase.local.files[atomicDependentPluginFile]);
    assert.deepEqual(applied.site.db.wp_options[atomicFixtureOptionRowId], shape.optionRow);
    assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape);
  }

  for (const testCase of missingDependencyCases) {
    const shape = assertAtomicPluginStackShape(testCase, { missingDependency: true });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(testCase);
    const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);
    const remoteBefore = cloneJson(testCase.remote);
    const beforeHash = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));

    assert.notEqual(plan.status, 'ready', `${testCase.id} missing dependency stack should be non-ready`);
    assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
    assert.equal(result.applied, false, `${testCase.id} non-ready stack must not apply`);
    assert.equal(group.status, 'blocked');
    assert.equal(group.requireAtomic, true);
    assert.ok(
      group.blockers.some((blocker) =>
        blocker.class === 'missing-plugin-dependency'
          && blocker.plugin === atomicDependencyPlugin),
      `${testCase.id} should block on missing dependency plugin`,
    );
    for (const resourceKey of shape.expectedResourceKeys) {
      assert.ok(
        group.blockers.some((blocker) =>
          blocker.class === 'atomic-group-blocker-propagation'
            && blocker.resourceKey === resourceKey),
        `${testCase.id} should propagate atomic blocker to ${resourceKey}`,
      );
    }
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === pluginResourceKey(atomicDependencyPlugin)),
      false,
      `${testCase.id} must not plan dependency plugin mutation outside the atomic group`,
    );
    assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready atomic stack should refuse apply`);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remoteBefore), beforeHash, `${testCase.id} non-ready apply changed remote`);
    assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape);
  }
});

test('RPP-0101 generated harness emits ready and non-ready file create/update/delete mix cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready file create/update/delete mix case');
  assert.ok(nonReadyCase, 'missing non-ready file create/update/delete mix case');
  assert.ok(readyCase.tags.has('file-create-update-delete-mix'));
  assert.ok(nonReadyCase.tags.has('file-create-update-delete-mix'));

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready mix should create, update, and delete files');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready mix should expose a file conflict');
  assert.equal(nonReady.applied, false, 'non-ready mix must not apply mutations');
});

test('RPP-0121 file create/update/delete mix target emits ready and non-ready variant coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileCreateUpdateDeleteMix;

  assert.ok(coverage, 'missing file create/update/delete mix target coverage');
  assert.equal(coverage.family, 'file-create-update-delete-mix-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['file-create-update-delete-mix']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready file mix cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready file mix cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready file create/update/delete mix case');
  assert.ok(nonReadyCase, 'missing non-ready file create/update/delete mix case');
  assertFileCreateUpdateDeleteMixShape(readyCase);
  assertFileCreateUpdateDeleteMixShape(nonReadyCase);

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready file mix should create, update, and delete files');
  assert.equal(ready.applied, true, 'ready file mix should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready file mix should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready file mix should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready file mix should expose a file conflict');
  assert.equal(nonReady.applied, false, 'non-ready file mix must not apply mutations');
});

test('RPP-0102/RPP-0122 directory descendant target exposes per-tier ready and conflict counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.directoryDescendantConflict;

  assert.ok(coverage, 'missing directory descendant conflict target coverage');
  assert.equal(coverage.family, 'directory-descendant-conflict');
  assert.equal(coverage.total, report.summary.featureFamilies['directory-descendant']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready directory descendant cases');
  assert.ok(coverage.statuses.conflict > 0, 'target should include conflicting directory descendant cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.tags.has('directory-delete-no-remote-descendant'));
  const conflictCase = cases.find((testCase) => testCase.family === 'directory-descendant-conflict');

  assert.ok(readyCase, 'missing generated ready directory descendant target case');
  assert.ok(conflictCase, 'missing generated directory descendant conflict case');
  assert.ok(readyCase.tags.has('directory-descendant'));
  assert.ok(readyCase.tags.has('directory-descendant-ready'));
  assert.ok(readyCase.tags.has('directory-delete-no-remote-descendant'));
  assert.ok(conflictCase.tags.has('directory-descendant'));
  assert.ok(conflictCase.tags.has('directory-delete-with-remote-descendant'));
  assertDirectoryDescendantShape(readyCase, { conflict: false });
  assertDirectoryDescendantShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready directory descendant case should plan the directory delete');
  assert.equal(ready.applied, true, 'ready directory descendant case should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready directory descendant apply should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready directory descendant case should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts > 0, 'directory descendant case must conflict');
  assert.equal(conflict.applied, false, 'directory descendant conflict must not apply mutations');
});

function assertDirectoryDescendantShape(testCase, { conflict }) {
  const marker = conflict ? '/descendant-' : '/descendant-ready-';
  const directories = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(marker) && value?.type === 'directory')
    .map(([path]) => path);

  assert.equal(directories.length, 1, `${testCase.id} should seed one directory descendant target`);

  const [directory] = directories;
  assert.equal(Object.hasOwn(testCase.local.files, directory), false, `${testCase.id} should delete the directory locally`);
  assert.equal(testCase.remote.files[directory]?.type, 'directory', `${testCase.id} should keep the remote directory`);

  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((path) => path.startsWith(`${directory}/`));
  assert.equal(
    remoteDescendants.length > 0,
    conflict,
    `${testCase.id} remote descendant shape should match expected conflict readiness`,
  );

  for (const path of remoteDescendants) {
    assert.equal(Object.hasOwn(testCase.base.files, path), false, `${testCase.id} remote descendant should not exist in base`);
    assert.equal(Object.hasOwn(testCase.local.files, path), false, `${testCase.id} remote descendant should be remote-only`);
  }
}

test('RPP-0103 generated harness emits ready and non-ready file type-swap cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'file-type-swap-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'file-type-swap-conflict');

  assert.ok(readyCase, 'missing ready file type-swap case');
  assert.ok(nonReadyCase, 'missing non-ready file type-swap case');
  assert.ok(readyCase.tags.has('file-type-swap'));
  assert.ok(nonReadyCase.tags.has('file-type-swap'));
  assert.ok(readyCase.tags.has('type-swap-ready'));
  assert.ok(nonReadyCase.tags.has('type-swap-conflict'));

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready type-swap should plan at least one file mutation');
  assert.equal(ready.applied, true, 'ready type-swap should apply through the harness');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready type-swap should expose a file topology conflict');
  assert.equal(nonReady.applied, false, 'non-ready type-swap must not apply mutations');
});

test('RPP-0123 file type-swap target exposes ready preservation and explicit conflicts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileTypeSwap;

  assert.ok(coverage, 'missing file type-swap target coverage');
  assert.equal(coverage.family, 'file-type-swap-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['file-type-swap']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready file type-swap cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready file type-swap cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'file-type-swap-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'file-type-swap-conflict');

  assert.ok(readyCase, 'missing ready file type-swap case');
  assert.ok(conflictCase, 'missing conflict file type-swap case');
  assertFileTypeSwapShape(readyCase, { conflict: false });
  assertFileTypeSwapShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready file type-swap should plan at least one mutation');
  assert.equal(ready.applied, true, 'ready file type-swap should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready file type-swap must preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready file type-swap should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'conflict file type-swap should expose topology conflict');
  assert.equal(conflict.applied, false, 'conflict file type-swap must not apply mutations');
});

test('RPP-0104 generated harness emits row create/update/delete mix with stale replay guard', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready row create/update/delete mix case');
  assert.ok(nonReadyCase, 'missing non-ready row create/update/delete mix case');
  assert.ok(readyCase.tags.has('row-create-update-delete-mix'));
  assert.ok(nonReadyCase.tags.has('row-create-update-delete-mix'));
  assertRowMixShape(readyCase);
  assertRowMixShape(nonReadyCase);

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready row mix should create, update, and delete rows');
  assert.equal(ready.applied, true, 'ready row mix should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready row mix should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready row mix should expose a row conflict');
  assert.equal(nonReady.applied, false, 'non-ready row mix must not apply mutations');
});

test('RPP-0124 row create/update/delete mix target exposes stale replay and conflict coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.rowCreateUpdateDeleteMix;

  assert.ok(coverage, 'missing row create/update/delete mix target coverage');
  assert.equal(coverage.family, 'row-create-update-delete-mix-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['row-create-update-delete-mix']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, {
    0: 2,
    1: 2,
    2: 2,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2,
    8: 2,
    9: 2,
  });

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready row create/update/delete mix case');
  assert.ok(conflictCase, 'missing conflict row create/update/delete mix case');
  assertRowMixShape(readyCase);
  assertRowMixShape(conflictCase);
  assertRowMixConflictShape(conflictCase);

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready row mix should create, update, and delete rows');
  assert.equal(ready.applied, true, 'ready row mix should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready row mix should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready row mix should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'conflict row mix should expose a row conflict');
  assert.equal(conflict.applied, false, 'conflict row mix must not apply mutations');
});

function assertRowMixShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id] && row.post_title.startsWith('Generated row mix create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated row mix update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base row mix delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one row`);
}

function assertRowMixConflictShape(testCase) {
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated row mix update '));

  assert.equal(updateRows.length, 1, `${testCase.id} should update one conflict target row`);

  const [rowId] = updateRows[0];
  assert.match(testCase.remote.db.wp_posts[rowId].post_title, /^Remote concurrent row mix update /);
  assert.notEqual(
    testCase.remote.db.wp_posts[rowId].post_title,
    testCase.base.db.wp_posts[rowId].post_title,
    `${testCase.id} conflict target should drift remotely`,
  );
}

test('RPP-0105 generated harness emits wp_options scalar option ready and conflict cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-conflict');

  assert.ok(readyCase, 'missing ready wp_options scalar option case');
  assert.ok(conflictCase, 'missing conflicting wp_options scalar option case');
  assert.ok(readyCase.tags.has('wp-options-scalar'));
  assert.ok(conflictCase.tags.has('wp-options-scalar'));
  assert.ok(readyCase.tags.has('scalar-option-update'));
  assert.ok(conflictCase.tags.has('scalar-option-update'));
  assertWpOptionsScalarShape(readyCase, { conflict: false });
  assertWpOptionsScalarShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready scalar option should plan an option mutation');
  assert.equal(ready.applied, true, 'ready scalar option should apply through the harness');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote scalar option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting scalar option must not apply mutations');
});

test('RPP-0125 wp_options scalar target exposes per-tier ready and conflict coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsScalarChanges;

  assert.ok(coverage, 'missing wp_options scalar target coverage');
  assert.equal(coverage.family, 'wp-options-scalar-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-scalar']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, {
    0: 2,
    1: 2,
    2: 2,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2,
    8: 2,
    9: 2,
  });

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-conflict');

  assert.ok(readyCase, 'missing ready wp_options scalar option case');
  assert.ok(conflictCase, 'missing conflicting wp_options scalar option case');
  assertWpOptionsScalarShape(readyCase, { conflict: false });
  assertWpOptionsScalarShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready scalar option should plan an option mutation');
  assert.equal(ready.applied, true, 'ready scalar option should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready scalar option should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready scalar option should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote scalar option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting scalar option must not apply mutations');
});

function assertWpOptionsScalarShape(testCase, { conflict }) {
  const scalarRows = Object.entries(testCase.base.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:scalar_generated_')
      && isScalar(row.option_value));

  assert.equal(scalarRows.length, 1, `${testCase.id} should seed one scalar option row`);
  const [rowId, baseRow] = scalarRows[0];
  const localRow = testCase.local.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(localRow, `${testCase.id} missing local scalar option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote scalar option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} scalar option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} scalar option should not be plugin-owned`);
  assert.equal(typeof localRow.option_value, typeof baseRow.option_value);
  assert.ok(isScalar(localRow.option_value), `${testCase.id} local option_value must stay scalar`);
  assert.notEqual(localRow.option_value, baseRow.option_value);
  if (conflict) {
    assert.notEqual(remoteRow.option_value, baseRow.option_value);
    assert.notEqual(remoteRow.option_value, localRow.option_value);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value);
  }
}

function isScalar(value) {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

test('RPP-0106 generated harness emits wp_options serialized option ready and conflict cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-conflict');

  assert.ok(readyCase, 'missing ready wp_options serialized option case');
  assert.ok(conflictCase, 'missing conflicting wp_options serialized option case');
  assert.ok(readyCase.tags.has('wp-options-serialized'));
  assert.ok(conflictCase.tags.has('wp-options-serialized'));
  assert.ok(readyCase.tags.has('serialized-option-update'));
  assert.ok(conflictCase.tags.has('serialized-option-update'));
  assertWpOptionsSerializedShape(readyCase, { conflict: false });
  assertWpOptionsSerializedShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready serialized option should plan an option mutation');
  assert.equal(ready.applied, true, 'ready serialized option should apply through the harness');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote serialized option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting serialized option must not apply mutations');
});

function assertWpOptionsSerializedShape(testCase, { conflict }) {
  const serializedRows = Object.entries(testCase.local.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_serialized_')
      && isSerializedOptionValue(row.option_value));

  assert.equal(serializedRows.length, 1, `${testCase.id} should update one serialized wp_options row`);
  const [rowId, localRow] = serializedRows[0];
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(baseRow, `${testCase.id} missing base serialized option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote serialized option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(localRow.option_name, baseRow.option_name);
  assert.match(baseRow.option_value, /^a:\d+:{/);
  assert.match(localRow.option_value, /^a:\d+:{/);
  assert.ok(isSerializedOptionValue(localRow.option_value), `${testCase.id} local option_value must stay serialized`);
  assert.notEqual(localRow.option_value, baseRow.option_value, `${testCase.id} local option should change`);
  if (conflict) {
    assert.notEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote option should drift`);
    assert.notEqual(remoteRow.option_value, localRow.option_value, `${testCase.id} remote drift should differ from local`);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote option should stay at base`);
  }

  return { rowId, baseRow, localRow, remoteRow };
}

function isSerializedOptionValue(value) {
  return typeof value === 'string'
    && /^a:\d+:{/.test(value)
    && value.includes('private_notes')
    && value.includes('auth_token');
}

test('RPP-0126 wp_options serialized option target emits redacted ready and non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsSerializedChanges;

  assert.ok(coverage, 'missing wp_options serialized option target coverage');
  assert.equal(coverage.family, 'wp-options-serialized-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-serialized-change']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready serialized option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready serialized option cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(JSON.stringify(report).includes('private_notes'), false, 'summary must not expose serialized private keys');
  assert.equal(JSON.stringify(report).includes('local-private-serialized'), false, 'summary must not expose private values');

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-conflict');

  assert.ok(readyCase, 'missing ready wp_options serialized option case');
  assert.ok(nonReadyCase, 'missing non-ready wp_options serialized option case');
  const readyShape = assertWpOptionsSerializedShape(readyCase, { conflict: false });
  const nonReadyShape = assertWpOptionsSerializedShape(nonReadyCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready serialized option should plan at least one row mutation');
  assert.equal(ready.applied, true, 'ready serialized option should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready serialized option should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready serialized option should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(nonReady.status, 'ready', 'non-ready serialized option case should fail closed');
  assert.equal(nonReady.applied, false, 'non-ready serialized option case must not apply mutations');

  assertSerializedOptionEvidenceRedacted(readyCase, readyShape);
  assertSerializedOptionEvidenceRedacted(nonReadyCase, nonReadyShape);
});

function assertSerializedOptionEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((entry) =>
    entry.resourceKey === `row:${JSON.stringify(['wp_options', shape.rowId])}`);

  if (!mutation) {
    assert.notEqual(plan.status, 'ready', `${testCase.id} missing mutation should only happen for non-ready plans`);
    assert.ok(plan.conflicts.length + plan.blockers.length > 0, `${testCase.id} should carry fail-closed evidence`);
    const redactedPlanEvidence = redactEvidence({
      status: plan.status,
      conflicts: plan.conflicts,
      blockers: plan.blockers,
    });
    assertSerializedOptionRawValuesAbsent(testCase, shape, JSON.stringify(redactedPlanEvidence));
    return;
  }

  assert.ok(mutation, `${testCase.id} should include a serialized option mutation`);
  assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
  assert.match(mutation.remoteBeforeHash, /^[a-f0-9]{64}$/);

  const redactedEvidence = redactEvidence({
    mutation: {
      resourceKey: mutation.resourceKey,
      value: mutation.value,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    },
  });
  const redactedJson = JSON.stringify(redactedEvidence);

  assertSerializedOptionRawValuesAbsent(testCase, shape, redactedJson);
  assert.equal(redactedEvidence.mutation.value.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(redactedEvidence.mutation.value.sha256, /^[a-f0-9]{64}$/);
}

function assertSerializedOptionRawValuesAbsent(testCase, shape, redactedJson) {
  for (const row of [shape.baseRow, shape.localRow, shape.remoteRow]) {
    assert.equal(
      redactedJson.includes(row.option_value),
      false,
      `${testCase.id} redacted evidence leaked serialized option payload`,
    );
  }
  assert.equal(redactedJson.includes('private_notes'), false, `${testCase.id} redacted evidence leaked private key`);
  assert.equal(redactedJson.includes('auth_token'), false, `${testCase.id} redacted evidence leaked token key`);
}

test('RPP-0107/RPP-0127 wp_posts create/update/delete target exposes per-tier ready and stale replay coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostsCreateUpdateDelete;

  assert.ok(coverage, 'missing wp_posts create/update/delete target coverage');
  assert.equal(coverage.family, 'wp-posts-create-update-delete-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-posts-create-update-delete']);
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready wp_posts case per tier');
  assert.equal(coverage.statuses.conflict, 10, 'target should include one conflicting wp_posts case per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-posts-create-update-delete-ready');
  const conflictCases = cases.filter((testCase) => testCase.family === 'wp-posts-create-update-delete-conflict');

  assert.equal(readyCases.length, 10, 'missing one ready wp_posts create/update/delete case per tier');
  assert.equal(conflictCases.length, 10, 'missing one conflicting wp_posts create/update/delete case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(conflictCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertWpPostsCreateUpdateDeleteShape(readyCase, { conflict: false });
    const ready = validateGeneratedCase(readyCase);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 3, 'ready wp_posts case should create, update, and delete rows');
    assert.equal(ready.applied, true, 'ready wp_posts case should apply through the harness');
    assert.equal(ready.unplannedRemotePreserved, true, 'ready wp_posts apply should preserve unplanned remote data');
    assert.equal(ready.staleReplayRejected, true, 'ready wp_posts case should reject stale replay');
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  }

  for (const conflictCase of conflictCases) {
    assertWpPostsCreateUpdateDeleteShape(conflictCase, { conflict: true });
    const conflict = validateGeneratedCase(conflictCase);
    assert.equal(conflict.status, 'conflict');
    assert.ok(conflict.conflicts >= 1, 'remote wp_posts drift should be a conflict');
    assert.equal(conflict.applied, false, 'conflicting wp_posts case must not apply mutations');
  }
});

function assertWpPostsCreateUpdateDeleteShape(testCase, { conflict }) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated wp_posts create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated wp_posts update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base wp_posts delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one wp_posts row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one wp_posts row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one wp_posts row`);

  const [updateRowId, localUpdateRow] = updateRows[0];
  const [, deleteBaseRow] = deleteRows[0];
  assert.equal(
    testCase.remote.db.wp_posts[deleteRows[0][0]].post_title,
    deleteBaseRow.post_title,
    `${testCase.id} should not mutate the deleted row remotely before apply`,
  );
  assert.equal(
    testCase.remote.db.wp_posts[`ID:${createRows[0][1].ID}`],
    undefined,
    `${testCase.id} created row should be local-only before apply`,
  );

  if (conflict) {
    assert.notEqual(
      testCase.remote.db.wp_posts[updateRowId].post_title,
      testCase.base.db.wp_posts[updateRowId].post_title,
      `${testCase.id} conflict case should drift the updated post remotely`,
    );
    assert.notEqual(
      testCase.remote.db.wp_posts[updateRowId].post_title,
      localUpdateRow.post_title,
      `${testCase.id} conflict case remote value should differ from local`,
    );
    return;
  }

  assert.deepEqual(
    testCase.remote.db.wp_posts[updateRowId],
    testCase.base.db.wp_posts[updateRowId],
    `${testCase.id} ready case remote updated post should match base before apply`,
  );
}

test('RPP-0108/RPP-0128 wp_postmeta create/update/delete target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostmetaCreateUpdateDelete;

  assert.ok(coverage, 'missing wp_postmeta create/update/delete target coverage');
  assert.equal(coverage.family, 'wp-postmeta-create-update-delete-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-postmeta-create-update-delete']);
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready wp_postmeta case per tier');
  assert.equal(coverage.statuses.conflict, 10, 'target should include one conflicting wp_postmeta case per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-postmeta-create-update-delete-ready');
  const conflictCases = cases.filter((testCase) => testCase.family === 'wp-postmeta-create-update-delete-conflict');

  assert.equal(readyCases.length, 10, 'missing one ready wp_postmeta create/update/delete case per tier');
  assert.equal(conflictCases.length, 10, 'missing one conflicting wp_postmeta create/update/delete case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(conflictCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertWpPostmetaCreateUpdateDeleteShape(readyCase, { conflict: false });
    const ready = validateGeneratedCase(readyCase);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 3, 'ready wp_postmeta case should create, update, and delete rows');
    assert.equal(ready.applied, true, 'ready wp_postmeta case should apply through the harness');
    assert.equal(ready.unplannedRemotePreserved, true, 'ready wp_postmeta apply should preserve unplanned remote data');
    assert.equal(ready.staleReplayRejected, true, 'ready wp_postmeta stale replay should be rejected');
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  }

  for (const conflictCase of conflictCases) {
    assertWpPostmetaCreateUpdateDeleteShape(conflictCase, { conflict: true });
    const conflict = validateGeneratedCase(conflictCase);
    assert.equal(conflict.status, 'conflict');
    assert.ok(conflict.conflicts >= 1, 'remote wp_postmeta drift should be a conflict');
    assert.equal(conflict.applied, false, 'conflicting wp_postmeta case must not apply mutations');
  }
});

function assertWpPostmetaCreateUpdateDeleteShape(testCase, { conflict }) {
  const createRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([id, row]) => !testCase.base.db.wp_postmeta[id]
      && row.meta_value.startsWith('generated wp_postmeta create '));
  const updateRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([id, row]) => testCase.base.db.wp_postmeta[id]
      && row.meta_value.startsWith('generated wp_postmeta update '));
  const deleteRows = Object.entries(testCase.base.db.wp_postmeta)
    .filter(([id, row]) => row.meta_value.startsWith('base postmeta delete ')
      && !testCase.local.db.wp_postmeta[id]
      && testCase.remote.db.wp_postmeta[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one wp_postmeta row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one wp_postmeta row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one wp_postmeta row`);

  const [, createRow] = createRows[0];
  const [updateRowId, localUpdateRow] = updateRows[0];
  const [deleteRowId, deleteBaseRow] = deleteRows[0];
  assert.ok(testCase.base.db.wp_posts[`ID:${createRow.post_id}`], `${testCase.id} should keep the meta parent post in base`);
  assert.equal(
    testCase.remote.db.wp_postmeta[deleteRowId].meta_value,
    deleteBaseRow.meta_value,
    `${testCase.id} should not mutate the deleted meta row remotely before apply`,
  );
  assert.equal(
    testCase.remote.db.wp_postmeta[`meta_id:${createRow.meta_id}`],
    undefined,
    `${testCase.id} created meta row should be local-only before apply`,
  );

  if (conflict) {
    assert.notEqual(
      testCase.remote.db.wp_postmeta[updateRowId].meta_value,
      testCase.base.db.wp_postmeta[updateRowId].meta_value,
      `${testCase.id} conflict case should drift the updated meta row remotely`,
    );
    assert.notEqual(
      testCase.remote.db.wp_postmeta[updateRowId].meta_value,
      localUpdateRow.meta_value,
      `${testCase.id} conflict case remote value should differ from local`,
    );
    return;
  }

  assert.deepEqual(
    testCase.remote.db.wp_postmeta[updateRowId],
    testCase.base.db.wp_postmeta[updateRowId],
    `${testCase.id} ready case remote updated meta row should match base before apply`,
  );
}

test('RPP-0110/RPP-0130 wp_comments/wp_commentmeta graph target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraph;

  assert.ok(coverage, 'missing wp_comments/wp_commentmeta graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph']);
  assert.equal(coverage.total, 20, 'target should include ready and stale cases for every tier');
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready comment/commentmeta graph per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'target should include one stale comment/commentmeta graph per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('generated commentmeta graph '), false);
  assert.equal(summaryEvidence.includes('Remote stale comment graph target'), false);

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');

  assert.equal(readyCases.length, 10, 'missing one ready wp_comments/wp_commentmeta graph case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale wp_comments/wp_commentmeta graph case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertCommentCommentmetaGraphShape(readyCase, { staleTarget: false });
    const ready = validateGeneratedCase(readyCase);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 2, 'ready graph should create comment and commentmeta rows');
    assert.equal(ready.applied, true, 'ready comment/commentmeta graph should apply through the harness');
    assert.equal(ready.unplannedRemotePreserved, true, 'ready graph should preserve unplanned remote data');
    assert.equal(ready.staleReplayRejected, true, 'ready comment/commentmeta graph should reject stale replay');
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  }

  for (const staleCase of staleCases) {
    assertCommentCommentmetaGraphShape(staleCase, { staleTarget: true });
    const stale = validateGeneratedCase(staleCase);
    assert.notEqual(stale.status, 'ready', 'stale graph should not be ready');
    assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
    assert.equal(stale.applied, false, 'stale graph must not apply mutations');
  }
});

function assertCommentCommentmetaGraphShape(testCase, { staleTarget }) {
  const commentRows = Object.entries(testCase.local.db.wp_comments)
    .filter(([id, row]) => !testCase.base.db.wp_comments[id]
      && row.comment_content.startsWith('Generated comment graph target '));
  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta)
    .filter(([id, row]) => !testCase.base.db.wp_commentmeta[id]
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one comment`);
  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one commentmeta row`);

  const [commentmetaRowId, commentmetaRow] = commentmetaRows[0];
  const commentId = staleTarget
    ? commentmetaRow.comment_id
    : commentRows[0][1].comment_ID;
  assert.equal(commentmetaRow.comment_id, commentId);
  assert.equal(testCase.base.db.wp_commentmeta[commentmetaRowId], undefined);
  assert.equal(testCase.remote.db.wp_commentmeta[commentmetaRowId], undefined);

  if (staleTarget) {
    const commentRowId = `comment_ID:${commentId}`;
    assert.ok(testCase.base.db.wp_comments[commentRowId], `${testCase.id} stale target should exist in base`);
    assert.deepEqual(
      testCase.local.db.wp_comments[commentRowId],
      testCase.base.db.wp_comments[commentRowId],
      `${testCase.id} stale target should be unchanged locally`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_comments[commentRowId],
      testCase.base.db.wp_comments[commentRowId],
      `${testCase.id} stale target should drift remotely`,
    );
    return;
  }

  const commentRowId = `comment_ID:${commentId}`;
  assert.equal(testCase.base.db.wp_comments[commentRowId], undefined);
  assert.equal(testCase.remote.db.wp_comments[commentRowId], undefined);
}

test('RPP-0109/RPP-0129 wp_users/wp_usermeta graph target exposes ready, stale, and redacted coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpUsersUsermetaGraph;

  assert.ok(coverage, 'missing wp_users/wp_usermeta graph target coverage');
  assert.equal(coverage.family, 'wp-users-usermeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-users-usermeta-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready user/usermeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready graph cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(JSON.stringify(report).includes('local-private-usermeta-token'), false);
  assert.equal(JSON.stringify(report).includes('generated-private-user-pass'), false);

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-users-usermeta-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'wp-users-usermeta-graph-stale');

  assert.ok(readyCase, 'missing ready wp_users/wp_usermeta graph case');
  assert.ok(staleCase, 'missing stale wp_users/wp_usermeta graph case');
  const readyShape = assertUserUsermetaGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertUserUsermetaGraphShape(staleCase, { staleTarget: true });

  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 2, 'ready graph should create user and usermeta rows');
  assert.equal(ready.applied, true, 'ready user/usermeta graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready user/usermeta graph should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(stale.status, 'ready', 'stale graph should not be ready');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale graph must not apply mutations');

  assertUsermetaGraphEvidenceRedacted(readyCase, readyShape);
  assertUsermetaGraphEvidenceRedacted(staleCase, staleShape);
});

function assertUserUsermetaGraphShape(testCase, { staleTarget }) {
  const userRows = Object.entries(testCase.local.db.wp_users)
    .filter(([id, row]) => !testCase.base.db.wp_users[id]
      && row.display_name.startsWith('Generated graph user ')
      && row.user_pass?.startsWith('generated-private-user-pass-'));
  const usermetaRows = Object.entries(testCase.local.db.wp_usermeta)
    .filter(([id, row]) => !testCase.base.db.wp_usermeta[id]
      && row.meta_key.startsWith('_generated_usermeta_graph_')
      && row.meta_value?.private_token?.startsWith('local-private-usermeta-token-'));

  assert.equal(userRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one user`);
  assert.equal(usermetaRows.length, 1, `${testCase.id} should create one usermeta row`);

  const [metaRowId, usermetaRow] = usermetaRows[0];
  const userId = staleTarget ? usermetaRow.user_id : userRows[0][1].ID;
  const userRowId = `ID:${userId}`;
  assert.equal(usermetaRow.user_id, userId);
  assert.ok(testCase.local.db.wp_users[userRowId], `${testCase.id} should have the user target locally`);
  assert.equal(testCase.local.db.wp_users[userRowId].user_pass.startsWith('generated-private-user-pass-'), true);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_users[userRowId], `${testCase.id} stale target should exist in base`);
    assert.deepEqual(
      testCase.local.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale target should be unchanged locally`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }

  return {
    userRowId,
    metaRowId,
    userRow: testCase.local.db.wp_users[userRowId],
    remoteUserRow: testCase.remote.db.wp_users[userRowId],
    usermetaRow,
  };
}

function assertUsermetaGraphEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const userResourceKey = `row:${JSON.stringify(['wp_users', shape.userRowId])}`;
  const usermetaResourceKey = `row:${JSON.stringify(['wp_usermeta', shape.metaRowId])}`;
  const relatedMutations = plan.mutations.filter((mutation) =>
    mutation.resourceKey === userResourceKey || mutation.resourceKey === usermetaResourceKey);
  const relatedBlockers = plan.blockers.filter((blocker) =>
    blocker.resourceKey === usermetaResourceKey
    || blocker.references?.some((reference) => reference.targetResourceKey === userResourceKey));
  const relatedDecisions = plan.decisions.filter((decision) => decision.resourceKey === userResourceKey);

  for (const mutation of relatedMutations) {
    assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
    assert.match(mutation.remoteBeforeHash, /^[a-f0-9]{64}$/);
  }

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 2, `${testCase.id} should mutate user and usermeta rows`);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have usermeta graph blockers`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: relatedMutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      value: mutation.value,
    })),
    blockers: relatedBlockers,
    decisions: relatedDecisions,
  });
  const redactedJson = JSON.stringify(redacted);

  if (relatedMutations.length > 0) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'mutation values should be redacted in evidence');
    assert.ok(redactedJson.includes('sha256'), 'redacted mutation evidence should keep hashes');
  }
  assertUsermetaGraphRawValuesAbsent(testCase, shape, redactedJson);
}

function assertUsermetaGraphRawValuesAbsent(testCase, shape, redactedJson) {
  const values = [
    shape.userRow.user_pass,
    shape.userRow.user_activation_key,
    shape.remoteUserRow?.user_email,
    shape.remoteUserRow?.display_name,
    shape.remoteUserRow?.user_activation_key,
    shape.usermetaRow.meta_value.private_token,
    shape.usermetaRow.meta_value.private_notes,
    'generated-private-user-pass',
    'local-private-usermeta-token',
    'remote-private-user',
  ].filter(Boolean).map(String);

  for (const value of values) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted evidence should not expose ${value}`,
    );
  }
}


test('RPP-0111/RPP-0131 wp_terms/wp_termmeta graph target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermsTermmetaGraph;

  assert.ok(coverage, 'missing wp_terms/wp_termmeta graph target coverage');
  assert.equal(coverage.family, 'wp-terms-termmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-terms-termmeta-graph']);
  assert.equal(coverage.total, 20, 'target should include ready and stale cases for every tier');
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready terms/termmeta graph per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'target should include one stale terms/termmeta graph case per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-terms-termmeta-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-terms-termmeta-graph-stale');

  assert.equal(readyCases.length, 10, 'missing one ready wp_terms/wp_termmeta graph case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale wp_terms/wp_termmeta graph case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertTermTermmetaGraphShape(readyCase, { staleTarget: false });

    const ready = validateGeneratedCase(readyCase);

    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 2, `${readyCase.id} should create term and termmeta rows`);
    assert.equal(ready.applied, true, `${readyCase.id} should apply through the harness`);
    assert.equal(ready.unplannedRemotePreserved, true, `${readyCase.id} should preserve unplanned remote data`);
    assert.equal(ready.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);
  }

  for (const staleCase of staleCases) {
    assertTermTermmetaGraphShape(staleCase, { staleTarget: true });

    const stale = validateGeneratedCase(staleCase);

    assert.notEqual(stale.status, 'ready', `${staleCase.id} should not be ready`);
    assert.ok(stale.blockers >= 1, `${staleCase.id} should record a graph identity blocker`);
    assert.equal(stale.applied, false, `${staleCase.id} must not apply mutations`);
  }
});

function assertTermTermmetaGraphShape(testCase, { staleTarget }) {
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term graph target '));
  const termmetaRows = Object.entries(testCase.local.db.wp_termmeta)
    .filter(([id, row]) => !testCase.base.db.wp_termmeta[id]
      && row.meta_key.startsWith('_generated_termmeta_graph_'));

  assert.equal(termRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one term`);
  assert.equal(termmetaRows.length, 1, `${testCase.id} should create one termmeta row`);

  const termId = staleTarget
    ? termmetaRows[0][1].term_id
    : termRows[0][1].term_id;
  assert.equal(termmetaRows[0][1].term_id, termId);

  if (staleTarget) {
    const termRowId = `term_id:${termId}`;
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }
}

test('RPP-0112/RPP-0132 wp_term_taxonomy graph target exposes redacted per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermTaxonomyGraph;

  assert.ok(coverage, 'missing wp_term_taxonomy graph target coverage');
  assert.equal(coverage.family, 'wp-term-taxonomy-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-taxonomy-graph']);
  assert.equal(coverage.total, 20, 'target should include ready and stale term-taxonomy graph cases per tier');
  assert.deepEqual(coverage.statuses, { blocked: 4, conflict: 6, ready: 10 });
  assert.equal(nonReadyTargetCount(coverage), 10, 'target should include one stale term-taxonomy graph case per tier');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-term-taxonomy-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-term-taxonomy-graph-stale');

  assert.equal(readyCases.length, 10, 'missing one ready wp_term_taxonomy graph case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale wp_term_taxonomy graph case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    const readyShape = assertTermTaxonomyGraphShape(readyCase, { staleTarget: false });
    const ready = validateGeneratedCase(readyCase);

    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 2, `${readyCase.id} should create term and term_taxonomy rows`);
    assert.equal(ready.applied, true, `${readyCase.id} should apply through the harness`);
    assert.equal(ready.unplannedRemotePreserved, true, `${readyCase.id} should preserve unplanned remote data`);
    assert.equal(ready.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);
    assertTermTaxonomyEvidenceRedacted(readyCase, readyShape);
  }

  for (const staleCase of staleCases) {
    const staleShape = assertTermTaxonomyGraphShape(staleCase, { staleTarget: true });
    const stale = validateGeneratedCase(staleCase);

    assert.notEqual(stale.status, 'ready', `${staleCase.id} should not be ready`);
    assert.ok(stale.blockers >= 1, `${staleCase.id} should record a graph identity blocker`);
    assert.equal(stale.applied, false, `${staleCase.id} must not apply mutations`);
    assertTermTaxonomyEvidenceRedacted(staleCase, staleShape);
  }
});

function assertTermTaxonomyGraphShape(testCase, { staleTarget }) {
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term taxonomy graph target '));
  const termTaxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([id, row]) => !testCase.base.db.wp_term_taxonomy[id]
      && typeof row.description === 'string'
      && row.description.startsWith('generated term taxonomy graph '));

  assert.equal(termRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one term`);
  assert.equal(termTaxonomyRows.length, 1, `${testCase.id} should create one term_taxonomy row`);

  const termId = staleTarget
    ? termTaxonomyRows[0][1].term_id
    : termRows[0][1].term_id;
  assert.equal(termTaxonomyRows[0][1].term_id, termId);

  if (staleTarget) {
    const termRowId = `term_id:${termId}`;
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }

  const termRowId = `term_id:${termId}`;
  const taxonomyRowId = termTaxonomyRows[0][0];
  return {
    termRowId,
    taxonomyRowId,
    termRow: testCase.local.db.wp_terms[termRowId],
    remoteTermRow: testCase.remote.db.wp_terms[termRowId],
    taxonomyRow: termTaxonomyRows[0][1],
  };
}

function assertTermTaxonomyEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const termResourceKey = `row:${JSON.stringify(['wp_terms', shape.termRowId])}`;
  const taxonomyResourceKey = `row:${JSON.stringify(['wp_term_taxonomy', shape.taxonomyRowId])}`;
  const relatedMutations = plan.mutations.filter((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === taxonomyResourceKey);
  const relatedBlockers = plan.blockers.filter((blocker) =>
    blocker.resourceKey === taxonomyResourceKey
    || blocker.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const relatedDecisions = plan.decisions.filter((decision) => decision.resourceKey === termResourceKey);

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 2, `${testCase.id} should mutate term and term_taxonomy rows`);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have term_taxonomy graph blockers`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: relatedMutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      value: mutation.value,
    })),
    blockers: relatedBlockers,
    decisions: relatedDecisions,
  });
  const redactedJson = JSON.stringify(redacted);

  if (relatedMutations.length > 0) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'mutation values should be redacted in evidence');
    assert.ok(redactedJson.includes('sha256'), 'redacted mutation evidence should keep hashes');
  }
  assertTermTaxonomyRawValuesAbsent(testCase, shape, redactedJson);
}

function assertTermTaxonomyRawValuesAbsent(testCase, shape, redactedJson) {
  const values = [
    shape.termRow?.name,
    shape.termRow?.slug,
    shape.remoteTermRow?.name,
    shape.remoteTermRow?.slug,
    shape.taxonomyRow.description,
  ].filter(Boolean).map(String);

  for (const value of values) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted evidence should not expose ${value}`,
    );
  }
}

test('RPP-0113/RPP-0133 wp_term_relationships graph target exposes redacted ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermRelationshipsGraph;

  assert.ok(coverage, 'missing wp_term_relationships graph target coverage');
  assert.equal(coverage.family, 'wp-term-relationships-graph');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-relationships-graph-target']);
  assert.equal(coverage.total, 10, 'target should include one relationship graph case per tier');
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph'], 10);
  assert.deepEqual(coverage.statuses, { blocked: 5, ready: 5 });
  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('Generated wp_term_relationships'), false);
  assert.equal(summaryEvidence.includes('Remote stale wp_term_relationships'), false);

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('wp-term-relationships-graph-target'));
  const readyCases = cases.filter((testCase) => testCase.tags.has('wp-term-relationships-graph-ready'));
  const staleCases = cases.filter((testCase) => testCase.tags.has('wp-term-relationships-graph-stale'));

  assert.equal(cases.length, 10, 'one wp_term_relationships graph target should appear per tier');
  assert.equal(readyCases.length, 5, 'even tiers should produce ready relationship graph targets');
  assert.equal(staleCases.length, 5, 'odd tiers should produce stale relationship graph targets');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 2, 4, 6, 8]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [1, 3, 5, 7, 9]);

  for (const readyCase of readyCases) {
    const readyShape = assertTermRelationshipsGraphShape(readyCase, { staleTarget: false });
    const ready = validateGeneratedCase(readyCase);

    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 4, 'ready graph should include the existing option plus graph row mutations');
    assert.equal(ready.applied, true, `${readyCase.id} should apply through the harness`);
    assert.equal(ready.unplannedRemotePreserved, true, `${readyCase.id} should preserve unplanned remote data`);
    assert.equal(ready.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);
    assertTermRelationshipsEvidenceRedacted(readyCase, readyShape);
  }

  for (const staleCase of staleCases) {
    const staleShape = assertTermRelationshipsGraphShape(staleCase, { staleTarget: true });
    const stale = validateGeneratedCase(staleCase);

    assert.equal(stale.status, 'blocked', `${staleCase.id} should be blocked by stale graph identity`);
    assert.ok(stale.blockers >= 1, `${staleCase.id} should record a graph identity blocker`);
    assert.equal(stale.applied, false, `${staleCase.id} must not apply mutations`);
    assertTermRelationshipsEvidenceRedacted(staleCase, staleShape);
  }
});

function assertTermRelationshipsGraphShape(testCase, { staleTarget }) {
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([, row]) => typeof row.name === 'string'
      && row.name.startsWith('Generated wp_term_relationships term target '));
  const taxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([, row]) => typeof row.description === 'string'
      && row.description.startsWith('Generated wp_term_relationships taxonomy target '));

  assert.equal(termRows.length, 1, `${testCase.id} should carry one relationship target term`);
  assert.equal(taxonomyRows.length, 1, `${testCase.id} should carry one relationship target taxonomy`);

  const [termRowId, term] = termRows[0];
  const [taxonomyRowId, taxonomy] = taxonomyRows[0];
  const relationshipRowId = `object_id:1|term_taxonomy_id:${taxonomy.term_taxonomy_id}`;
  const relationship = testCase.local.db.wp_term_relationships[relationshipRowId];

  assert.ok(relationship, `${testCase.id} should create one relationship for the target taxonomy`);
  assert.ok(testCase.base.db.wp_posts[`ID:${relationship.object_id}`], `${testCase.id} relationship post should exist`);
  assert.equal(taxonomy.term_id, term.term_id, `${testCase.id} taxonomy should reference the target term`);
  assert.equal(
    relationship.term_taxonomy_id,
    taxonomy.term_taxonomy_id,
    `${testCase.id} relationship should reference the target taxonomy`,
  );
  assert.equal(relationship.term_order, 0);
  assert.equal(testCase.base.db.wp_term_relationships[relationshipRowId], undefined);
  assert.equal(testCase.remote.db.wp_term_relationships[relationshipRowId], undefined);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale term target should exist in base`);
    assert.ok(
      testCase.base.db.wp_term_taxonomy[taxonomyRowId],
      `${testCase.id} stale taxonomy target should exist in base`,
    );
    assert.deepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale term target should not drift`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_term_taxonomy[taxonomyRowId],
      testCase.base.db.wp_term_taxonomy[taxonomyRowId],
      `${testCase.id} stale taxonomy target should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.remote.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.base.db.wp_term_taxonomy[taxonomyRowId], undefined);
    assert.equal(testCase.remote.db.wp_term_taxonomy[taxonomyRowId], undefined);
  }

  return {
    termRowId,
    taxonomyRowId,
    relationshipRowId,
    termRow: term,
    taxonomyRow: taxonomy,
    remoteTaxonomyRow: testCase.remote.db.wp_term_taxonomy[taxonomyRowId],
  };
}

function assertTermRelationshipsEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const termResourceKey = generatedRowResourceKey('wp_terms', shape.termRowId);
  const taxonomyResourceKey = generatedRowResourceKey('wp_term_taxonomy', shape.taxonomyRowId);
  const relationshipResourceKey = generatedRowResourceKey('wp_term_relationships', shape.relationshipRowId);
  const graphResourceKeys = new Set([termResourceKey, taxonomyResourceKey, relationshipResourceKey]);
  const relatedMutations = plan.mutations.filter((mutation) => graphResourceKeys.has(mutation.resourceKey));
  const relatedBlockers = plan.blockers.filter((blocker) =>
    graphResourceKeys.has(blocker.resourceKey)
    || blocker.references?.some((reference) => graphResourceKeys.has(reference.targetResourceKey)));

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 3, `${testCase.id} should mutate term, taxonomy, and relationship rows`);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have relationship graph blockers`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: relatedMutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      value: mutation.value,
    })),
    blockers: relatedBlockers,
  });
  const redactedJson = JSON.stringify(redacted);

  if (relatedMutations.length > 0) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'mutation values should be redacted in evidence');
    assert.ok(redactedJson.includes('sha256'), 'redacted relationship evidence should keep hashes');
  }

  const values = [
    shape.termRow?.name,
    shape.termRow?.slug,
    shape.taxonomyRow?.description,
    shape.remoteTaxonomyRow?.description,
  ].filter(Boolean).map(String);

  for (const value of values) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted evidence should not expose ${value}`,
    );
  }
}


test('RPP-0117 stale remote after dry-run target exposes per-tier ready replay rejection counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.staleRemoteAfterDryRun;

  assert.ok(coverage, 'missing stale remote after dry-run target coverage');
  assert.equal(coverage.family, 'ready-plan-stale-remote-after-dry-run');
  assert.equal(coverage.total, 354);
  assert.deepEqual(coverage.statuses, { ready: coverage.total });
  assert.deepEqual(coverage.perTier, {
    0: 35,
    1: 35,
    2: 36,
    3: 35,
    4: 36,
    5: 35,
    6: 36,
    7: 35,
    8: 36,
    9: 35,
  });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.ok(coverage.total < report.summary.statuses.ready, 'zero-mutation ready cases should not count');

  const readyCase = generatePushHarnessCases()
    .find((testCase) => {
      const result = validateGeneratedCase(testCase);
      return result.status === 'ready' && result.staleReplayRejected === true;
    });

  assert.ok(readyCase, 'missing ready case with stale remote replay rejection');
  const result = validateGeneratedCase(readyCase);

  assert.equal(result.status, 'ready');
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);
});

test('RPP-0137 stale remote after dry-run variant 2 proves hash-only per-tier replay refusals', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.staleRemoteAfterDryRun;

  assert.ok(coverage, 'missing stale remote after dry-run target coverage');

  const firstEvidence = generatedStaleRemoteAfterDryRunVariant2Evidence(coverage);
  const replayEvidence = generatedStaleRemoteAfterDryRunVariant2Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0137 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'ready-plan-stale-remote-after-dry-run');
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 stale replay evidence changed between runs');
  assert.equal(firstEvidence.target, 'staleRemoteAfterDryRun');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(firstEvidence.selectedCases.length, 10, 'variant 2 evidence should select one stale replay case per tier');
  assert.equal(
    Object.values(firstEvidence.perTier).reduce((sum, count) => sum + count, 0),
    firstEvidence.totalCases,
  );

  for (const entry of firstEvidence.selectedCases) {
    assert.equal(entry.status, 'ready', `${entry.id} should be a ready stale replay target`);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('stale-private-rpp0137'), false, 'variant 2 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('local-private'), false, 'variant 2 evidence leaked generated local payload');
  assert.equal(evidenceText.includes('remote-private'), false, 'variant 2 evidence leaked generated remote payload');
});


test('RPP-0114/RPP-0134 plugin-owned option target exposes ready, conflict, and redacted coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedOptionChange;

  assert.ok(coverage, 'missing plugin-owned option target coverage');
  assert.equal(coverage.family, 'plugin-owned-option-change-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-option-change']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready plugin-owned option cases');
  assert.ok(coverage.statuses.conflict > 0, 'target should include conflicting plugin-owned option cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(JSON.stringify(report).includes('private_plugin_owned_option'), false);
  assert.equal(JSON.stringify(report).includes('private-plugin-owned-option'), false);

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'plugin-owned-option-change-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'plugin-owned-option-change-conflict');

  assert.ok(readyCase, 'missing ready plugin-owned option case');
  assert.ok(conflictCase, 'missing conflicting plugin-owned option case');
  const readyShape = assertPluginOwnedOptionShape(readyCase, { conflict: false });
  const conflictShape = assertPluginOwnedOptionShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready plugin-owned option should plan a mutation');
  assert.equal(ready.applied, true, 'ready plugin-owned option should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready plugin-owned option should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready plugin-owned option should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote plugin-owned option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting plugin-owned option must not apply mutations');

  assertPluginOwnedOptionEvidenceRedacted(readyCase, readyShape);
  assertPluginOwnedOptionEvidenceRedacted(conflictCase, conflictShape);
});

function assertPluginOwnedOptionShape(testCase, { conflict }) {
  const optionRows = Object.entries(testCase.local.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_plugin_owned_option_')
      && row.__pluginOwner === 'forms');

  assert.equal(optionRows.length, 1, `${testCase.id} should include one generated plugin-owned option`);
  const [rowId, row] = optionRows[0];
  const resourceKey = `row:["wp_options","${rowId}"]`;
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(baseRow, `${testCase.id} should have a base plugin-owned option row`);
  assert.ok(remoteRow, `${testCase.id} should have a remote plugin-owned option row`);
  assert.notDeepEqual(row.option_value, baseRow.option_value, `${testCase.id} should update option_value locally`);
  assert.match(baseRow.option_value.private_token, /^base-private-plugin-owned-option-token-/);
  assert.match(baseRow.option_value.private_notes, /^base-private-plugin-owned-option-notes-/);
  assert.match(row.option_value.private_token, /^local-private-plugin-owned-option-token-/);
  assert.match(row.option_value.private_notes, /^local-private-plugin-owned-option-notes-/);
  if (conflict) {
    assert.notDeepEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} should drift remotely`);
    assert.match(remoteRow.option_value.private_token, /^remote-private-plugin-owned-option-token-/);
    assert.match(remoteRow.option_value.private_notes, /^remote-private-plugin-owned-option-notes-/);
    return { rowId, baseRow, localRow: row, remoteRow, resourceKey };
  }

  assert.deepEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote should match base`);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((candidate) => candidate.resourceKey === resourceKey);
  assert.ok(mutation, `${testCase.id} should plan the plugin-owned option mutation`);
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  return { rowId, baseRow, localRow: row, remoteRow, resourceKey };
}

function assertPluginOwnedOptionEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((candidate) => candidate.resourceKey === shape.resourceKey);
  const relatedConflicts = plan.conflicts.filter((conflict) => conflict.resourceKey === shape.resourceKey);

  if (plan.status === 'ready') {
    assert.ok(mutation, `${testCase.id} should include plugin-owned option mutation`);
    assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
    assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
    assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
    assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
    assert.match(mutation.remoteBeforeHash, /^[a-f0-9]{64}$/);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedConflicts.length >= 1, `${testCase.id} should carry plugin-owned option conflict evidence`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: mutation ? [{
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      pluginOwnedResource: mutation.pluginOwnedResource,
      value: mutation.value,
    }] : [],
    conflicts: relatedConflicts,
  });
  const redactedJson = JSON.stringify(redacted);

  if (mutation) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'plugin-owned option values should be redacted');
    assert.ok(redactedJson.includes('sha256'), 'redacted plugin-owned option evidence should keep hashes');
  }
  assertPluginOwnedOptionRawValuesAbsent(testCase, shape, redactedJson);
}

function assertPluginOwnedOptionRawValuesAbsent(testCase, shape, redactedJson) {
  const privateValues = [
    shape.baseRow.option_value.private_token,
    shape.baseRow.option_value.private_notes,
    shape.localRow.option_value.private_token,
    shape.localRow.option_value.private_notes,
    shape.remoteRow.option_value.private_token,
    shape.remoteRow.option_value.private_notes,
    'base-private-plugin-owned-option-token',
    'local-private-plugin-owned-option-token',
    'remote-private-plugin-owned-option-token',
    'private-plugin-owned-option-notes',
  ].filter(Boolean).map(String);

  for (const value of privateValues) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted plugin-owned option evidence leaked ${value}`,
    );
  }
}

test('RPP-0115 plugin-owned custom-table variant 1 records generated model evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedCustomTableVariant1;

  assert.ok(coverage, 'missing plugin-owned custom-table variant 1 target coverage');
  assert.equal(coverage.family, 'plugin-owned-custom-table-variant1');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-custom-table-variant1']);
  assert.ok(coverage.statuses.ready > 0, 'variant 1 should include ready custom-table cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 1 should include non-ready custom-table cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('plugin-owned-custom-table-variant1'));

  assert.equal(cases.length, coverage.total);
  const evidence = cases.map(assertPluginOwnedCustomTableVariant1ModelEvidence);
  const proof = {
    rpp: 'RPP-0115',
    evidenceSource: 'generated-push-harness-model',
    surface: 'plugin-owned-custom-table-variant1',
    format: 'hash-only',
    rawValuesIncluded: false,
    cases: evidence,
    proofHash: digest(evidence),
  };
  const proofJson = JSON.stringify(proof);

  assert.ok(evidence.some((entry) => entry.status === 'ready'), 'variant 1 evidence should include a ready case');
  assert.ok(evidence.some((entry) => entry.status !== 'ready'), 'variant 1 evidence should include a refusal case');
  assert.equal(proofJson.includes('rpp0135-private'), false);
  assert.equal(proofJson.includes('privateToken'), false);
});

function assertPluginOwnedCustomTableVariant1ModelEvidence(testCase) {
  const shape = pluginOwnedCustomTableVariant1Shape(testCase);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const result = validateGeneratedCase(testCase);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const refusal = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey)
    || plan.blockers.find((entry) => entry.resourceKey === shape.resourceKey);

  assert.equal(testCase.family, 'plugin-owned-custom-table-changes');
  assert.ok(testCase.tags.has('plugin-owned-custom-table-update'));
  assert.equal(shape.policy.pluginOwner, 'forms');
  assert.equal(shape.policy.driver, 'fixture-forms-lab-table');
  assert.equal(shape.policy.table, 'wp_reprint_push_forms_lab');
  assert.equal(shape.policy.supportsDelete === true, false);

  if (result.status === 'ready') {
    assert.ok(mutation, `${testCase.id} should plan the variant 1 custom-table mutation`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
    assert.equal(mutation.pluginOwnedResource?.driver, 'fixture-forms-lab-table');
    assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
    assert.equal(mutation.pluginOwnedResource?.auditEvidence?.format, 'hash-only');
    assert.equal(mutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
  } else {
    assert.equal(mutation, undefined, `${testCase.id} should refuse the stale variant 1 row before mutation`);
    assert.ok(refusal, `${testCase.id} should expose conflict/blocker evidence for the stale variant 1 row`);
    assert.equal(result.applied, false);
    assert.equal(result.nonReadyRemoteUnchanged, true);
  }

  const modelEvidence = {
    caseId: testCase.id,
    tier: testCase.tier,
    status: result.status,
    table: 'wp_reprint_push_forms_lab',
    rowId: shape.rowId,
    resourceKey: shape.resourceKey,
    owner: 'forms',
    driver: 'fixture-forms-lab-table',
    supportsDelete: false,
    baseRowHash: digest(shape.baseRow),
    localRowHash: digest(shape.localRow),
    remoteRowHash: digest(shape.remoteRow),
    planStatus: plan.status,
    mutationHash: mutation ? digest({
      action: mutation.action,
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      pluginOwner: mutation.pluginOwnedResource?.pluginOwner,
      driver: mutation.pluginOwnedResource?.driver,
      supportsDelete: mutation.pluginOwnedResource?.supportsDelete,
      auditEvidenceHash: digest(mutation.pluginOwnedResource?.auditEvidence),
      driverEvidenceHash: digest(mutation.pluginOwnedResource?.driverEvidence),
    }) : null,
    refusalHash: refusal ? digest(refusal) : null,
  };
  const modelEvidenceJson = JSON.stringify(modelEvidence);

  for (const rawValue of shape.privateValues) {
    assert.equal(
      modelEvidenceJson.includes(rawValue),
      false,
      `${testCase.id} variant 1 model evidence leaked raw custom-table value ${rawValue}`,
    );
  }

  return modelEvidence;
}

function pluginOwnedCustomTableVariant1Shape(testCase) {
  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([, row]) => row.payload?.generatedHarnessVariant === 'rpp-0115-variant1');

  assert.equal(rows.length, 1, `${testCase.id} should carry one RPP-0115 custom-table model row`);
  const [rowId, localRow] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];
  const resourceKey = generatedRowResourceKey('wp_reprint_push_forms_lab', rowId);
  const policy = testCase.local.meta.pluginOwnedResources.allowedResources
    .find((entry) => entry.resourceKey === resourceKey);

  assert.ok(baseRow, `${testCase.id} should seed the variant 1 row in the base model`);
  assert.ok(remoteRow, `${testCase.id} should seed the variant 1 row in the remote model`);
  assert.ok(policy, `${testCase.id} should allowlist the exact variant 1 row`);
  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use a deterministic positive id row`);
  assert.equal(localRow.__pluginOwner, 'forms');
  assert.equal(baseRow.__pluginOwner, 'forms');
  assert.equal(remoteRow.__pluginOwner, 'forms');
  assert.equal(localRow.payload.owner, 'forms');
  assert.equal(baseRow.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  assert.equal(localRow.payload.generatedHarnessVariant, 'rpp-0115-variant1');
  assert.equal(baseRow.payload.generatedHarnessVariant, 'rpp-0115-variant1');
  assert.equal(remoteRow.payload.generatedHarnessVariant, 'rpp-0115-variant1');
  assert.equal(localRow.payload.mode, 'local');
  assert.equal(baseRow.payload.mode, 'base');
  assert.ok(
    remoteRow.payload.mode === 'base' || remoteRow.payload.mode === 'remote-stale',
    `${testCase.id} should model either an unchanged or stale remote custom-table row`,
  );

  return {
    rowId,
    resourceKey,
    baseRow,
    localRow,
    remoteRow,
    policy,
    privateValues: [
      baseRow.payload.privateToken,
      localRow.payload.privateToken,
      remoteRow.payload.privateToken,
    ].filter(Boolean),
  };
}

test('RPP-0135 plugin-owned custom-table target records ready and non-ready invariants', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedCustomTableChanges;

  assert.ok(coverage, 'missing plugin-owned custom-table target coverage');
  assert.equal(coverage.family, 'plugin-owned-custom-table-changes');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-custom-table-target']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready custom-table cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready custom-table cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) =>
    testCase.family === 'plugin-owned-custom-table-changes'
    && testCase.tags.has('forms-lab-custom-table-ready'));
  const staleCase = cases.find((testCase) =>
    testCase.family === 'plugin-owned-custom-table-changes'
    && testCase.tags.has('forms-lab-custom-table-stale'));
  const deleteBlockedCase = cases.find((testCase) =>
    testCase.family === 'forms-lab-delete-blocked'
    && validateGeneratedCase(testCase).status === 'blocked');

  assert.ok(readyCase, 'missing ready plugin-owned custom-table case');
  assert.ok(staleCase, 'missing stale plugin-owned custom-table case');
  assert.ok(deleteBlockedCase, 'missing blocked plugin-owned custom-table delete case');
  assert.ok(readyCase.tags.has('plugin-owned-custom-table-change'));
  assert.ok(staleCase.tags.has('plugin-owned-custom-table-change'));
  assert.ok(deleteBlockedCase.tags.has('plugin-owned-custom-table-change'));

  const readyShape = assertFormsLabReadyShape(readyCase);
  const staleShape = assertFormsLabStaleShape(staleCase);
  const deleteShape = assertFormsLabDeleteBlockedShape(deleteBlockedCase);
  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);
  const deleteBlocked = validateGeneratedCase(deleteBlockedCase);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true, 'ready custom-table case should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready custom-table apply should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready custom-table case should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(stale.status, 'ready', 'stale custom-table case must not be ready');
  assert.equal(stale.applied, false, 'stale custom-table case must not apply mutations');
  assert.ok(stale.conflicts >= 1 || stale.blockers >= 1, 'stale custom-table case should record a refusal');
  assert.equal(deleteBlocked.status, 'blocked', 'delete custom-table case must be blocked');
  assert.ok(deleteBlocked.blockers >= 1, 'custom-table delete should be blocked by driver policy');
  assert.equal(deleteBlocked.applied, false, 'blocked custom-table delete must not apply mutations');

  assertFormsLabReadyPlanEvidence(readyCase, readyShape.resourceKey, readyShape.payloadToken);
  assertFormsLabStalePlanRefusesMutation(staleCase, staleShape.resourceKey);
  assertFormsLabDeletePlanRefusesMutation(deleteBlockedCase, deleteShape.resourceKey);
});

function assertFormsLabReadyShape(testCase) {
  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([id, row]) => {
      const baseRow = testCase.base.db.wp_reprint_push_forms_lab[id];
      const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[id];
      return baseRow
        && remoteRow
        && row.__pluginOwner === 'forms'
        && row.payload?.mode === 'local'
        && baseRow.payload?.mode === 'base'
        && remoteRow.payload?.mode === 'base';
    });

  assert.equal(rows.length, 1, `${testCase.id} should update one plugin-owned custom-table row`);
  const [rowId, row] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];
  const payloadToken = row.payload.privateToken || row.payload.token;

  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use deterministic numeric custom-table ids`);
  assert.equal(row.payload.owner, 'forms');
  assert.equal(baseRow.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  assert.ok(payloadToken, `${testCase.id} should carry a local payload token for redaction checks`);
  return {
    rowId,
    resourceKey: generatedRowResourceKey('wp_reprint_push_forms_lab', rowId),
    payloadToken,
  };
}

function assertFormsLabStaleShape(testCase) {
  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([id, row]) => {
      const baseRow = testCase.base.db.wp_reprint_push_forms_lab[id];
      const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[id];
      return baseRow
        && remoteRow
        && row.__pluginOwner === 'forms'
        && row.payload?.mode === 'local'
        && baseRow.payload?.mode === 'base'
        && remoteRow.payload?.mode === 'remote-stale';
    });

  assert.equal(rows.length, 1, `${testCase.id} should expose one stale plugin-owned custom-table row`);
  const [rowId, row] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];

  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use deterministic numeric custom-table ids`);
  assert.notDeepEqual(remoteRow, baseRow, `${testCase.id} stale row should drift remotely`);
  assert.equal(row.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  return {
    rowId,
    resourceKey: generatedRowResourceKey('wp_reprint_push_forms_lab', rowId),
  };
}

function assertFormsLabDeleteBlockedShape(testCase) {
  const rows = Object.entries(testCase.base.db.wp_reprint_push_forms_lab)
    .filter(([id, row]) => row.__pluginOwner === 'forms'
      && row.payload?.token?.startsWith('delete-blocked-')
      && !testCase.local.db.wp_reprint_push_forms_lab[id]
      && testCase.remote.db.wp_reprint_push_forms_lab[id]);

  assert.equal(rows.length, 1, `${testCase.id} should attempt one custom-table delete`);
  const [rowId] = rows[0];
  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use deterministic numeric custom-table ids`);
  return {
    rowId,
    resourceKey: generatedRowResourceKey('wp_reprint_push_forms_lab', rowId),
  };
}

function assertFormsLabReadyPlanEvidence(testCase, resourceKey, payloadToken) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  const auditEvidence = mutation?.pluginOwnedResource?.auditEvidence;

  assert.equal(plan.status, 'ready');
  assert.ok(mutation, `${testCase.id} should plan a custom-table mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.ok(mutation.pluginOwnedResource?.ownerContext.length >= 2);
  assert.equal(auditEvidence?.format, 'hash-only');
  assert.equal(auditEvidence?.rawValuesIncluded, false);
  assert.equal(auditEvidence?.resourceKey, resourceKey);
  assert.equal(auditEvidence?.driver, 'fixture-forms-lab-table');
  assert.equal(auditEvidence?.supportsDelete, false);
  assert.equal(auditEvidence?.baseHash, mutation.baseHash);
  assert.equal(auditEvidence?.localHash, mutation.localHash);
  assert.equal(auditEvidence?.remoteHash, mutation.remoteBeforeHash);
  assert.match(auditEvidence?.driverEvidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(mutation.pluginOwnedResource?.driverEvidence?.plugin, 'reprint-push-forms-fixture');
  assert.match(mutation.pluginOwnedResource?.driverEvidence?.baseHash, /^[a-f0-9]{64}$/);
  assert.equal(
    mutation.pluginOwnedResource?.driverEvidence?.baseHash,
    mutation.pluginOwnedResource?.driverEvidence?.remoteHash,
  );
  assert.equal(
    Object.hasOwn(auditEvidence, 'payload'),
    false,
    'custom-table audit evidence must not include payload fields',
  );
  assert.equal(
    JSON.stringify(auditEvidence).includes(payloadToken),
    false,
    'custom-table audit evidence must be hash-only',
  );
}

function assertFormsLabStalePlanRefusesMutation(testCase, resourceKey) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });

  assert.notEqual(plan.status, 'ready');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    false,
    `${testCase.id} should not plan the stale custom-table mutation`,
  );
  assert.ok(
    plan.conflicts.some((conflict) => conflict.resourceKey === resourceKey)
      || plan.blockers.some((blocker) => blocker.resourceKey === resourceKey),
    `${testCase.id} should refuse the stale custom-table change before mutation`,
  );
}

function assertFormsLabDeletePlanRefusesMutation(testCase, resourceKey) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });

  assert.notEqual(plan.status, 'ready');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    false,
    `${testCase.id} should not plan the refused custom-table delete`,
  );
  assert.ok(
    plan.blockers.some((blocker) =>
      blocker.resourceKey === resourceKey
      && blocker.class === 'unsupported-plugin-owned-resource'
      && blocker.driver === 'fixture-forms-lab-table'
      && blocker.change?.localChange === 'delete'
      && (
        blocker.reason === 'Plugin-owned resource driver does not support delete mutations.'
        || (
          blocker.driverDryRunValidationEvidence?.reasonCode === 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_REFUSED'
          && blocker.driverDryRunValidationEvidence?.issueCodes?.includes('PLANNED_ROW_INVALID')
        )
      )),
    `${testCase.id} should block custom-table delete before mutation with driver refusal evidence`,
  );
}

test('RPP-0347 generated harness emits comment user ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.commentUserGraph;

  assert.ok(coverage, 'missing comment user graph target coverage');
  assert.equal(coverage.family, 'comment-user-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['comment-user-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready comment user graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready comment user graph cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'comment-user-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'comment-user-graph-stale');

  assert.ok(readyCase, 'missing ready comment user graph case');
  assert.ok(staleCase, 'missing stale comment user graph case');

  const readyShape = assertCommentUserGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertCommentUserGraphShape(staleCase, { staleTarget: true });
  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);
  const readyPlan = createPushPlan({
    base: readyCase.base,
    local: readyCase.local,
    remote: readyCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const stalePlan = createPushPlan({
    base: staleCase.base,
    local: staleCase.local,
    remote: staleCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const userMutation = readyPlan.mutations.find(
    (mutation) => mutation.resourceKey === readyShape.userResourceKey,
  );
  const commentMutation = readyPlan.mutations.find(
    (mutation) => mutation.resourceKey === readyShape.commentResourceKey,
  );
  const plannedComment = deserializeResourceValue(commentMutation.value);
  const staleBlocker = stalePlan.blockers.find(
    (blocker) => blocker.resourceKey === staleShape.commentResourceKey,
  );
  const staleReference = staleBlocker?.references?.find(
    (reference) => reference.relationshipType === 'comment-user',
  );
  const stalePlanJson = JSON.stringify(stalePlan);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true);
  assert.equal(ready.staleReplayRejected, true);
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.ok(userMutation, 'ready plan should create the user target');
  assert.ok(commentMutation, 'ready plan should create the comment reference');
  assert.equal(plannedComment.user_id, readyShape.userId);

  assert.equal(stale.status, 'blocked');
  assert.ok(stale.blockers >= 1, 'stale comment user graph should record a graph blocker');
  assert.equal(stale.applied, false, 'stale comment user graph must not apply mutations');
  assert.ok(staleBlocker, 'stale plan should block the comment user reference');
  assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(staleReference, 'stale blocker should include the user_id reference');
  assert.equal(staleReference.relationshipKey, 'wp_comments.user_id');
  assert.equal(staleReference.targetResourceKey, staleShape.userResourceKey);
  assert.equal(staleReference.targetChange.remoteChange, 'update');
  assert.match(staleReference.targetRemoteHash, /^[a-f0-9]{64}$/);
  assert.match(staleReference.targetBaseHash, /^[a-f0-9]{64}$/);
  assert.match(staleReference.targetLocalHash, /^[a-f0-9]{64}$/);
  assert.equal(stalePlanJson.includes('Generated comment user target'), false);
  assert.equal(stalePlanJson.includes('Remote stale comment user'), false);
  assert.equal(stalePlanJson.includes('remote-stale-comment-user-private'), false);
  assert.equal(stalePlanJson.includes('comment-user-reference'), false);
});

function assertCommentUserGraphShape(testCase, { staleTarget }) {
  const commentRows = Object.entries(testCase.local.db.wp_comments)
    .filter(([, row]) => String(row.comment_content || '').startsWith('comment-user-reference-'));

  assert.equal(commentRows.length, 1, `${testCase.id} should create one comment user reference row`);

  const [commentRowId, commentRow] = commentRows[0];
  const userId = Number(commentRow.user_id);
  const userRowId = `ID:${userId}`;
  const user = testCase.local.db.wp_users[userRowId];

  assert.ok(Number.isSafeInteger(userId), `${testCase.id} user_id should be numeric`);
  assert.equal(commentRowId, `comment_ID:${commentRow.comment_ID}`);
  assert.ok(user, `${testCase.id} missing local user target ${userRowId}`);
  assert.equal(user.ID, userId);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_users[userRowId], `${testCase.id} stale user should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale user should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_users[userRowId], undefined);
    assert.equal(testCase.remote.db.wp_users[userRowId], undefined);
  }

  return {
    userId,
    userResourceKey: generatedRowResourceKey('wp_users', userRowId),
    commentResourceKey: generatedRowResourceKey('wp_comments', commentRowId),
  };
}

function generatedRowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

test('RPP-0342 generated harness emits featured image attachment ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.featuredImageAttachmentGraph;

  assert.ok(coverage, 'missing featured image attachment graph target coverage');
  assert.equal(coverage.family, 'featured-image-attachment-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['featured-image-attachment']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready featured image graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready featured image graph cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'featured-image-attachment-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'featured-image-attachment-stale');

  assert.ok(readyCase, 'missing ready featured image attachment graph case');
  assert.ok(staleCase, 'missing stale featured image attachment graph case');
  const readyShape = assertFeaturedImageAttachmentGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertFeaturedImageAttachmentGraphShape(staleCase, { staleTarget: true });

  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);
  const readyPlan = createPushPlan({
    base: readyCase.base,
    local: readyCase.local,
    remote: readyCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const stalePlan = createPushPlan({
    base: staleCase.base,
    local: staleCase.local,
    remote: staleCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const thumbnailMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.thumbnailResourceKey);
  const attachmentMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.attachmentResourceKey);
  const thumbnailValue = deserializeResourceValue(thumbnailMutation.value);
  const staleBlocker = stalePlan.blockers.find((blocker) =>
    blocker.resourceKey === staleShape.thumbnailResourceKey);
  const stalePlanJson = JSON.stringify(stalePlan);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true, 'ready featured image graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready featured image graph should reject stale replay');
  assert.ok(thumbnailMutation, 'ready graph should plan the thumbnail postmeta row');
  assert.ok(attachmentMutation, 'ready graph should plan the attachment target row');
  assert.equal(thumbnailValue.meta_key, '_thumbnail_id');
  assert.equal(thumbnailValue.meta_value, String(readyShape.attachmentId));
  assert.equal(stale.status, 'blocked');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale featured image graph must not apply mutations');
  assert.ok(staleBlocker, 'stale graph should block the thumbnail postmeta row');
  assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(staleBlocker.references[0].relationshipType, 'featured-image-attachment');
  assert.equal(staleBlocker.references[0].targetResourceKey, staleShape.attachmentResourceKey);
  assert.match(staleBlocker.references[0].targetRemoteHash, /^[a-f0-9]{64}$/);
  assert.match(staleBlocker.references[0].targetBaseHash, /^[a-f0-9]{64}$/);
  assert.match(staleBlocker.references[0].targetLocalHash, /^[a-f0-9]{64}$/);
  assert.equal(stalePlanJson.includes('Generated featured image attachment'), false);
  assert.equal(stalePlanJson.includes('Remote stale featured image attachment'), false);
  assert.equal(stalePlanJson.includes('remote stale featured image private payload'), false);
});

function assertFeaturedImageAttachmentGraphShape(testCase, { staleTarget }) {
  const thumbnailRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([, row]) => row.meta_key === '_thumbnail_id');

  assert.equal(thumbnailRows.length, 1, `${testCase.id} should create one featured image postmeta row`);

  const [thumbnailRowId, thumbnailRow] = thumbnailRows[0];
  const attachmentId = Number(thumbnailRow.meta_value);
  const attachmentRowId = `ID:${attachmentId}`;
  const attachment = testCase.local.db.wp_posts[attachmentRowId];

  assert.equal(thumbnailRowId, `post_id:${thumbnailRow.post_id}:meta_key:_thumbnail_id`);
  assert.equal(thumbnailRow.post_id, 1, `${testCase.id} thumbnail should point at the base post`);
  assert.ok(Number.isSafeInteger(attachmentId), `${testCase.id} thumbnail meta_value should be a numeric attachment ID`);
  assert.ok(attachment, `${testCase.id} missing local attachment target ${attachmentRowId}`);
  assert.equal(attachment.post_type, 'attachment');
  assert.equal(attachment.post_status, 'inherit');
  assert.equal(attachment.post_parent, 1);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_posts[attachmentRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_posts[attachmentRowId],
      testCase.base.db.wp_posts[attachmentRowId],
      `${testCase.id} stale attachment target should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_posts[attachmentRowId], undefined);
    assert.equal(testCase.remote.db.wp_posts[attachmentRowId], undefined);
  }

  return {
    attachmentId,
    attachmentResourceKey: rowResourceKey('wp_posts', attachmentRowId),
    thumbnailResourceKey: rowResourceKey('wp_postmeta', thumbnailRowId),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

test('RPP-0150 wp_comments and wp_commentmeta graph target exposes ready and non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraph;

  assert.ok(coverage, 'missing wp_comments/wp_commentmeta graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready wp_comments/wp_commentmeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready stale graph cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.match(`sha256:${digest(coverage)}`, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes('generated commentmeta graph '), false);
  assert.equal(JSON.stringify(report).includes('Remote stale comment graph target'), false);

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('wp-comments-commentmeta-graph'));
  const readyFamilyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleFamilyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');
  const plannedCases = targetCases.map((testCase) => ({
    testCase,
    plan: createGeneratedPlan(testCase),
    shape: assertCommentsCommentmetaGraphShape(testCase, {
      staleTarget: testCase.family === 'wp-comments-commentmeta-graph-stale',
    }),
  }));
  const readyCases = plannedCases.filter(({ plan }) => plan.status === 'ready');
  const nonReadyCases = plannedCases.filter(({ plan }) => plan.status !== 'ready');

  assert.equal(readyFamilyCases.length, 10, 'expected one ready comment/commentmeta graph case per tier');
  assert.equal(staleFamilyCases.length, 10, 'expected one stale comment/commentmeta graph case per tier');
  assert.equal(readyCases.length, coverage.statuses.ready, 'ready comment/commentmeta count should match summary');
  assert.equal(nonReadyCases.length, nonReadyTargetCount(coverage), 'non-ready comment/commentmeta count should match summary');

  for (const { testCase: readyCase, plan, shape } of readyCases) {
    const result = validateGeneratedCase(readyCase);
    const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
    const commentResourceKey = rowResourceKey('wp_comments', shape.commentRowId);
    const commentmetaResourceKey = rowResourceKey('wp_commentmeta', shape.commentmetaRowId);

    assert.equal(plan.status, 'ready');
    assert.equal(result.status, 'ready');
    assert.ok(mutationKeys.has(commentResourceKey), `${readyCase.id} should plan wp_comments create`);
    assert.ok(mutationKeys.has(commentmetaResourceKey), `${readyCase.id} should plan wp_commentmeta create`);
    assert.equal(result.applied, true, `${readyCase.id} should apply planned comment graph work`);
    assert.equal(result.unplannedRemotePreserved, true, `${readyCase.id} should preserve unrelated remote data`);
    assert.equal(result.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);

    const applied = applyPlan(cloneJson(readyCase.remote), plan);
    assert.deepEqual(applied.site.db.wp_comments[shape.commentRowId], readyCase.local.db.wp_comments[shape.commentRowId]);
    assert.deepEqual(
      applied.site.db.wp_commentmeta[shape.commentmetaRowId],
      readyCase.local.db.wp_commentmeta[shape.commentmetaRowId],
    );
    assertCommentsCommentmetaEvidenceRedacted(readyCase, plan, shape);
  }

  for (const { testCase: nonReadyCase, plan, shape } of nonReadyCases) {
    const result = validateGeneratedCase(nonReadyCase);
    const commentmetaResourceKey = rowResourceKey('wp_commentmeta', shape.commentmetaRowId);
    const remoteBefore = cloneJson(nonReadyCase.remote);
    const beforeHash = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));

    assert.notEqual(plan.status, 'ready');
    assert.notEqual(result.status, 'ready');
    assert.equal(result.applied, false, `${nonReadyCase.id} stale graph must not apply`);
    assert.ok(error instanceof PushPlanError, `${nonReadyCase.id} non-ready plan should refuse`);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remoteBefore), beforeHash, `${nonReadyCase.id} refusal must happen before mutation`);
    assert.ok(
      plan.blockers.some((blocker) => blocker.resourceKey === commentmetaResourceKey),
      `${nonReadyCase.id} should block the commentmeta row that references stale wp_comments`,
    );
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === commentmetaResourceKey),
      false,
      `${nonReadyCase.id} must not plan a mutation for the stale commentmeta row`,
    );
    assert.equal(
      JSON.stringify(plan.blockers).includes(shape.remoteComment.comment_content),
      false,
      `${nonReadyCase.id} blocker evidence should stay hash-only`,
    );
    assertCommentsCommentmetaEvidenceRedacted(nonReadyCase, plan, shape);
  }
});

function assertCommentsCommentmetaGraphShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('same-plan-graph'));
  assert.ok(testCase.tags.has('comment-graph'));
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph'));
  assert.ok(testCase.tags.has('wp-commentmeta-create'));

  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta)
    .filter(([id, row]) =>
      !testCase.base.db.wp_commentmeta[id]
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one wp_commentmeta row`);

  const commentId = commentmetaRows[0][1].comment_id;
  const commentRowId = `comment_ID:${commentId}`;
  const localComment = testCase.local.db.wp_comments[commentRowId];
  const remoteComment = testCase.remote.db.wp_comments[commentRowId];
  const baseComment = testCase.base.db.wp_comments[commentRowId];

  assert.ok(localComment, `${testCase.id} should have a local wp_comments target`);
  assert.equal(localComment.comment_content, `Generated comment graph target ${commentId}`);

  if (staleTarget) {
    assert.ok(baseComment, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteComment, `${testCase.id} stale target should exist remotely`);
    assert.notDeepEqual(remoteComment, baseComment, `${testCase.id} stale target should drift remotely`);
    assert.equal(remoteComment.comment_content, `Remote stale comment graph target ${commentId}`);
    assert.ok(testCase.tags.has('stale-graph'));
    assert.ok(testCase.tags.has('wp-comments-remote-drift'));
  } else {
    assert.equal(baseComment, undefined, `${testCase.id} ready target should not exist in base`);
    assert.equal(remoteComment, undefined, `${testCase.id} ready target should not exist remotely`);
    assert.ok(testCase.tags.has('wp-comments-create'));
  }

  return {
    commentRowId,
    commentmetaRowId: commentmetaRows[0][0],
    localComment,
    remoteComment,
    baseComment,
    commentmetaRow: commentmetaRows[0][1],
  };
}

function createGeneratedPlan(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function assertCommentsCommentmetaEvidenceRedacted(testCase, plan, shape) {
  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    preconditions: plan.preconditions,
    mutations: plan.mutations,
    conflicts: plan.conflicts,
    blockers: plan.blockers,
    decisions: plan.decisions,
    rawCommentGraphProbe: {
      value: {
        localComment: shape.localComment,
        remoteComment: shape.remoteComment,
        baseComment: shape.baseComment,
        commentmeta: shape.commentmetaRow,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw comment graph evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} evidence should keep hash-only comment values`);
  assert.equal(serialized.includes('generated commentmeta graph '), false, `${testCase.id} leaked raw commentmeta value`);
  assert.equal(serialized.includes('Generated comment graph target'), false, `${testCase.id} leaked raw comment content`);
  assert.equal(serialized.includes('Remote stale comment graph target'), false, `${testCase.id} leaked remote comment drift`);
}


function generatedAtomicPluginInstallStackV1Evidence() {
  return generatedAtomicPluginInstallStackVariantEvidence({
    target: 'atomicPluginInstallStackV1',
    variantNumber: 1,
    variantTag: 'atomic-plugin-install-stack-v1',
  });
}

function generatedAtomicPluginInstallStackV2Evidence() {
  return generatedAtomicPluginInstallStackVariantEvidence({
    target: 'atomicPluginInstallStackV2',
    variantNumber: 2,
    variantTag: 'atomic-plugin-install-stack-v2',
  });
}

function generatedAtomicPluginInstallStackVariantEvidence({ target, variantNumber, variantTag }) {
  const targetCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(variantTag));
  const selectedCases = [
    targetCases.find((testCase) => testCase.family === 'atomic-plugin-stack-ready'),
    targetCases.find((testCase) => testCase.family === 'atomic-plugin-missing-dependency'),
  ];

  assert.equal(
    selectedCases.includes(undefined),
    false,
    `variant ${variantNumber} evidence needs ready and non-ready cases`,
  );

  const cases = selectedCases.map((testCase) => {
    const missingDependency = testCase.family === 'atomic-plugin-missing-dependency';
    const shape = assertAtomicPluginStackShape(testCase, { missingDependency });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(testCase);
    const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);

    assert.ok(group, `${testCase.id} should emit an atomic group for variant ${variantNumber} evidence`);
    assert.equal(testCase.tags.has(variantTag), true);

    return {
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      status: result.status,
      applied: result.applied,
      summary: {
        mutations: plan.summary.mutations,
        blockers: plan.summary.blockers,
        conflicts: plan.summary.conflicts,
        atomicGroups: plan.summary.atomicGroups,
      },
      atomicGroup: {
        id: group.id,
        status: group.status,
        requireAtomic: group.requireAtomic,
        resources: [...group.resources].sort(),
        mutationResourceKeys: plan.mutations
          .filter((mutation) => mutation.atomicGroupId === group.id)
          .map((mutation) => mutation.resourceKey)
          .sort(),
        dependencySources: (group.dependencyRequirements || [])
          .map((requirement) => requirement.source)
          .sort(),
        dependencyRequirementHashes: (group.dependencyRequirements || [])
          .map((requirement) => ({
            plugin: requirement.plugin,
            expectedHash: requirement.expectedHash,
            plannedHash: requirement.plannedHash || null,
            remoteHash: requirement.remoteHash || null,
          }))
          .sort((left, right) => left.plugin.localeCompare(right.plugin)),
        blockers: group.blockers
          .map((blocker) => ({
            class: blocker.class,
            resourceKey: blocker.resourceKey || null,
            plugin: blocker.plugin || null,
            reason: blocker.reason || null,
          }))
          .sort((left, right) =>
            `${left.class}:${left.resourceKey || ''}:${left.plugin || ''}`
              .localeCompare(`${right.class}:${right.resourceKey || ''}:${right.plugin || ''}`)),
      },
      modelProofHash: digest({
        id: testCase.id,
        expectedResourceKeys: shape.expectedResourceKeys,
        status: result.status,
        applied: result.applied,
        groupStatus: group.status,
      }),
    };
  });

  return {
    target,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases: cases.length,
    readyCases: cases.filter((entry) => entry.status === 'ready').length,
    nonReadyCases: cases.filter((entry) => entry.status !== 'ready').length,
    cases,
  };
}

function assertAtomicPluginStackShape(testCase, { missingDependency }) {
  assert.ok(testCase.tags.has('atomic-plugin-install-stack-v1'));
  assert.ok(testCase.tags.has('atomic-plugin-install-stack-v3'));
  const intent = testCase.local.pushIntents?.[0];

  assert.ok(intent, `${testCase.id} should declare an atomic plugin install intent`);
  assert.equal(intent.kind, 'plugin-install');
  assert.equal(intent.requireAtomic, true);

  if (missingDependency) {
    assert.ok(testCase.tags.has('atomic-blocked'));
    assert.ok(testCase.tags.has('atomic-plugin-stack-missing-dependency-v3'));
    assert.equal(testCase.local.files[atomicDependencyPluginFile], undefined);
    assert.equal(testCase.local.plugins[atomicDependencyPlugin], undefined);
    assert.ok(testCase.local.files[atomicDependentPluginFile], `${testCase.id} should stage dependent plugin file`);
    assert.ok(testCase.local.plugins[atomicDependentPlugin], `${testCase.id} should stage dependent plugin metadata`);
    assert.deepEqual(intent.resources, [
      fileResourceKey(atomicDependentPluginFile),
      pluginResourceKey(atomicDependentPlugin),
    ]);
    assert.deepEqual(intent.dependencies.plugins, [atomicDependencyPlugin]);
    return {
      intent,
      expectedResourceKeys: [
        fileResourceKey(atomicDependentPluginFile),
        pluginResourceKey(atomicDependentPlugin),
      ],
      optionRow: null,
    };
  }

  assert.ok(testCase.tags.has('atomic-ready'));
  assert.ok(testCase.tags.has('atomic-plugin-stack-ready-v3'));
  assert.ok(testCase.local.files[atomicDependencyPluginFile], `${testCase.id} should stage dependency plugin file`);
  assert.ok(testCase.local.files[atomicDependentPluginFile], `${testCase.id} should stage dependent plugin file`);
  assert.deepEqual(testCase.local.plugins[atomicDependencyPlugin], { version: '2.1.0', active: true });
  assert.equal(testCase.local.plugins[atomicDependentPlugin].requires[0], atomicDependencyPlugin);

  const optionRow = testCase.local.db.wp_options[atomicFixtureOptionRowId];
  const optionResourceKey = rowResourceKey('wp_options', atomicFixtureOptionRowId);
  assert.ok(optionRow, `${testCase.id} should create plugin-owned fixture option`);
  assert.equal(optionRow.__pluginOwner, atomicDependentPlugin);
  assert.equal(optionRow.option_value.mode, 'generated-installed');
  assert.equal(optionRow.option_value.privateInstallToken, 'private-atomic-plugin-install-stack-v3');
  assert.ok(
    intent.resourcePolicy.pluginOwnedResources.allowedResources.some((entry) =>
      entry.resourceKey === optionResourceKey
        && entry.pluginOwner === atomicDependentPlugin
        && entry.driver === 'wp-option'),
    `${testCase.id} should include plugin-owned option driver policy in the atomic intent`,
  );
  assert.equal(intent.dependencies.plugins[0].name, atomicDependencyPlugin);
  assert.equal(intent.dependencies.plugins[0].version, '2.1.0');
  assert.match(intent.dependencies.plugins[0].hash, /^[a-f0-9]{64}$/);

  return {
    intent,
    expectedResourceKeys: [
      fileResourceKey(atomicDependencyPluginFile),
      fileResourceKey(atomicDependentPluginFile),
      pluginResourceKey(atomicDependencyPlugin),
      pluginResourceKey(atomicDependentPlugin),
      optionResourceKey,
    ],
    optionRow,
  };
}

function fileResourceKey(path) {
  return `file:${path}`;
}

function pluginResourceKey(name) {
  return `plugin:${name}`;
}

function assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape) {
  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    atomicGroups: plan.atomicGroups,
    mutations: plan.mutations,
    blockers: plan.blockers,
    rawAtomicInstallProbe: {
      value: {
        intent: shape.intent,
        optionRow: shape.optionRow,
        dependencyFile: testCase.local.files[atomicDependencyPluginFile],
        dependentFile: testCase.local.files[atomicDependentPluginFile],
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw atomic install evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} evidence should keep hash-only values`);
  assert.equal(serialized.includes('private-atomic-plugin-install-stack-v3'), false, `${testCase.id} leaked private install token`);
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}

function generatedIndependentLocalRemoteTargets(testCase) {
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

function generatedIndependentRowRemoteFileTargets(testCase) {
  const rowEntry = Object.entries(testCase.local.db.wp_posts)
    .find(([, row]) => row.post_title?.startsWith('Independent local row '));
  const fileEntry = Object.entries(testCase.remote.files)
    .find(([, value]) => typeof value === 'string' && value.startsWith('independent remote file '));

  assert.ok(rowEntry, `${testCase.id} missing generated independent local row`);
  assert.ok(fileEntry, `${testCase.id} missing generated independent remote file`);

  return {
    rowId: rowEntry[0],
    rowTitle: rowEntry[1].post_title,
    filePath: fileEntry[0],
    fileValue: fileEntry[1],
  };
}

function generatedRemoteOnlyPostUpdateTargets(testCase) {
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([id, row]) =>
      testCase.base.db.wp_posts[id]
      && testCase.local.db.wp_posts[id]
      && row.post_title?.startsWith('Remote editorial '));

  assert.ok(rowEntry, `${testCase.id} missing generated remote-only row update`);
  assert.deepEqual(
    testCase.local.db.wp_posts[rowEntry[0]],
    testCase.base.db.wp_posts[rowEntry[0]],
    `${testCase.id} remote-only row should be unchanged locally`,
  );
  assert.notDeepEqual(
    testCase.remote.db.wp_posts[rowEntry[0]],
    testCase.base.db.wp_posts[rowEntry[0]],
    `${testCase.id} remote-only row should drift remotely`,
  );

  return {
    rowId: rowEntry[0],
    remoteTitle: rowEntry[1].post_title,
  };
}

function generatedDeleteEditTargets(testCase) {
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([id, row]) =>
      testCase.base.db.wp_posts[id]
      && !testCase.local.db.wp_posts[id]
      && row.post_title?.startsWith('Remote edit while local deletes '));

  assert.ok(rowEntry, `${testCase.id} missing generated delete/edit row`);

  return {
    rowId: rowEntry[0],
    remoteTitle: rowEntry[1].post_title,
  };
}

function generatedStaleRemoteAfterDryRunVariant2Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedByTier = new Map();

  for (const testCase of generatePushHarnessCases()) {
    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (!selectedByTier.has(testCase.tier)) {
      selectedByTier.set(
        testCase.tier,
        generatedStaleRemoteAfterDryRunCaseEvidence(testCase, result),
      );
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 2 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 2 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 2 target recount should match summary total');

  return {
    target: 'staleRemoteAfterDryRun',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [...selectedByTier.values()].sort((left, right) => left.tier - right.tier),
  };
}

function generatedStaleRemoteAfterDryRunCaseEvidence(testCase, result) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations[0];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0137-${testCase.tier}-${mutation.id}`;
  const plannedValue = deserializeResourceValue(mutation.value);

  assert.equal(plan.status, 'ready', `${testCase.id} should be ready for stale replay evidence`);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to drift after dry-run`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0137StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated remote before refusal`);
  assert.equal(result.status, 'ready');
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    summary: plan.summary,
    staleReplay: {
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      code: error.code,
      expectedHash: error.details.expectedHash,
      actualHash: error.details.actualHash,
      mutationRemoteBeforeHash: mutation.remoteBeforeHash,
      plannedValueHash: `sha256:${digest(plannedValue)}`,
      preconditionHash: `sha256:${digest(precondition)}`,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
  };
}

function rpp0137StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0137StaleRemoteAfterDryRun: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-dry-run' : currentValue,
    __rpp0137StaleRemoteAfterDryRun: stalePayload,
  };
}

function hashOnlyGeneratedPlanEvidence(plan) {
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
      change: conflict.change,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
    })),
  };
}

function assertFileTypeSwapShape(testCase, { conflict }) {
  const swapEntries = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(conflict ? '/conflict-type-swap-' : '/ready-type-swap-')
      && value?.type === 'directory');

  assert.equal(swapEntries.length, 1, `${testCase.id} should start with one directory swap target`);

  const [path] = swapEntries[0];
  assert.deepEqual(testCase.base.files[path], { type: 'directory' });
  assert.deepEqual(testCase.remote.files[path], { type: 'directory' });
  assert.equal(testCase.local.files[path]?.type, 'file', `${testCase.id} local target should become a file`);
  assert.match(testCase.local.files[path]?.content, /^local type swap /);

  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((remotePath) => remotePath.startsWith(`${path}/`));
  assert.equal(remoteDescendants.length, conflict ? 1 : 0, `${testCase.id} remote descendant shape mismatch`);
}

function assertFileCreateUpdateDeleteMixShape(testCase) {
  const createFiles = Object.entries(testCase.local.files)
    .filter(([path, value]) => !testCase.base.files[path]
      && String(value).startsWith('generated file mix create '));
  const updateFiles = Object.entries(testCase.local.files)
    .filter(([path, value]) => testCase.base.files[path]
      && String(value).startsWith('generated file mix update '));
  const deleteFiles = Object.keys(testCase.base.files)
    .filter((path) => String(testCase.base.files[path]).startsWith('base shared ')
      && !testCase.local.files[path]
      && testCase.remote.files[path]);

  assert.equal(createFiles.length, 1, `${testCase.id} should create one file`);
  assert.equal(updateFiles.length, 1, `${testCase.id} should update one file`);
  assert.equal(deleteFiles.length, 1, `${testCase.id} should delete one file`);
}

function generatedPlannerSummaryEvidence() {
  return generatePushHarnessCases().map((testCase) => {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const emitted = emittedPlannerCounts(plan);

    assert.deepEqual(plan.summary, emitted, `${testCase.id} summary totals mismatch`);
    assert.equal(
      plan.status,
      plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
      `${testCase.id} status does not match emitted conflict/blocker evidence`,
    );

    return {
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      tags: [...testCase.tags].sort(),
      status: plan.status,
      summary: plan.summary,
      emitted,
      preconditions: plan.preconditions.length,
    };
  });
}

function generatedConflictApplyRefusalEvidence() {
  return generatePushHarnessCases()
    .map((testCase) => {
      const plan = createPushPlan({
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        now: fixedGeneratedHarnessNow,
      });

      if (plan.status !== 'conflict') {
        return null;
      }

      const remote = cloneJson(testCase.remote);
      const beforeRemoteHash = digest(remote);
      const conflictJournalEvents = [];
      let appliedMutationCount = 0;
      const applyError = captureError(() => {
        const result = applyPlan(remote, plan, {
          durableJournal: claimFencedDurableJournal(conflictJournalEvents),
        });
        appliedMutationCount = result.appliedMutations;
      });

      assert.ok(applyError instanceof PushPlanError, `${testCase.id} conflict apply should throw PushPlanError`);
      assert.equal(applyError.code, 'PLAN_NOT_READY', `${testCase.id} conflict apply should fail as not ready`);
      assert.deepEqual(applyError.details, { status: 'conflict' }, `${testCase.id} conflict apply details changed`);
      assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} conflict apply mutated remote`);
      assert.equal(appliedMutationCount, 0, `${testCase.id} conflict apply reported applied mutations`);
      assert.deepEqual(conflictJournalEvents, [], `${testCase.id} conflict apply wrote durable journal events`);

      const forgedReadyWithConflictEvidence = cloneJson(plan);
      forgedReadyWithConflictEvidence.status = 'ready';
      const forgedRemote = cloneJson(testCase.remote);
      const forgedBeforeHash = digest(forgedRemote);
      const forgedJournalEvents = [];
      const forgedError = captureError(() => applyPlan(forgedRemote, forgedReadyWithConflictEvidence, {
        durableJournal: claimFencedDurableJournal(forgedJournalEvents),
      }));
      const forgedIssueCodes = forgedError.details.issues.map((issue) => issue.code).sort();
      assert.ok(forgedError instanceof PushPlanError, `${testCase.id} forged conflict plan should throw`);
      assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION', `${testCase.id} forged conflict code changed`);
      assert.ok(
        forgedIssueCodes.includes('READY_PLAN_HAS_CONFLICTS'),
        `${testCase.id} forged ready status must reject retained conflict evidence`,
      );
      assert.equal(digest(forgedRemote), forgedBeforeHash, `${testCase.id} forged conflict plan mutated remote`);
      assert.deepEqual(forgedJournalEvents, [], `${testCase.id} forged conflict plan wrote durable journal events`);

      const staleAttempt = plan.mutations.length > 0 && plan.blockers.length === 0
        ? generatedStaleConflictMutationAttempt(testCase, plan)
        : null;
      const allJournalEvents = [
        ...conflictJournalEvents,
        ...forgedJournalEvents,
        ...(staleAttempt?.journalEvents || []),
      ];
      for (const mutation of plan.mutations) {
        const mutationPayloadText = JSON.stringify(mutation.value);
        assert.equal(
          JSON.stringify({
            planId: testCase.id,
            conflicts: plan.conflicts.map((conflict) => conflict.resourceKey),
            mutationHashes: plan.mutations.map((entry) => [
              entry.resourceKey,
              entry.baseHash,
              entry.localHash,
              entry.remoteBeforeHash,
            ]),
          }).includes(mutationPayloadText),
          false,
          `${testCase.id} hash-only generated evidence leaked mutation payload for ${mutation.resourceKey}`,
        );
      }

      return {
        id: testCase.id,
        tier: testCase.tier,
        family: testCase.family,
        tags: [...testCase.tags].sort(),
        status: plan.status,
        summary: plan.summary,
        plannedMutations: plan.mutations.length,
        plannedPreconditions: plan.preconditions.length,
        conflicts: plan.conflicts.map((conflict) => ({
          id: conflict.id,
          resourceKey: conflict.resourceKey,
          class: conflict.class,
          resolutionPolicy: conflict.resolutionPolicy,
          baseHash: conflict.baseHash,
          localHash: conflict.localHash,
          remoteHash: conflict.remoteHash,
        })),
        refusal: {
          code: applyError.code,
          detailsHash: `sha256:${digest(applyError.details)}`,
        },
        forgedReadyWithConflictEvidence: {
          code: forgedError.code,
          issueCodes: forgedIssueCodes,
          detailsHash: `sha256:${digest(forgedError.details)}`,
        },
        staleMutationAttempt: staleAttempt
          ? {
              code: staleAttempt.error.code,
              detailsHash: `sha256:${digest(staleAttempt.error.details)}`,
              beforeRemoteHash: `sha256:${staleAttempt.beforeHash}`,
              afterRemoteHash: `sha256:${staleAttempt.afterHash}`,
              mutationJournalEventCount: staleAttempt.mutationJournalEventCount,
            }
          : null,
        appliedMutationCount,
        mutationJournalEventCount: allJournalEvents
          .filter((event) => event.type.includes('mutation')).length,
      };
    })
    .filter(Boolean);
}

function generatedStaleConflictMutationAttempt(testCase, plan) {
  const staleForgedReady = cloneJson(plan);
  staleForgedReady.status = 'ready';
  staleForgedReady.conflicts = [];
  staleForgedReady.summary.conflicts = 0;
  staleForgedReady.blockers = [];
  staleForgedReady.summary.blockers = 0;
  const target = staleForgedReady.mutations[0];
  const staleRemote = cloneJson(testCase.remote);
  setResource(staleRemote, target.resource, deserializeResourceValue(target.value));
  const beforeHash = digest(staleRemote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(staleRemote, staleForgedReady, {
    durableJournal: claimFencedDurableJournal(journalEvents),
  }));
  const afterHash = digest(staleRemote);
  const mutationJournalEventCount = journalEvents
    .filter((event) => event.type.includes('mutation')).length;

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale forged conflict plan should throw`);
  assert.equal(error.code, 'PRECONDITION_FAILED', `${testCase.id} stale forged conflict code changed`);
  assert.equal(afterHash, beforeHash, `${testCase.id} stale forged conflict plan mutated remote`);
  assert.equal(mutationJournalEventCount, 0, `${testCase.id} stale forged conflict wrote mutation journal events`);

  return {
    error,
    beforeHash,
    afterHash,
    journalEvents,
    mutationJournalEventCount,
  };
}

function generatedAtomicBlockerPropagationEvidence() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'atomic-plugin-missing-dependency')
    .map((testCase) => {
      const plan = createPushPlan({
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        now: fixedGeneratedHarnessNow,
      });
      const blockedGroups = plan.atomicGroups.filter((group) =>
        group.status === 'blocked'
        && group.blockers.some((blocker) => blocker.class === 'missing-plugin-dependency'));
      const remote = cloneJson(testCase.remote);
      const beforeRemoteHash = digest(remote);
      const journalEvents = [];
      let appliedMutationCount = 0;
      const error = captureError(() => {
        const result = applyPlan(remote, plan, {
          durableJournal: claimFencedDurableJournal(journalEvents),
        });
        appliedMutationCount = result.appliedMutations;
      });
      const mutationJournalEventCount = journalEvents
        .filter((event) => event.type.includes('mutation')).length;

      assert.ok(blockedGroups.length > 0, `${testCase.id} must include a blocked atomic group`);
      assert.ok(error instanceof PushPlanError, `${testCase.id} blocked atomic plan should throw`);
      assert.equal(error.code, 'PLAN_NOT_READY', `${testCase.id} apply refusal code changed`);
      assert.deepEqual(error.details, { status: plan.status }, `${testCase.id} refusal details changed`);
      assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} apply mutated remote before refusal`);
      assert.equal(appliedMutationCount, 0, `${testCase.id} apply reported mutations before refusal`);
      assert.equal(journalEvents.length, 0, `${testCase.id} apply wrote durable journal events before refusal`);
      assert.equal(mutationJournalEventCount, 0, `${testCase.id} apply wrote mutation journal events before refusal`);

      const groupEvidence = blockedGroups.map((group) => {
        const groupMutations = plan.mutations
          .filter((mutation) => group.mutationIds.includes(mutation.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        const directBlockers = group.blockers
          .filter((blocker) => blocker.class !== 'atomic-group-blocker-propagation')
          .sort((a, b) => a.id.localeCompare(b.id));
        const propagatedBlockers = group.blockers
          .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation')
          .sort((a, b) => a.mutationId.localeCompare(b.mutationId));
        const directBlockerIds = directBlockers.map((blocker) => blocker.id);

        assert.ok(directBlockers.length > 0, `${testCase.id} ${group.id} missing source blockers`);
        assert.equal(
          propagatedBlockers.length,
          groupMutations.length,
          `${testCase.id} ${group.id} should propagate to every grouped mutation`,
        );
        assert.deepEqual(
          propagatedBlockers.map((blocker) => blocker.mutationId),
          groupMutations.map((mutation) => mutation.id),
          `${testCase.id} ${group.id} propagation mutation ids changed`,
        );
        assert.deepEqual(
          propagatedBlockers.map((blocker) => [...blocker.sourceBlockerIds].sort()),
          groupMutations.map(() => [...directBlockerIds].sort()),
          `${testCase.id} ${group.id} propagation source blockers changed`,
        );

        const entry = {
          id: group.id,
          status: group.status,
          mutationIds: [...group.mutationIds],
          directBlockers: directBlockers.map((blocker) => ({
            id: blocker.id,
            class: blocker.class,
            groupId: blocker.groupId,
            blockerHash: `sha256:${digest(blocker)}`,
          })),
          propagatedBlockers: propagatedBlockers.map((blocker) => ({
            id: blocker.id,
            class: blocker.class,
            groupId: blocker.groupId,
            mutationId: blocker.mutationId,
            resourceKey: blocker.resourceKey,
            sourceBlockerIds: [...blocker.sourceBlockerIds].sort(),
            blockerHash: `sha256:${digest(blocker)}`,
          })),
          mutations: groupMutations.map((mutation) => ({
            id: mutation.id,
            resourceKey: mutation.resourceKey,
            action: mutation.action,
            atomicGroupId: mutation.atomicGroupId,
            baseHash: mutation.baseHash,
            localHash: mutation.localHash,
            remoteBeforeHash: mutation.remoteBeforeHash,
            plannedValueHash: `sha256:${digest(deserializeResourceValue(mutation.value))}`,
          })),
        };
        const entryText = JSON.stringify(entry);
        for (const mutation of groupMutations) {
          assert.equal(
            entryText.includes(JSON.stringify(mutation.value)),
            false,
            `${testCase.id} ${group.id} hash-only evidence leaked payload for ${mutation.resourceKey}`,
          );
        }
        return entry;
      });

      return {
        id: testCase.id,
        tier: testCase.tier,
        family: testCase.family,
        tags: [...testCase.tags].sort(),
        status: plan.status,
        summary: plan.summary,
        groups: groupEvidence,
        refusal: {
          code: error.code,
          detailsHash: `sha256:${digest(error.details)}`,
          beforeRemoteHash: `sha256:${beforeRemoteHash}`,
          afterRemoteHash: `sha256:${digest(remote)}`,
          appliedMutationCount,
          durableJournalEventCount: journalEvents.length,
          mutationJournalEventCount,
        },
      };
    });
}

function emittedPlannerCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function aggregateGeneratedConflictApplyRefusalEvidence(evidence) {
  const aggregate = evidence.reduce(
    (aggregate, entry) => {
      aggregate.totalConflictCases++;
      aggregate.totalPlannedMutations += entry.plannedMutations;
      aggregate.totalPlannedPreconditions += entry.plannedPreconditions;
      aggregate.totalConflicts += entry.conflicts.length;
      aggregate.totalAppliedMutations += entry.appliedMutationCount;
      aggregate.totalMutationJournalEvents += entry.mutationJournalEventCount;
      if (entry.staleMutationAttempt) {
        aggregate.totalStaleAttempts++;
      }
      incrementCount(aggregate.families, entry.family);
      for (const conflict of entry.conflicts) {
        incrementCount(aggregate.conflictClasses, conflict.class);
      }
      for (const issueCode of entry.forgedReadyWithConflictEvidence.issueCodes) {
        incrementCount(aggregate.forgedIssueCodes, issueCode);
      }
      return aggregate;
    },
    {
      totalConflictCases: 0,
      totalPlannedMutations: 0,
      totalPlannedPreconditions: 0,
      totalConflicts: 0,
      totalAppliedMutations: 0,
      totalMutationJournalEvents: 0,
      totalStaleAttempts: 0,
      families: {},
      conflictClasses: {},
      forgedIssueCodes: {},
    },
  );

  return {
    ...aggregate,
    families: sortStringObject(aggregate.families),
    conflictClasses: sortStringObject(aggregate.conflictClasses),
    forgedIssueCodes: sortStringObject(aggregate.forgedIssueCodes),
  };
}

function aggregateGeneratedAtomicBlockerPropagationEvidence(evidence) {
  const aggregate = evidence.reduce(
    (aggregate, entry) => {
      aggregate.totalCases++;
      aggregate.totalBlockedGroups += entry.groups.length;
      aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
      aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;
      aggregate.totalMutationJournalEvents += entry.refusal.mutationJournalEventCount;
      incrementCount(aggregate.statuses, entry.status);
      incrementCount(aggregate.tiers, entry.tier);
      incrementCount(aggregate.families, entry.family);
      for (const group of entry.groups) {
        aggregate.totalGroupMutations += group.mutations.length;
        aggregate.totalDirectBlockers += group.directBlockers.length;
        aggregate.totalPropagatedBlockers += group.propagatedBlockers.length;
        for (const blocker of group.directBlockers) {
          incrementCount(aggregate.directBlockerClasses, blocker.class);
        }
      }
      return aggregate;
    },
    {
      totalCases: 0,
      totalBlockedGroups: 0,
      totalGroupMutations: 0,
      totalDirectBlockers: 0,
      totalPropagatedBlockers: 0,
      totalAppliedMutations: 0,
      totalDurableJournalEvents: 0,
      totalMutationJournalEvents: 0,
      statuses: {},
      tiers: {},
      families: {},
      directBlockerClasses: {},
    },
  );

  return {
    ...aggregate,
    statuses: sortStringObject(aggregate.statuses),
    tiers: sortNumericObject(aggregate.tiers),
    families: sortStringObject(aggregate.families),
    directBlockerClasses: sortStringObject(aggregate.directBlockerClasses),
  };
}

function aggregateGeneratedPlannerEvidence(evidence) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    statusByTier: {},
    tiers: {},
    featureFamilies: {},
    totalMutations: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalDecisions: 0,
    totalAtomicGroups: 0,
    totalPreconditions: 0,
  };

  for (const entry of evidence) {
    incrementCount(aggregate.statuses, entry.status);
    aggregate.statusByTier[entry.status] ||= {};
    incrementCount(aggregate.statusByTier[entry.status], entry.tier);
    incrementCount(aggregate.tiers, entry.tier);
    incrementCount(aggregate.featureFamilies, entry.family);
    for (const tag of entry.tags) {
      incrementCount(aggregate.featureFamilies, tag);
    }
    aggregate.totalMutations += entry.summary.mutations;
    aggregate.totalConflicts += entry.summary.conflicts;
    aggregate.totalBlockers += entry.summary.blockers;
    aggregate.totalDecisions += entry.summary.decisions;
    aggregate.totalAtomicGroups += entry.summary.atomicGroups;
    aggregate.totalPreconditions += entry.preconditions;
  }

  return {
    ...aggregate,
    statuses: sortStringObject(aggregate.statuses),
    statusByTier: sortNestedNumericObject(aggregate.statusByTier),
    tiers: sortNumericObject(aggregate.tiers),
    featureFamilies: sortStringObject(aggregate.featureFamilies),
  };
}

function reportPlannerSummaryTotals(summary) {
  return {
    totalCases: summary.totalCases,
    statuses: summary.statuses,
    statusByTier: summary.statusByTier,
    tiers: summary.tiers,
    featureFamilies: summary.featureFamilies,
    totalMutations: summary.totalMutations,
    totalConflicts: summary.totalConflicts,
    totalBlockers: summary.totalBlockers,
    totalDecisions: summary.totalDecisions,
  };
}

function reportComparablePlannerSummaryTotals(aggregate) {
  return {
    totalCases: aggregate.totalCases,
    statuses: aggregate.statuses,
    statusByTier: aggregate.statusByTier,
    tiers: aggregate.tiers,
    featureFamilies: aggregate.featureFamilies,
    totalMutations: aggregate.totalMutations,
    totalConflicts: aggregate.totalConflicts,
    totalBlockers: aggregate.totalBlockers,
    totalDecisions: aggregate.totalDecisions,
  };
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortNestedNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortNumericObject(value)]),
  );
}
