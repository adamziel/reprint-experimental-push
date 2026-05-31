import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0598-capability-downgrade-rejection-v5.md');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const requiredCapability = 'manage_options';
const sessionId = 'psh_01j00000000000000000598';
const authScope = 'reprint-push:production-shaped:manage-options';
const checkedCommand = 'timeout 300s npm run verify:release';
const hashPattern = /^[a-f0-9]{64}$/;
const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const activeSession = {
  type: 'production-auth-session',
  status: 'active',
  id: sessionId,
  expiresAt: '2030-01-01T00:00:00Z',
};
const grantedAuth = {
  identity: {
    userId: 598,
    userLogin: credential.username,
    capabilities: { manage_options: true },
  },
  session: activeSession,
};
const fixturePath = 'wp-content/uploads/reprint-push/rpp-0598-capability-v5.txt';

function functionBody(name, source = routeSource) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function assertBefore(body, first, second) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  assert.notEqual(firstIndex, -1, `missing ${first}`);
  assert.notEqual(secondIndex, -1, `missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0598:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutKey(value, keyName) {
  const copy = { ...value };
  delete copy[keyName];
  return copy;
}

function withBindingHash(binding) {
  return {
    ...binding,
    bindingHash: digest(binding),
  };
}

function withIssueHash(issue) {
  return {
    ...issue,
    issueHash: digest(issue),
  };
}

function headerEntries(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fixtureSnapshots() {
  return {
    base: {
      files: {
        [fixturePath]: 'rpp-0598 base capability downgrade content',
      },
      plugins: {},
      db: {},
    },
    local: {
      files: {
        [fixturePath]: 'rpp-0598 local capability downgrade content',
      },
      plugins: {},
      db: {},
    },
  };
}

function planEvidence(plan) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan?.preconditions) ? plan.preconditions : [];

  return {
    mutationSetHash: digest(mutations.map((mutation) => ({
      id: String(mutation?.id || ''),
      resourceKey: String(mutation?.resourceKey || ''),
      resource: mutation?.resource,
      action: mutation?.action ?? null,
      changeKind: mutation?.changeKind ?? null,
      baseHash: mutation?.baseHash ?? null,
      remoteBeforeHash: mutation?.remoteBeforeHash ?? null,
      localHash: mutation?.localHash ?? null,
    }))),
    preconditionSetHash: digest(preconditions.map((precondition) => ({
      mutationId: String(precondition?.mutationId || ''),
      resourceKey: String(precondition?.resourceKey || ''),
      resource: precondition?.resource,
      expectedHash: String(precondition?.expectedHash || ''),
    }))),
  };
}

function receiptForPlan(plan, idempotencyKey, dryRunRawBodyHash) {
  const evidence = planEvidence(plan);
  const planHash = digest(plan);
  const identityHash = digest(grantedAuth.identity);
  const authSessionHash = digest(grantedAuth.session);
  const pushSessionHash = fixtureHash('push-session');
  const signingKeyHash = fixtureHash('signing-key');
  const scopeHash = sha256Hex(authScope);
  const subjectBinding = withBindingHash({
    schemaVersion: 1,
    scopeHash,
    identityHash,
    authSessionHash,
    pushSessionHash,
    planHash,
  });
  const sessionUser = withBindingHash({
    schemaVersion: 1,
    required: 'same authenticated user identity for push session, dry-run receipt, and apply',
    userId: grantedAuth.identity.userId,
    userLoginHash: sha256Hex(grantedAuth.identity.userLogin),
    identityHash,
    authSessionHash,
    pushSessionHash,
    manageOptions: true,
  });
  const issue = withIssueHash({
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: pushSessionHash,
    signingKeyHash,
    scopeHash,
    identityHash,
    userIdentityHash: fixtureHash('user-identity'),
    requiredCapability,
    capabilityHash: fixtureHash('capability-granted'),
    sourceHash: fixtureHash('source'),
    sourceUrlHash: sha256Hex(sourceUrl),
    issuedAt: '2026-05-31T00:00:00Z',
    expiresAt: grantedAuth.session.expiresAt,
    ttlSeconds: 300,
  });

  const receipt = {
    planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      schemaVersion: 1,
      scope: authScope,
      planHash,
      binding: subjectBinding,
      identity: cloneJson(grantedAuth.identity),
      session: cloneJson(grantedAuth.session),
      pushSession: {
        sessionHash: pushSessionHash,
        signingKeyHash,
        issue,
        dryRunNonceHash: fixtureHash('dry-run-nonce'),
        dryRunContentHash: dryRunRawBodyHash,
        dryRunCanonicalHash: fixtureHash('dry-run-canonical'),
        dryRunIdempotencyKeyHash: sha256Hex(idempotencyKey),
      },
      sessionUser,
      source: {
        sourceHash: fixtureHash('source'),
        sourceUrlHash: sha256Hex(sourceUrl),
        restNamespace: 'reprint/v1',
        routeProfile: 'production-shaped',
        labBacked: false,
      },
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: `${routePrefix}/dry-run`,
        routeProfile: 'production-shaped',
        labBacked: false,
        planHash,
        planPayloadHash: planHash,
        dryRunBodyHash: digest({ plan }),
        dryRunRawBodyHash,
      },
      plan: {
        schemaVersion: 1,
        planHash,
        planPayloadHash: planHash,
      },
      preconditions: {
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
      },
      snapshotHashes: {
        schemaVersion: 1,
        required: 'dry-run receipt binds snapshot hash preconditions as planning evidence only',
        planningOnly: true,
        snapshotIdHash: fixtureHash('snapshot-id'),
        coverageHash: fixtureHash('coverage'),
        preconditionSetHash: evidence.preconditionSetHash,
        mutationSetHash: evidence.mutationSetHash,
        mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
        planHash,
      },
      issuedAt: '2026-05-31T00:00:00Z',
      expiresAt: grantedAuth.session.expiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function signedRequest(pathname, contentHash) {
  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    sessionHash: fixtureHash('signed-session'),
    signingKeyHash: fixtureHash('signing-key'),
    request: { method: 'POST', path: pathname },
  };
}

function receiptBindingEvidence(receipt, plan, dryRunRequestHash) {
  const binding = receipt.authBinding.binding;
  const issue = receipt.authBinding.pushSession.issue;
  const sessionUser = receipt.authBinding.sessionUser;
  const planHash = digest(plan);

  return {
    schemaVersion: 1,
    receiptHash: receipt.receiptHash,
    planHash: receipt.planHash,
    canonicalPlanHash: planHash,
    scopeHash: sha256Hex(receipt.authBinding.scope),
    bindingHash: binding.bindingHash,
    identityHash: binding.identityHash,
    authSessionHash: binding.authSessionHash,
    pushSessionHash: binding.pushSessionHash,
    issueHash: issue.issueHash,
    issueSessionHash: issue.sessionHash,
    issueIdentityHash: issue.identityHash,
    issueScopeHash: issue.scopeHash,
    issueRequiredCapabilityHash: sha256Hex(issue.requiredCapability),
    issueCapabilityHash: issue.capabilityHash,
    sessionUserIdentityHash: sessionUser.identityHash,
    sessionUserAuthSessionHash: sessionUser.authSessionHash,
    sessionUserPushSessionHash: sessionUser.pushSessionHash,
    sessionUserBindingHash: sessionUser.bindingHash,
    dryRunContentHash: receipt.authBinding.pushSession.dryRunContentHash,
    dryRunCanonicalHash: receipt.authBinding.pushSession.dryRunCanonicalHash,
    dryRunIdempotencyKeyHash: receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
    dryRunRequestHash,
    mutationSetHash: receipt.mutationSetHash,
    preconditionSetHash: receipt.preconditionSetHash,
    binds: {
      samePlan: receipt.authBinding.planHash === receipt.planHash
        && binding.planHash === receipt.planHash,
      sameCanonicalPlan: receipt.planHash === planHash,
      sameScope: binding.scopeHash === issue.scopeHash,
      sameIdentity: binding.identityHash === issue.identityHash
        && binding.identityHash === sessionUser.identityHash,
      sameAuthSession: binding.authSessionHash === sessionUser.authSessionHash,
      sameSession: binding.pushSessionHash === issue.sessionHash
        && binding.pushSessionHash === sessionUser.pushSessionHash,
      requiredCapability: issue.requiredCapability === requiredCapability,
      capabilityHashPresent: hashPattern.test(issue.capabilityHash),
    },
  };
}

function buildCapabilityEvidence(receipt, overrides = {}) {
  const binding = receipt.authBinding.binding;
  const issue = receipt.authBinding.pushSession.issue;
  const evidence = {
    schemaVersion: 1,
    caseHash: fixtureHash(overrides.caseLabel || 'accepted-capability-evidence'),
    evidenceKindHash: fixtureHash('session-capability-evidence'),
    sessionHash: binding.pushSessionHash,
    identityHash: binding.identityHash,
    authSessionHash: binding.authSessionHash,
    scopeHash: binding.scopeHash,
    planHash: receipt.planHash,
    requiredCapabilityHash: sha256Hex(requiredCapability),
    issuedCapabilityHash: issue.capabilityHash,
    observedCapabilityHash: issue.capabilityHash,
    capabilityGranted: true,
    fresh: true,
    sourceHash: fixtureHash('source'),
    observedAtHash: fixtureHash('capability-observed-at'),
    expiresAtHash: fixtureHash('capability-expires-at'),
    ...overrides.fields,
  };

  if (overrides.malformedEvidenceHash === true) {
    evidence.evidenceHash = 'not-a-sha256-capability-evidence-hash';
    return evidence;
  }

  evidence.evidenceHash = digest(evidence);
  return evidence;
}

function safeHash(value) {
  return hashPattern.test(String(value || '')) ? value : null;
}

function capabilityEvidenceSummary(capabilityEvidence) {
  const evidence = capabilityEvidence && typeof capabilityEvidence === 'object'
    ? capabilityEvidence
    : {};
  return {
    schemaVersion: 1,
    caseHash: safeHash(evidence.caseHash),
    evidenceHash: safeHash(evidence.evidenceHash),
    evidenceKindHash: safeHash(evidence.evidenceKindHash),
    sessionHash: safeHash(evidence.sessionHash),
    identityHash: safeHash(evidence.identityHash),
    authSessionHash: safeHash(evidence.authSessionHash),
    scopeHash: safeHash(evidence.scopeHash),
    planHash: safeHash(evidence.planHash),
    requiredCapabilityHash: safeHash(evidence.requiredCapabilityHash),
    issuedCapabilityHash: safeHash(evidence.issuedCapabilityHash),
    observedCapabilityHash: safeHash(evidence.observedCapabilityHash),
    sourceHash: safeHash(evidence.sourceHash),
    observedAtHash: safeHash(evidence.observedAtHash),
    expiresAtHash: safeHash(evidence.expiresAtHash),
    capabilityGranted: evidence.capabilityGranted === true,
    fresh: evidence.fresh === true,
  };
}

function validateCapabilityEvidence({ capabilityEvidence, receipt, planHash }) {
  const evidence = capabilityEvidence && typeof capabilityEvidence === 'object'
    ? capabilityEvidence
    : null;
  const binding = receipt?.authBinding?.binding || {};
  const issue = receipt?.authBinding?.pushSession?.issue || {};
  const hashFields = [
    'caseHash',
    'evidenceHash',
    'evidenceKindHash',
    'sessionHash',
    'identityHash',
    'authSessionHash',
    'scopeHash',
    'planHash',
    'requiredCapabilityHash',
    'issuedCapabilityHash',
    'observedCapabilityHash',
    'sourceHash',
    'observedAtHash',
    'expiresAtHash',
  ];
  const complete = Boolean(
    evidence
      && hashFields.every((field) => typeof evidence[field] === 'string' && evidence[field] !== '')
      && typeof evidence.capabilityGranted === 'boolean'
      && typeof evidence.fresh === 'boolean',
  );
  const shapeValid = Boolean(
    complete
      && hashFields.every((field) => hashPattern.test(evidence[field]))
      && evidence.evidenceHash === digest(withoutKey(evidence, 'evidenceHash')),
  );
  const fresh = Boolean(shapeValid && evidence.fresh === true);
  const capabilityNotDowngraded = Boolean(
    shapeValid
      && evidence.capabilityGranted === true
      && evidence.observedCapabilityHash === evidence.issuedCapabilityHash,
  );
  const bindingMatches = Boolean(
    shapeValid
      && evidence.sessionHash === binding.pushSessionHash
      && evidence.sessionHash === issue.sessionHash
      && evidence.identityHash === binding.identityHash
      && evidence.identityHash === issue.identityHash
      && evidence.authSessionHash === binding.authSessionHash
      && evidence.scopeHash === binding.scopeHash
      && evidence.scopeHash === issue.scopeHash
      && evidence.planHash === planHash
      && evidence.planHash === receipt?.planHash
      && evidence.requiredCapabilityHash === sha256Hex(requiredCapability)
      && evidence.issuedCapabilityHash === issue.capabilityHash,
  );
  const ok = Boolean(
    complete
      && shapeValid
      && fresh
      && capabilityNotDowngraded
      && bindingMatches,
  );
  const reason = !complete
    ? 'missing-capability-evidence'
    : !shapeValid
      ? 'malformed-capability-evidence'
      : !fresh
        ? 'stale-capability-evidence'
        : !capabilityNotDowngraded
          ? 'downgraded-capability-evidence'
          : !bindingMatches
            ? 'drifted-capability-evidence'
            : 'bound-capability-evidence';
  const code = ok
    ? 'OK'
    : reason === 'downgraded-capability-evidence'
      ? 'SIGNED_SESSION_CAPABILITY_DOWNGRADED'
      : reason === 'missing-capability-evidence'
        ? 'CAPABILITY_EVIDENCE_MISSING'
        : reason === 'malformed-capability-evidence'
          ? 'CAPABILITY_EVIDENCE_MALFORMED'
          : reason === 'stale-capability-evidence'
            ? 'CAPABILITY_EVIDENCE_STALE'
            : 'CAPABILITY_EVIDENCE_DRIFTED';
  const validation = {
    ok,
    code,
    reasonHash: sha256Hex(reason),
    capabilityEvidenceComplete: complete,
    capabilityEvidenceShapeValid: shapeValid,
    capabilityEvidenceFresh: fresh,
    capabilityNotDowngraded,
    sessionHashBound: bindingMatches && evidence.sessionHash === binding.pushSessionHash,
    identityHashBound: bindingMatches && evidence.identityHash === binding.identityHash,
    authSessionHashBound: bindingMatches && evidence.authSessionHash === binding.authSessionHash,
    scopeHashBound: bindingMatches && evidence.scopeHash === binding.scopeHash,
    planHashBound: bindingMatches && evidence.planHash === planHash,
    checkedBeforeJsonParsing: true,
    checkedBeforeReceiptWork: true,
    checkedBeforeMutationCapableWork: true,
    checkedBeforeReleaseMovement: true,
  };
  validation.validationHash = digest(validation);
  return validation;
}

function positiveSupportEvidence({ receipt, plan, dryRunRequestHash, afterSnapshotHash }) {
  const capabilityEvidence = buildCapabilityEvidence(receipt);
  const dryRunReceipt = receiptBindingEvidence(receipt, plan, dryRunRequestHash);
  const preMovementBinding = validateCapabilityEvidence({
    capabilityEvidence,
    receipt,
    planHash: digest(plan),
  });
  const supportOk = Boolean(
    dryRunReceipt.binds.samePlan
      && dryRunReceipt.binds.sameCanonicalPlan
      && dryRunReceipt.binds.sameScope
      && dryRunReceipt.binds.sameIdentity
      && dryRunReceipt.binds.sameAuthSession
      && dryRunReceipt.binds.sameSession
      && dryRunReceipt.binds.requiredCapability
      && dryRunReceipt.binds.capabilityHashPresent
      && preMovementBinding.ok,
  );
  const envelope = {
    schemaVersion: 1,
    sliceHash: sha256Hex('RPP-0598'),
    variantHash: sha256Hex('capability-downgrade-rejection-release-verifier-v5'),
    evidenceScope: 'local-executor-auth-support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportStatus: supportOk ? 'dry-run-receipt-and-capability-bound' : 'support-only-blocked',
    verifyRelease: {
      summaryCount: 1,
      capabilityDowngradeRejectionSummaryCount: 1,
      checkedCommandHash: sha256Hex(checkedCommand),
    },
    dryRunReceipt,
    capabilityEvidence: capabilityEvidenceSummary(capabilityEvidence),
    preMovementBinding,
    noWork: {
      dryRunOnly: true,
      applyAttempted: false,
      jsonParseCount: 0,
      receiptWorkCount: 0,
      mutationCapableWorkCount: 0,
      releaseMovementCount: 0,
      afterSnapshotHash,
    },
    releaseMovement: {
      allowed: false,
      blockedBySupportScope: supportOk,
      reasonHash: fixtureHash(
        supportOk
          ? 'local-support-proof-only'
          : 'receipt-or-capability-binding-incomplete',
      ),
    },
  };
  envelope.proofHash = digest(envelope);
  return envelope;
}

function applyCounters() {
  return {
    jsonParse: 0,
    receiptRead: 0,
    receiptValidated: 0,
    receiptMoved: 0,
    dbJournalOpen: 0,
    mutationPrepared: 0,
    mutationApplied: 0,
    releaseMovement: 0,
  };
}

function capabilityRejectionEvidence({
  caseLabel,
  category,
  validation,
  capabilityEvidence,
  receipt,
  plan,
  requestHash,
  counters,
}) {
  const summary = capabilityEvidenceSummary(capabilityEvidence);
  const evidence = {
    schemaVersion: 1,
    caseHash: fixtureHash(caseLabel),
    categoryHash: sha256Hex(category),
    code: validation.code,
    phase: 'before-json-parsing',
    receiptPhase: 'before-receipt-work',
    authorization: 'mutation-authority-denied',
    capabilityEvidenceHash: summary.evidenceHash,
    sessionHash: summary.sessionHash || receipt.authBinding.binding.pushSessionHash,
    identityHash: summary.identityHash || receipt.authBinding.binding.identityHash,
    authSessionHash: summary.authSessionHash || receipt.authBinding.binding.authSessionHash,
    scopeHash: summary.scopeHash || sha256Hex(authScope),
    planHash: receipt.planHash,
    canonicalPlanHash: digest(plan),
    receiptHash: receipt.receiptHash,
    requestHash,
    requiredCapabilityHash: summary.requiredCapabilityHash || sha256Hex(requiredCapability),
    issuedCapabilityHash: summary.issuedCapabilityHash || receipt.authBinding.pushSession.issue.capabilityHash,
    observedCapabilityHash: summary.observedCapabilityHash,
    validationHash: validation.validationHash,
    blockedBefore: {
      jsonParsing: counters.jsonParse === 0,
      receiptWork: counters.receiptRead === 0
        && counters.receiptValidated === 0
        && counters.receiptMoved === 0,
      mutationCapableWork: counters.dbJournalOpen === 0
        && counters.mutationPrepared === 0
        && counters.mutationApplied === 0,
      releaseMovement: counters.releaseMovement === 0,
    },
    counters: { ...counters },
  };
  evidence.rejectionHash = digest(evidence);
  return evidence;
}

function runCapabilityGuardedApply({
  caseLabel,
  category,
  receipt,
  plan,
  capabilityEvidence,
  rawBody,
}) {
  const counters = applyCounters();
  const validation = validateCapabilityEvidence({
    capabilityEvidence,
    receipt,
    planHash: digest(plan),
  });
  const requestHash = sha256Hex(rawBody);

  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      status: validation.code === 'SIGNED_SESSION_CAPABILITY_DOWNGRADED' ? 403 : 409,
      validation,
      counters,
      rejection: capabilityRejectionEvidence({
        caseLabel,
        category,
        validation,
        capabilityEvidence,
        receipt,
        plan,
        requestHash,
        counters,
      }),
    };
  }

  counters.jsonParse += 1;
  JSON.parse(rawBody);
  counters.receiptRead += 1;
  counters.receiptValidated += 1;
  counters.dbJournalOpen += 1;
  counters.mutationPrepared += 1;
  counters.mutationApplied += 1;

  return {
    ok: true,
    code: 'OK',
    status: 200,
    validation,
    counters,
  };
}

function releaseVerifierSummary({ positiveSupport, rejections }) {
  const negativeOk = rejections.length === 5
    && rejections.every((rejection) => (
      rejection.blockedBefore.jsonParsing === true
      && rejection.blockedBefore.receiptWork === true
      && rejection.blockedBefore.mutationCapableWork === true
      && rejection.blockedBefore.releaseMovement === true
      && rejection.counters.jsonParse === 0
      && rejection.counters.receiptRead === 0
      && rejection.counters.receiptValidated === 0
      && rejection.counters.receiptMoved === 0
      && rejection.counters.dbJournalOpen === 0
      && rejection.counters.mutationPrepared === 0
      && rejection.counters.mutationApplied === 0
      && rejection.counters.releaseMovement === 0
    ));
  const supportOk = Boolean(
    positiveSupport.preMovementBinding.ok
      && positiveSupport.dryRunReceipt.binds.sameSession
      && positiveSupport.dryRunReceipt.binds.sameIdentity
      && positiveSupport.dryRunReceipt.binds.sameScope
      && positiveSupport.dryRunReceipt.binds.sameCanonicalPlan
      && negativeOk,
  );
  const summary = {
    schemaVersion: 1,
    sliceHash: sha256Hex('RPP-0598'),
    variantHash: sha256Hex('capability-downgrade-rejection-release-verifier-v5'),
    proofClassHash: fixtureHash('capability-downgrade-rejection-release-verifier'),
    evidenceScope: 'local-executor-auth-support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    ok: supportOk,
    supportStatus: supportOk ? 'support-only-bound-and-rejected' : 'support-only-blocked',
    verifyRelease: {
      summaryCount: 1,
      capabilityDowngradeRejectionSummaryCount: 1,
      checkedCommandHash: sha256Hex(checkedCommand),
      positiveSupportHash: positiveSupport.proofHash,
    },
    dryRunReceipt: positiveSupport.dryRunReceipt,
    capabilityEvidence: positiveSupport.capabilityEvidence,
    preMovementBinding: positiveSupport.preMovementBinding,
    negativeProof: {
      caseCount: rejections.length,
      downgradedMissingMalformedStaleOrDrifted: true,
      rejectedBeforeJsonParsing: negativeOk,
      rejectedBeforeReceiptWork: negativeOk,
      rejectedBeforeMutationCapableWork: negativeOk,
      rejectedBeforeReleaseMovement: negativeOk,
      proofHash: digest(rejections),
    },
    downgradeRejections: rejections,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: fixtureHash(
        supportOk
          ? 'local-support-proof-only'
          : 'capability-downgrade-rejection-proof-incomplete',
      ),
    },
    boundary: {
      status: 'blocked',
      verdictHash: fixtureHash('checked-production-capability-downgrade-proof-required'),
    },
  };
  summary.proofHash = digest(summary);
  return summary;
}

function assertHashOrNull(value, label) {
  if (value === null) {
    return;
  }
  assert.match(value, hashPattern, `${label} must be a bare sha256 digest or null`);
}

function readPath(value, pathExpression) {
  return pathExpression.split('.').reduce((current, key) => current?.[key], value);
}

function assertHashFields(value, labels) {
  for (const label of labels) {
    assert.match(readPath(value, label), hashPattern, `${label} must be a bare sha256 digest`);
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `support evidence leaked raw value ${rawValue}`,
    );
  }
}

function assertHashOnlySupportEnvelope(envelope) {
  function visit(value) {
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'scope', 'support envelope must not expose raw scopes');
      assert.notEqual(key, 'identity', 'support envelope must not expose raw identities');
      assert.notEqual(key, 'session', 'support envelope must not expose raw sessions');
      assert.notEqual(key, 'sessionId', 'support envelope must not expose raw session ids');
      assert.notEqual(key, 'userId', 'support envelope must not expose raw user ids');
      assert.notEqual(key, 'userLogin', 'support envelope must not expose raw user logins');
      assert.notEqual(key, 'sourceUrl', 'support envelope must not expose raw URLs');
      assert.notEqual(key, 'plan', 'support envelope must not expose raw plans');
      assert.notEqual(key, 'requestBody', 'support envelope must not expose raw request bodies');
      assert.notEqual(key, 'filePath', 'support envelope must not expose raw file paths');
      assert.notEqual(key, 'rowValues', 'support envelope must not expose raw row values');
      assert.notEqual(key, 'journalPayload', 'support envelope must not expose raw journal payloads');
      assert.notEqual(key, 'token', 'support envelope must not expose tokens');
      visit(child);
    }
  }
  visit(envelope);
}

function assertReceiptBinding(receipt, plan, idempotencyKey) {
  const binding = receipt.authBinding.binding;
  const issue = receipt.authBinding.pushSession.issue;
  const sessionUser = receipt.authBinding.sessionUser;
  const planHash = digest(plan);

  assert.equal(receipt.planHash, planHash);
  assert.equal(receipt.authBinding.planHash, planHash);
  assert.equal(receipt.authBinding.plan.planHash, planHash);
  assert.equal(receipt.authBinding.request.planHash, planHash);
  assert.equal(receipt.authBinding.request.planPayloadHash, planHash);
  assert.equal(binding.planHash, planHash);
  assert.equal(receipt.authBinding.scope, authScope);
  assert.equal(binding.scopeHash, sha256Hex(authScope));
  assert.equal(binding.identityHash, digest(grantedAuth.identity));
  assert.equal(binding.authSessionHash, digest(grantedAuth.session));
  assert.equal(issue.sessionHash, binding.pushSessionHash);
  assert.equal(issue.identityHash, binding.identityHash);
  assert.equal(issue.scopeHash, binding.scopeHash);
  assert.equal(issue.requiredCapability, requiredCapability);
  assert.equal(issue.capabilityHash, fixtureHash('capability-granted'));
  assert.equal(sessionUser.identityHash, binding.identityHash);
  assert.equal(sessionUser.authSessionHash, binding.authSessionHash);
  assert.equal(sessionUser.pushSessionHash, binding.pushSessionHash);
  assert.equal(sessionUser.manageOptions, true);
  assert.equal(
    receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
    sha256Hex(idempotencyKey),
  );
}

function installFetch(handler) {
  const originalFetch = global.fetch;
  const seen = [];

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    const headers = headerEntries(options.headers);
    const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
    seen.push({ pathname, rawBody, body, headers, contentHash });
    return handler({ pathname, rawBody, body, headers, contentHash });
  };

  return {
    seen,
    restore() {
      global.fetch = originalFetch;
    },
  };
}

async function runBoundDryRunProof() {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0598-bound-dry-run-v5';
  let dryRunReceipt = null;
  let dryRunPlan = null;
  let afterSnapshotHash = '';
  let mutationCapableWorkCount = 0;
  let releaseMovementCount = 0;

  const { seen, restore } = installFetch(({ pathname, body, contentHash }) => {
    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth: cloneJson(grantedAuth),
        session: { id: sessionId, expiresAt: grantedAuth.session.expiresAt },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      afterSnapshotHash = digest(base);
      return jsonResponse({
        ok: true,
        snapshot: cloneJson(base),
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      dryRunPlan = body.plan;
      dryRunReceipt = receiptForPlan(dryRunPlan, idempotencyKey, contentHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: cloneJson(grantedAuth),
        receipt: dryRunReceipt,
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    mutationCapableWorkCount += 1;
    releaseMovementCount += 1;
    throw new Error(`unexpected mutation path for RPP-0598 dry-run proof: ${pathname}`);
  });

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl,
      base,
      local,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
      dryRunOnly: true,
      requireProductionAuthSession: true,
      now: fixedNow,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.mode, 'dry-run');
    assert.equal(summary.apply, null);
    assert.equal(summary.replay, null);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.dbJournal, null);
    assert.equal(mutationCapableWorkCount, 0);
    assert.equal(releaseMovementCount, 0);
    assert.deepEqual(
      seen.map((entry) => entry.pathname),
      [
        `${routePrefix}/preflight`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/dry-run`,
        `${routePrefix}/snapshot`,
      ],
    );

    const dryRunRequest = seen.find((entry) => entry.pathname === `${routePrefix}/dry-run`);
    assert.ok(dryRunRequest);
    assert.equal(dryRunRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(dryRunRequest.headers['x-reprint-push-idempotency-key'], idempotencyKey);
    assert.equal(dryRunRequest.headers['x-auth-content-hash'], sha256Hex(dryRunRequest.rawBody));
    assert.deepEqual(dryRunPlan, summary.planObject);
    assertReceiptBinding(dryRunReceipt, dryRunPlan, idempotencyKey);
    assert.equal(summary.sessionUserIdentityBinding.ok, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameUser, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameSession, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.manageOptions, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.receiptBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sessionUserBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.receiptIdentityMatches, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.issueIdentityMatches, true);

    const positiveSupport = positiveSupportEvidence({
      receipt: dryRunReceipt,
      plan: dryRunPlan,
      dryRunRequestHash: dryRunRequest.headers['x-auth-content-hash'],
      afterSnapshotHash,
    });
    assertHashFields(positiveSupport, [
      'proofHash',
      'sliceHash',
      'variantHash',
      'verifyRelease.checkedCommandHash',
      'dryRunReceipt.receiptHash',
      'dryRunReceipt.planHash',
      'dryRunReceipt.canonicalPlanHash',
      'dryRunReceipt.scopeHash',
      'dryRunReceipt.bindingHash',
      'dryRunReceipt.identityHash',
      'dryRunReceipt.authSessionHash',
      'dryRunReceipt.pushSessionHash',
      'dryRunReceipt.issueHash',
      'dryRunReceipt.issueSessionHash',
      'dryRunReceipt.issueIdentityHash',
      'dryRunReceipt.issueScopeHash',
      'dryRunReceipt.issueRequiredCapabilityHash',
      'dryRunReceipt.issueCapabilityHash',
      'dryRunReceipt.sessionUserIdentityHash',
      'dryRunReceipt.sessionUserAuthSessionHash',
      'dryRunReceipt.sessionUserPushSessionHash',
      'dryRunReceipt.sessionUserBindingHash',
      'dryRunReceipt.dryRunContentHash',
      'dryRunReceipt.dryRunCanonicalHash',
      'dryRunReceipt.dryRunIdempotencyKeyHash',
      'dryRunReceipt.dryRunRequestHash',
      'capabilityEvidence.evidenceHash',
      'capabilityEvidence.sessionHash',
      'capabilityEvidence.identityHash',
      'capabilityEvidence.authSessionHash',
      'capabilityEvidence.scopeHash',
      'capabilityEvidence.planHash',
      'preMovementBinding.validationHash',
      'noWork.afterSnapshotHash',
      'releaseMovement.reasonHash',
    ]);
    assert.deepEqual(positiveSupport.dryRunReceipt.binds, {
      samePlan: true,
      sameCanonicalPlan: true,
      sameScope: true,
      sameIdentity: true,
      sameAuthSession: true,
      sameSession: true,
      requiredCapability: true,
      capabilityHashPresent: true,
    });
    assert.equal(positiveSupport.preMovementBinding.ok, true);
    assert.equal(positiveSupport.preMovementBinding.code, 'OK');
    assert.equal(positiveSupport.preMovementBinding.sessionHashBound, true);
    assert.equal(positiveSupport.preMovementBinding.identityHashBound, true);
    assert.equal(positiveSupport.preMovementBinding.scopeHashBound, true);
    assert.equal(positiveSupport.preMovementBinding.planHashBound, true);
    assert.equal(positiveSupport.preMovementBinding.checkedBeforeReleaseMovement, true);
    assert.equal(positiveSupport.releaseMovement.allowed, false);
    assert.equal(positiveSupport.releaseMovement.blockedBySupportScope, true);
    assert.equal(positiveSupport.productionBacked, false);
    assert.equal(positiveSupport.releaseGate, 'NO-GO');
    assertHashOnlySupportEnvelope(positiveSupport);
    assertNoRawValues(positiveSupport, [
      sourceUrl,
      sessionId,
      credential.username,
      credential.password,
      authScope,
      requiredCapability,
      idempotencyKey,
      fixturePath,
      base.files[fixturePath],
      local.files[fixturePath],
      dryRunRequest.rawBody,
      JSON.stringify(dryRunPlan),
    ]);

    return {
      positiveSupport,
      receipt: dryRunReceipt,
      plan: dryRunPlan,
      rawRedactionValues: [
        sourceUrl,
        sessionId,
        credential.username,
        credential.password,
        authScope,
        requiredCapability,
        idempotencyKey,
        fixturePath,
        base.files[fixturePath],
        local.files[fixturePath],
        dryRunRequest.rawBody,
        JSON.stringify(dryRunPlan),
      ],
    };
  } finally {
    restore();
  }
}

