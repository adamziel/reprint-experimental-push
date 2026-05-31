import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import {
  deserializeResourceValue,
  resourceHash,
  serializeResourceValue,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T09:29:08.000Z');
const command = 'node --test test/rpp-0298-forged-ready-plan-defense-release-verifier-v5.test.js';
const caveat = 'Local release-verifier support evidence only; final release remains NO-GO.';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  '<?php echo "rpp-0298-release-verifier-base-index";',
  '<?php echo "rpp-0298-release-verifier-local-index-private";',
  'rpp-0298-release-verifier-base-private-title',
  'rpp-0298-release-verifier-local-private-title',
  'rpp-0298-release-verifier-forged-raw-private-hash',
  '<?php echo "rpp-0298-release-verifier-forged-payload-private";',
]);

const boundary = Object.freeze({
  filePath: 'wp-content/themes/rpp-0298/index.php',
  postRowId: 'ID:298',
  fileResourceKey: 'file:wp-content/themes/rpp-0298/index.php',
  postResourceKey: 'row:["wp_posts","ID:298"]',
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashEvidence(value) {
  return `sha256:${digest(value)}`;
}

function baseSite() {
  return {
    files: {
      [boundary.filePath]: rawFixtures[0],
    },
    plugins: {},
    db: {
      wp_options: {},
      wp_posts: {
        [boundary.postRowId]: {
          ID: 298,
          post_title: rawFixtures[2],
          post_status: 'publish',
        },
      },
    },
  };
}

function releaseVerifierSnapshots() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files[boundary.filePath] = rawFixtures[1];
  local.db.wp_posts[boundary.postRowId].post_title = rawFixtures[3];

  return { base, local, remote };
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
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(mutation, `missing mutation for ${resourceKey}`);
  return mutation;
}

function preconditionFor(plan, resourceKey) {
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(precondition, `missing precondition for ${resourceKey}`);
  return precondition;
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
    atomicGroups: copy.atomicGroups.length,
  };
  return copy;
}

function claimOpenedDurableJournal() {
  return {
    claimFenced: true,
    claimOpened: true,
    claimHash: '9'.repeat(64),
    events: [],
    appendEvent(type, payload) {
      const record = { sequence: this.events.length + 1, type, ...payload };
      this.events.push(record);
      return record;
    },
  };
}

function issueCodes(error) {
  return (error.details.issues || []).map((issue) => issue.code).sort();
}

function hashFieldEvidence(value) {
  if (typeof value === 'string' && sha256HexPattern.test(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return { state: 'missing' };
  }
  return {
    state: 'redacted-invalid-hash',
    sha256: hashEvidence(value),
    valueType: Array.isArray(value) ? 'array' : typeof value,
    characterCount: typeof value === 'string' ? value.length : undefined,
  };
}

function plannedValueHash(mutation) {
  try {
    return hashEvidence(deserializeResourceValue(mutation.value));
  } catch {
    return { state: 'unreadable-planned-value' };
  }
}

function summarizeMutation(mutation) {
  return {
    id: mutation.id,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind || null,
    baseHash: hashFieldEvidence(mutation.baseHash),
    localHash: hashFieldEvidence(mutation.localHash),
    remoteBeforeHash: hashFieldEvidence(mutation.remoteBeforeHash),
    plannedValueHash: plannedValueHash(mutation),
    mutationHash: hashEvidence(mutation),
  };
}

function summarizePrecondition(precondition) {
  return {
    mutationId: precondition.mutationId,
    resourceKey: precondition.resourceKey,
    expectedHash: hashFieldEvidence(precondition.expectedHash),
    checkedAgainst: precondition.checkedAgainst,
    preconditionHash: hashEvidence(precondition),
  };
}

function assertReadyPlanBoundary(plan, remote) {
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 2);
  assert.equal(plan.preconditions.length, plan.mutations.length);
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.resourceKey).sort(),
    [boundary.fileResourceKey, boundary.postResourceKey].sort(),
  );

  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation.resourceKey);
    assert.equal(precondition.mutationId, mutation.id);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(mutation.remoteBeforeHash, resourceHash(remote, mutation.resource));
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  }
}

function assertNoRawFixtures(value, label = 'RPP-0298 release verifier evidence') {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('"content"'), false, `${label} must not expose raw file content fields`);
  assert.equal(serialized.includes('post_title'), false, `${label} must not expose raw post_title fields`);
}

