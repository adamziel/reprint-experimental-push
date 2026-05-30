import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';
import {
  summarizeIndependentLocalRowRemoteFileReleaseVerifierProof,
  summarizeMergeInvariantReleaseVerifierProofs,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function generatedIndependentRowRemoteFileTargets(testCase) {
  const rowEntry = Object.entries(testCase.local.db.wp_posts)
    .find(([, row]) => row.post_title?.startsWith('Independent local row '));
  const fileEntry = Object.entries(testCase.remote.files)
    .find(([, contents]) => typeof contents === 'string' && contents.startsWith('independent remote file '));

  assert.ok(rowEntry, `${testCase.id} missing generated independent local row`);
  assert.ok(fileEntry, `${testCase.id} missing generated independent remote file`);

  return {
    rowTitle: rowEntry[1].post_title,
    fileValue: fileEntry[1],
  };
}

function assertNoRawGeneratedValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const testCase of generatePushHarnessCases()
    .filter((entry) => entry.family === 'independent-local-row-remote-file')) {
    const { rowTitle, fileValue } = generatedIndependentRowRemoteFileTargets(testCase);
    const forbiddenValues = [
      rowTitle,
      fileValue,
      `rpp-0282-forged-remote-file-overwrite-${testCase.id}`,
      `rpp-0282-stale-local-row-${testCase.id}`,
    ];
    for (const forbidden of forbiddenValues) {
      assert.equal(serialized.includes(forbidden), false, `release verifier proof leaked ${forbidden}`);
    }
  }
}

