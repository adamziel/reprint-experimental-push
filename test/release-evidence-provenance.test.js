import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_EVIDENCE_PROVENANCE_CONTRACT,
  RELEASE_EVIDENCE_PROVENANCE_REASON_CODES,
  releaseGateProvenanceRequirements,
  releaseGateProvenanceSubjectHash,
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

function expectedReleaseGateRequirement(gate) {
  return {
    evidenceId: `release-gate:${gate.id}`,
    rppId: gate.rpp,
    gateId: gate.id,
    title: gate.title,
    expectedSubjectHash: releaseGateProvenanceSubjectHash(gate),
    productionRequired: true,
  };
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

test('production-run rows are labels only and do not satisfy production-required provenance', () => {
  assert.equal(
    RELEASE_EVIDENCE_PROVENANCE_CONTRACT.productionSourceKinds.includes('production-run'),
    false,
  );

  const summary = validateReleaseEvidenceProvenance({
    referenceNow: fixture.referenceNow,
    maxEvidenceAgeHours: fixture.maxEvidenceAgeHours,
    evidenceRows: [
      {
        evidenceId: 'RPP-0020:verify-release-failure-reason',
        rppId: 'RPP-0020',
        sourceKind: 'production-run',
        artifactPath: 'docs/evidence/release/verify-release-failure-reason.json',
        observedAt: '2026-05-28T11:30:00.000Z',
        command: 'npm run verify:release',
        status: 'checked-failed',
        subjectHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        operatorScope: 'final-release',
        productionRequired: true,
      },
    ],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.deepEqual(summary.rejectedEvidence, [
    {
      evidenceId: 'RPP-0020:verify-release-failure-reason',
      rppId: 'RPP-0020',
      productionRequired: true,
      reasonCodes: [RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.productionSourceRequired],
    },
  ]);
  assert.deepEqual(summary.productionRequired, {
    total: 1,
    accepted: 0,
    rejected: 1,
  });
});

test('production-required provenance rejects subject hashes that do not match the required gate subject', () => {
  const gate = {
    id: 'tmux-status-marker',
    rpp: 'RPP-0017',
    title: 'tmux stdout proof status marker',
    category: 'operator-proof',
    status: 'passed',
    code: 'OK',
    reason: 'tmux stdout proof status marker is backed by final release evidence.',
    evidence: {
      required: 'final bracketed stdout status marker',
      observed: '[release-gates-ci:release-ready final=20/20 candidate=20/20 reason=OK]',
      scope: 'final-release',
      requiredScope: 'final-release',
    },
  };
  const requirement = expectedReleaseGateRequirement(gate);
  const validRow = {
    evidenceId: requirement.evidenceId,
    rppId: requirement.rppId,
    sourceKind: 'operator-production',
    artifactPath: 'docs/evidence/release/tmux-status-marker.ndjson',
    observedAt: '2026-05-28T10:30:00.000Z',
    command: 'tmux capture-pane -pt release-gates',
    status: 'checked-passed',
    subjectHash: requirement.expectedSubjectHash,
    operatorScope: 'final-release',
  };
  const mismatchSummary = validateReleaseEvidenceProvenance({
    referenceNow: fixture.referenceNow,
    maxEvidenceAgeHours: fixture.maxEvidenceAgeHours,
    requiredProductionEvidence: [requirement],
    evidenceRows: [
      {
        ...validRow,
        subjectHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
    ],
  });

  assert.equal(mismatchSummary.ok, false);
  assert.equal(mismatchSummary.releaseReady, false);
  assert.deepEqual(mismatchSummary.rejectedEvidence, [
    {
      evidenceId: 'release-gate:tmux-status-marker',
      rppId: 'RPP-0017',
      productionRequired: true,
      reasonCodes: [RELEASE_EVIDENCE_PROVENANCE_REASON_CODES.subjectHashMismatch],
    },
  ]);
  assert.deepEqual(mismatchSummary.productionRequired, {
    total: 1,
    accepted: 0,
    rejected: 1,
  });

  const matchedSummary = validateReleaseEvidenceProvenance({
    referenceNow: fixture.referenceNow,
    maxEvidenceAgeHours: fixture.maxEvidenceAgeHours,
    requiredProductionEvidence: [requirement],
    evidenceRows: [validRow],
  });

  assert.equal(matchedSummary.ok, true);
  assert.equal(matchedSummary.releaseReady, true);
  assert.deepEqual(matchedSummary.acceptedEvidenceIds, ['release-gate:tmux-status-marker']);
  assert.deepEqual(matchedSummary.productionRequired, {
    total: 1,
    accepted: 1,
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

test('missing required production evidence rows fail closed with deterministic synthetic rejections', () => {
  const summary = validateReleaseEvidenceProvenance({
    referenceNow: fixture.referenceNow,
    requiredProductionEvidence: [
      {
        evidenceId: 'release-gate:tmux-status-marker',
        rppId: 'RPP-0017',
      },
      {
        evidenceId: 'release-gate:progress-release-timestamp',
        rppId: 'RPP-0018',
      },
    ],
    evidenceRows: [
      {
        evidenceId: 'release-gate:tmux-status-marker',
        rppId: 'RPP-0017',
        sourceKind: 'operator-production',
        artifactPath: 'docs/evidence/release/tmux-status-marker.ndjson',
        observedAt: '2026-05-28T10:30:00.000Z',
        command: 'tmux capture-pane -pt release-gates',
        status: 'checked-passed',
        subjectHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        operatorScope: 'final-release',
      },
    ],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseReady, false);
  assert.deepEqual(summary.acceptedEvidenceIds, ['release-gate:tmux-status-marker']);
  assert.deepEqual(summary.rejectedEvidence, [
    {
      evidenceId: 'release-gate:progress-release-timestamp',
      rppId: 'RPP-0018',
      productionRequired: true,
      reasonCodes: ['PRODUCTION_EVIDENCE_REQUIRED'],
    },
  ]);
  assert.deepEqual(summary.productionRequired, {
    total: 2,
    accepted: 1,
    rejected: 1,
  });
});

test('release gate provenance adapter selects release-boundary gates in stable RPP order', () => {
  const gates = [
    {
      id: 'progress-release-timestamp',
      rpp: 'RPP-0018',
      title: 'progress.html release timestamp',
      category: 'operator-proof',
    },
    {
      id: 'source-url',
      rpp: 'RPP-0001',
      title: 'REPRINT_PUSH_SOURCE_URL gate',
      category: 'topology',
    },
    {
      id: 'application-password-binding',
      rpp: 'RPP-0008',
      title: 'Application Password credential binding',
      category: 'auth',
    },
    {
      id: 'preflight-route-identity',
      rpp: 'RPP-0011',
      title: 'Preflight route identity proof',
      category: 'route',
    },
    {
      id: 'journal-route-read-only',
      rpp: 'RPP-0014',
      title: 'Journal route read-only proof',
      category: 'recovery',
    },
    {
      id: 'release-movement-summary',
      rpp: 'RPP-0016',
      title: 'releaseMovement allowed/denied summary',
      category: 'summary',
    },
    {
      id: 'tmux-status-marker',
      rpp: 'RPP-0017',
      title: 'tmux stdout proof status marker',
      category: 'operator-proof',
    },
  ];
  const gatesById = new Map(gates.map((gate) => [gate.id, gate]));
  const requirements = releaseGateProvenanceRequirements({ gates });

  assert.deepEqual(requirements, [
    expectedReleaseGateRequirement(gatesById.get('source-url')),
    expectedReleaseGateRequirement(gatesById.get('application-password-binding')),
    expectedReleaseGateRequirement(gatesById.get('preflight-route-identity')),
    expectedReleaseGateRequirement(gatesById.get('journal-route-read-only')),
    expectedReleaseGateRequirement(gatesById.get('tmux-status-marker')),
    expectedReleaseGateRequirement(gatesById.get('progress-release-timestamp')),
  ]);
});

test('release gate provenance adapter can still select one explicit category', () => {
  const gates = [
    {
      id: 'source-url',
      rpp: 'RPP-0001',
      title: 'REPRINT_PUSH_SOURCE_URL gate',
      category: 'topology',
    },
    {
      id: 'tmux-status-marker',
      rpp: 'RPP-0017',
      title: 'tmux stdout proof status marker',
      category: 'operator-proof',
    },
  ];
  const requirements = releaseGateProvenanceRequirements({ gates }, { category: 'operator-proof' });

  assert.deepEqual(requirements, [
    expectedReleaseGateRequirement(gates[1]),
  ]);
});
