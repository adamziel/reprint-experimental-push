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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0590-session-user-identity-binding-v5.md');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');
const hashPattern = /^[a-f0-9]{64}$/;
const sourceUrl = 'https://source.example.test/rpp-0590';
const authScope = 'reprint-push-lab:authenticated-http-push';
const authScopeHash = sha256Hex(authScope);
const rawUserLogin = 'rpp_0590_generated_admin_do_not_emit';
const rawDriftUserLogin = 'rpp_0590_generated_other_admin_do_not_emit';
const rawUserId = 590027;
const rawDriftUserId = 590028;
const rawSessionId = 'psh_rpp_0590_generated_session_do_not_emit';
const rawPlanMarker = 'rpp-0590-generated-plan-body-do-not-emit';
const requiredRouteEvidence = [
  'issued.sessionHash',
  'issued.userIdentityHash',
  'readback.sessionHash',
  'readback.userIdentityHash',
];

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
    id: 'plan-rpp-0590-generated-v5',
    body: rawPlanMarker,
    status: 'ready',
    mutations: [
      {
        action: 'update',
        resourceType: 'wp_option',
        resourceHash: sha256Hex('rpp-0590-generated-resource'),
        beforeHash: sha256Hex('rpp-0590-before'),
        afterHash: sha256Hex('rpp-0590-after'),
      },
    ],
  };
}

