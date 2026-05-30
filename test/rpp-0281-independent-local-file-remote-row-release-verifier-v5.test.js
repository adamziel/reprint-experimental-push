import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';
import {
  independentLocalFileRemoteRowReleaseVerifierBoundary,
  summarizeIndependentLocalFileRemoteRowReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const fixedNow = new Date('2026-05-30T15:40:00.000Z');
const focusedRawFixtures = Object.freeze([
  'rpp-0281-focused-local-file-private-v5',
  'rpp-0281-focused-remote-row-private-v5',
  'rpp-0281-focused-stale-remote-file-private-v5',
]);

function assertSha256Evidence(value, label = 'sha256 evidence') {
  assert.match(value, sha256EvidencePattern, label);
}

function assertSha256(value, label = 'sha256 hash') {
  assert.match(value, sha256Pattern, label);
}

function generatedIndependentRawFixtures() {
  const raw = [];
  for (const testCase of generatePushHarnessCases()
    .filter((entry) => entry.family === independentLocalFileRemoteRowReleaseVerifierBoundary.family)) {
    const fileEntry = Object.entries(testCase.local.files || {})
      .find(([, payload]) => typeof payload === 'string' && payload.startsWith('independent local '));
    const rowEntry = Object.entries(testCase.remote.db?.wp_posts || {})
      .find(([, row]) => typeof row?.post_title === 'string' && row.post_title.startsWith('Independent remote '));

    assert.ok(fileEntry, `${testCase.id} missing generated independent file raw fixture`);
    assert.ok(rowEntry, `${testCase.id} missing generated independent row raw fixture`);
    raw.push(fileEntry[1], rowEntry[1].post_title, `rpp-0281-stale-generated-${testCase.id}`);
  }
  return raw;
}

function assertNoRawFixtures(value, rawFixtures, label = 'RPP-0281 release verifier proof') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked ${raw}`);
  }
  assert.equal(serialized.includes('post_title'), false, `${label} exposed raw post_title fields`);
}

function assertFixtureInvariant(row, label) {
  assert.equal(row.status, 'checked', `${label} status`);
  assert.equal(row.plan.status, 'ready', `${label} plan status`);
  assert.equal(row.plan.summary.conflicts, 0, `${label} conflicts`);
  assert.equal(row.plan.summary.blockers, 0, `${label} blockers`);
  assert.equal(row.plan.mutationCount, row.plan.summary.mutations, `${label} mutation count`);
  assert.equal(row.plan.decisionCount, row.plan.summary.decisions, `${label} decision count`);
  assert.equal(row.plan.preconditionCount, row.plan.summary.mutations, `${label} one precondition per mutation`);
  assertSha256Evidence(row.plan.hash, `${label} plan hash`);

  assert.match(row.fileKey, /^file:/, `${label} file key`);
  assert.match(row.rowKey, /^row:\["wp_posts",/, `${label} row key`);
  assert.equal(row.fileMutation.resourceKey, row.fileKey, `${label} file mutation key`);
  assert.equal(row.fileMutation.action, 'put', `${label} file mutation action`);
  assert.equal(row.fileMutation.remoteChange, 'unchanged', `${label} file remote change`);
  assert.equal(row.fileMutation.exactMutation, true, `${label} exact file mutation`);
  assertSha256(row.fileMutation.baseHash, `${label} file base hash`);
  assertSha256(row.fileMutation.localHash, `${label} file local hash`);
  assertSha256(row.fileMutation.remoteBeforeHash, `${label} file remote hash`);
  assert.equal(row.fileMutation.precondition.expectedHash, row.fileMutation.remoteBeforeHash, `${label} precondition hash`);
  assert.equal(row.fileMutation.precondition.checkedAgainst, 'live-remote', `${label} precondition scope`);
  assert.equal(row.fileMutation.precondition.exactPrecondition, true, `${label} exact precondition`);
  assertSha256Evidence(row.fileMutation.precondition.preconditionHash, `${label} precondition hash evidence`);
  assertSha256Evidence(row.fileMutation.mutationHash, `${label} mutation evidence hash`);

  assert.equal(row.remoteRowPreservation.resourceKey, row.rowKey, `${label} row preservation key`);
  assert.equal(row.remoteRowPreservation.decision, 'keep-remote', `${label} row decision`);
  assert.equal(row.remoteRowPreservation.localChange, 'unchanged', `${label} row local change`);
  assert.equal(row.remoteRowPreservation.remoteChange, 'update', `${label} row remote change`);
  assert.equal(row.remoteRowPreservation.exactDecision, true, `${label} exact decision`);
  assert.equal(row.remoteRowPreservation.noMutation, true, `${label} no row mutation`);
  assert.equal(row.remoteRowPreservation.noPrecondition, true, `${label} no row precondition`);
  assertSha256(row.remoteRowPreservation.baseHash, `${label} row base hash`);
  assertSha256(row.remoteRowPreservation.localHash, `${label} row local hash`);
  assertSha256(row.remoteRowPreservation.remoteHash, `${label} row remote hash`);
  assert.equal(row.remoteRowPreservation.rowHashAfter, row.remoteRowPreservation.rowHashBefore, `${label} row preserved`);
  assertSha256Evidence(row.remoteRowPreservation.preservationHash, `${label} preservation evidence hash`);

  assert.equal(row.applyCarryThrough.mutateRemote, true, `${label} mutate remote`);
  assert.equal(row.applyCarryThrough.fileApplied, true, `${label} file applied`);
  assert.equal(row.applyCarryThrough.remoteRowPreserved, true, `${label} remote row preserved`);
  assert.equal(row.applyCarryThrough.rowJournalEvents, 0, `${label} row journal events`);
  assert.ok(row.applyCarryThrough.journalPlannedEvents >= row.plan.summary.mutations, `${label} planned journal events`);
  assert.ok(row.applyCarryThrough.journalObservedEvents >= row.plan.summary.mutations, `${label} observed journal events`);

  assert.equal(row.staleReplay.preMutation, true, `${label} stale pre-mutation`);
  assert.equal(row.staleReplay.code, 'PRECONDITION_FAILED', `${label} stale code`);
  assert.equal(row.staleReplay.failedBeforeMutation, true, `${label} stale failed before mutation`);
  assert.equal(row.staleReplay.remoteUnchanged, true, `${label} stale remote unchanged`);
  assert.equal(row.staleReplay.remoteRowPreserved, true, `${label} stale row preserved`);
  assert.equal(row.staleReplay.remoteHashAfter, row.staleReplay.remoteHashBefore, `${label} stale remote hash`);
  assert.equal(row.staleReplay.rowHashAfter, row.staleReplay.rowHashBefore, `${label} stale row hash`);
  assertSha256Evidence(row.staleReplay.remoteHashBefore, `${label} stale remote hash evidence`);
  assertSha256(row.staleReplay.rowHashBefore, `${label} stale row resource hash`);
  assertSha256Evidence(row.proofHash, `${label} proof hash`);
}

test('RPP-0281 release verifier carries focused independent local file plus remote row invariant, variant 5', () => {
  const proof = summarizeIndependentLocalFileRemoteRowReleaseVerifierProof({ now: fixedNow });

  assert.equal(proof.rpp, 'RPP-0281');
  assert.equal(proof.evidenceSource, 'release-verifier-independent-local-file-remote-row-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'INDEPENDENT_LOCAL_FILE_REMOTE_ROW_PRESERVED_SUPPORT_ONLY');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.invariant, {
    plannedResource: 'local-file',
    preservedResource: 'remote-wp-posts-row',
    localFilePrecondition: 'live-remote',
    remoteRowDecision: 'keep-remote',
    remoteRowMutation: 'absent',
    remoteRowPrecondition: 'absent',
    staleReplayFailure: 'PRECONDITION_FAILED',
  });
  assert.deepEqual(proof.focused.plan.summary, {
    mutations: 1,
    decisions: 1,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 0,
  });
  assertFixtureInvariant(proof.focused, 'RPP-0281 focused release verifier invariant');
  assertSha256Evidence(proof.proofHash, 'RPP-0281 proof hash');
  assertNoRawFixtures(proof, focusedRawFixtures);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0281 release verifier focused proof' }));
});

test('RPP-0281 release verifier carries generated independent local file plus remote row fixtures, variant 5', () => {
  const proof = summarizeIndependentLocalFileRemoteRowReleaseVerifierProof({ now: fixedNow });

  assert.equal(proof.generated.source, 'generated');
  assert.equal(proof.generated.family, independentLocalFileRemoteRowReleaseVerifierBoundary.family);
  assert.equal(proof.generated.requiredTag, independentLocalFileRemoteRowReleaseVerifierBoundary.tag);
  assert.deepEqual(proof.generated.tiers, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(proof.generated.totalCases, proof.generated.rows.length);
  assert.deepEqual(proof.generated.statuses, { ready: proof.generated.totalCases });
  assert.deepEqual(proof.generated.validation, {
    applied: true,
    staleReplayRejected: true,
    staleReplayRejectionCode: 'PRECONDITION_FAILED',
    staleReplayRemoteUnchanged: true,
  });
  assertSha256Evidence(proof.generated.proofHash, 'RPP-0281 generated aggregate proof hash');

  for (const row of proof.generated.rows) {
    assertFixtureInvariant(row, `RPP-0281 generated ${row.id}`);
    assert.equal(row.validation.applied, true, `${row.id} validation applied`);
    assert.equal(row.validation.staleReplayRejected, true, `${row.id} validation stale replay`);
    assert.equal(row.validation.staleReplayRejectionCode, 'PRECONDITION_FAILED', `${row.id} validation code`);
    assert.equal(row.validation.staleReplayRemoteUnchanged, true, `${row.id} validation remote unchanged`);
  }

  assertNoRawFixtures(proof, [...focusedRawFixtures, ...generatedIndependentRawFixtures()], 'RPP-0281 generated proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0281 release verifier generated proof' }));
});

test('RPP-0281 production-shaped release verifier emits merge-invariant carry-through proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeIndependentLocalFileRemoteRowReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /independentLocalFileRemoteRow: summarizeIndependentLocalFileRemoteRowReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /mergeInvariants: mergeInvariantProof/);
  assert.match(verifierSource, /INDEPENDENT_LOCAL_FILE_REMOTE_ROW_PRESERVED_SUPPORT_ONLY/);
});
