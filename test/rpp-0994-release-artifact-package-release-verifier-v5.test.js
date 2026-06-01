import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scanArtifacts } from '../scripts/release/artifact-redaction-scan.mjs';
import { runReleaseGateCli } from '../scripts/release/check-release-gates.mjs';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRelativePath = 'docs/evidence/rpp-0994-release-artifact-package-release-verifier-v5.md';
const evidencePath = path.join(repoRoot, evidenceRelativePath);
const baselineEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0974-release-artifact-package-v4.md');
const fixedNowIso = '2026-06-01T05:10:00.000Z';
const auditedLaneHead = '5ef95f39c06b80b6d248918f4ad6e6e7b6b7cfa4';
const staleRpp0974LaneHead = '4aa80fc429150966ac124c05f2812d38383e8017';

const acceptableStates = Object.freeze([
  'old-remote',
  'fully-updated-remote',
  'blocked-recovery',
]);

const requiredArtifactPaths = Object.freeze([
  'docs/release/release-artifact-package.md',
  'docs/evidence/rpp-0914-release-artifact-package.md',
  'docs/evidence/rpp-0934-release-artifact-package-v2.md',
  'docs/evidence/rpp-0954-release-artifact-package-v3.md',
  'docs/evidence/rpp-0974-release-artifact-package-v4.md',
  'docs/evidence/rpp-0994-release-artifact-package-release-verifier-v5.md',
  'docs/operations/operator-runbook.md',
  'docs/evidence/rpp-0949-operator-runbook-v3.md',
  'docs/operations/failure-triage-runbook.md',
  'docs/evidence/rpp-0950-failure-triage-runbook-v3.md',
  'docs/operations/rollback-repair-runbook.md',
  'docs/evidence/rpp-0951-rollback-repair-runbook-v3.md',
  'docs/evidence/rpp-0952-ci-required-checks-list-v3.md',
  'docs/evidence/rpp-0953-github-pages-progress-publish-v3.md',
  'docs/recovery/operator-safe-recovery.md',
  'docs/recovery/apply-journal.md',
  'docs/recovery/acceptable-states.md',
  'docs/release/go-no-go-release-decision-record.md',
]);

const requiredArtifactNames = Object.freeze([
  'release artifact package manifest',
  'RPP-0914 release artifact package base evidence',
  'RPP-0934 release artifact package v2 pattern evidence',
  'RPP-0954 release artifact package v3 contract evidence',
  'RPP-0974 release artifact package v4 evidence',
  'RPP-0994 release artifact package release verifier v5 evidence',
  'operator runbook',
  'operator runbook v3 evidence',
  'failure triage runbook',
  'failure triage runbook v3 evidence',
  'rollback repair runbook',
  'rollback repair runbook v3 evidence',
  'CI required checks list v3 evidence',
  'GitHub Pages progress publish v3 evidence',
  'operator safe recovery guide',
  'apply journal recovery states',
  'acceptable post-failure states',
  'go/no-go release decision record',
]);

const requiredLifecyclePhases = Object.freeze([
  'before-packaging',
  'before-publication',
  'before-finalization',
  'before-release-movement',
]);

const requiredStopConditions = Object.freeze([
  'operator-recovery-prerequisite-missing',
  'safe-recovery-evidence-missing',
  'journal-missing-uninspectable-unowned-nonmonotonic-or-not-restart-readable',
  'terminal-evidence-missing-after-mutation-boundary',
  'artifact-redaction-scan-fails',
  'remote-tunnel-or-unapproved-ingress-required',
  'blocked-recovery-or-unknown-state',
  'package-lifecycle-requested-without-production-backed-proof',
  'release-status-movement-requested-from-support-only-evidence',
  'release-movement-requested-without-production-backed-gates',
  'hidden-assumption-answer-missing',
]);

const expectedAuditCommands = Object.freeze([
  'git rev-parse HEAD',
  "git show -s --format='%h%x09%H%x09%s' HEAD origin/main",
  "git show -s --format='%H%x09%h%x09%s' 5ef95f39c 95697bcc7 0b2010e1f b012aac6c 2f53dde24 588d9ee31 f5a566a50 c05c4b73b 5164fe2ad 83811e4f1 003460487",
  'node scripts/release/agents-release-gates-status-row.mjs',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T05:10:00.000Z',
  'timeout 300s npm run verify:release',
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0994-release-artifact-package-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0994 test/rpp-0994-release-artifact-package-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0994-release-artifact-package-release-verifier-v5.md',
  'git diff --check',
]);

