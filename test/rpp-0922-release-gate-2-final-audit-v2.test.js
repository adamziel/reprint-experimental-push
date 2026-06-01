import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  evaluateReleaseGates,
  formatReleaseGateStatusMarker,
} from '../src/release-gates.js';
import { findEvidenceRedactionIssues } from '../src/evidence-redaction.js';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import {
  parseAgentsReleaseGatesStatusRow,
  readAgentsReleaseGatesStatusRow,
} from '../scripts/release/agents-release-gates-status-row.mjs';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0922-release-gate-2-final-audit-v2.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');
const fixedNowIso = '2026-06-01T02:12:00.000Z';
const auditedHead = '08e3fe63284c6b42615a79913de3c075d3228975';
const supportBoundaryVerdict = 'PACKAGED_RELEASE_BOUNDARY_OK';
const liveBoundaryVerdict = 'LIVE_RELEASE_BOUNDARY_OK';

test('RPP-0922 audit report records GATE-2 support_only and final release NO-GO', () => {
  const { report, text } = loadAuditReport();

  assert.deepEqual(report, expectedAuditReport());
  assert.equal(report.rppId, 'RPP-0922');
  assert.equal(report.variant, 2);
  assert.equal(report.gate.id, 'GATE-2');
  assert.equal(report.gate.statusBefore, 'support_only');
  assert.equal(report.gate.statusAfter, 'support_only');
  assert.equal(report.gate.movement, 'none');
  assert.equal(report.gate.finalReleaseStatus, 'NO-GO');
  assert.equal(report.supportEvidence.productionBacked, false);
  assert.equal(report.supportEvidence.releaseEligible, false);
  assert.equal(report.productionMovementRule.requiredBoundaryVerdict, liveBoundaryVerdict);
  assert.deepEqual(findEvidenceRedactionIssues(report), []);
  assert.equal(/https?:\/\//i.test(text), false, 'audit evidence must not store raw URLs');
});

test('RPP-0922 current release gate row keeps durable recovery journal support_only', () => {
  const row = readAgentsReleaseGatesStatusRow({
    rootDir: repoRoot,
    scope: 'final-release',
  });
  const sourceMarkdown = fs.readFileSync(releaseGatesPath, 'utf8');
  const parsed = parseAgentsReleaseGatesStatusRow(sourceMarkdown, {
    path: '.agents/RELEASE_GATES.md',
    scope: 'final-release',
  });
  const gate2 = row.evidence.gateStatuses.find((gate) => gate.gate === 'GATE-2');

  assert.deepEqual(row, parsed);
  assert.equal(row.ok, true);
  assert.equal(row.evidence.releaseVerdict, '0/4');
  assert.equal(row.evidence.releaseStatus, 'NO-GO');
  assert.deepEqual(row.evidence.statusCounts, { support_only: 4 });
  assert.deepEqual(gate2, {
    gate: 'GATE-2',
    title: 'Durable Recovery Journal Boundary',
    status: 'support_only',
  });
  assert.deepEqual(
    row.evidence.gateStatuses.map((gate) => gate.status),
    ['support_only', 'support_only', 'support_only', 'support_only'],
  );
});

test('RPP-0922 support evidence alone can reach candidate review but cannot move release', () => {
  const evaluation = evaluateReleaseGates({
    evidence: completeSupportEvidence('local-candidate'),
    scope: 'local-candidate',
    now: fixedNowIso,
  });
  const marker = formatReleaseGateStatusMarker(evaluation, { label: 'release-gates-ci' });

  assert.equal(evaluation.status, 'candidate-for-review');
  assert.equal(evaluation.releaseMovement.allowed, false);
  assert.equal(evaluation.releaseMovement.state, 'candidate-for-review');
  assert.equal(evaluation.releaseMovement.finalGates, '0/20');
  assert.equal(evaluation.releaseMovement.candidateGates, '20/20');
  assert.equal(evaluation.candidateMovement.allowed, true);
  assert.equal(evaluation.candidateMovement.gates, '20/20');
  assert.deepEqual(evaluation.totals, {
    gates: 20,
    passed: 0,
    candidate: 20,
    missing: 0,
    failed: 0,
    blocking: 20,
  });
  assert.equal(
    marker,
    '[release-gates-ci:candidate-for-review final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]',
  );
  assert.ok(
    evaluation.releaseMovement.missingEvidence.every((gate) => gate.status === 'candidate'),
    'every non-final gate should remain candidate evidence, not final release evidence',
  );
});

test('RPP-0922 final release evaluator remains NO-GO without production-backed evidence', () => {
  const result = runReleaseGateCli([
    '--scope',
    'final-release',
    '--now',
    fixedNowIso,
  ], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });
  const gatesById = new Map(result.report.evaluation.gates.map((gate) => [gate.id, gate]));
  const missingCodes = new Set(result.report.releaseMovement.missingEvidence.map((gate) => gate.code));

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.releaseStatus, 'NO-GO');
  assert.equal(result.report.primaryFailureBucket, 'topology');
  assert.equal(result.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(result.report.statusMarker, '[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]');
  assert.equal(result.report.mutationAttempted, false);
  assert.equal(result.report.releaseMovement.allowed, false);
  assert.equal(result.report.releaseMovement.finalGates, '3/20');
  assert.equal(result.report.releaseMovement.candidateGates, '3/20');
  assert.equal(gatesById.get('journal-route-read-only')?.status, 'missing');
  assert.equal(gatesById.get('journal-route-read-only')?.code, 'JOURNAL_ROUTE_READ_ONLY_REQUIRED');
  assert.equal(gatesById.get('recovery-inspect-read-only')?.status, 'missing');
  assert.equal(gatesById.get('recovery-inspect-read-only')?.code, 'RECOVERY_INSPECT_READ_ONLY_REQUIRED');
  assert.equal(missingCodes.has('JOURNAL_ROUTE_READ_ONLY_REQUIRED'), true);
  assert.equal(missingCodes.has('RECOVERY_INSPECT_READ_ONLY_REQUIRED'), true);
});

