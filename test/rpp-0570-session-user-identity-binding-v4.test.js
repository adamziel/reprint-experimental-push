import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthSessionBoundaryProof } from '../scripts/playground/production-shaped-release-verify.mjs';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0570-session-user-identity-binding-v4.md');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');
const hashPattern = /^[a-f0-9]{64}$/;
const sourceUrl = 'https://source.example.test/rpp-0570';
const rawUserLogin = 'rpp_0570_generated_admin_do_not_emit';
const rawDriftUserLogin = 'rpp_0570_generated_other_admin_do_not_emit';
const rawUserId = 570027;
const rawDriftUserId = 570028;
const rawSessionId = 'psh_rpp_0570_generated_session_do_not_emit';
const rawPlanMarker = 'rpp-0570-generated-plan-body-do-not-emit';

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function functionDeclaration(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const signatureEnd = source.indexOf(') {', start);
  const open = signatureEnd === -1
    ? source.indexOf('{', start)
    : signatureEnd + 2;
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function functionBody(source, name) {
  const declaration = functionDeclaration(source, name);
  const signatureEnd = declaration.indexOf(') {');
  const open = signatureEnd === -1
    ? declaration.indexOf('{')
    : signatureEnd + 2;
  return declaration.slice(open + 1, -1);
}

function loadReleaseAuthSessionUserIdentityEvidenceBuilder() {
  const declaration = functionDeclaration(liveReleaseVerifierSource, 'buildReleaseAuthSessionUserIdentityEvidence');
  return Function('"use strict"; return (' + declaration + ');')();
}

function verifiedAuthSessionBoundary(overrides = {}) {
  const issued = {
    step: 'preflight',
    id: rawSessionId,
    authUser: rawUserLogin,
    authUserId: rawUserId,
    authCapabilities: { manage_options: true },
    ...overrides.issued,
  };
  const read = {
    step: 'journal',
    id: rawSessionId,
    authUser: rawUserLogin,
    authUserId: rawUserId,
    authCapabilities: { manage_options: true },
    ...overrides.read,
  };

  return resolveAuthSessionBoundaryProof({
    liveSourceUrlEnv: sourceUrl,
    effectiveSourceUrl: sourceUrl,
    authSessionSourceCommand: 'node ./scripts/playground/auth-session-source-command.js',
    authSessionSource: {
      ok: true,
      sourceUrl,
      username: rawUserLogin,
      applicationPassword: '<redacted>',
    },
    authSessionLifecycleSummary: { issued, read },
  });
}

function releaseSummaryForBoundary(boundary) {
  const buildSummary = loadReleaseAuthSessionUserIdentityEvidenceBuilder();
  return buildSummary({
    verify: {
      authSessionBoundary: boundary,
      preflight: { routeProfile: { profile: 'production-shaped' } },
    },
    sourceUrl,
  });
}

function generatedDryRunPlan() {
  return {
    id: 'plan-rpp-0570-generated-v4',
    body: rawPlanMarker,
    status: 'ready',
    mutations: [
      {
        action: 'update',
        resourceType: 'wp_option',
        resourceHash: sha256Hex('rpp-0570-generated-resource'),
        beforeHash: sha256Hex('rpp-0570-before'),
        afterHash: sha256Hex('rpp-0570-after'),
      },
    ],
  };
}

function generatedDryRunReceipt(summary, plan, overrides = {}) {
  const sessionUser = {
    schemaVersion: 1,
    requiredHash: sha256Hex('same authenticated user identity for push session, dry-run receipt, and apply'),
    identityHash: summary.issued.userIdentityHash,
    authSessionHash: digest({
      scope: 'rpp-0570-generated-auth-session',
      sessionHash: summary.issued.sessionHash,
    }),
    pushSessionHash: summary.issued.sessionHash,
    manageOptions: summary.manageOptions === true,
    ...overrides.sessionUser,
  };
  sessionUser.bindingHash = digest(sessionUser);

  const issue = {
    schemaVersion: 1,
    typeHash: sha256Hex('short-lived-push-session'),
    sessionHash: summary.issued.sessionHash,
    userIdentityHash: summary.issued.userIdentityHash,
    scopeHash: sha256Hex('reprint-push-lab:authenticated-http-push'),
    ...overrides.issue,
  };
  issue.issueHash = digest(issue);

  const planHash = digest(plan);
  return {
    receiptHash: digest({
      planHash,
      sessionUserBindingHash: sessionUser.bindingHash,
      issueHash: issue.issueHash,
    }),
    authBinding: {
      sessionUser,
      pushSession: {
        sessionHash: summary.issued.sessionHash,
        issue,
        ...overrides.pushSession,
      },
    },
  };
}

function countOwnKey(value, keyName) {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === keyName) {
      count += 1;
    }
    count += countOwnKey(child, keyName);
  }
  return count;
}

