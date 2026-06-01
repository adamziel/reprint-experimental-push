import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0995-versioned-protocol-docs-release-verifier-v5.md',
);
const rpp0975EvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0975-versioned-protocol-docs-v4.md');
const protocolDocPath = path.join(repoRoot, 'docs/protocol/versioned-release-protocol.md');

const auditedHead = '099ec1cba8a39479c8c40c76fb99175c42162a46';
const fixedNowIso = '2026-06-01T04:48:52.000Z';
const expectedDomains = [
  'protocol',
  'compatibility',
  'migration',
  'final-release',
];

const expectedRiskIdsByDomain = {
  protocol: [
    'RPP-0995-PROTOCOL-RISK-01',
    'RPP-0995-PROTOCOL-RISK-02',
    'RPP-0995-PROTOCOL-RISK-03',
    'RPP-0995-PROTOCOL-RISK-04',
  ],
  compatibility: [
    'RPP-0995-COMPATIBILITY-RISK-01',
    'RPP-0995-COMPATIBILITY-RISK-02',
    'RPP-0995-COMPATIBILITY-RISK-03',
    'RPP-0995-COMPATIBILITY-RISK-04',
  ],
  migration: [
    'RPP-0995-MIGRATION-RISK-01',
    'RPP-0995-MIGRATION-RISK-02',
    'RPP-0995-MIGRATION-RISK-03',
    'RPP-0995-MIGRATION-RISK-04',
  ],
  'final-release': [
    'RPP-0995-FINAL-RELEASE-RISK-01',
    'RPP-0995-FINAL-RELEASE-RISK-02',
    'RPP-0995-FINAL-RELEASE-RISK-03',
    'RPP-0995-FINAL-RELEASE-RISK-04',
  ],
};

const validationCommands = [
  'node --check test/rpp-0995-versioned-protocol-docs-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0995 test/rpp-0995-versioned-protocol-docs-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0995-versioned-protocol-docs-release-verifier-v5.md',
  'git diff --check',
];

test('RPP-0995 release verifier v5 evidence anchors support-only NO-GO without gate movement', () => {
  const { text, record } = loadEvidence(evidencePath);
  const { record: rpp0975 } = loadEvidence(rpp0975EvidencePath);

  assert.match(text, /^# RPP-0995 versioned protocol docs release verifier v5 evidence$/m);
  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-995`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.rppId, 'RPP-0995');
  assert.equal(record.sliceId, 'RPP-0995');
  assert.equal(record.proofId, 'rpp-0995-versioned-protocol-docs-release-verifier-v5');
  assert.equal(record.variant, 5);
  assert.equal(record.generatedAt, fixedNowIso);
  assert.equal(record.auditedBranch, 'session/rpp-995');
  assert.equal(record.auditedLaneHeadBeforeEvidence, auditedHead);
  assert.equal(record.evidencePath, 'docs/evidence/rpp-0995-versioned-protocol-docs-release-verifier-v5.md');
  assert.equal(record.status, 'final-go-no-go-recorded');
  assert.equal(record.supportOnly, true);
  assert.equal(record.productionBacked, false);
  assert.equal(record.releaseEligible, false);
  assert.equal(record.finalReleaseStatus, 'NO-GO');
  assert.equal(record.integrationRecommendation, 'NO-GO');
  assert.equal(record.verdictHeld, true);
  assert.equal(record.patternEvidence, 'docs/evidence/rpp-0975-versioned-protocol-docs-v4.md');
  assert.deepEqual(record.versionedProtocolRecord, rpp0975.versionedProtocolRecord);
  assert.deepEqual(record.releaseVerifierCarryThrough, {
    mode: 'support-only-release-verifier-v5',
    target: 'versioned-protocol-docs',
    carriedForwardFrom: 'docs/evidence/rpp-0975-versioned-protocol-docs-v4.md',
    contractSource: 'RPP-0975 versioned protocol documentation v4',
    productionBackedClosureProofAdded: false,
    closedRisksWithoutProductionProof: false,
    failClosed: true,
    releaseGateStatusMovement: 'none',
    finalReleaseStatus: 'NO-GO',
  });
});

test('RPP-0995 carries forward the RPP-0975 versioned protocol docs contract', () => {
  const protocolDoc = readText(protocolDocPath);
  const { record } = loadEvidence(evidencePath);

  assert.equal(record.documentationPackage.status, 'support-only');
  assert.equal(record.documentationPackage.supportEvidencePath, 'docs/evidence/rpp-0995-versioned-protocol-docs-release-verifier-v5.md');
  assert.equal(record.documentationPackage.patternEvidencePath, 'docs/evidence/rpp-0975-versioned-protocol-docs-v4.md');
  assert.equal(record.documentationPackage.protocolDocPath, 'docs/protocol/versioned-release-protocol.md');
  assert.deepEqual(record.documentationPackage.riskDomainsAudited, expectedDomains);
  assert.equal(record.documentationPackage.releaseGateStatusMovement, 'none');
  assert.equal(record.documentationPackage.productionClosurePacketObserved, false);
  assert.match(protocolDoc, /^Status: support-only, release blocking$/m);
  assert.match(protocolDoc, /^Final release: \*\*NO-GO\*\*$/m);
  assert.match(protocolDoc, /Support-only documentation does not close production risks\./);
  assert.match(protocolDoc, /Closed risks: none\./);

  for (const version of record.versionedProtocolRecord.supportedVersions) {
    assert.ok(protocolDoc.includes(`| \`${version}\` |`), `missing documented version ${version}`);
  }

  for (const group of record.versionedProtocolRecord.capabilityGroups) {
    assert.ok(protocolDoc.includes(`\`${group}\``), `missing capability group ${group}`);
  }
});

