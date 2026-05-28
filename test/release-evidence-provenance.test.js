import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_EVIDENCE_PROVENANCE_CONTRACT,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES,
  validateReleaseEvidenceProvenance,
} from '../src/release-evidence-provenance.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, 'fixtures/protocol/push-release-evidence-provenance-contract.json'),
    'utf8',
  ),
);

function validateFixture(evidenceRows = fixture.evidenceRows) {
  return validateReleaseEvidenceProvenance({
    ...fixture,
    evidenceRows,
  });
}

test('provenance contract exposes the required release evidence fields and checked statuses', () => {
  assert.equal(RELEASE_EVIDENCE_PROVENANCE_CONTRACT.schemaVersion, 1);
  assert.equal(RELEASE_EVIDENCE_PROVENANCE_CONTRACT.validator, fixture.validator);
  assert.deepEqual(RELEASE_EVIDENCE_PROVENANCE_CONTRACT.requiredFields, fixture.requiredFields);
  assert.deepEqual(RELEASE_EVIDENCE_PROVENANCE_CONTRACT.acceptedCommandStatuses, fixture.acceptedCommandStatuses);
});

test('fixture cases produce the pinned deterministic provenance summary', () => {
  const summary = validateFixture();

  assert.deepEqual(summary, fixture.expectedSummary);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.deepEqual(summary.productionRequired, {
    total: 8,
    accepted: 2,
    rejected: 6,
  });
});

test('accepted and rejected evidence ordering is stable independent of input row order', () => {
  const forwardSummary = validateFixture();
  const reversedSummary = validateFixture([...fixture.evidenceRows].reverse());
  const shuffledSummary = validateFixture([
    fixture.evidenceRows[5],
    fixture.evidenceRows[2],
    fixture.evidenceRows[9],
    fixture.evidenceRows[1],
    fixture.evidenceRows[7],
    fixture.evidenceRows[0],
    fixture.evidenceRows[4],
    fixture.evidenceRows[3],
    fixture.evidenceRows[8],
    fixture.evidenceRows[6],
  ]);

  assert.deepEqual(reversedSummary, forwardSummary);
  assert.deepEqual(shuffledSummary, forwardSummary);
});

test('fixture covers the fail-closed provenance reason codes required by release gates', () => {
  const summary = validateFixture();
  const observedCodes = new Set(summary.rejectedEvidence.flatMap((entry) => entry.reasonCodes));

  assert.deepEqual(
    fixture.reasonCodes.filter((code) => !observedCodes.has(code)),
    [],
  );
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtRequired));
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.observedAtStale));
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.productionSourceRequired));
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.subjectHashRequired));
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathRawUrl));
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.artifactPathSecretLike));
  assert.ok(observedCodes.has(RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.commandStatusUnchecked));
});

test('complete fresh operator production evidence is release ready', () => {
  const summary = validateReleaseEvidenceProvenance({
    referenceNow: fixture.referenceNow,
    maxEvidenceAgeHours: fixture.maxEvidenceAgeHours,
    evidenceRows: [
      {
        evidenceId: 'RPP-0020:verify-release-failure-reason',
        rppId: 'RPP-0020',
        sourceKind: 'operator-production',
        artifactPath: 'docs/evidence/release/verify-release-failure-reason.json',
        observedAt: '2026-05-28T11:30:00.000Z',
        command: 'npm run verify:release',
        status: 'checked-failed',
        subjectHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        operatorScope: 'final-release',
        productionRequired: true,
      },
      {
        evidenceId: 'RPP-0017:tmux-status-marker',
        rppId: 'RPP-0017',
        sourceKind: 'operator-production',
        artifactPath: 'docs/evidence/release/tmux-status-marker.ndjson',
        observedAt: '2026-05-28T10:30:00.000Z',
        command: 'tmux capture-pane -pt release-gates',
        status: 'checked-passed',
        subjectHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        operatorScope: 'final-release',
        productionRequired: true,
      },
    ],
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.releaseReady, true);
  assert.deepEqual(summary.acceptedEvidenceIds, [
    'RPP-0017:tmux-status-marker',
    'RPP-0020:verify-release-failure-reason',
  ]);
  assert.deepEqual(summary.rejectedEvidence, []);
  assert.deepEqual(summary.productionRequired, {
    total: 2,
    accepted: 2,
    rejected: 0,
  });
});

test('multi-failure placeholder rows keep reason code order deterministic', () => {
  const summary = validateReleaseEvidenceProvenance({
    referenceNow: fixture.referenceNow,
    maxEvidenceAgeHours: fixture.maxEvidenceAgeHours,
    evidenceRows: [
      {
        evidenceId: 'RPP-0019:multi-failure-placeholder',
        rppId: 'RPP-0019',
        sourceKind: 'local-playground',
        artifactPath: 'docs/evidence/release/agents-row.json?token=local-placeholder',
        command: 'cat .agents/RELEASE_GATES.md',
        status: 'generated',
        operatorScope: 'local-candidate',
        productionRequired: true,
      },
    ],
  });

  assert.deepEqual(summary.rejectedEvidence, [
    {
      evidenceId: 'RPP-0019:multi-failure-placeholder',
      rppId: 'RPP-0019',
      productionRequired: true,
      reasonCodes: [
        'OBSERVED_AT_REQUIRED',
        'PRODUCTION_SOURCE_REQUIRED',
        'SUBJECT_HASH_REQUIRED',
        'ARTIFACT_PATH_SECRET_LIKE',
        'COMMAND_STATUS_UNCHECKED',
      ],
    },
  ]);
  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
});