function buildSupportProofEnvelope({ summary, receipt, plan }) {
  const routeEvidenceSummary = {
    complete: summary.routeEvidence.complete === true,
    required: [...summary.routeEvidence.required],
    issued: {
      stepHash: sha256Hex(summary.issued.step || ''),
      sessionHash: summary.issued.sessionHash,
      userIdentityHash: summary.issued.userIdentityHash,
    },
    readback: {
      stepHash: sha256Hex(summary.readback.step || ''),
      sessionHash: summary.readback.sessionHash,
      userIdentityHash: summary.readback.userIdentityHash,
    },
  };
  const dryRunSessionUser = receipt.authBinding.sessionUser;
  const dryRunIssue = receipt.authBinding.pushSession.issue;
  const receiptMatchesSummary = Boolean(
    dryRunSessionUser.pushSessionHash
    && dryRunSessionUser.identityHash
    && dryRunIssue.sessionHash
    && dryRunIssue.userIdentityHash
    && dryRunSessionUser.pushSessionHash === routeEvidenceSummary.issued.sessionHash
    && dryRunSessionUser.pushSessionHash === routeEvidenceSummary.readback.sessionHash
    && dryRunIssue.sessionHash === routeEvidenceSummary.issued.sessionHash
    && dryRunIssue.sessionHash === routeEvidenceSummary.readback.sessionHash
    && dryRunSessionUser.identityHash === routeEvidenceSummary.issued.userIdentityHash
    && dryRunSessionUser.identityHash === routeEvidenceSummary.readback.userIdentityHash
    && dryRunIssue.userIdentityHash === routeEvidenceSummary.issued.userIdentityHash
    && dryRunIssue.userIdentityHash === routeEvidenceSummary.readback.userIdentityHash,
  );
  const supportOk = Boolean(summary.ok && routeEvidenceSummary.complete && receiptMatchesSummary);

  return {
    sliceHash: sha256Hex('RPP-0570'),
    variantHash: sha256Hex('session-user-identity-binding-v4'),
    evidenceScopeHash: sha256Hex('local/generated support-only'),
    productionBacked: false,
    releaseGateHash: sha256Hex('NO-GO'),
    supportStatusHash: sha256Hex(supportOk ? 'support-only-bound' : 'support-only-blocked'),
    sourceHash: sha256Hex(summary.sourceUrl),
    routeProfileHash: sha256Hex(summary.routeProfile),
    verifyRelease: {
      summaryCount: 1,
      routeEvidenceSummaryCount: 1,
      routeEvidenceSummaryHash: digest(routeEvidenceSummary),
    },
    routeEvidenceSummaries: [routeEvidenceSummary],
    dryRunReceipt: {
      planHash: digest(plan),
      receiptHash: receipt.receiptHash,
      sessionUserBindingHash: dryRunSessionUser.bindingHash,
      pushSessionHash: dryRunSessionUser.pushSessionHash,
      issueSessionHash: dryRunIssue.sessionHash,
      sessionUserIdentityHash: dryRunSessionUser.identityHash,
      issueUserIdentityHash: dryRunIssue.userIdentityHash,
      receiptMatchesSummary,
    },
    continuity: {
      sameSession: summary.sameSession === true,
      sameUserLogin: summary.sameUserLogin === true,
      sameUserId: summary.sameUserId === true,
      manageOptions: summary.manageOptions === true,
      issuedReadbackSessionHashMatch:
        routeEvidenceSummary.issued.sessionHash === routeEvidenceSummary.readback.sessionHash,
      issuedReadbackUserIdentityHashMatch:
        routeEvidenceSummary.issued.userIdentityHash === routeEvidenceSummary.readback.userIdentityHash,
    },
    releaseMovement: {
      allowed: false,
      reasonHash: sha256Hex(
        supportOk
          ? 'local generated proof only; checked production release evidence still required'
          : 'session user identity route evidence is incomplete or does not match the dry-run receipt',
      ),
    },
  };
}

function assertHashOnlySupportEnvelope(envelope) {
  const serialized = JSON.stringify(envelope);
  for (const forbidden of [rawUserLogin, rawDriftUserLogin, rawSessionId, sourceUrl, rawPlanMarker]) {
    assert.equal(serialized.includes(forbidden), false, `support envelope leaked ${forbidden}`);
  }

  function visit(value) {
    if (!value || typeof value !== 'object') {
      assert.notEqual(value, rawUserId, 'support envelope leaked raw user id');
      assert.notEqual(value, rawDriftUserId, 'support envelope leaked raw drift user id');
      assert.notEqual(value, String(rawUserId), 'support envelope leaked raw user id string');
      assert.notEqual(value, String(rawDriftUserId), 'support envelope leaked raw drift user id string');
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'userId', 'support envelope must not expose raw user id fields');
      assert.notEqual(key, 'userLogin', 'support envelope must not expose raw user login fields');
      assert.notEqual(key, 'sessionId', 'support envelope must not expose raw session id fields');
      assert.notEqual(key, 'sourceUrl', 'support envelope must not expose raw URL fields');
      assert.notEqual(key, 'plan', 'support envelope must not expose plan bodies');
      visit(child);
    }
  }
  visit(envelope);
}