test('RPP-0282 release verifier carries independent local row plus remote file edit through forged and stale executor refusals', () => {
  const proof = summarizeIndependentLocalRowRemoteFileReleaseVerifierProof({
    now: new Date('2026-05-30T14:28:20.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0282');
  assert.equal(proof.evidenceSource, 'release-verifier-independent-local-row-remote-file-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'INDEPENDENT_LOCAL_ROW_REMOTE_FILE_FORGED_AND_STALE_REJECTED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'independent-local-row-remote-file',
    variant: 'v5',
    executorRejectsForgedOrStale: true,
  });
  assert.deepEqual(proof.invariant, {
    localRowMutation: true,
    independentRemoteFileDecision: 'keep-remote',
    unplannedRemoteFileMutationCount: 0,
    unplannedRemoteFilePreconditionCount: 0,
    staleReplayRefusalCode: 'PRECONDITION_FAILED',
    forgedPlanRefusalCode: 'PLAN_INVARIANT_VIOLATION',
    forgedPlanIssueCode: 'MUTATION_DECISION_RESOURCE_OVERLAP',
  });
  assert.deepEqual(proof.coverage, {
    family: 'independent-local-row-remote-file',
    target: 'independentLocalRowRemoteFileReleaseVerifierVariant5',
    total: 10,
    perTier: {
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
    },
    statuses: { ready: 10 },
  });
  assert.deepEqual(proof.totals, {
    readyPlans: 10,
    applied: 10,
    remoteFilePreserved: 10,
    rowMutationPreconditions: 10,
    remoteFileMutations: 0,
    remoteFilePreconditions: 0,
    forgedRejectedBeforeMutation: 10,
    staleRejectedBeforeMutation: 10,
  });
  assert.equal(proof.caseProofs.length, 10);

  for (const caseProof of proof.caseProofs) {
    assert.equal(caseProof.exactIndependentPlan, true, `${caseProof.id} exact independent plan`);
    assert.match(caseProof.planHash, sha256EvidencePattern);
    assert.equal(caseProof.rowMutation.action, 'put');
    assert.equal(caseProof.rowMutation.changeKind, 'update');
    assert.match(caseProof.rowMutation.baseHash, sha256Pattern);
    assert.match(caseProof.rowMutation.localHash, sha256Pattern);
    assert.match(caseProof.rowMutation.remoteBeforeHash, sha256Pattern);
    assert.equal(caseProof.rowPrecondition.resourceKey, caseProof.rowMutation.resourceKey);
    assert.equal(caseProof.rowPrecondition.expectedHash, caseProof.rowMutation.remoteBeforeHash);
    assert.equal(caseProof.rowPrecondition.checkedAgainst, 'live-remote');
    assert.equal(caseProof.rowPrecondition.matchesMutation, true);
    assert.equal(caseProof.remoteFileDecision.decision, 'keep-remote');
    assert.equal(caseProof.remoteFileDecision.remoteChange, 'update');
    assert.equal(caseProof.remoteFileDecision.noMutation, true);
    assert.equal(caseProof.remoteFileDecision.noPrecondition, true);
    assert.match(caseProof.remoteFileDecision.remoteHash, sha256Pattern);
    assert.equal(caseProof.validation.ready, true);
    assert.equal(caseProof.validation.applied, true);
    assert.equal(caseProof.validation.unplannedRemotePreserved, true);
    assert.equal(caseProof.validation.staleReplayRejected, true);
    assert.equal(caseProof.validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(caseProof.validation.staleReplayRemoteUnchanged, true);
    assert.equal(caseProof.applyCarryThrough.applied, true);
    assert.equal(caseProof.applyCarryThrough.remoteFilePreserved, true);
    assert.ok(caseProof.applyCarryThrough.mutationResourceKeys.includes(caseProof.rowMutation.resourceKey));
    assert.equal(
      caseProof.applyCarryThrough.mutationResourceKeys.includes(caseProof.remoteFileDecision.resourceKey),
      false,
      `${caseProof.id} apply journal must not target the remote-only file`,
    );
    assert.match(caseProof.applyCarryThrough.remoteHashAfter, sha256EvidencePattern);
    assert.equal(caseProof.forgedRemoteFileMutation.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(caseProof.forgedRemoteFileMutation.issueCodes.includes('MUTATION_DECISION_RESOURCE_OVERLAP'));
    assert.equal(caseProof.forgedRemoteFileMutation.rejectedBeforeMutation, true);
    assert.equal(caseProof.forgedRemoteFileMutation.eventCount, 0);
    assert.equal(caseProof.forgedRemoteFileMutation.remoteHashAfter, caseProof.forgedRemoteFileMutation.remoteHashBefore);
    assert.match(caseProof.forgedRemoteFileMutation.detailsHash, sha256EvidencePattern);
    assert.equal(caseProof.staleRowReplay.code, 'PRECONDITION_FAILED');
    assert.equal(caseProof.staleRowReplay.resourceKey, caseProof.rowMutation.resourceKey);
    assert.equal(caseProof.staleRowReplay.expectedHash, caseProof.rowMutation.remoteBeforeHash);
    assert.match(caseProof.staleRowReplay.actualHash, sha256Pattern);
    assert.equal(caseProof.staleRowReplay.rejectedBeforeMutation, true);
    assert.equal(caseProof.staleRowReplay.eventCount, 0);
    assert.equal(caseProof.staleRowReplay.remoteHashAfter, caseProof.staleRowReplay.remoteHashBefore);
    assert.match(caseProof.staleRowReplay.detailsHash, sha256EvidencePattern);
  }

  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawGeneratedValues(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0282 release verifier merge-invariant proof' }));
});

test('RPP-0282 production-shaped release verifier emits merge-invariant carry-through proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const mergeInvariants = summarizeMergeInvariantReleaseVerifierProofs();

  assert.equal(mergeInvariants.independentLocalRowRemoteFile.rpp, 'RPP-0282');
  assert.equal(mergeInvariants.independentLocalRowRemoteFile.status, 'support_only');
  assert.match(verifierSource, /export function summarizeIndependentLocalRowRemoteFileReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /independentLocalRowRemoteFile: summarizeIndependentLocalRowRemoteFileReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /mergeInvariants: mergeInvariantProofs/);
  assert.match(verifierSource, /INDEPENDENT_LOCAL_ROW_REMOTE_FILE_FORGED_AND_STALE_REJECTED/);
});
