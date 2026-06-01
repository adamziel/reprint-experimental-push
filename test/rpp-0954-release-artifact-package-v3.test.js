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
const evidenceRelativePath = 'docs/evidence/rpp-0954-release-artifact-package-v3.md';
const evidencePath = path.join(repoRoot, evidenceRelativePath);
const patternEvidencePath = path.join(repoRoot, 'docs/evidence/rpp-0934-release-artifact-package-v2.md');
const fixedNowIso = '2026-06-01T03:25:00.000Z';
const auditedLaneHead = '30579db75230cd3734020a5a298d7393046caf90';
const staleRpp0934LaneHead = '7f2f8e6a1058afab14eab82635427de8a48a8c87';

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
  'RPP-0954 release artifact package v3 evidence',
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

const requiredStopConditions = Object.freeze([
  'packaged-artifact-name-or-path-missing',
  'audited-lane-head-missing-or-stale',
  'command-or-lane-commit-link-missing',
  'operator-recovery-prerequisite-missing',
  'safe-recovery-evidence-missing',
  'release-gate-approval-missing-expired-or-different-run',
  'source-target-identity-ambiguous-or-unverified',
  'dry-run-conflicts-or-stale-preconditions',
  'current-precondition-hash-drift',
  'plan-receipt-target-or-mutation-count-mismatch',
  'single-writer-lease-missing-stale-unowned-or-contested',
  'journal-missing-uninspectable-unowned-nonmonotonic-or-not-restart-readable',
  'observed-hashes-not-explained-by-before-or-after-hashes',
  'terminal-evidence-missing-after-mutation-boundary',
  'same-key-replay-would-create-fresh-mutations',
  'manual-production-edit-or-direct-database-change-required',
  'artifact-redaction-scan-fails',
  'remote-tunnel-or-unapproved-ingress-required',
  'blocked-recovery-or-unknown-state',
  'publication-target-not-local-or-approved',
  'package-publication-requested-from-this-slice',
  'package-lifecycle-requested-without-production-backed-proof',
  'release-status-movement-requested-from-support-only-evidence',
  'finalization-terminal-evidence-missing',
  'release-movement-requested-without-production-backed-gates',
  'hidden-assumption-answer-missing',
]);

const requiredLifecyclePhases = Object.freeze([
  'before-packaging',
  'before-publication',
  'before-finalization',
  'before-release-movement',
]);

const expectedAuditCommands = Object.freeze([
  'git rev-parse HEAD',
  "git show -s --format='%h%x09%H%x09%s' HEAD origin/main",
  "git log --oneline --all --grep='RPP-0914\\|RPP-0934\\|RPP-0949\\|RPP-0950\\|RPP-0951\\|RPP-0952\\|RPP-0953' -30",
  "git show -s --format='%H%x09%h%x09%s' 30579db75 39c1156f1 0b2010e1f b012aac6c 2f53dde24 588d9ee31 f5a566a50 c05c4b73b 5164fe2ad",
  'node scripts/release/agents-release-gates-status-row.mjs',
]);

const expectedValidationCommands = Object.freeze([
  'node --check test/rpp-0954-release-artifact-package-v3.test.js',
  'node --test --test-name-pattern RPP-0954 test/rpp-0954-release-artifact-package-v3.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0954-release-artifact-package-v3.md',
  'git diff --check',
]);

const expectedCommits = Object.freeze([
  ['30579db75230cd3734020a5a298d7393046caf90', '30579db75', 'Merge published progress page state'],
  ['39c1156f19136c6f38f754396b44731e4502d5b8', '39c1156f1', 'docs: publish progress page'],
  ['0b2010e1fa51e76467a71f43b48e7ba730fadfb5', '0b2010e1f', 'Add RPP-0914 release artifact package evidence'],
  ['b012aac6cb1c08bbe070e9a0dd23ba06586f0678', 'b012aac6c', 'Add RPP-0934 release artifact package v2 evidence'],
  ['2f53dde24af98a4b47efd0073d76f2ae1def4186', '2f53dde24', 'docs: add RPP-0949 operator runbook v3 evidence'],
  ['588d9ee3103899bc83240eb94143f605b9ab26cb', '588d9ee31', 'Add RPP-0950 failure triage runbook v3 evidence'],
  ['f5a566a50d05aa077c328091f04da6aba911d67e', 'f5a566a50', 'Add RPP-0951 rollback repair runbook v3 evidence'],
  ['c05c4b73bee1c04f10e1260ce3336e7d373d1945', 'c05c4b73b', 'Add RPP-0952 CI required checks v3 evidence'],
  ['5164fe2ad3ba958ab09144b8bc0ef9a5a3477340', '5164fe2ad', 'Add RPP-0953 progress publish support proof'],
]);