function assertBlockedEnvelope(envelope) {
  assert.equal(envelope.verifyRelease.summaryCount, 1);
  assert.equal(envelope.verifyRelease.routeEvidenceSummaryCount, 1);
  assert.equal(envelope.routeEvidenceSummaries.length, 1);
  assert.equal(envelope.dryRunReceipt.receiptMatchesSummary, false);
  assert.equal(envelope.releaseMovement.allowed, false);
  assert.match(envelope.supportStatusHash, hashPattern);
  assertHashOnlySupportEnvelope(envelope);
}

test('RPP-0570 verify:release includes route evidence in exactly one session user identity summary', () => {
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence');
  const summaryEmitter = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof');
  const userIdentitySummary = functionBody(liveReleaseVerifierSource, 'buildReleaseAuthSessionUserIdentityEvidence');

  const summaryBlocks = topologyEvidence.match(/authSessionUserIdentity:\s*buildReleaseAuthSessionUserIdentityEvidence\(/g) || [];
  const routeEvidenceBlocks = userIdentitySummary.match(/routeEvidence:\s*\{/g) || [];

  assert.equal(summaryBlocks.length, 1, 'combined release topology should carry one authSessionUserIdentity summary');
  assert.equal(routeEvidenceBlocks.length, 1, 'authSessionUserIdentity summary should carry one routeEvidence block');
  assert.match(summaryEmitter, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.match(topologyEvidence, /authSessionUserIdentity:\s*buildReleaseAuthSessionUserIdentityEvidence\(\{\s*verify,\s*sourceUrl,\s*\}\)/s);
  assert.match(userIdentitySummary, /routeEvidenceComplete\s*=\s*Boolean\(/);
  assert.match(userIdentitySummary, /const ok = userIdentity\.ok === true && routeEvidenceComplete/);
  assert.match(userIdentitySummary, /'issued\.sessionHash'/);
  assert.match(userIdentitySummary, /'issued\.userIdentityHash'/);
  assert.match(userIdentitySummary, /'readback\.sessionHash'/);
  assert.match(userIdentitySummary, /'readback\.userIdentityHash'/);
  assert.doesNotMatch(userIdentitySummary, /applicationPassword|credentialHash|signingKey|password/i);
});

test('RPP-0570 v4 generated support proof binds one hash-only route-evidence summary to the dry-run receipt', () => {
  const plan = generatedDryRunPlan();
  const boundary = verifiedAuthSessionBoundary();
  const summary = releaseSummaryForBoundary(boundary);
  const receipt = generatedDryRunReceipt(summary, plan);
  const positive = buildSupportProofEnvelope({ summary, receipt, plan });

  assert.equal(boundary.verdict, 'AUTH_SESSION_BOUNDARY_OK');
  assert.equal(boundary.userIdentity.ok, true);
  assert.equal(summary.ok, true);
  assert.equal(summary.verdict, 'AUTH_SESSION_USER_IDENTITY_BOUND');
  assert.equal(summary.routeEvidence.complete, true);
  assert.equal(countOwnKey(summary, 'routeEvidence'), 1);
  assert.equal(positive.verifyRelease.summaryCount, 1);
  assert.equal(positive.verifyRelease.routeEvidenceSummaryCount, 1);
  assert.equal(positive.routeEvidenceSummaries.length, 1);
  assert.equal(positive.productionBacked, false);
  assert.equal(positive.releaseMovement.allowed, false);
  assert.equal(positive.dryRunReceipt.receiptMatchesSummary, true);
  assert.deepEqual(positive.routeEvidenceSummaries[0].required, [
    'issued.sessionHash',
    'issued.userIdentityHash',
    'readback.sessionHash',
    'readback.userIdentityHash',
  ]);
  assert.match(positive.sliceHash, hashPattern);
  assert.match(positive.variantHash, hashPattern);
  assert.match(positive.evidenceScopeHash, hashPattern);
  assert.match(positive.releaseGateHash, hashPattern);
  assert.match(positive.supportStatusHash, hashPattern);
  assert.match(positive.sourceHash, hashPattern);
  assert.match(positive.routeProfileHash, hashPattern);
  assert.match(positive.verifyRelease.routeEvidenceSummaryHash, hashPattern);
  assert.match(positive.dryRunReceipt.planHash, hashPattern);
  assert.match(positive.dryRunReceipt.receiptHash, hashPattern);
  assert.match(positive.routeEvidenceSummaries[0].issued.sessionHash, hashPattern);
  assert.match(positive.routeEvidenceSummaries[0].issued.userIdentityHash, hashPattern);
  assert.equal(
    positive.routeEvidenceSummaries[0].issued.sessionHash,
    positive.routeEvidenceSummaries[0].readback.sessionHash,
  );
  assert.equal(
    positive.routeEvidenceSummaries[0].issued.userIdentityHash,
    positive.routeEvidenceSummaries[0].readback.userIdentityHash,
  );
  assertHashOnlySupportEnvelope(positive);
});

test('RPP-0570 v4 blocks release movement on identity drift or missing hash route evidence', () => {
  const plan = generatedDryRunPlan();
  const summary = releaseSummaryForBoundary(verifiedAuthSessionBoundary());

  const readbackDriftSummary = releaseSummaryForBoundary(verifiedAuthSessionBoundary({
    read: {
      authUser: rawDriftUserLogin,
      authUserId: rawDriftUserId,
    },
  }));
  const readbackDriftEnvelope = buildSupportProofEnvelope({
    summary: readbackDriftSummary,
    receipt: generatedDryRunReceipt(readbackDriftSummary, plan),
    plan,
  });

  assert.equal(readbackDriftSummary.ok, false);
  assert.equal(readbackDriftSummary.verdict, 'AUTH_SESSION_USER_IDENTITY_REQUIRED');
  assert.equal(readbackDriftSummary.routeEvidence.complete, true);
  assert.equal(readbackDriftSummary.sameUserLogin, false);
  assert.equal(readbackDriftSummary.sameUserId, false);
  assert.equal(readbackDriftEnvelope.continuity.issuedReadbackUserIdentityHashMatch, false);
  assertBlockedEnvelope(readbackDriftEnvelope);

  const buildSummary = loadReleaseAuthSessionUserIdentityEvidenceBuilder();
  const missingHashSummary = buildSummary({
    verify: {
      authSessionBoundary: {
        userIdentity: {
          ok: true,
          observed: 'same-session-user-identity',
          verdict: 'AUTH_SESSION_USER_IDENTITY_BOUND',
          sameSession: true,
          sameUserLogin: true,
          sameUserId: true,
          manageOptions: true,
          issued: {
            step: 'preflight',
            sessionHash: summary.issued.sessionHash,
            userIdentityHash: summary.issued.userIdentityHash,
          },
          readback: {
            step: 'journal',
            sessionHash: summary.readback.sessionHash,
            userIdentityHash: '',
          },
        },
      },
      preflight: { routeProfile: 'production-shaped' },
    },
    sourceUrl,
  });
  const missingHashEnvelope = buildSupportProofEnvelope({
    summary: missingHashSummary,
    receipt: generatedDryRunReceipt(missingHashSummary, plan),
    plan,
  });

  assert.equal(missingHashSummary.ok, false);
  assert.equal(missingHashSummary.observed, 'missing-session-user-identity-route-evidence');
  assert.equal(missingHashSummary.verdict, 'AUTH_SESSION_USER_IDENTITY_REQUIRED');
  assert.equal(missingHashSummary.routeEvidence.complete, false);
  assert.equal(countOwnKey(missingHashSummary, 'routeEvidence'), 1);
  assertBlockedEnvelope(missingHashEnvelope);

  const driftedIdentityHash = sha256Hex('rpp-0570-drifted-dry-run-user-identity');
  const dryRunIdentityDriftReceipt = generatedDryRunReceipt(summary, plan, {
    sessionUser: {
      identityHash: driftedIdentityHash,
    },
    issue: {
      userIdentityHash: driftedIdentityHash,
    },
  });
  const dryRunIdentityDriftEnvelope = buildSupportProofEnvelope({
    summary,
    receipt: dryRunIdentityDriftReceipt,
    plan,
  });

  assert.equal(summary.ok, true);
  assert.equal(dryRunIdentityDriftEnvelope.continuity.issuedReadbackUserIdentityHashMatch, true);
  assertBlockedEnvelope(dryRunIdentityDriftEnvelope);
});

test('RPP-0570 evidence doc records support-only NO-GO scope without raw proof material', () => {
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(evidence, /^# RPP-0570 session user identity binding, variant 4$/m);
  assert.match(evidence, /Final release remains \*\*NO-GO\*\*/);
  assert.match(evidence, /local\/generated support evidence only/);
  assert.match(evidence, /exactly one `authSessionUserIdentity` summary/);
  assert.match(evidence, /one\s+`routeEvidence`\s+summary/);
  assert.match(evidence, /dry-run receipt/);
  assert.match(evidence, /identity drift/);
  assert.match(evidence, /missing hash/);
  assert.match(evidence, /hash-only/);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /\b(?:test|docs|scripts|src)\/[^\s`]+/);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|password/i);
});