const expectedCommits = Object.freeze([
  ['5ef95f39c06b80b6d248918f4ad6e6e7b6b7cfa4', '5ef95f39c', 'Merge published progress page state'],
  ['95697bcc7e8bc10aec1251ab36ed1449baf4b064', '95697bcc7', 'docs: publish progress page'],
  ['0b2010e1fa51e76467a71f43b48e7ba730fadfb5', '0b2010e1f', 'Add RPP-0914 release artifact package evidence'],
  ['b012aac6cb1c08bbe070e9a0dd23ba06586f0678', 'b012aac6c', 'Add RPP-0934 release artifact package v2 evidence'],
  ['2f53dde24af98a4b47efd0073d76f2ae1def4186', '2f53dde24', 'docs: add RPP-0949 operator runbook v3 evidence'],
  ['588d9ee3103899bc83240eb94143f605b9ab26cb', '588d9ee31', 'Add RPP-0950 failure triage runbook v3 evidence'],
  ['f5a566a50d05aa077c328091f04da6aba911d67e', 'f5a566a50', 'Add RPP-0951 rollback repair runbook v3 evidence'],
  ['c05c4b73bee1c04f10e1260ce3336e7d373d1945', 'c05c4b73b', 'Add RPP-0952 CI required checks v3 evidence'],
  ['5164fe2ad3ba958ab09144b8bc0ef9a5a3477340', '5164fe2ad', 'Add RPP-0953 progress publish support proof'],
  ['83811e4f1186c4a7cba1afd67330b26bfc7ccf2d', '83811e4f1', 'Add RPP-0954 release artifact package v3 evidence'],
  ['0034604877dc3ed9392fb50c3b22a77783f192c5', '003460487', 'Add RPP-0974 release artifact package v4 evidence'],
]);

const carriedPackageContractKeys = Object.freeze([
  'supportOnly',
  'noHiddenAssumptions',
  'verdictHeld',
  'normalValidatedApplyOnly',
  'sameRunEnvelopeRequired',
  'sameRecoveryPathRequired',
  'statusCodeOnlyClassificationAllowed',
  'missingEvidenceAction',
  'unknownStateAction',
  'manualProductionRepairAuthorized',
  'packagePublicationAllowed',
  'packageFinalizationAllowed',
  'packageLifecycleStatusMovementAllowed',
  'releaseGateMovement',
  'releaseMovementAllowed',
  'productionBackedProofRequiredBeforeLifecycleMovement',
  'dashboardsStarted',
  'remoteTunnelsUsed',
  'acceptableStates',
]);