function applyForgedPlan({ forgedPlan, remoteSnapshot, expectedIssueCodes, attack }) {
  const applyRemote = cloneJson(remoteSnapshot);
  const beforeRemote = cloneJson(applyRemote);
  const beforeRemoteHash = hashEvidence(beforeRemote);
  const durableJournal = claimOpenedDurableJournal();
  let beforeMutationCalls = 0;
  let appliedMutationCount = 0;

  const error = captureError(() => {
    const result = applyPlan(applyRemote, forgedPlan, {
      mutateRemote: true,
      durableJournal,
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
    appliedMutationCount = result.appliedMutations;
  });

  assert.ok(error instanceof PushPlanError, `${attack} should raise PushPlanError`);
  assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION', attack);
  assert.deepEqual(
    expectedIssueCodes.every((code) => issueCodes(error).includes(code)),
    true,
    `${attack} missing expected issue codes`,
  );
  assert.deepEqual(applyRemote, beforeRemote, `${attack} mutated remote before refusal`);
  assert.equal(hashEvidence(applyRemote), beforeRemoteHash, `${attack} changed remote hash`);
  assert.equal(beforeMutationCalls, 0, `${attack} reached beforeMutation hook`);
  assert.equal(appliedMutationCount, 0, `${attack} reported applied mutations`);
  assert.deepEqual(durableJournal.events, [], `${attack} wrote durable journal events`);
  assertNoRawFixtures(error.details, `${attack} refusal details`);

  return {
    attack,
    rejectedBeforeMutation: true,
    code: error.code,
    issueCodes: issueCodes(error),
    expectedIssueCodes: [...expectedIssueCodes].sort(),
    issueCount: issueCodes(error).length,
    details: error.details,
    detailsHash: hashEvidence(error.details),
    forgedPlanHash: hashEvidence(forgedPlan),
    remoteHashBefore: beforeRemoteHash,
    remoteHashAfter: hashEvidence(applyRemote),
    remotePreserved: true,
    beforeMutationCalls,
    appliedMutationCount,
    journalEventTypes: durableJournal.events.map((event) => event.type),
    targetOrMutationJournalEvents: durableJournal.events.filter(
      (event) => event.type === 'target-planned' || event.type.includes('mutation'),
    ).length,
  };
}

function summarizeForgedReadyPlanDefenseReleaseVerifierProof({ now = fixedNow } = {}) {
  const { base, local, remote } = releaseVerifierSnapshots();
  const plan = createPushPlan({ base, local, remote, now });
  assertReadyPlanBoundary(plan, remote);

  const fileMutation = mutationFor(plan, boundary.fileResourceKey);
  const postMutation = mutationFor(plan, boundary.postResourceKey);
  const filePrecondition = preconditionFor(plan, boundary.fileResourceKey);

  const forgedPlans = [
    {
      attack: 'missing-live-precondition-with-raw-remote-before-hash',
      expectedIssueCodes: ['MISSING_LIVE_REMOTE_PRECONDITION', 'REMOTE_BEFORE_HASH_INVALID'],
      plan: tamperReadyPlan(plan, (copy) => {
        const mutation = mutationFor(copy, fileMutation.resourceKey);
        mutation.remoteBeforeHash = rawFixtures[4];
        copy.preconditions = copy.preconditions.filter(
          (precondition) => precondition.mutationId !== mutation.id,
        );
      }),
    },
    {
      attack: 'duplicate-live-precondition',
      expectedIssueCodes: ['DUPLICATE_LIVE_REMOTE_PRECONDITION'],
      plan: tamperReadyPlan(plan, (copy) => {
        copy.preconditions.push(cloneJson(filePrecondition));
      }),
    },
    {
      attack: 'precondition-hash-mismatch-with-raw-private-hash',
      expectedIssueCodes: ['PRECONDITION_HASH_MISMATCH'],
      plan: tamperReadyPlan(plan, (copy) => {
        preconditionFor(copy, postMutation.resourceKey).expectedHash = rawFixtures[4];
      }),
    },
    {
      attack: 'forged-private-mutation-body',
      expectedIssueCodes: ['LOCAL_HASH_MISMATCH'],
      plan: tamperReadyPlan(plan, (copy) => {
        mutationFor(copy, fileMutation.resourceKey).value = serializeResourceValue({
          type: 'file',
          content: rawFixtures[5],
        });
      }),
    },
  ];

  const forgedRefusals = forgedPlans.map((forged) =>
    applyForgedPlan({
      forgedPlan: forged.plan,
      remoteSnapshot: remote,
      expectedIssueCodes: forged.expectedIssueCodes,
      attack: forged.attack,
    }));

  const proof = {
    rpp: 'RPP-0298',
    evidenceSource: 'release-verifier-forged-ready-plan-defense-v5',
    status: 'support_only',
    verdict: 'FORGED_READY_PLAN_DEFENSE_FAIL_CLOSED_BEFORE_MUTATION',
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    evidenceScope: 'local-focused-release-verifier',
    command,
    caveat,
    releaseVerifier: {
      checkedBy: 'test/rpp-0298-forged-ready-plan-defense-release-verifier-v5.test.js',
      check: 'forged-ready-plan-defense',
      variant: 'v5',
      serializedPlanEvidence: 'hash-only',
      executorRejectsForgedReadyPlans: true,
      finalReleaseRecommendation: 'NO-GO',
    },
    scenario: {
      resourceKeys: [boundary.fileResourceKey, boundary.postResourceKey],
      forgedAttackCount: forgedRefusals.length,
      rawFixtureStringsIncluded: false,
    },
    readyPlan: {
      status: plan.status,
      summary: plan.summary,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      decisionCount: plan.decisions.length,
      conflictCount: plan.conflicts.length,
      blockerCount: plan.blockers.length,
      hash: hashEvidence(plan),
      mutations: plan.mutations.map(summarizeMutation),
      preconditions: plan.preconditions.map(summarizePrecondition),
    },
    forgedRefusals,
    aggregate: {
      allRejectedBeforeMutation: forgedRefusals.every((entry) => entry.rejectedBeforeMutation),
      allRemotePreserved: forgedRefusals.every((entry) => entry.remotePreserved),
      totalBeforeMutationCalls: forgedRefusals.reduce((sum, entry) => sum + entry.beforeMutationCalls, 0),
      totalAppliedMutations: forgedRefusals.reduce((sum, entry) => sum + entry.appliedMutationCount, 0),
      totalJournalEvents: forgedRefusals.reduce((sum, entry) => sum + entry.journalEventTypes.length, 0),
      issueCodes: [...new Set(forgedRefusals.flatMap((entry) => entry.issueCodes))].sort(),
    },
    redaction: {
      format: 'hash-only',
      rawFixtureStringsIncluded: false,
      rawSiteFieldNamesIncluded: false,
      surfaces: [
        'ready-plan-boundary',
        'forged-plan-refusals',
        'refusal-details',
        'remote-preservation-hashes',
        'release-verifier-proof',
      ],
    },
  };

  return {
    ...proof,
    proofHash: hashEvidence(proof),
  };
}

test('RPP-0298 release verifier forged ready plans fail closed with hash-only evidence', () => {
  const proof = summarizeForgedReadyPlanDefenseReleaseVerifierProof();

  assert.equal(proof.rpp, 'RPP-0298');
  assert.equal(proof.evidenceSource, 'release-verifier-forged-ready-plan-defense-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'FORGED_READY_PLAN_DEFENSE_FAIL_CLOSED_BEFORE_MUTATION');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-focused-release-verifier');
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'test/rpp-0298-forged-ready-plan-defense-release-verifier-v5.test.js',
    check: 'forged-ready-plan-defense',
    variant: 'v5',
    serializedPlanEvidence: 'hash-only',
    executorRejectsForgedReadyPlans: true,
    finalReleaseRecommendation: 'NO-GO',
  });

  assert.equal(proof.readyPlan.status, 'ready');
  assert.deepEqual(proof.readyPlan.summary, {
    mutations: 2,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.equal(proof.readyPlan.mutationCount, 2);
  assert.equal(proof.readyPlan.preconditionCount, 2);
  assert.equal(proof.readyPlan.decisionCount, 0);
  assert.equal(proof.readyPlan.conflictCount, 0);
  assert.equal(proof.readyPlan.blockerCount, 0);
  assert.match(proof.readyPlan.hash, sha256EvidencePattern);

  for (const mutation of proof.readyPlan.mutations) {
    assert.ok(proof.scenario.resourceKeys.includes(mutation.resourceKey));
    assert.match(mutation.baseHash, sha256HexPattern);
    assert.match(mutation.localHash, sha256HexPattern);
    assert.match(mutation.remoteBeforeHash, sha256HexPattern);
    assert.match(mutation.plannedValueHash, sha256EvidencePattern);
    assert.match(mutation.mutationHash, sha256EvidencePattern);
  }

  for (const precondition of proof.readyPlan.preconditions) {
    assert.ok(proof.scenario.resourceKeys.includes(precondition.resourceKey));
    assert.match(precondition.expectedHash, sha256HexPattern);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.match(precondition.preconditionHash, sha256EvidencePattern);
  }

  assert.deepEqual(
    proof.forgedRefusals.map((entry) => entry.attack),
    [
      'missing-live-precondition-with-raw-remote-before-hash',
      'duplicate-live-precondition',
      'precondition-hash-mismatch-with-raw-private-hash',
      'forged-private-mutation-body',
    ],
  );
  assert.deepEqual(proof.aggregate.issueCodes, [
    'DUPLICATE_LIVE_REMOTE_PRECONDITION',
    'LOCAL_HASH_MISMATCH',
    'MISSING_LIVE_REMOTE_PRECONDITION',
    'PRECONDITION_HASH_MISMATCH',
    'REMOTE_BEFORE_HASH_INVALID',
  ]);
  assert.equal(proof.aggregate.allRejectedBeforeMutation, true);
  assert.equal(proof.aggregate.allRemotePreserved, true);
  assert.equal(proof.aggregate.totalBeforeMutationCalls, 0);
  assert.equal(proof.aggregate.totalAppliedMutations, 0);
  assert.equal(proof.aggregate.totalJournalEvents, 0);

  for (const refusal of proof.forgedRefusals) {
    assert.equal(refusal.rejectedBeforeMutation, true, refusal.attack);
    assert.equal(refusal.code, 'PLAN_INVARIANT_VIOLATION', refusal.attack);
    assert.equal(refusal.remotePreserved, true, refusal.attack);
    assert.equal(refusal.beforeMutationCalls, 0, refusal.attack);
    assert.equal(refusal.appliedMutationCount, 0, refusal.attack);
    assert.equal(refusal.targetOrMutationJournalEvents, 0, refusal.attack);
    assert.deepEqual(refusal.journalEventTypes, [], refusal.attack);
    assert.match(refusal.detailsHash, sha256EvidencePattern);
    assert.match(refusal.forgedPlanHash, sha256EvidencePattern);
    assert.match(refusal.remoteHashBefore, sha256EvidencePattern);
    assert.equal(refusal.remoteHashAfter, refusal.remoteHashBefore);
    for (const expectedIssueCode of refusal.expectedIssueCodes) {
      assert.ok(refusal.issueCodes.includes(expectedIssueCode), refusal.attack);
    }
  }

  const missingPrecondition = proof.forgedRefusals[0];
  const invalidHashIssue = missingPrecondition.details.issues.find(
    (issue) => issue.code === 'REMOTE_BEFORE_HASH_INVALID',
  );
  const missingPreconditionIssue = missingPrecondition.details.issues.find(
    (issue) => issue.code === 'MISSING_LIVE_REMOTE_PRECONDITION',
  );
  assert.deepEqual(invalidHashIssue.remoteBeforeHash, {
    state: 'invalid',
    sha256: digest(rawFixtures[4]),
    valueType: 'string',
    characterCount: rawFixtures[4].length,
  });
  assert.deepEqual(missingPreconditionIssue.expectedHash, invalidHashIssue.remoteBeforeHash);

  const hashMismatch = proof.forgedRefusals[2].details.issues.find(
    (issue) => issue.code === 'PRECONDITION_HASH_MISMATCH',
  );
  assert.deepEqual(hashMismatch.actualHash, {
    state: 'invalid',
    sha256: digest(rawFixtures[4]),
    valueType: 'string',
    characterCount: rawFixtures[4].length,
  });

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawFixtureStringsIncluded, false);
  assert.equal(proof.redaction.rawSiteFieldNamesIncluded, false);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0298 forged ready release verifier proof' }));
});

test('RPP-0298 release verifier proof is deterministic and scoped to NO-GO support evidence', () => {
  const proof = summarizeForgedReadyPlanDefenseReleaseVerifierProof();
  const replayProof = summarizeForgedReadyPlanDefenseReleaseVerifierProof();

  assert.deepEqual(proof, replayProof);
  assert.equal(proof.command, command);
  assert.equal(proof.caveat, caveat);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.aggregate.allRejectedBeforeMutation, true);
  assert.equal(proof.aggregate.totalBeforeMutationCalls, 0);
  assertNoRawFixtures(JSON.stringify(proof), 'serialized deterministic proof');
});
