import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';
import {
  fileCreateUpdateDeleteMixReleaseVerifierBoundary,
  summarizeFileCreateUpdateDeleteMixReleaseVerifierProof,
  summarizeGeneratedHarnessReleaseVerifierProofs,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const expectedPerTier = Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2]));
const fixedNow = new Date('2026-05-30T19:20:00.000Z');

function targetCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(fileCreateUpdateDeleteMixReleaseVerifierBoundary.tag));
}

function generatedRawSentinels() {
  const raw = [];
  for (const testCase of targetCases()) {
    raw.push(`rpp-0181-stale-file-mix-update-${testCase.id}`);
    for (const value of Object.values(testCase.local.files || {})) {
      if (typeof value === 'string' && value.startsWith('generated file mix ')) {
        raw.push(value);
      }
    }
    for (const value of Object.values(testCase.remote.files || {})) {
      if (
        typeof value === 'string'
        && (
          value.startsWith('remote-only file mix preserve ')
          || value.startsWith('remote concurrent file mix update ')
        )
      ) {
        raw.push(value);
      }
    }
  }
  return raw;
}

function assertNoRawGeneratedValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const raw of generatedRawSentinels()) {
    assert.equal(serialized.includes(raw), false, `RPP-0181 proof leaked raw fixture ${raw}`);
  }
  assert.equal(serialized.includes('generated file mix create '), false);
  assert.equal(serialized.includes('generated file mix update '), false);
  assert.equal(serialized.includes('remote-only file mix preserve '), false);
  assert.equal(serialized.includes('remote concurrent file mix update '), false);
}