test('RPP-0994 evidence records a held support-only release-verifier package v5 contract', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.match(text, /^# RPP-0994 Release Artifact Package Release Verifier v5 Evidence$/m);
  assert.match(text, /^Worker: `rpp-994`$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-994`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0974LaneHead));
  assert.match(text, /Final release\s+remains `NO-GO`/);
  assert.match(text, /no release-gate status movement/);
  assert.match(text, /unresolved production-backed proof gaps stay open and\s+fail closed/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0994');
  assert.equal(report.proofId, 'rpp-0994-release-artifact-package-release-verifier-v5');
  assert.equal(report.variant, 5);
  assert.equal(report.workerId, 'rpp-994');
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.releaseReadiness, 'held');
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.evidenceMode, 'support-only-release-verifier-carry-through');
  assert.equal(report.auditedBranch, 'session/rpp-994');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-994',
    headBeforeEvidence: auditedLaneHead,
    headShortSha: '5ef95f39c',
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '95697bcc7e8bc10aec1251ab36ed1449baf4b064',
    originMainShortSha: '95697bcc7',
    originMainSubject: 'docs: publish progress page',
  });
  assert.equal(report.packageContract.verdictHeld, true);
  assert.equal(report.packageContract.releaseGateMovement, 'none');
  assert.equal(report.packageContract.releaseMovementAllowed, false);
  assert.equal(report.packageContract.packagePublicationAllowed, false);
  assert.equal(report.packageContract.packageFinalizationAllowed, false);
  assert.equal(report.packageContract.packageLifecycleStatusMovementAllowed, false);
  assert.equal(report.packageContract.productionBackedProofRequiredBeforeLifecycleMovement, true);
});

test('RPP-0994 carries forward the RPP-0974 release artifact package contract', () => {
  const previous = loadMarkdownJson(baselineEvidencePath).report;
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.documents.patternEvidence, 'docs/evidence/rpp-0974-release-artifact-package-v4.md');
  assert.equal(report.contractLineage.carriedForwardFrom, 'docs/evidence/rpp-0974-release-artifact-package-v4.md');
  assert.equal(report.contractLineage.carriedForwardProofId, previous.proofId);
  assert.equal(report.contractLineage.carriedForwardVariant, previous.variant);
  assert.equal(report.contractLineage.finalReleaseStatusCarriedForward, previous.finalReleaseStatus);
  assert.equal(report.contractLineage.releaseGateMovementCarriedForward, previous.packageContract.releaseGateMovement);

  for (const key of carriedPackageContractKeys) {
    assert.deepEqual(report.packageContract[key], previous.packageContract[key], `${key} must match RPP-0974`);
  }
  assert.deepEqual(report.operatorRecoveryPrerequisites, previous.operatorRecoveryPrerequisites);
  assert.deepEqual(report.safeRecoveryEvidence, previous.safeRecoveryEvidence);
  assert.deepEqual(report.excludedMaterial, previous.excludedMaterial);
  assert.deepEqual(report.excludedProductionOnlyArtifacts, previous.excludedProductionOnlyArtifacts);
  assert.deepEqual(report.stopConditions, previous.stopConditions);
  assert.deepEqual(report.lifecycleGuards, previous.lifecycleGuards);
  assert.deepEqual(report.lifecycleMovementProof, previous.lifecycleMovementProof);
  assert.deepEqual(report.releaseHold, previous.releaseHold);
  assert.deepEqual(report.redactionPosture, previous.redactionPosture);

  const artifactPaths = report.packagedArtifacts.map((artifact) => artifact.path);
  const artifactNames = report.packagedArtifacts.map((artifact) => artifact.name);

  assert.deepEqual(artifactPaths, requiredArtifactPaths);
  assert.deepEqual(artifactNames, requiredArtifactNames);
  for (const artifactPath of artifactPaths) {
    assert.equal(fs.existsSync(path.join(repoRoot, artifactPath)), true, `${artifactPath} must exist`);
  }

  for (const artifact of report.packagedArtifacts) {
    assert.equal(artifact.supportOnly, true, `${artifact.path} must stay support-only`);
    assert.equal(artifact.productionBackedEvidence, false, `${artifact.path} must not claim production evidence`);
    assert.equal(artifact.productionSecretMaterial, false, `${artifact.path} must exclude production material`);
    assert.equal(artifact.releaseLifecycleMovementAllowed, false, `${artifact.path} must not move lifecycle state`);
    assert.match(artifact.purpose, /\S/);
  }

  assert.match(text, /^## Packaged Artifacts$/m);
  assert.match(text, /RPP-0974 v4 package contract/);
  assert.match(text, /Every\s+packaged artifact remains support-only/);
});

test('RPP-0994 proves operator docs describe safe recovery without hidden assumptions', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const manifest = fs.readFileSync(path.join(repoRoot, 'docs/release/release-artifact-package.md'), 'utf8');
  const safeRecovery = fs.readFileSync(path.join(repoRoot, 'docs/recovery/operator-safe-recovery.md'), 'utf8');

  assert.equal(report.packageContract.noHiddenAssumptions, true);
  assert.equal(report.packageContract.normalValidatedApplyOnly, true);
  assert.equal(report.packageContract.sameRunEnvelopeRequired, true);
  assert.equal(report.packageContract.sameRecoveryPathRequired, true);
  assert.equal(report.packageContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.packageContract.missingEvidenceAction, 'stop-preserve-artifacts-review');
  assert.equal(report.packageContract.unknownStateAction, 'blocked-recovery');
  assert.deepEqual(report.packageContract.acceptableStates, acceptableStates);

  assert.equal(report.operatorDocsSafeRecoveryProof.artifactPackagePrerequisitesExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.explicitEvidenceRequired, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.stopConditionsExplicit, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.noHiddenAssumptions, true);
  assert.equal(report.operatorDocsSafeRecoveryProof.statusCodeOnlyRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.artifactNameOnlyRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.screenshotOnlyRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.operatorMemoryRecoveryClassificationAllowed, false);
  assert.equal(report.operatorDocsSafeRecoveryProof.manualProductionRepairAuthorized, false);
  assert.equal(
    report.operatorDocsSafeRecoveryProof.failClosedRecoveryPosture,
    'missing-or-unknown-evidence-stops-preserves-artifacts-and-keeps-blocked-recovery',
  );
  assert.deepEqual(report.operatorDocsSafeRecoveryProof.acceptableStates, acceptableStates);
  assert.equal(report.operatorDocsSafeRecoveryProof.productionBackedClosureObserved, false);

  assert.ok(report.safeRecoveryEvidence.length >= 8);
  for (const evidence of report.safeRecoveryEvidence) {
    assert.match(evidence.name, /\S/);
    assert.match(evidence.requires, /\S/);
    assert.equal(evidence.stopIfMissing, true, `${evidence.name} must stop if missing`);
  }

  const blockerPhases = report.hiddenAssumptionBlockers.map((blocker) => blocker.phase);
  const guardPhases = report.lifecycleGuards.map((guard) => guard.phase);
  assert.deepEqual(blockerPhases, requiredLifecyclePhases);
  assert.deepEqual(guardPhases, requiredLifecyclePhases);

  for (const blocker of report.hiddenAssumptionBlockers) {
    assert.ok(blocker.mustAnswer.length >= 5, `${blocker.phase} must ask concrete blocker questions`);
    assert.match(blocker.unknownAnswerAction, /stop|blocked|hold/);
  }

  for (const guard of report.lifecycleGuards) {
    assert.ok(guard.requiredEvidence.length >= 4, `${guard.phase} must require explicit evidence`);
    assert.match(guard.hiddenAssumptionAction, /stop|blocked|hold/);
    assert.equal(guard.packageLifecycleMovementAllowed, false, `${guard.phase} must not allow package movement`);
    assert.equal(guard.releaseMovementAllowed, false, `${guard.phase} must not allow release movement`);
  }

  for (const stopCondition of requiredStopConditions) {
    assert.ok(report.stopConditions.includes(stopCondition), `missing stop condition ${stopCondition}`);
  }

  assert.match(text, /^## Operator Recovery Prerequisites$/m);
  assert.match(text, /^## Explicit Safe Recovery Evidence$/m);
  assert.match(text, /^## Stop Conditions$/m);
  assert.match(text, /Operators must not infer safety from status codes, screenshots, artifact names/);
  assert.match(text, /Unknown state means\s+`blocked-recovery`/);
  assert.match(text, /missing evidence means\s+`stop-preserve-artifacts-review`/);
  assert.match(manifest, /Missing evidence means\s+stop, preserve the artifacts already captured/);
  assert.match(manifest, /Do not infer safety from a successful status code/);
  assert.match(safeRecovery, /If any item is missing, mark the case `blocked-recovery`/);
  assert.match(safeRecovery, /Any state outside that set is unsafe/);
});

test('RPP-0994 release verifier carry-through fails closed without release movement', () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const gateResult = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.deepEqual(report.releaseVerifierCarryThrough, {
    canonicalCommand: 'timeout 300s npm run verify:release',
    observedExitCode: 1,
    status: 'held',
    primaryFailureCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    statusMarker: '[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]',
    mutationAttempted: false,
    releaseMovementAllowed: false,
    releaseMovementGates: '0/4',
    supportEvidenceCanMoveRelease: false,
    productionBackedProofObserved: false,
    releaseGateStatusMovement: 'none',
    finalReleaseStatus: 'NO-GO',
  });
  assert.deepEqual(report.finalScopeGateReadback, {
    command: 'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T05:10:00.000Z',
    observedExitCode: 1,
    releaseStatus: 'NO-GO',
    status: 'held',
    gateState: 'held',
    primaryFailureCode: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
    statusMarker: '[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]',
    mutationAttempted: false,
    releaseMovementAllowed: false,
    finalGates: '3/20',
    candidateGates: '3/20',
    remainingBlockingRiskCount: 17,
  });

  assert.equal(gateResult.exitCode, 1);
  assert.equal(gateResult.report.releaseStatus, 'NO-GO');
  assert.equal(gateResult.report.status, 'held');
  assert.equal(gateResult.report.gateState, 'held');
  assert.equal(gateResult.report.primaryFailureCode, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(gateResult.report.mutationAttempted, false);
  assert.equal(gateResult.report.releaseMovement.allowed, false);
  assert.equal(gateResult.report.releaseMovement.finalGates, '3/20');

  assert.equal(report.unresolvedProductionBackedProofGapStatus, 'open-fail-closed');
  assert.ok(report.unresolvedProductionBackedProofGaps.length >= 8);
  assert.ok(report.unresolvedProductionBackedProofGaps.includes('production-backed live source boundary evidence'));
  assert.ok(report.unresolvedProductionBackedProofGaps.includes('production-backed durable journal and recovery readback proof'));
  assert.ok(
    report.unresolvedProductionBackedProofGaps
      .includes('final release status-row and release verifier failure-reason proof from the exact production run'),
  );

  for (const transition of report.lifecycleMovementProof.blockedLifecycleTransitions) {
    const decision = lifecycleDecision(report, transition);
    assert.equal(decision.allowed, false, `${transition} must be blocked without production-backed proof`);
    assert.equal(decision.finalReleaseStatus, 'NO-GO');
  }

  assert.match(text, /Those results are blockers, not release proof/);
  assert.match(text, /production-backed\s+source, local edited site, remote changed source/);
  assert.match(text, /gaps open and fail closed/);
});

test('RPP-0994 evidence links exact audit commands, validation commands, and lane commits', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.deepEqual(report.auditCommands, expectedAuditCommands);
  assert.deepEqual(report.validationCommands, expectedValidationCommands);

  for (const command of [...expectedAuditCommands, ...expectedValidationCommands]) {
    assert.ok(text.includes(command), `missing exact command: ${command}`);
  }

  assert.equal(report.relevantCurrentCommits.length, expectedCommits.length);
  for (const [sha, shortSha, subject] of expectedCommits) {
    const commit = report.relevantCurrentCommits.find((entry) => entry.sha === sha);
    assert.ok(commit, `${sha} must be listed as a relevant commit`);
    assert.equal(commit.shortSha, shortSha);
    assert.equal(commit.subject, subject);
    assert.match(commit.reason, /\S/);
    assert.ok(text.includes(`\`${shortSha}\``), `${shortSha} must be linked in evidence text`);
    assert.ok(text.includes(subject), `${subject} must be linked in evidence text`);
    assertGitSubject(sha, subject);
  }

  assert.deepEqual(
    report.commandCommitLinks.map((entry) => entry.command),
    expectedAuditCommands,
  );
  assert.deepEqual(
    report.validationCommandCommitLinks.map((entry) => entry.command),
    expectedValidationCommands,
  );

  const knownShortRefs = new Set(report.relevantCurrentCommits.map((commit) => commit.shortSha));
  for (const link of [...report.commandCommitLinks, ...report.validationCommandCommitLinks]) {
    assert.ok(link.commitRefs.length > 0, `${link.command} must name at least one commit`);
    assert.match(link.purpose, /\S/);
    for (const commitRef of link.commitRefs) {
      assert.ok(knownShortRefs.has(commitRef), `${link.command} must reference known commit ${commitRef}`);
    }
  }
});