function generatedDryRunReceipt(summary, plan, overrides = {}) {
  const planHash = digest(plan);
  const sessionUser = {
    schemaVersion: 1,
    requiredHash: sha256Hex('same authenticated user identity for push session, dry-run receipt, and apply'),
    identityHash: summary.issued.userIdentityHash,
    authSessionHash: digest({
      scopeHash: authScopeHash,
      issuedSessionHash: summary.issued.sessionHash,
      readbackSessionHash: summary.readback.sessionHash,
    }),
    pushSessionHash: summary.issued.sessionHash,
    scopeHash: authScopeHash,
    planHash,
    manageOptions: summary.manageOptions === true,
    ...overrides.sessionUser,
  };
  sessionUser.bindingHash = digest(sessionUser);

  const issue = {
    schemaVersion: 1,
    typeHash: sha256Hex('short-lived-push-session'),
    sessionHash: summary.issued.sessionHash,
    userIdentityHash: summary.issued.userIdentityHash,
    scopeHash: authScopeHash,
    planHash,
    ...overrides.issue,
  };
  issue.issueHash = digest(issue);

  return {
    planHash,
    receiptHash: digest({
      planHash,
      scopeHash: authScopeHash,
      sessionUserBindingHash: sessionUser.bindingHash,
      issueHash: issue.issueHash,
      sessionUserIdentityHash: sessionUser.identityHash,
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

function withoutKey(value, keyName) {
  const copy = { ...value };
  delete copy[keyName];
  return copy;
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

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isSha256(value) {
  return hashPattern.test(String(value || ''));
}

function buildRouteEvidenceSummary(summary, planHash, overrides = {}) {
  const base = {
    complete: summary.routeEvidence.complete === true,
    required: [...summary.routeEvidence.required],
    sourceHash: sha256Hex(summary.sourceUrl),
    routeProfileHash: sha256Hex(summary.routeProfile),
    scopeHash: authScopeHash,
    planHash,
    fresh: true,
    freshnessHash: digest({
      issuedAtHash: sha256Hex('rpp-0590-route-evidence-issued-at'),
      expiresAtHash: sha256Hex('rpp-0590-route-evidence-expires-at'),
      checkedAtHash: sha256Hex('rpp-0590-route-evidence-checked-at'),
    }),
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

  return {
    ...base,
    ...overrides,
    required: overrides.required || base.required,
    issued: {
      ...base.issued,
      ...overrides.issued,
    },
    readback: {
      ...base.readback,
      ...overrides.readback,
    },
  };
}

function validatePreMovementBinding({ routeEvidenceSummary, receipt, planHash }) {
  const sessionUser = receipt?.authBinding?.sessionUser || {};
  const issue = receipt?.authBinding?.pushSession?.issue || {};
  const issued = routeEvidenceSummary?.issued || {};
  const readback = routeEvidenceSummary?.readback || {};
  const routeEvidenceComplete = Boolean(
    routeEvidenceSummary?.complete === true
    && sameArray(routeEvidenceSummary.required, requiredRouteEvidence)
    && issued.sessionHash
    && issued.userIdentityHash
    && readback.sessionHash
    && readback.userIdentityHash,
  );
  const routeEvidenceShapeValid = Boolean(
    routeEvidenceComplete
    && isSha256(issued.stepHash)
    && isSha256(issued.sessionHash)
    && isSha256(issued.userIdentityHash)
    && isSha256(readback.stepHash)
    && isSha256(readback.sessionHash)
    && isSha256(readback.userIdentityHash)
    && isSha256(routeEvidenceSummary.sourceHash)
    && isSha256(routeEvidenceSummary.routeProfileHash)
    && isSha256(routeEvidenceSummary.scopeHash)
    && isSha256(routeEvidenceSummary.planHash)
    && isSha256(routeEvidenceSummary.freshnessHash),
  );
  const routeEvidenceFresh = routeEvidenceSummary?.fresh === true;
  const routeEvidenceContinuity = Boolean(
    routeEvidenceShapeValid
    && issued.sessionHash === readback.sessionHash
    && issued.userIdentityHash === readback.userIdentityHash,
  );
  const receiptShapeValid = Boolean(
    receipt?.planHash === planHash
    && isSha256(receipt?.receiptHash)
    && isSha256(sessionUser.bindingHash)
    && isSha256(issue.issueHash)
    && sessionUser.bindingHash === digest(withoutKey(sessionUser, 'bindingHash'))
    && issue.issueHash === digest(withoutKey(issue, 'issueHash'))
  );
  const sessionHashBound = Boolean(
    receiptShapeValid
    && routeEvidenceContinuity
    && sessionUser.pushSessionHash === issued.sessionHash
    && issue.sessionHash === issued.sessionHash,
  );
  const userIdentityHashBound = Boolean(
    receiptShapeValid
    && routeEvidenceContinuity
    && sessionUser.identityHash === issued.userIdentityHash
    && issue.userIdentityHash === issued.userIdentityHash,
  );
  const scopeBound = Boolean(
    receiptShapeValid
    && routeEvidenceSummary.scopeHash === authScopeHash
    && sessionUser.scopeHash === authScopeHash
    && issue.scopeHash === authScopeHash,
  );
  const planHashBound = Boolean(
    receiptShapeValid
    && routeEvidenceSummary.planHash === planHash
    && receipt.planHash === planHash
    && sessionUser.planHash === planHash
    && issue.planHash === planHash,
  );
  const receiptHashBound = Boolean(
    receiptShapeValid
    && receipt.receiptHash === digest({
      planHash,
      scopeHash: authScopeHash,
      sessionUserBindingHash: sessionUser.bindingHash,
      issueHash: issue.issueHash,
      sessionUserIdentityHash: sessionUser.identityHash,
    }),
  );
  const ok = Boolean(
    routeEvidenceComplete
    && routeEvidenceShapeValid
    && routeEvidenceFresh
    && routeEvidenceContinuity
    && receiptShapeValid
    && sessionHashBound
    && userIdentityHashBound
    && scopeBound
    && planHashBound
    && receiptHashBound,
  );
  const reason = !routeEvidenceComplete
    ? 'missing-route-evidence'
    : !routeEvidenceShapeValid
      ? 'malformed-route-evidence'
      : !routeEvidenceFresh
        ? 'stale-route-evidence'
        : !routeEvidenceContinuity
          ? 'drifted-route-evidence'
          : !receiptShapeValid
            ? 'malformed-dry-run-receipt'
            : !(sessionHashBound && userIdentityHashBound)
              ? 'drifted-dry-run-receipt'
              : !scopeBound
                ? 'drifted-auth-scope-binding'
                : !planHashBound
                  ? 'drifted-plan-hash-binding'
                  : !receiptHashBound
                    ? 'drifted-receipt-hash-binding'
                    : 'bound';

  return {
    ok,
    reasonHash: sha256Hex(reason),
    routeEvidenceComplete,
    routeEvidenceShapeValid,
    routeEvidenceFresh,
    routeEvidenceContinuity,
    receiptShapeValid,
    sessionHashBound,
    userIdentityHashBound,
    scopeBound,
    planHashBound,
    receiptHashBound,
  };
}

function buildSupportProofEnvelope({
  summary,
  receipt,
  plan,
  routeEvidenceOverrides = {},
} = {}) {
  const planHash = digest(plan);
  const routeEvidenceSummary = buildRouteEvidenceSummary(summary, planHash, routeEvidenceOverrides);
  const validation = validatePreMovementBinding({ routeEvidenceSummary, receipt, planHash });
  const supportOk = Boolean(summary.ok && validation.ok);
  const dryRunSessionUser = receipt.authBinding.sessionUser;
  const dryRunIssue = receipt.authBinding.pushSession.issue;

  return {
    sliceHash: sha256Hex('RPP-0590'),
    variantHash: sha256Hex('session-user-identity-binding-v5'),
    evidenceScopeHash: sha256Hex('local/generated support-only'),
    productionBacked: false,
    releaseGateHash: sha256Hex('NO-GO'),
    supportStatusHash: sha256Hex(supportOk ? 'support-only-bound' : 'support-only-blocked'),
    verifyRelease: {
      summaryCount: 1,
      sessionUserIdentitySummaryCount: 1,
      routeEvidenceSummaryCount: 1,
      routeEvidenceSummaryHash: digest(routeEvidenceSummary),
      checkedCommandHash: sha256Hex('npm run verify:release'),
    },
    routeEvidenceSummaries: [routeEvidenceSummary],
    dryRunReceipt: {
      planHash,
      receiptHash: receipt.receiptHash,
      sessionUserBindingHash: dryRunSessionUser.bindingHash,
      pushSessionHash: dryRunSessionUser.pushSessionHash,
      issueSessionHash: dryRunIssue.sessionHash,
      sessionUserIdentityHash: dryRunSessionUser.identityHash,
      issueUserIdentityHash: dryRunIssue.userIdentityHash,
      scopeHash: authScopeHash,
      receiptMatchesRouteEvidence: validation.sessionHashBound && validation.userIdentityHashBound,
    },
    preMovementBinding: {
      checkedBeforeReleaseMovement: true,
      ...validation,
      validationHash: digest(validation),
    },
    continuity: {
      sameSession: summary.sameSession === true,
      sameUserLogin: summary.sameUserLogin === true,
      sameUserId: summary.sameUserId === true,
      manageOptions: summary.manageOptions === true,
      issuedReadbackSessionHashMatch: routeEvidenceSummary.issued.sessionHash === routeEvidenceSummary.readback.sessionHash,
      issuedReadbackUserIdentityHashMatch:
        routeEvidenceSummary.issued.userIdentityHash === routeEvidenceSummary.readback.userIdentityHash,
    },
    releaseMovement: {
      allowed: false,
      blockedByRouteEvidence: validation.ok === false,
      blockedBySupportScope: supportOk === true,
      reasonHash: sha256Hex(
        supportOk
          ? 'local generated proof only; checked production release evidence still required'
          : 'session user identity route evidence failed pre-movement binding validation',
      ),
    },
  };
}

function assertHashOnlySupportEnvelope(envelope) {
  const serialized = JSON.stringify(envelope);
  for (const forbidden of [
    rawUserLogin,
    rawDriftUserLogin,
    rawSessionId,
    sourceUrl,
    rawPlanMarker,
    authScope,
  ]) {
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

function assertBlockedEnvelope(envelope, expectedReasonHash) {
  assert.equal(envelope.verifyRelease.summaryCount, 1);
  assert.equal(envelope.verifyRelease.sessionUserIdentitySummaryCount, 1);
  assert.equal(envelope.verifyRelease.routeEvidenceSummaryCount, 1);
  assert.equal(envelope.routeEvidenceSummaries.length, 1);
  assert.equal(envelope.preMovementBinding.ok, false);
  assert.equal(envelope.preMovementBinding.reasonHash, expectedReasonHash);
  assert.equal(envelope.releaseMovement.allowed, false);
  assert.equal(envelope.releaseMovement.blockedByRouteEvidence, true);
  assert.equal(envelope.releaseMovement.blockedBySupportScope, false);
  assert.equal(envelope.supportStatusHash, sha256Hex('support-only-blocked'));
  assert.match(envelope.preMovementBinding.validationHash, hashPattern);
  assertHashOnlySupportEnvelope(envelope);
}

test('RPP-0590 verify:release includes exactly one session-user identity route-evidence summary', () => {
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
  assert.match(userIdentitySummary, /scope:\s*'final-release'/);
  assert.match(userIdentitySummary, /'issued\.sessionHash'/);
  assert.match(userIdentitySummary, /'issued\.userIdentityHash'/);
  assert.match(userIdentitySummary, /'readback\.sessionHash'/);
  assert.match(userIdentitySummary, /'readback\.userIdentityHash'/);
  assert.doesNotMatch(userIdentitySummary, /applicationPassword|credentialHash|signingKey|password/i);
});

test('RPP-0590 v5 deterministic support proof binds route evidence to receipt, scope, and plan before movement', () => {
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
  assert.equal(positive.verifyRelease.sessionUserIdentitySummaryCount, 1);
  assert.equal(positive.verifyRelease.routeEvidenceSummaryCount, 1);
  assert.equal(positive.routeEvidenceSummaries.length, 1);
  assert.equal(positive.productionBacked, false);
  assert.equal(positive.releaseMovement.allowed, false);
  assert.equal(positive.releaseMovement.blockedBySupportScope, true);
  assert.equal(positive.releaseMovement.blockedByRouteEvidence, false);
  assert.equal(positive.supportStatusHash, sha256Hex('support-only-bound'));
  assert.equal(positive.preMovementBinding.ok, true);
  assert.equal(positive.preMovementBinding.reasonHash, sha256Hex('bound'));
  assert.equal(positive.preMovementBinding.checkedBeforeReleaseMovement, true);
  assert.equal(positive.preMovementBinding.routeEvidenceComplete, true);
  assert.equal(positive.preMovementBinding.routeEvidenceShapeValid, true);
  assert.equal(positive.preMovementBinding.routeEvidenceFresh, true);
  assert.equal(positive.preMovementBinding.routeEvidenceContinuity, true);
  assert.equal(positive.preMovementBinding.receiptShapeValid, true);
  assert.equal(positive.preMovementBinding.sessionHashBound, true);
  assert.equal(positive.preMovementBinding.userIdentityHashBound, true);
  assert.equal(positive.preMovementBinding.scopeBound, true);
  assert.equal(positive.preMovementBinding.planHashBound, true);
  assert.equal(positive.preMovementBinding.receiptHashBound, true);
  assert.deepEqual(positive.routeEvidenceSummaries[0].required, requiredRouteEvidence);
  assert.match(positive.sliceHash, hashPattern);
  assert.match(positive.variantHash, hashPattern);
  assert.match(positive.evidenceScopeHash, hashPattern);
  assert.match(positive.releaseGateHash, hashPattern);
  assert.match(positive.verifyRelease.routeEvidenceSummaryHash, hashPattern);
  assert.match(positive.verifyRelease.checkedCommandHash, hashPattern);
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

test('RPP-0590 v5 rejects missing, malformed, stale, or drifted route evidence before movement', () => {
  const plan = generatedDryRunPlan();
  const summary = releaseSummaryForBoundary(verifiedAuthSessionBoundary());
  const receipt = generatedDryRunReceipt(summary, plan);

  const missingHashEnvelope = buildSupportProofEnvelope({
    summary,
    receipt,
    plan,
    routeEvidenceOverrides: {
      complete: false,
      readback: { userIdentityHash: '' },
    },
  });
  assert.equal(missingHashEnvelope.preMovementBinding.routeEvidenceComplete, false);
  assertBlockedEnvelope(missingHashEnvelope, sha256Hex('missing-route-evidence'));

  const malformedEnvelope = buildSupportProofEnvelope({
    summary,
    receipt,
    plan,
    routeEvidenceOverrides: {
      issued: { sessionHash: 'not-a-sha256-route-proof' },
    },
  });
  assert.equal(malformedEnvelope.preMovementBinding.routeEvidenceShapeValid, false);
  assertBlockedEnvelope(malformedEnvelope, sha256Hex('malformed-route-evidence'));

  const staleEnvelope = buildSupportProofEnvelope({
    summary,
    receipt,
    plan,
    routeEvidenceOverrides: {
      fresh: false,
      freshnessHash: sha256Hex('rpp-0590-stale-route-evidence-window'),
    },
  });
  assert.equal(staleEnvelope.preMovementBinding.routeEvidenceFresh, false);
  assertBlockedEnvelope(staleEnvelope, sha256Hex('stale-route-evidence'));

  const routeDriftEnvelope = buildSupportProofEnvelope({
    summary,
    receipt,
    plan,
    routeEvidenceOverrides: {
      readback: { userIdentityHash: sha256Hex('rpp-0590-route-readback-identity-drift') },
    },
  });
  assert.equal(routeDriftEnvelope.preMovementBinding.routeEvidenceContinuity, false);
  assert.equal(routeDriftEnvelope.continuity.issuedReadbackUserIdentityHashMatch, false);
  assertBlockedEnvelope(routeDriftEnvelope, sha256Hex('drifted-route-evidence'));

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
  assertBlockedEnvelope(readbackDriftEnvelope, sha256Hex('drifted-route-evidence'));

  const driftedIdentityHash = sha256Hex('rpp-0590-drifted-dry-run-user-identity');
  const receiptDriftEnvelope = buildSupportProofEnvelope({
    summary,
    receipt: generatedDryRunReceipt(summary, plan, {
      sessionUser: { identityHash: driftedIdentityHash },
      issue: { userIdentityHash: driftedIdentityHash },
    }),
    plan,
  });
  assert.equal(receiptDriftEnvelope.preMovementBinding.userIdentityHashBound, false);
  assertBlockedEnvelope(receiptDriftEnvelope, sha256Hex('drifted-dry-run-receipt'));

  const wrongScopeHash = sha256Hex('rpp-0590-wrong-auth-scope');
  const scopeDriftEnvelope = buildSupportProofEnvelope({
    summary,
    receipt: generatedDryRunReceipt(summary, plan, {
      sessionUser: { scopeHash: wrongScopeHash },
      issue: { scopeHash: wrongScopeHash },
    }),
    plan,
  });
  assert.equal(scopeDriftEnvelope.preMovementBinding.scopeBound, false);
  assertBlockedEnvelope(scopeDriftEnvelope, sha256Hex('drifted-auth-scope-binding'));

  const wrongPlanHash = sha256Hex('rpp-0590-wrong-plan-hash');
  const planDriftEnvelope = buildSupportProofEnvelope({
    summary,
    receipt: generatedDryRunReceipt(summary, plan, {
      sessionUser: { planHash: wrongPlanHash },
      issue: { planHash: wrongPlanHash },
    }),
    plan,
  });
  assert.equal(planDriftEnvelope.preMovementBinding.planHashBound, false);
  assertBlockedEnvelope(planDriftEnvelope, sha256Hex('drifted-plan-hash-binding'));
});

test('RPP-0590 evidence doc records support-only NO-GO scope without raw proof material', () => {
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(evidence, /^# RPP-0590 session user identity binding, variant 5$/m);
  assert.match(evidence, /Final release remains \*\*NO-GO\*\*/);
  assert.match(evidence, /local\/generated support evidence only/);
  assert.match(evidence, /exactly one `authSessionUserIdentity` summary/);
  assert.match(evidence, /one\s+`routeEvidence`\s+summary/);
  assert.match(evidence, /dry-run receipt/);
  assert.match(evidence, /scope hash/);
  assert.match(evidence, /plan hash/);
  assert.match(evidence, /missing, malformed, stale, and drifted/);
  assert.match(evidence, /hash-only/);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /\b(?:test|docs|scripts|src)\/[^\s`]+/);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|password/i);
});