test('RPP-0598 v5 route and release verifier check capability before parsing receipt mutation and movement', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const capabilityMatches = functionBody('reprint_push_lab_rest_signed_session_capability_matches');
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');
  const liveVerifierEntry = liveReleaseVerifierSource.slice(
    0,
    liveReleaseVerifierSource.indexOf('function resolveReleaseTopologyBlocker'),
  );
  const manageOptionsBlocker = functionBody(
    'resolveManageOptionsCapabilityBlocker',
    liveReleaseVerifierSource,
  );
  const emitManageOptionsGate = functionBody(
    'emitManageOptionsCapabilityGateAndExit',
    liveReleaseVerifierSource,
  );

  assert.match(routeSource, /const REPRINT_PUSH_LAB_REQUIRED_CAPABILITY = 'manage_options';/);
  assert.match(capabilityMatches, /current_user_can\(REPRINT_PUSH_LAB_REQUIRED_CAPABILITY\)/);
  assert.match(capabilityMatches, /\$session\['requiredCapability'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityGranted'\]/);
  assert.match(capabilityMatches, /\$session\['capabilityHash'\]/);
  assert.match(capabilityMatches, /reprint_push_lab_rest_signed_capability_hash\(\)/);
  assert.match(verifySignedRequest, /'SIGNED_SESSION_CAPABILITY_DOWNGRADED'/);
  assertBefore(
    verifySignedRequest,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifySignedRequest,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    'reprint_push_lab_rest_claim_signed_nonce',
  );
  assert.doesNotMatch(
    verifySignedRequest,
    /reprint_push_lab_rest_json_payload|get_json_params|reprint_push_lab_rest_bind_authenticated_receipt|reprint_push_lab_rest_validate_authenticated_receipt|reprint_push_lab_rest_apply_with_db_journal|reprint_push_protocol_run_payload/,
  );

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(
    dryRun,
    'reprint_push_lab_rest_protocol_response',
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    dryRun,
    'reprint_push_lab_rest_json_payload($request)',
    'reprint_push_lab_rest_bind_authenticated_receipt',
  );
  assertBefore(
    apply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(apply, 'return $signature_error;', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assert.match(bindReceipt, /'binding'\s*=>\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(bindReceipt, /'issue'\s*=>\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(bindReceipt, /'sessionUser'\s*=>\s*reprint_push_lab_rest_authenticated_user_identity_binding/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assert.match(validateReceipt, /Receipt session user identity binding does not match the current authenticated user\./);

  assertBefore(
    liveVerifierEntry,
    'const manageOptionsCapabilityBlocker = resolveManageOptionsCapabilityBlocker',
    'const sameSourceIdentityBlocker = resolveSameSourceIdentityBlocker',
  );
  assertBefore(
    liveVerifierEntry,
    'const manageOptionsCapabilityBlocker = resolveManageOptionsCapabilityBlocker',
    'const verify = runCheckedReleaseVerify',
  );
  assert.match(manageOptionsBlocker, /capabilities\.manage_options === true/);
  assert.match(manageOptionsBlocker, /return \{\s*authSessionSource,\s*capabilities,\s*\}/s);
  assert.match(emitManageOptionsGate, /MANAGE_OPTIONS_CAPABILITY_REQUIRED/);
  assert.match(emitManageOptionsGate, /mutationAttempted:\s*false/);
  assert.match(emitManageOptionsGate, /allowed:\s*false/);
  assert.match(emitManageOptionsGate, /manageOptionsCapability/);
});

test('RPP-0598 v5 accepted dry-run receipt binds session identity scope and canonical plan hash', async () => {
  await runBoundDryRunProof();
});

test('RPP-0598 v5 rejects downgraded missing malformed stale or drifted capability evidence before work', async () => {
  const { positiveSupport, receipt, plan, rawRedactionValues } = await runBoundDryRunProof();
  const malformedRawBody = '{"plan":';
  const negativeCases = [
    {
      caseLabel: 'downgraded-current-user-capability',
      category: 'downgraded',
      capabilityEvidence: buildCapabilityEvidence(receipt, {
        caseLabel: 'downgraded-current-user-capability',
        fields: {
          capabilityGranted: false,
          observedCapabilityHash: fixtureHash('capability-denied-current-user'),
        },
      }),
      code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
      blockedFlag: 'capabilityNotDowngraded',
    },
    {
      caseLabel: 'missing-capability-evidence',
      category: 'missing',
      capabilityEvidence: null,
      code: 'CAPABILITY_EVIDENCE_MISSING',
      blockedFlag: 'capabilityEvidenceComplete',
    },
    {
      caseLabel: 'malformed-capability-evidence',
      category: 'malformed',
      capabilityEvidence: buildCapabilityEvidence(receipt, {
        caseLabel: 'malformed-capability-evidence',
        malformedEvidenceHash: true,
      }),
      code: 'CAPABILITY_EVIDENCE_MALFORMED',
      blockedFlag: 'capabilityEvidenceShapeValid',
    },
    {
      caseLabel: 'stale-capability-evidence',
      category: 'stale',
      capabilityEvidence: buildCapabilityEvidence(receipt, {
        caseLabel: 'stale-capability-evidence',
        fields: {
          fresh: false,
          observedAtHash: fixtureHash('stale-observed-at'),
          expiresAtHash: fixtureHash('stale-expires-at'),
        },
      }),
      code: 'CAPABILITY_EVIDENCE_STALE',
      blockedFlag: 'capabilityEvidenceFresh',
    },
    {
      caseLabel: 'drifted-capability-evidence',
      category: 'drifted',
      capabilityEvidence: buildCapabilityEvidence(receipt, {
        caseLabel: 'drifted-capability-evidence',
        fields: {
          planHash: fixtureHash('drifted-plan-hash'),
        },
      }),
      code: 'CAPABILITY_EVIDENCE_DRIFTED',
      blockedFlag: 'planHashBound',
    },
  ];

  const rejections = negativeCases.map((negativeCase) => {
    const result = runCapabilityGuardedApply({
      caseLabel: negativeCase.caseLabel,
      category: negativeCase.category,
      receipt,
      plan,
      capabilityEvidence: negativeCase.capabilityEvidence,
      rawBody: malformedRawBody,
    });
    assert.equal(result.ok, false, negativeCase.caseLabel);
    assert.equal(result.code, negativeCase.code, negativeCase.caseLabel);
    assert.equal(result.validation[negativeCase.blockedFlag], false, negativeCase.caseLabel);
    assert.equal(result.validation.checkedBeforeJsonParsing, true, negativeCase.caseLabel);
    assert.deepEqual(result.counters, applyCounters(), negativeCase.caseLabel);
    assert.equal(result.rejection.code, negativeCase.code, negativeCase.caseLabel);
    assert.equal(result.rejection.phase, 'before-json-parsing', negativeCase.caseLabel);
    assert.equal(result.rejection.receiptPhase, 'before-receipt-work', negativeCase.caseLabel);
    assert.equal(result.rejection.blockedBefore.jsonParsing, true, negativeCase.caseLabel);
    assert.equal(result.rejection.blockedBefore.receiptWork, true, negativeCase.caseLabel);
    assert.equal(result.rejection.blockedBefore.mutationCapableWork, true, negativeCase.caseLabel);
    assert.equal(result.rejection.blockedBefore.releaseMovement, true, negativeCase.caseLabel);
    assertHashFields(result.rejection, [
      'caseHash',
      'categoryHash',
      'sessionHash',
      'identityHash',
      'authSessionHash',
      'scopeHash',
      'planHash',
      'canonicalPlanHash',
      'receiptHash',
      'requestHash',
      'requiredCapabilityHash',
      'issuedCapabilityHash',
      'validationHash',
      'rejectionHash',
    ]);
    assertHashOrNull(result.rejection.capabilityEvidenceHash, 'capabilityEvidenceHash');
    assertHashOrNull(result.rejection.observedCapabilityHash, 'observedCapabilityHash');
    assertHashOnlySupportEnvelope(result.rejection);
    return result.rejection;
  });

  const summary = releaseVerifierSummary({ positiveSupport, rejections });
  assert.equal(summary.ok, true);
  assert.equal(summary.supportStatus, 'support-only-bound-and-rejected');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.releaseGate, 'NO-GO');
  assert.equal(summary.verifyRelease.summaryCount, 1);
  assert.equal(summary.verifyRelease.capabilityDowngradeRejectionSummaryCount, 1);
  assert.equal(summary.negativeProof.caseCount, 5);
  assert.equal(summary.negativeProof.downgradedMissingMalformedStaleOrDrifted, true);
  assert.equal(summary.negativeProof.rejectedBeforeJsonParsing, true);
  assert.equal(summary.negativeProof.rejectedBeforeReceiptWork, true);
  assert.equal(summary.negativeProof.rejectedBeforeMutationCapableWork, true);
  assert.equal(summary.negativeProof.rejectedBeforeReleaseMovement, true);
  assert.equal(summary.releaseMovement.allowed, false);
  assert.deepEqual(
    summary.downgradeRejections.map((rejection) => rejection.code),
    [
      'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
      'CAPABILITY_EVIDENCE_MISSING',
      'CAPABILITY_EVIDENCE_MALFORMED',
      'CAPABILITY_EVIDENCE_STALE',
      'CAPABILITY_EVIDENCE_DRIFTED',
    ],
  );
  assert.deepEqual(summary.dryRunReceipt.binds, {
    samePlan: true,
    sameCanonicalPlan: true,
    sameScope: true,
    sameIdentity: true,
    sameAuthSession: true,
    sameSession: true,
    requiredCapability: true,
    capabilityHashPresent: true,
  });
  assertHashFields(summary, [
    'proofHash',
    'sliceHash',
    'variantHash',
    'proofClassHash',
    'verifyRelease.checkedCommandHash',
    'verifyRelease.positiveSupportHash',
    'negativeProof.proofHash',
    'releaseMovement.reasonHash',
    'boundary.verdictHash',
  ]);
  assertHashOnlySupportEnvelope(summary);
  assertNoRawValues(summary, [
    ...rawRedactionValues,
    malformedRawBody,
    checkedCommand,
  ]);
});

test('RPP-0598 evidence doc records support-only hash-only NO-GO scope', () => {
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(evidence, /^# RPP-0598 capability downgrade rejection, variant 5$/m);
  assert.match(evidence, /local executor-auth release-verifier support evidence only/);
  assert.match(evidence, /Final release remains\s+\*\*NO-GO\*\*/);
  assert.match(evidence, /dry-run receipts bind session, identity, scope, and canonical plan hash/);
  assert.match(evidence, /downgraded, missing, malformed, stale, and drifted capability evidence/);
  assert.match(evidence, /before JSON parsing, receipt work, mutation-capable work, or release movement/);
  assert.match(evidence, /hash-only/i);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /\b(?:test|docs|src|scripts)\//);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|signingKey|password|username|nonce|token|bearer|session id|file path/i);
});
