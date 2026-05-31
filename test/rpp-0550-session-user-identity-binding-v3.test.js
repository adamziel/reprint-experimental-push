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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0550-session-user-identity-binding-v3.md');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');
const hashPattern = /^[a-f0-9]{64}$/;
const sourceUrl = 'https://source.example.test/rpp-0550';
const rawUserLogin = 'rpp_0550_generated_admin_do_not_emit';
const rawUserId = 830027;
const rawSessionId = 'psh_rpp_0550_generated_session_do_not_emit';
const rawPlanMarker = 'rpp-0550-generated-plan-body-do-not-emit';

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
    id: 'plan-rpp-0550-generated-v3',
    body: rawPlanMarker,
    status: 'ready',
    mutations: [
      {
        action: 'update',
        resourceType: 'wp_option',
        resourceHash: sha256Hex('rpp-0550-generated-resource'),
        beforeHash: sha256Hex('rpp-0550-before'),
        afterHash: sha256Hex('rpp-0550-after'),
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
      scope: 'rpp-0550-generated-auth-session',
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
  const routeEvidenceBlock = {
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
    && dryRunIssue.userIdentityHash
    && dryRunSessionUser.pushSessionHash === routeEvidenceBlock.issued.sessionHash
    && dryRunSessionUser.pushSessionHash === routeEvidenceBlock.readback.sessionHash
    && dryRunIssue.userIdentityHash === routeEvidenceBlock.issued.userIdentityHash
    && dryRunIssue.userIdentityHash === routeEvidenceBlock.readback.userIdentityHash,
  );
  const supportOk = Boolean(summary.ok && routeEvidenceBlock.complete && receiptMatchesSummary);

  return {
    slice: 'RPP-0550',
    variant: 'session-user-identity-binding-v3',
    evidenceScope: 'local/generated support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportStatus: supportOk ? 'support-only-bound' : 'support-only-blocked',
    sourceHash: sha256Hex(summary.sourceUrl),
    routeProfileHash: sha256Hex(summary.routeProfile),
    routeEvidenceBlocks: [routeEvidenceBlock],
    dryRunReceipt: {
      planHash: digest(plan),
      receiptHash: receipt.receiptHash,
      sessionUserBindingHash: dryRunSessionUser.bindingHash,
      pushSessionHash: dryRunSessionUser.pushSessionHash,
      userIdentityHash: dryRunIssue.userIdentityHash,
      receiptMatchesSummary,
    },
    continuity: {
      sameSession: summary.sameSession === true,
      sameUserLogin: summary.sameUserLogin === true,
      sameUserId: summary.sameUserId === true,
      manageOptions: summary.manageOptions === true,
      issuedReadbackSessionHashMatch: routeEvidenceBlock.issued.sessionHash === routeEvidenceBlock.readback.sessionHash,
      issuedReadbackUserIdentityHashMatch:
        routeEvidenceBlock.issued.userIdentityHash === routeEvidenceBlock.readback.userIdentityHash,
    },
    releaseMovement: {
      allowed: false,
      reason: supportOk
        ? 'local generated proof only; checked production release evidence still required'
        : 'session user identity route evidence is incomplete or does not match the dry-run receipt',
    },
  };
}

function assertHashOnlySupportEnvelope(envelope) {
  const serialized = JSON.stringify(envelope);
  for (const forbidden of [rawUserLogin, rawSessionId, sourceUrl, rawPlanMarker]) {
    assert.equal(serialized.includes(forbidden), false, `support envelope leaked ${forbidden}`);
  }

  function visit(value) {
    if (!value || typeof value !== 'object') {
      assert.notEqual(value, rawUserId, 'support envelope leaked raw user id');
      assert.notEqual(value, String(rawUserId), 'support envelope leaked raw user id string');
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

test('RPP-0550 verify:release includes exactly one session user identity route-evidence summary block', () => {
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
  assert.match(userIdentitySummary, /issuedSessionHash/);
  assert.match(userIdentitySummary, /issuedUserIdentityHash/);
  assert.match(userIdentitySummary, /readbackSessionHash/);
  assert.match(userIdentitySummary, /readbackUserIdentityHash/);
  assert.match(userIdentitySummary, /'issued\.sessionHash'/);
  assert.match(userIdentitySummary, /'issued\.userIdentityHash'/);
  assert.match(userIdentitySummary, /'readback\.sessionHash'/);
  assert.match(userIdentitySummary, /'readback\.userIdentityHash'/);
  assert.doesNotMatch(userIdentitySummary, /applicationPassword|credentialHash|signingKey|password/i);
});

test('RPP-0550 v3 generated support cases bind one hash-only route-evidence block to the dry-run receipt', () => {
  const plan = generatedDryRunPlan();
  const boundary = verifiedAuthSessionBoundary();
  const summary = releaseSummaryForBoundary(boundary);
  const receipt = generatedDryRunReceipt(summary, plan);
  const positive = buildSupportProofEnvelope({ summary, receipt, plan });

  assert.equal(boundary.verdict, 'AUTH_SESSION_BOUNDARY_OK');
  assert.equal(summary.ok, true);
  assert.equal(summary.verdict, 'AUTH_SESSION_USER_IDENTITY_BOUND');
  assert.equal(summary.routeEvidence.complete, true);
  assert.equal(countOwnKey(summary, 'routeEvidence'), 1);
  assert.equal(positive.routeEvidenceBlocks.length, 1);
  assert.equal(positive.releaseGate, 'NO-GO');
  assert.equal(positive.productionBacked, false);
  assert.equal(positive.supportStatus, 'support-only-bound');
  assert.equal(positive.releaseMovement.allowed, false);
  assert.equal(positive.dryRunReceipt.receiptMatchesSummary, true);
  assert.deepEqual(positive.routeEvidenceBlocks[0].required, [
    'issued.sessionHash',
    'issued.userIdentityHash',
    'readback.sessionHash',
    'readback.userIdentityHash',
  ]);
  assert.match(positive.sourceHash, hashPattern);
  assert.match(positive.routeProfileHash, hashPattern);
  assert.match(positive.dryRunReceipt.planHash, hashPattern);
  assert.match(positive.dryRunReceipt.receiptHash, hashPattern);
  assert.match(positive.routeEvidenceBlocks[0].issued.sessionHash, hashPattern);
  assert.match(positive.routeEvidenceBlocks[0].issued.userIdentityHash, hashPattern);
  assert.equal(
    positive.routeEvidenceBlocks[0].issued.sessionHash,
    positive.routeEvidenceBlocks[0].readback.sessionHash,
  );
  assert.equal(
    positive.routeEvidenceBlocks[0].issued.userIdentityHash,
    positive.routeEvidenceBlocks[0].readback.userIdentityHash,
  );
  assertHashOnlySupportEnvelope(positive);

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
  assert.equal(missingHashSummary.verdict, 'AUTH_SESSION_USER_IDENTITY_REQUIRED');
  assert.equal(missingHashSummary.routeEvidence.complete, false);
  assert.equal(countOwnKey(missingHashSummary, 'routeEvidence'), 1);
  assert.equal(missingHashEnvelope.routeEvidenceBlocks.length, 1);
  assert.equal(missingHashEnvelope.supportStatus, 'support-only-blocked');
  assert.equal(missingHashEnvelope.releaseGate, 'NO-GO');
  assert.equal(missingHashEnvelope.releaseMovement.allowed, false);
  assertHashOnlySupportEnvelope(missingHashEnvelope);

  const driftedReceipt = generatedDryRunReceipt(summary, plan, {
    sessionUser: {
      pushSessionHash: sha256Hex('rpp-0550-drifted-dry-run-session'),
    },
  });
  const driftedEnvelope = buildSupportProofEnvelope({
    summary,
    receipt: driftedReceipt,
    plan,
  });

  assert.equal(driftedEnvelope.routeEvidenceBlocks.length, 1);
  assert.equal(driftedEnvelope.dryRunReceipt.receiptMatchesSummary, false);
  assert.equal(driftedEnvelope.supportStatus, 'support-only-blocked');
  assert.equal(driftedEnvelope.releaseGate, 'NO-GO');
  assert.equal(driftedEnvelope.releaseMovement.allowed, false);
  assertHashOnlySupportEnvelope(driftedEnvelope);
});

test('RPP-0550 evidence doc records support-only NO-GO scope without raw proof material', () => {
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(evidence, /^# RPP-0550 session user identity binding, variant 3$/m);
  assert.match(evidence, /Final release remains \*\*NO-GO\*\*/);
  assert.match(evidence, /local\/generated support evidence only/);
  assert.match(evidence, /one `authSessionUserIdentity` summary/);
  assert.match(evidence, /one\s+`routeEvidence`\s+block/);
  assert.match(evidence, /hash-only/);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|password/i);
});