test('RPP-0954 evidence records a held support-only package v3 contract', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.match(text, /^# RPP-0954 Release Artifact Package Evidence Variant 3$/m);
  assert.match(text, /^Worker: `rpp-954`$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-954`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedLaneHead}\`$`, 'm'));
  assert.doesNotMatch(text, new RegExp(staleRpp0934LaneHead));
  assert.match(text, /verdict stays held/);
  assert.match(text, /final release\s+remains `NO-GO`/);
  assert.match(text, /no\s+release-gate status movement is allowed/);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0954');
  assert.equal(report.proofId, 'rpp-0954-release-artifact-package-v3');
  assert.equal(report.variant, 3);
  assert.equal(report.workerId, 'rpp-954');
  assert.equal(report.status, 'held-support-only');
  assert.equal(report.supportOnly, true);
  assert.equal(report.productionBacked, false);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.finalReleaseStatus, 'NO-GO');
  assert.equal(report.integrationRecommendation, 'NO-GO');
  assert.equal(report.auditedBranch, 'session/rpp-954');
  assert.equal(report.auditedLaneHeadBeforeEvidence, auditedLaneHead);
  assert.deepEqual(report.auditedLane, {
    branch: 'session/rpp-954',
    headBeforeEvidence: auditedLaneHead,
    headShortSha: '30579db75',
    headSubject: 'Merge published progress page state',
    originMainAtAudit: '39c1156f19136c6f38f754396b44731e4502d5b8',
    originMainShortSha: '39c1156f1',
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

test('RPP-0954 package names artifacts and inherits RPP-0934 recovery prerequisites', () => {
  const pattern = loadMarkdownJson(patternEvidencePath).report;
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.documents.patternEvidence, 'docs/evidence/rpp-0934-release-artifact-package-v2.md');
  assert.equal(report.documents.basePackageEvidence, 'docs/evidence/rpp-0914-release-artifact-package.md');
  assert.deepEqual(report.operatorRecoveryPrerequisites, pattern.operatorRecoveryPrerequisites);
  assert.deepEqual(report.excludedMaterial, pattern.excludedMaterial);

  const artifactPaths = report.packagedArtifacts.map((artifact) => artifact.path);
  const artifactNames = report.packagedArtifacts.map((artifact) => artifact.name);

  assert.deepEqual(artifactPaths, requiredArtifactPaths);
  assert.deepEqual(artifactNames, requiredArtifactNames);

  for (const artifact of report.packagedArtifacts) {
    assert.equal(artifact.supportOnly, true, `${artifact.path} must stay support-only`);
    assert.equal(artifact.productionBackedEvidence, false, `${artifact.path} must not claim production evidence`);
    assert.equal(artifact.productionSecretMaterial, false, `${artifact.path} must exclude production secrets`);
    assert.equal(artifact.releaseLifecycleMovementAllowed, false, `${artifact.path} must not move lifecycle state`);
    assert.match(artifact.purpose, /\S/);
  }

  assert.match(text, /^## Packaged Artifacts$/m);
  assert.match(text, /operator recovery prerequisites/);
  assert.match(text, /Every packaged artifact remains support-only/);
});

test('RPP-0954 evidence links exact audit commands and lane commits', () => {
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

test('RPP-0954 evidence requires safe recovery evidence and stop conditions', () => {
  const { report, text } = loadMarkdownJson(evidencePath);

  assert.equal(report.packageContract.noHiddenAssumptions, true);
  assert.equal(report.packageContract.normalValidatedApplyOnly, true);
  assert.equal(report.packageContract.sameRunEnvelopeRequired, true);
  assert.equal(report.packageContract.sameRecoveryPathRequired, true);
  assert.equal(report.packageContract.statusCodeOnlyClassificationAllowed, false);
  assert.equal(report.packageContract.missingEvidenceAction, 'stop-preserve-artifacts-review');
  assert.equal(report.packageContract.unknownStateAction, 'blocked-recovery');
  assert.deepEqual(report.packageContract.acceptableStates, acceptableStates);

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

  assert.match(text, /^## Safe Recovery Evidence$/m);
  assert.match(text, /Missing or unknown evidence stops the\s+action/);
  assert.match(text, /status codes, screenshots, or\s+artifact names/);
});

test('RPP-0954 blocks lifecycle and release movement without production-backed proof', async () => {
  const { report, text } = loadMarkdownJson(evidencePath);
  const scan = await scanArtifacts([evidenceRelativePath], { cwd: repoRoot });
  const gateResult = runReleaseGateCli(['--scope', 'final-release', '--now', fixedNowIso], {
    cwd: repoRoot,
    env: {},
    now: new Date(fixedNowIso),
  });

  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(report, { label: 'RPP-0954 package v3 evidence' }));
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.rejectedFiles, []);
  assert.equal(text.includes('http://'), false);
  assert.equal(text.includes('https://'), false);

  assert.deepEqual(report.lifecycleMovementProof, {
    productionBackedProofRequired: true,
    productionBackedProofObserved: false,
    packageLifecycleStatusMovementAllowedWithoutProductionProof: false,
    releaseStatusMovementAllowedWithoutProductionProof: false,
    blockedLifecycleTransitions: [
      'package-publication',
      'package-finalization',
      'package-lifecycle-status-movement',
      'release-gate-status-movement',
      'final-release-go',
    ],
    decisionWithoutProductionBackedProof: 'block-lifecycle-and-release-status-movement',
  });

  for (const transition of report.lifecycleMovementProof.blockedLifecycleTransitions) {
    const decision = lifecycleDecision(report, transition);
    assert.equal(decision.allowed, false, `${transition} must be blocked without production-backed proof`);
    assert.equal(decision.finalReleaseStatus, 'NO-GO');
  }

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

  assert.equal(report.redactionPosture.mode, 'hash-count-metadata-only');
  assert.equal(report.redactionPosture.rawPayloadsIncluded, false);
  assert.equal(report.redactionPosture.credentialMaterialIncluded, false);
  assert.equal(report.redactionPosture.cookiesIncluded, false);
  assert.equal(report.redactionPosture.privatePathsIncluded, false);
  assert.equal(report.redactionPosture.liveServiceConfigurationIncluded, false);
  assert.equal(report.redactionPosture.productionSecretMaterialIncluded, false);

  assert.equal(gateResult.exitCode, 1);
  assert.equal(gateResult.report.releaseStatus, 'NO-GO');
  assert.equal(gateResult.report.status, 'held');
  assert.equal(gateResult.report.gateState, 'held');
  assert.equal(gateResult.report.mutationAttempted, false);
  assert.equal(gateResult.report.releaseMovement.allowed, false);
  assert.match(text, /package lifecycle movement and\s+release movement are blocked/);
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