test('RPP-0922 durable recovery proof only reports proven on a production-backed live boundary', () => {
  const supportProof = buildDurableRecoveryJournalReleaseProof(buildGate2ProofInput(supportBoundaryVerdict));
  const liveProof = buildDurableRecoveryJournalReleaseProof(buildGate2ProofInput(liveBoundaryVerdict));

  assert.equal(supportProof.gate, 'GATE-2');
  assert.equal(supportProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(supportProof.gateStatus, 'support_only');
  assert.equal(supportProof.ok, false);
  assert.equal(supportProof.checks.ownsJournal, true);
  assert.equal(supportProof.checks.restartReadable, true);
  assert.equal(supportProof.checks.leaseOwnerIdentity, true);
  assert.equal(supportProof.checks.manualRecoveryAuditExport, true);
  assert.equal(supportProof.checks.sameKeyReplayAfterRejection, false);
  assert.equal(supportProof.sameKeyReplayAfterRejection.releaseBoundaryVerdict, supportBoundaryVerdict);

  assert.equal(liveProof.gate, 'GATE-2');
  assert.equal(liveProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(liveProof.gateStatus, 'proven');
  assert.equal(liveProof.ok, true);
  assert.equal(liveProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(liveProof.sameKeyReplayAfterRejection.releaseBoundaryVerdict, liveBoundaryVerdict);
  assert.equal(liveProof.manualRecoveryAuditExport.proved, true);
});

function loadAuditReport() {
  const text = fs.readFileSync(evidencePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, 'RPP-0922 evidence must contain one JSON audit report block');
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function expectedAuditReport() {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0922',
    variant: 2,
    title: 'Release gate 2 final audit v2',
    checkedAt: fixedNowIso,
    auditedBranch: 'session/rpp-922',
    auditedLaneHeadBeforeEvidence: auditedHead,
    gate: {
      id: 'GATE-2',
      title: 'Durable Recovery Journal Boundary',
      statusBefore: 'support_only',
      statusAfter: 'support_only',
      movement: 'none',
      releaseVerdict: '0/4',
      finalReleaseStatus: 'NO-GO',
    },
    supportEvidence: {
      durableRecoveryJournalBoundary: 'release-verifier',
      supportOnly: true,
      productionBacked: false,
      releaseEligible: false,
      observedBoundaryVerdict: 'support-boundary-not-live-release-boundary',
      localEvidenceCanOnlySupportCandidateReview: true,
      coveredSupportSurfaces: [
        'journal-route-read-only',
        'recovery-inspect-read-only',
        'restart-readable-journal-ownership',
        'lease-owner-identity',
        'stale-owner-fencing',
        'claim-expiry-policy',
        'old-new-blocked-recovery-classification',
        'preserved-remote-retry',
        'manual-recovery-audit-export',
      ],
    },
    productionMovementRule: {
      requiresProductionBackedDurableRecoveryEvidence: true,
      requiredBoundaryVerdict: liveBoundaryVerdict,
      requiredStatusBeforeMovement: 'proven',
      allowedStatusWithoutProductionEvidence: 'support_only',
      blockedStatusesWithoutProductionEvidence: [
        'partially_proven',
        'proven',
      ],
    },
    supportOnlyEvaluator: {
      evidenceScope: 'local-candidate',
      expectedGateState: 'candidate-for-review',
      expectedReleaseMovementAllowed: false,
      expectedCandidateMovementAllowed: true,
      expectedFinalGates: '0/20',
      expectedCandidateGates: '20/20',
      expectedStatusMarkerReason: 'LOCAL_CANDIDATE_EVIDENCE_ONLY',
      expectedFinalReleaseStatus: 'NO-GO',
    },
    finalReleaseEvaluator: {
      command: 'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:12:00.000Z',
      expectedExit: 1,
      observedReleaseStatus: 'NO-GO',
      primaryFailureCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      primaryFailureBucket: 'topology',
      statusMarker: '[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]',
      mutationAttempted: false,
      releaseMovementAllowed: false,
      finalGates: '3/20',
      candidateGates: '3/20',
      missingRecoveryEvidenceCodes: [
        'JOURNAL_ROUTE_READ_ONLY_REQUIRED',
        'RECOVERY_INSPECT_READ_ONLY_REQUIRED',
      ],
    },
    statusRowReadback: {
      path: '.agents/RELEASE_GATES.md',
      releaseVerdict: '0/4',
      releaseStatus: 'NO-GO',
      gate2Status: 'support_only',
      statusCounts: {
        support_only: 4,
      },
    },
    evidenceLimits: {
      mode: 'command-summary-and-status-only',
      rawUrlsIncluded: false,
      credentialsIncluded: false,
      payloadsStored: false,
      releaseGateStatusMutated: false,
    },
    integrationRecommendation: 'NO-GO until GATE-2 has production-backed durable recovery evidence on the checked release path',
  };
}

function completeSupportEvidence(scope) {
  const sourceUrl = 'https://source.example.test/reprint-push';
  const localUrl = 'https://local-edited.example.test/reprint-push';
  const remoteChangedUrl = 'https://remote-changed.example.test/reprint-push';

  return {
    sourceUrl: { observed: sourceUrl, scope },
    localUrl: { observed: localUrl, scope },
    remoteChangedUrl: { observed: remoteChangedUrl, scope },
    packagedFallback: { ok: true, observed: false, scope },
    authSourceCommandReadback: {
      ok: true,
      issuedSourceUrl: sourceUrl,
      readbackSourceUrl: sourceUrl,
      command: 'node ./scripts/playground/auth-session-source-command.js',
      scope,
    },
    productionSecret: { ok: true, present: true, observed: 'auth-session-source-command', scope },
    applicationPasswordCredentialBinding: {
      ok: true,
      bound: true,
      sameSource: true,
      observed: 'bound-to-source-url',
      scope,
    },
    manageOptionsCapability: { ok: true, hasManageOptions: true, observed: 'manage_options', scope },
    sourceIdentity: { ok: true, same: true, sameSource: true, observed: 'same-source-url', scope },
    preflightRouteIdentity: { ok: true, sameRoute: true, observed: 'preflight-route', scope },
    dryRunRouteEligibility: { ok: true, eligible: true, observed: 'dry-run-route', scope },
    applyRoutePreMutation: { ok: true, preMutation: true, observed: 'rejected-before-mutation', scope },
    journalRouteReadOnly: { ok: true, readOnly: true, observed: 'journal-read-only', scope },
    recoveryInspectReadOnly: { ok: true, readOnly: true, observed: 'recovery-inspect-read-only', scope },
    tmuxStatusMarker: {
      ok: true,
      marker: '[release-gates-ci:held final=0/20 candidate=20/20 reason=LOCAL_CANDIDATE_EVIDENCE_ONLY]',
      scope,
    },
    progressReleaseTimestamp: { iso: fixedNowIso, scope },
    agentsReleaseGateStatusRow: {
      ok: true,
      present: true,
      observed: 'release-gates-status-row-no-go',
      releaseVerdict: '0/4',
      releaseStatus: 'NO-GO',
      scope,
    },
    verifyReleaseFailure: {
      ok: true,
      exitCode: 1,
      reason: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      mutationAttempted: false,
      scope,
    },
  };
}

function buildGate2ProofInput(boundaryVerdict) {
  const releaseSummary = buildReleaseSummary(boundaryVerdict);
  return {
    releaseSummary,
    applyRevalidation: buildApplyRevalidation(boundaryVerdict),
  };
}

function buildReleaseSummary(boundaryVerdict) {
  const activeClaimId = 'claim-active-rpp-0922';
  const previousClaimId = 'claim-previous-rpp-0922';
  const activeClaimKeyHash = 'a'.repeat(64);
  const previousClaimKeyHash = 'b'.repeat(64);
  const originalRequestHash = 'c'.repeat(64);
  const conflictingRequestHash = 'd'.repeat(64);
  const journal = buildJournal({
    activeClaimId,
    previousClaimId,
    activeClaimKeyHash,
    previousClaimKeyHash,
  });
  const releaseProof = {
    plan: { mutations: 2 },
    planObject: {
      mutations: [
        { id: 'mutation-1' },
        { id: 'mutation-2' },
      ],
    },
    dbJournal: {
      ...journal,
      mutationApplied: 2,
      latestEvents: [
        { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
        { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
        { sequence: 3, event: 'mutation-applied' },
        { sequence: 4, event: 'mutation-applied' },
        { sequence: 5, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
      ],
    },
    replay: {
      idempotency: {
        replayed: true,
        freshMutationWork: false,
      },
    },
    idempotencyConflict: {
      status: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      idempotency: {
        conflict: true,
        freshMutationWork: false,
        requestHash: conflictingRequestHash,
        originalRequestHash,
      },
      targetSnapshotUnchanged: true,
      recovery: {
        source: 'different-body idempotency conflict recovery state',
        state: 'fully-updated-remote',
        counts: { old: 0, new: 2, blockedUnknown: 0, total: 2 },
        storage: 'wpdb-single-statement-cas',
        restartReadable: true,
      },
    },
    recoveryInspect: {
      status: 200,
      recovery: {
        journalState: 'ok',
        state: 'fully-updated-remote',
        counts: { old: 0, new: 2, blockedUnknown: 0, total: 2 },
      },
    },
    staleClaimRetry: {
      abandoned: {
        status: 409,
        code: 'STALE_CLAIM_REJECTED',
        recovery: {
          source: 'old remote recovery classification',
          state: 'old-remote',
          counts: { old: 2, new: 0, blockedUnknown: 0, total: 2 },
        },
      },
    },
    replayAndRetry: {
      required: '/snapshot',
      observed: '/snapshot',
      retryAttempts: 2,
      verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
    },
    manualRecoveryAuditExport: manualRecoveryAuditExport(),
  };

  return {
    topology: {
      sourceUrl: 'https://source.example.test/reprint-push',
    },
    boundary: {
      verdict: boundaryVerdict,
    },
    releaseProof,
    durableJournal: {
      checkedAccepted: true,
      proof: {
        journal,
        leaseFence: journal.leaseFence,
      },
    },
  };
}

function buildJournal({
  activeClaimId,
  previousClaimId,
  activeClaimKeyHash,
  previousClaimKeyHash,
}) {
  return {
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim: {
      activeClaimId,
      activeClaimKeyHash,
      previousClaimId,
      previousClaimKeyHash,
      staleClaimRejected: true,
      activeClaimSequence: 2,
      previousClaimSequence: 1,
      activeClaimEvent: 'claim-opened',
    },
    writerLease: {
      claimId: activeClaimId,
      claimKeyHash: activeClaimKeyHash,
      staleClaimRejected: true,
    },
    leaseFence: {
      restartReadable: true,
      staleClaimRejected: true,
      boundary: 'wpdb-single-statement-cas',
      writerLease: {
        claimId: activeClaimId,
        claimKeyHash: activeClaimKeyHash,
        staleClaimRejected: true,
      },
    },
    claimExpiry: {
      policy: 'stale-claim-expiry',
      expired: true,
      previousClaimExpired: true,
      staleThresholdMs: 60000,
      openedAt: '2026-06-01T01:00:00.000Z',
      expiresAt: '2026-06-01T01:01:00.000Z',
      previousClaimOpenedAt: '2026-06-01T00:58:00.000Z',
      previousClaimExpiresAt: '2026-06-01T00:59:00.000Z',
      previousClaimAgeMs: 120000,
      activeClaimSequence: 2,
      previousClaimSequence: 1,
    },
    integrity: {
      status: 'ok',
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
    },
    records: 3,
    applyCommitted: true,
    paginationComplete: true,
    paginationTruncated: false,
  };
}

function buildApplyRevalidation(boundaryVerdict) {
  return {
    ok: true,
    boundary: {
      verdict: boundaryVerdict,
      durableJournal: {
        verdict: boundaryVerdict,
      },
    },
    durableJournal: {
      checkedAccepted: boundaryVerdict === liveBoundaryVerdict,
    },
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      applied: 0,
      applyRevalidation: {
        phase: 'before-first-mutation',
      },
    },
    replay: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      replayed: true,
      freshMutationWork: false,
      preservedRemoteUnchanged: true,
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 7,
        applyReplayed: 8,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: { old: 0, new: 1, blockedUnknown: 1, total: 2 },
      },
    },
  };
}

function manualRecoveryAuditExport() {
  return {
    kind: 'manual-recovery-audit-export',
    schemaVersion: 1,
    exportId: 'e'.repeat(64),
    generatedAt: fixedNowIso,
    source: {
      kind: 'release-verifier-recovery-inspect',
      path: 'releaseProof.recoveryInspect.recovery',
      releasePath: true,
      readOnly: true,
      mutates: false,
      samePathRequiredForRecoveryMutation: true,
    },
    state: 'fully-updated-remote',
    counts: { old: 0, new: 2, blockedUnknown: 0, total: 2 },
    targetEnvelope: {
      total: 2,
      hashOnly: true,
      rawValuesIncluded: false,
      summaryOnly: true,
    },
    targets: [],
    manualReview: {
      required: false,
      mutates: false,
      requiresFreshInspectBeforeMutation: true,
      operatorDecisionTemplate: {
        targets: [],
      },
    },
  };
}