test('RPP-0995 final go-no-go record names every remaining risk or closes it', () => {
  const { record } = loadEvidence(evidencePath);
  const allRiskIds = record.remainingRisks.map((risk) => risk.id);
  const uniqueRiskIds = new Set(allRiskIds);
  const namedOrClosedRisks = [...record.remainingRisks, ...record.closedRisks];

  assert.equal(record.goNoGoRecord.decision, 'NO-GO');
  assert.equal(record.goNoGoRecord.productionClosureProofObserved, false);
  assert.equal(record.goNoGoRecord.riskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.protocolRiskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.compatibilityRiskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.migrationRiskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.finalReleaseRiskRegisterComplete, true);
  assert.equal(record.goNoGoRecord.everyRemainingRiskNamedOrClosed, true);
  assert.equal(record.goNoGoRecord.supportOnlySliceClosesNone, true);
  assert.equal(record.goNoGoRecord.closureBlocked, true);
  assert.deepEqual(record.goNoGoRecord.remainingRiskCountsByDomain, {
    protocol: 4,
    compatibility: 4,
    migration: 4,
    'final-release': 4,
  });
  assert.equal(record.goNoGoRecord.remainingRiskCount, 16);
  assert.equal(record.goNoGoRecord.closedRiskCount, 0);
  assert.equal(record.goNoGoRecord.namedOrClosedRiskCount, 16);
  assert.equal(record.goNoGoRecord.releaseGateStatusMovement, 'none');
  assert.equal(uniqueRiskIds.size, 16);
  assert.equal(namedOrClosedRisks.length, 16);
  assert.deepEqual(record.closedRisks, []);

  assert.deepEqual(record.riskDomains.map((domain) => domain.domain), expectedDomains);
  for (const domain of record.riskDomains) {
    assert.equal(domain.registerComplete, true);
    assert.equal(domain.productionBackedClosureObserved, false);
    assert.deepEqual(domain.riskIds, expectedRiskIdsByDomain[domain.domain]);
  }

  for (const [domain, riskIds] of Object.entries(expectedRiskIdsByDomain)) {
    assert.deepEqual(
      record.remainingRisks.filter((risk) => risk.domain === domain).map((risk) => risk.id),
      riskIds,
    );
  }

  for (const risk of namedOrClosedRisks) {
    assertOpenNamedRisk(risk);
  }
});