test('RPP-0994 evidence remains redacted and records no status movement', async () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0994 package verifier v5 evidence' }));
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.deepEqual(scan.scannedFiles, [evidenceRelativePath]);
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);
  assert.doesNotMatch(text, /\b(?:Bearer|Basic|Set-Cookie|Cookie:|ghp_|github_pat_|sk-)/);
  assert.doesNotMatch(text, /\b(?:ngrok|cloudflared|localtunnel|serveo|localhost\.run|tailscale funnel)\b/i);

  assert.equal(report.releaseHold.noReleaseGateMovement, true);
  assert.equal(report.releaseHold.releaseGateStatusMoved, false);
  assert.equal(report.releaseHold.statusFilesChanged, false);
  assert.equal(report.releaseHold.progressFilesChanged, false);
  assert.equal(report.releaseHold.completionChecklistChanged, false);
  assert.equal(report.releaseHold.productionRepairAuthorized, false);
  assert.equal(report.releaseHold.packagePublished, false);
  assert.equal(report.releaseHold.packageFinalized, false);
  assert.equal(report.releaseHold.packageLifecycleStatusMoved, false);
  assert.equal(report.releaseHold.releaseStatusMovementAllowed, false);
  assert.equal(report.releaseHold.finalReleaseRecommendation, 'NO-GO');
  assert.equal(report.releaseHold.statusMovementProof.thisEvidenceMovesReleaseGateStatus, false);
  assert.deepEqual(
    report.releaseHold.statusMovementProof.gateStatusesAfter,
    report.releaseHold.statusMovementProof.gateStatusesBefore,
  );
});

function loadMarkdownJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/```json\n(?<json>{[\s\S]*?})\n```/);

  assert.ok(match?.groups?.json, `${path.relative(repoRoot, filePath)} must contain one JSON block`);
  return {
    text,
    report: JSON.parse(match.groups.json),
  };
}

function assertGitSubject(sha, expectedSubject) {
  const result = spawnSync('git', ['show', '-s', '--format=%s', sha], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expectedSubject);
}

function lifecycleDecision(report, transition) {
  const blocked = report.lifecycleMovementProof.blockedLifecycleTransitions.includes(transition);
  const productionBacked = report.lifecycleMovementProof.productionBackedProofObserved;

  return {
    allowed: productionBacked && !blocked,
    reason: blocked ? report.lifecycleMovementProof.decisionWithoutProductionBackedProof : 'requires-production-backed-proof',
    finalReleaseStatus: report.finalReleaseStatus,
  };
}