function assertReadyCase(caseProof) {
  assert.equal(caseProof.variant, 'ready');
  assert.equal(caseProof.status, 'ready');
  assert.equal(caseProof.exactReady, true);
  assert.ok(caseProof.planSummary.mutations >= 3);
  assert.ok(caseProof.planSummary.decisions >= 1);
  assert.equal(caseProof.planSummary.conflicts, 0);
  assert.equal(caseProof.planSummary.blockers, 0);
  assert.deepEqual(caseProof.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(caseProof.mutations.length, 3);
  assert.ok(caseProof.preconditions.count >= 3);
  assert.equal(caseProof.preconditions.oneToOneLiveRemote, true);
  assert.match(caseProof.planHash, sha256EvidencePattern);

  for (const mutation of caseProof.mutations) {
    assert.equal(mutation.action, mutation.changeKind === 'delete' ? 'delete' : 'put');
    assert.equal(mutation.appliedLocalHashMatches, true);
    assert.equal(mutation.exactKind, true);
    assert.match(mutation.baseHash, sha256Pattern);
    assert.match(mutation.localHash, sha256Pattern);
    assert.match(mutation.remoteBeforeHash, sha256Pattern);
    assert.match(mutation.localResourceHash, sha256Pattern);
    assert.match(mutation.appliedHash, sha256Pattern);
    assert.equal(mutation.precondition.resourceKey, mutation.resourceKey);
    assert.equal(mutation.precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(mutation.precondition.checkedAgainst, 'live-remote');
    assert.equal(mutation.precondition.matchesMutation, true);
    assert.match(mutation.precondition.preconditionHash, sha256EvidencePattern);
    assert.match(mutation.mutationHash, sha256EvidencePattern);
  }

  assert.equal(caseProof.remoteOnly.decision, 'keep-remote');
  assert.equal(caseProof.remoteOnly.plannedMutation, false);
  assert.equal(caseProof.remoteOnly.plannedPrecondition, false);
  assert.equal(caseProof.remoteOnly.preserved, true);
  assert.equal(caseProof.remoteOnly.remoteHashAfter, caseProof.remoteOnly.remoteHashBefore);
  assert.match(caseProof.remoteOnly.decisionHash, sha256EvidencePattern);
  assert.equal(caseProof.applyCarryThrough.applied, true);
  assert.equal(caseProof.applyCarryThrough.appliedMutations, caseProof.planSummary.mutations);
  assert.equal(caseProof.applyCarryThrough.createUpdateDeleteApplied, true);
  assert.match(caseProof.applyCarryThrough.remoteHashAfter, sha256EvidencePattern);
  assert.equal(caseProof.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(caseProof.staleReplay.rejectedBeforeMutation, true);
  assert.equal(caseProof.staleReplay.eventCount, 0);
  assert.equal(caseProof.staleReplay.remoteHashAfter, caseProof.staleReplay.remoteHashBefore);
  assert.match(caseProof.staleReplay.detailsHash, sha256EvidencePattern);
  assert.equal(caseProof.validation.status, 'ready');
  assert.equal(caseProof.validation.applied, true);
  assert.equal(caseProof.validation.unplannedRemotePreserved, true);
  assert.equal(caseProof.validation.staleReplayRejected, true);
  assert.equal(caseProof.validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(caseProof.validation.staleReplayRemoteUnchanged, true);
}

function assertNonReadyCase(caseProof) {
  assert.equal(caseProof.variant, 'non-ready');
  assert.equal(caseProof.status, 'conflict');
  assert.equal(caseProof.exactNonReady, true);
  assert.ok(caseProof.planSummary.mutations >= 2);
  assert.ok(caseProof.planSummary.decisions >= 1);
  assert.ok(caseProof.planSummary.conflicts >= 1);
  assert.match(caseProof.planHash, sha256EvidencePattern);
  assert.equal(caseProof.conflict.class, 'file-conflict');
  assert.equal(caseProof.conflict.localChange, 'update');
  assert.equal(caseProof.conflict.remoteChange, 'update');
  assert.equal(caseProof.conflict.targetMutationSuppressed, true);
  assert.equal(caseProof.conflict.targetPreconditionSuppressed, true);
  assert.equal(caseProof.conflict.exactConflict, true);
  assert.match(caseProof.conflict.conflictHash, sha256EvidencePattern);
  assert.equal(caseProof.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(caseProof.applyRefusal.rejectedBeforeMutation, true);
  assert.equal(caseProof.applyRefusal.eventCount, 0);
  assert.equal(caseProof.applyRefusal.remoteHashAfter, caseProof.applyRefusal.remoteHashBefore);
  assert.match(caseProof.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.equal(caseProof.validation.status, 'conflict');
  assert.equal(caseProof.validation.applied, false);
  assert.equal(caseProof.validation.nonReadyRemoteUnchanged, true);
}

test('RPP-0181 generated harness emits ready and non-ready file mix release-verifier v5 target coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileCreateUpdateDeleteMixReleaseVerifierVariant5;
  const cases = targetCases();
  const readyCase = cases.find((testCase) => testCase.tags.has(fileCreateUpdateDeleteMixReleaseVerifierBoundary.readyTag));
  const nonReadyCase = cases.find((testCase) =>
    testCase.tags.has(fileCreateUpdateDeleteMixReleaseVerifierBoundary.nonReadyTag));

  assert.ok(coverage, 'missing file create/update/delete release-verifier v5 target coverage');
  assert.equal(coverage.family, fileCreateUpdateDeleteMixReleaseVerifierBoundary.family);
  assert.equal(coverage.total, report.summary.featureFamilies[fileCreateUpdateDeleteMixReleaseVerifierBoundary.tag]);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.perTier, expectedPerTier);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.equal(report.summary.featureFamilies[fileCreateUpdateDeleteMixReleaseVerifierBoundary.readyTag], 10);
  assert.equal(report.summary.featureFamilies[fileCreateUpdateDeleteMixReleaseVerifierBoundary.nonReadyTag], 10);
  assert.ok(readyCase, 'missing ready file create/update/delete release-verifier case');
  assert.ok(nonReadyCase, 'missing non-ready file create/update/delete release-verifier case');
  assert.equal(validateGeneratedCase(readyCase).status, 'ready');
  assert.equal(validateGeneratedCase(nonReadyCase).status, 'conflict');
});

test('RPP-0181 release verifier carries file create/update/delete ready and non-ready generated cases', () => {
  const proof = summarizeFileCreateUpdateDeleteMixReleaseVerifierProof({ now: fixedNow });

  assert.equal(proof.rpp, 'RPP-0181');
  assert.equal(proof.evidenceSource, 'release-verifier-file-create-update-delete-mix-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'FILE_CREATE_UPDATE_DELETE_MIX_READY_AND_NON_READY_VERIFIED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, fileCreateUpdateDeleteMixReleaseVerifierBoundary.evidenceScope);
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'file-create-update-delete-mix',
    variant: 'v5',
    generatedHarnessReadyAndNonReady: true,
    executorCarriesReadyAndRejectsConflict: true,
  });
  assert.deepEqual(proof.coverage, {
    family: fileCreateUpdateDeleteMixReleaseVerifierBoundary.family,
    target: 'fileCreateUpdateDeleteMixReleaseVerifierVariant5',
    total: 20,
    perTier: expectedPerTier,
    statuses: { conflict: 10, ready: 10 },
  });
  assert.deepEqual(proof.totals, {
    readyCases: 10,
    nonReadyCases: 10,
    readyApplied: 10,
    readyCreateUpdateDeleteApplied: 10,
    readyRemoteOnlyPreserved: 10,
    readyStaleReplayRejected: 10,
    readyPreconditionsOneToOne: 10,
    nonReadyConflicts: 10,
    nonReadyApplyRefusedBeforeMutation: 10,
    nonReadyTargetMutationSuppressed: 10,
    nonReadyRemoteUnchanged: 10,
  });
  assert.equal(proof.caseProofs.length, 20);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assert.equal(proof.rawValuesIncluded, false);

  const readyProof = proof.caseProofs.find((caseProof) => caseProof.variant === 'ready');
  const nonReadyProof = proof.caseProofs.find((caseProof) => caseProof.variant === 'non-ready');
  assert.ok(readyProof, 'missing selected ready proof');
  assert.ok(nonReadyProof, 'missing selected non-ready proof');
  assertReadyCase(readyProof);
  assertNonReadyCase(nonReadyProof);
  assert.equal(proof.caseProofs.every((caseProof) => caseProof.exactReady === true || caseProof.exactNonReady === true), true);
  assertNoRawGeneratedValues(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0181 release verifier file CUD proof' }));
});

test('RPP-0181 production-shaped release verifier emits generated-harness carry-through proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const generatedHarness = summarizeGeneratedHarnessReleaseVerifierProofs();

  assert.equal(generatedHarness.fileCreateUpdateDeleteMix.rpp, 'RPP-0181');
  assert.equal(generatedHarness.fileCreateUpdateDeleteMix.status, 'support_only');
  assert.match(verifierSource, /export function summarizeFileCreateUpdateDeleteMixReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /fileCreateUpdateDeleteMix: summarizeFileCreateUpdateDeleteMixReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /generatedHarness: generatedHarnessProofs/);
  assert.match(verifierSource, /FILE_CREATE_UPDATE_DELETE_MIX_READY_AND_NON_READY_VERIFIED/);
});