test('RPP-0995 keeps unresolved production-backed proof gaps open and fails closed', () => {
  const { text, record } = loadEvidence(evidencePath);
  const openRisks = record.remainingRisks.filter((risk) => risk.disposition === 'open');
  const blockers = record.remainingRisks.filter((risk) => risk.releaseBlocker === true);

  assert.match(record.goNoGoRecord.reason, /Production-backed closure proof is absent/);
  assert.match(record.goNoGoRecord.dispositionRule, /remains open unless production-backed closure proof closes it/);
  assert.equal(openRisks.length, 16);
  assert.equal(blockers.length, 16);
  assert.equal(record.unresolvedProductionBackedProofGapStatus, 'open-fail-closed');
  assert.ok(record.unresolvedProductionBackedProofGaps.length >= expectedDomains.length);
  assert.deepEqual(record.failClosedPolicy, {
    missingProductionBackedProofAction: 'NO-GO',
    supportOnlyClosureAction: 'reject-closure',
    releaseMovementAllowed: false,
    productionMutationAuthorized: false,
    releaseGateMovementAllowed: false,
    closedRisksWithoutProductionProofAllowed: false,
  });
  assert.match(text, /every unresolved\s+production-backed proof gap remains open and fails closed/i);
  assert.doesNotMatch(text, /releaseEligible": true/);

  for (const risk of record.remainingRisks) {
    assertOpenNamedRisk(risk);
    assert.equal(risk.productionBackedClosureObserved, false);
    assert.match(risk.sourceRiskId, /^RPP-0975-/);
    assert.match(risk.closureRequired, /^Production|^Independent|^Release gate|^Passing/);
  }
});

test('RPP-0995 maps every RPP-0975 risk contract entry forward without closing it', () => {
  const { record } = loadEvidence(evidencePath);
  const { record: rpp0975 } = loadEvidence(rpp0975EvidencePath);
  const sourceRisksById = new Map(rpp0975.remainingRisks.map((risk) => [risk.id, risk]));
  const targetRisksBySourceId = new Map(record.remainingRisks.map((risk) => [risk.sourceRiskId, risk]));

  assert.deepEqual(record.rpp0975RiskContractCarryForward, {
    sourceEvidencePath: 'docs/evidence/rpp-0975-versioned-protocol-docs-v4.md',
    sourceProofId: 'rpp-0975-versioned-protocol-docs-v4',
    sourceRiskCount: 16,
    targetRiskCount: 16,
    sourceClosedRiskCount: 0,
    targetClosedRiskCount: 0,
    contractDisposition: 'carried-forward-open',
    productionBackedClosureObserved: false,
  });
  assert.deepEqual(record.rpp0975RiskCrosswalk.map((entry) => entry.sourceRiskId), rpp0975.remainingRisks.map((risk) => risk.id));

  for (const entry of record.rpp0975RiskCrosswalk) {
    const sourceRisk = sourceRisksById.get(entry.sourceRiskId);
    const targetRisk = targetRisksBySourceId.get(entry.sourceRiskId);

    assert.ok(sourceRisk, `${entry.sourceRiskId} must exist in RPP-0975`);
    assert.ok(targetRisk, `${entry.sourceRiskId} must be carried by an RPP-0995 risk`);
    assert.equal(entry.disposition, 'open');
    assert.equal(entry.productionBackedClosureObserved, false);
    assert.deepEqual(entry.carriedBy, [targetRisk.id]);
    assert.equal(targetRisk.domain, sourceRisk.domain);
    assert.equal(targetRisk.category, sourceRisk.category);
    assert.equal(targetRisk.title, sourceRisk.title);
    assert.equal(targetRisk.namedRisk, sourceRisk.namedRisk);
    assert.equal(targetRisk.closureRequired.replace('RPP-0995', 'RPP-0975'), sourceRisk.closureRequired);
    assert.equal(targetRisk.disposition, 'open');
    assert.equal(targetRisk.productionBackedClosureObserved, false);
  }
});

test('RPP-0995 evidence is redacted and records no release-gate movement', async () => {
  const { text, record } = loadEvidence(evidencePath);
  const scan = await scanArtifacts([
    'docs/evidence/rpp-0995-versioned-protocol-docs-release-verifier-v5.md',
  ], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(record, { label: 'RPP-0995 versioned protocol docs release verifier v5 evidence' }));
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.equal(record.redactionPosture.mode, 'hash-count-metadata-only');
  assert.equal(record.redactionPosture.rawValuesIncluded, false);
  assert.equal(record.redactionPosture.rawUrlsIncluded, false);
  assert.equal(record.redactionPosture.authenticationMaterialIncluded, false);
  assert.equal(record.redactionPosture.cookiesIncluded, false);
  assert.equal(record.redactionPosture.privatePathsIncluded, false);
  assert.equal(record.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(record.evidenceLimits.mode, 'support-only-release-verifier-versioned-protocol-docs-v5');
  assert.equal(record.evidenceLimits.mutationAttempted, false);
  assert.equal(record.evidenceLimits.productionMutationAttempted, false);
  assert.equal(record.evidenceLimits.rawPayloadsStored, false);
  assert.equal(record.evidenceLimits.authenticationMaterialCaptured, false);
  assert.equal(record.evidenceLimits.releaseGateChanged, false);
  assert.equal(record.evidenceLimits.releaseGateStatusMovement, 'none');
  assert.equal(record.evidenceLimits.progressRecordChanged, false);
  assert.equal(record.evidenceLimits.progressPageChanged, false);
  assert.equal(record.evidenceLimits.completionChecklistChanged, false);
  assert.equal(record.evidenceLimits.statusFilesChanged, false);
  assert.equal(record.evidenceLimits.protocolDocChanged, false);
  assert.equal(record.evidenceLimits.unrelatedFilesChanged, false);
  assert.equal(record.evidenceLimits.remoteTunnelsUsed, false);
  assert.equal(record.evidenceLimits.dashboardsStarted, false);
  assert.equal(record.evidenceLimits.productionVersionNegotiationObserved, false);
  assert.equal(record.evidenceLimits.productionRouteEnforcementObserved, false);
  assert.equal(record.evidenceLimits.productionCompatibilityMatrixObserved, false);
  assert.equal(record.evidenceLimits.productionMigrationObserved, false);
  assert.equal(record.evidenceLimits.productionFinalReleaseClosureObserved, false);

  for (const command of validationCommands) {
    assert.ok(text.includes(`\`${command}\``), `missing validation command: ${command}`);
  }
});

test('RPP-0995 final-release evaluator remains held without production closure proof', () => {
  const { record } = loadEvidence(evidencePath);
  const result = runReleaseGateCli(['--scope', 'final-release', '--now', record.generatedAt], {
    cwd: repoRoot,
    env: {},
    now: new Date(record.generatedAt),
  });

  assert.equal(record.releaseGateSnapshot.expectedExit, 1);
  assert.equal(record.releaseGateSnapshot.expectedReleaseStatus, 'NO-GO');
  assert.equal(record.releaseGateSnapshot.expectedPrimaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(record.releaseGateSnapshot.expectedPrimaryFailureBucket, 'topology');
  assert.equal(record.releaseGateSnapshot.expectedMutationAttempted, false);
  assert.equal(record.releaseGateSnapshot.expectedReleaseMovementAllowed, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.primaryFailureBucket, 'topology');
  assert.equal(result.report.statusMarker, record.releaseGateSnapshot.expectedStatusMarker);
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '3/20');
  assert.equal(result.report.releaseMovement.candidateGates, '3/20');
  assert.equal(result.report.totals.blocking, 17);
});

function loadEvidence(filePath) {
  const text = readText(filePath);
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON record block`);
  return {
    text,
    record: JSON.parse(match.groups.json),
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertOpenNamedRisk(risk) {
  assert.equal(risk.disposition, 'open');
  assert.equal(risk.releaseBlocker, true);
  assert.match(risk.title, /\S/);
  assert.match(risk.namedRisk, /\S/);
  assert.match(risk.closureRequired, /\S/);
}
