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
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0578-capability-downgrade-rejection-v4.md');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const requiredCapability = 'manage_options';
const sessionId = 'psh_01j00000000000000000578';
const authScope = 'reprint-push:production-shaped:manage-options';
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
    userId: 578,
    userLogin: credential.username,
    capabilities: { manage_options: true },
  },
  session: activeSession,
};
const downgradedAuth = {
  identity: {
    userId: grantedAuth.identity.userId,
    userLogin: credential.username,
    capabilities: { manage_options: false },
  },
  session: activeSession,
};
const fixturePath = 'wp-content/uploads/reprint-push/rpp-0578-capability-v4.txt';

function functionBody(name) {
  const declaration = `function ${name}`;
  const start = routeSource.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = routeSource.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < routeSource.length; index += 1) {
    const char = routeSource[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return routeSource.slice(open + 1, index);
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
  return sha256Hex(`rpp-0578:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
        [fixturePath]: 'rpp-0578 base capability downgrade content',
      },
      plugins: {},
      db: {},
    },
    local: {
      files: {
        [fixturePath]: 'rpp-0578 local capability downgrade content',
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

function positiveSupportEvidence({ receipt, plan, dryRunRequestHash, afterSnapshotHash }) {
  const dryRunReceipt = receiptBindingEvidence(receipt, plan, dryRunRequestHash);
  const envelope = {
    schemaVersion: 1,
    sliceHash: sha256Hex('RPP-0578'),
    variantHash: sha256Hex('capability-downgrade-rejection-v4'),
    evidenceScope: 'local-support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportStatus: 'dry-run-receipt-bound',
    routeProfileHash: sha256Hex('production-shaped'),
    dryRunReceipt,
    noMutation: {
      dryRunOnly: true,
      applyAttempted: false,
      receiptMovementCount: 0,
      mutationCapableWorkCount: 0,
      afterSnapshotHash,
    },
  };
  envelope.proofHash = digest(envelope);
  return envelope;
}

function capabilityDowngradeEvidence({
  receipt,
  requestHash,
  caseLabel,
  observedCapabilityHash,
}) {
  return {
    schemaVersion: 1,
    caseHash: fixtureHash(caseLabel),
    code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
    phase: 'before-receipt-movement',
    signedRequestPhase: 'before-canonical-verification',
    authorization: 'mutation-authority-denied',
    scopeHash: sha256Hex(authScope),
    sessionHash: receipt.authBinding.pushSession.sessionHash,
    identityHash: receipt.authBinding.binding.identityHash,
    authSessionHash: receipt.authBinding.binding.authSessionHash,
    planHash: receipt.planHash,
    canonicalPlanHash: receipt.planHash,
    receiptHash: receipt.receiptHash,
    requestHash,
    requiredCapabilityHash: sha256Hex(requiredCapability),
    issuedCapabilityHash: receipt.authBinding.pushSession.issue.capabilityHash,
    observedCapabilityHash,
    blockedBefore: {
      receiptMovement: true,
      mutationCapableWork: true,
    },
    receiptMovementCounts: {
      read: 0,
      moved: 0,
      mutated: 0,
    },
    mutationEventCounts: {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    },
  };
}

function rejectionSupportEnvelope({ positiveSupport, downgradeCases }) {
  const rejections = downgradeCases.map((downgrade) => ({
    caseHash: downgrade.caseHash,
    code: downgrade.code,
    phase: downgrade.phase,
    signedRequestPhase: downgrade.signedRequestPhase,
    authorization: downgrade.authorization,
    scopeHash: downgrade.scopeHash,
    sessionHash: downgrade.sessionHash,
    identityHash: downgrade.identityHash,
    authSessionHash: downgrade.authSessionHash,
    planHash: downgrade.planHash,
    canonicalPlanHash: downgrade.canonicalPlanHash,
    receiptHash: downgrade.receiptHash,
    requestHash: downgrade.requestHash,
    requiredCapabilityHash: downgrade.requiredCapabilityHash,
    issuedCapabilityHash: downgrade.issuedCapabilityHash,
    observedCapabilityHash: downgrade.observedCapabilityHash,
    blockedBefore: { ...downgrade.blockedBefore },
    receiptMovementCounts: { ...downgrade.receiptMovementCounts },
    mutationEventCounts: { ...downgrade.mutationEventCounts },
  }));
  const supportOk = Boolean(
    positiveSupport.dryRunReceipt.binds.samePlan
      && positiveSupport.dryRunReceipt.binds.sameCanonicalPlan
      && positiveSupport.dryRunReceipt.binds.sameScope
      && positiveSupport.dryRunReceipt.binds.sameIdentity
      && positiveSupport.dryRunReceipt.binds.sameAuthSession
      && positiveSupport.dryRunReceipt.binds.sameSession
      && rejections.every((entry) =>
        entry.code === 'SIGNED_SESSION_CAPABILITY_DOWNGRADED'
        && entry.blockedBefore.receiptMovement === true
        && entry.blockedBefore.mutationCapableWork === true
        && entry.receiptMovementCounts.read === 0
        && entry.receiptMovementCounts.moved === 0
        && entry.receiptMovementCounts.mutated === 0
        && entry.mutationEventCounts.prepared === 0
        && entry.mutationEventCounts.applied === 0
        && entry.mutationEventCounts.preconditionFailed === 0),
  );
  const envelope = {
    schemaVersion: 1,
    sliceHash: sha256Hex('RPP-0578'),
    variantHash: sha256Hex('capability-downgrade-rejection-v4'),
    evidenceScope: 'local-support-only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportStatus: supportOk ? 'support-only-bound-and-rejected' : 'support-only-blocked',
    positiveSupportHash: positiveSupport.proofHash,
    routeProfileHash: sha256Hex('production-shaped'),
    dryRunReceipt: positiveSupport.dryRunReceipt,
    downgradeRejections: rejections,
    releaseMovement: {
      allowed: false,
      reasonHash: supportOk
        ? fixtureHash('local-support-proof-only')
        : fixtureHash('receipt-or-downgrade-binding-incomplete'),
    },
  };
  envelope.proofHash = digest(envelope);
  return envelope;
}

function assertHashField(value, label) {
  assert.match(value, hashPattern, `${label} must be a bare sha256 hex digest`);
}

function readPath(value, pathExpression) {
  return pathExpression.split('.').reduce((current, key) => current?.[key], value);
}

function assertHashFields(value, labels) {
  for (const label of labels) {
    assertHashField(readPath(value, label), label);
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
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
    const urlString = String(url);
    const pathname = new URL(urlString).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    const headers = headerEntries(options.headers);
    const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
    seen.push({ pathname, rawBody, body, headers, contentHash });
    return handler({ urlString, pathname, rawBody, body, headers, contentHash });
  };

  return {
    seen,
    restore() {
      global.fetch = originalFetch;
    },
  };
}

async function runPositiveSupportPath() {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = 'idem-rpp-0578-positive-support-v4';
  let dryRunReceipt = null;
  let dryRunPlan = null;
  let afterSnapshotHash = '';
  let mutationCapableWorkCount = 0;
  let receiptMovementCount = 0;

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

    receiptMovementCount += 1;
    mutationCapableWorkCount += 1;
    throw new Error(`unexpected mutation path for RPP-0578 positive support: ${pathname}`);
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
    assert.equal(receiptMovementCount, 0);
    assert.equal(mutationCapableWorkCount, 0);
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
      'routeProfileHash',
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
      'dryRunReceipt.mutationSetHash',
      'dryRunReceipt.preconditionSetHash',
      'noMutation.afterSnapshotHash',
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
    assert.equal(positiveSupport.noMutation.applyAttempted, false);
    assert.equal(positiveSupport.noMutation.receiptMovementCount, 0);
    assert.equal(positiveSupport.noMutation.mutationCapableWorkCount, 0);
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

    return positiveSupport;
  } finally {
    restore();
  }
}

async function runDowngradeCase({ id, observedCapabilityHash }) {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = `idem-rpp-0578-${id}-v4`;
  const seenReceipts = [];
  let dryRunReceipt = null;
  let dryRunPlan = null;
  let downgradeEvidence = null;
  let receiptMovementCount = 0;
  let mutationCapableWorkCount = 0;

  const { seen, restore } = installFetch(({ pathname, body, contentHash }) => {
    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth: cloneJson(grantedAuth),
        session: { id: sessionId, expiresAt: grantedAuth.session.expiresAt },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: cloneJson(base),
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      dryRunPlan = body.plan;
      dryRunReceipt = receiptForPlan(dryRunPlan, idempotencyKey, contentHash);
      seenReceipts.push(dryRunReceipt.receiptHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: cloneJson(grantedAuth),
        receipt: dryRunReceipt,
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      seenReceipts.push(body.receipt?.receiptHash);
      downgradeEvidence = capabilityDowngradeEvidence({
        receipt: body.receipt,
        requestHash: contentHash,
        caseLabel: id,
        observedCapabilityHash,
      });
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
        responseSchemaVersion: 1,
        auth: cloneJson(downgradedAuth),
        capabilityDowngrade: downgradeEvidence,
        idempotency: {
          conflict: false,
          replayed: false,
          freshMutationWork: false,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: contentHash,
        },
        signedRequest: signedRequest(pathname, contentHash),
      }, 403);
    }

    receiptMovementCount += 1;
    mutationCapableWorkCount += 1;
    throw new Error(`unexpected mutation path after capability downgrade: ${pathname}`);
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
      requireProductionAuthSession: true,
      now: fixedNow,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.code, 'SIGNED_SESSION_CAPABILITY_DOWNGRADED');
    assert.equal(summary.apply.status, 403);
    assert.equal(summary.apply.code, 'SIGNED_SESSION_CAPABILITY_DOWNGRADED');
    assert.equal(summary.apply.idempotency.conflict, false);
    assert.equal(summary.apply.idempotency.freshMutationWork, false);
    assert.equal(summary.apply.idempotency.replayed, false);
    assert.equal(summary.replay, null);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.dbJournal, null);
    assert.equal(receiptMovementCount, 0);
    assert.equal(mutationCapableWorkCount, 0);
    assert.deepEqual(
      seen.map((entry) => entry.pathname),
      [
        `${routePrefix}/preflight`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/dry-run`,
        `${routePrefix}/apply`,
      ],
    );

    const dryRunRequest = seen.find((entry) => entry.pathname === `${routePrefix}/dry-run`);
    const applyRequest = seen.find((entry) => entry.pathname === `${routePrefix}/apply`);
    assert.ok(dryRunRequest);
    assert.ok(applyRequest);
    assert.equal(dryRunRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(applyRequest.headers['x-reprint-push-session'], sessionId);
    assert.equal(dryRunRequest.headers['x-reprint-push-idempotency-key'], idempotencyKey);
    assert.equal(applyRequest.headers['x-reprint-push-idempotency-key'], idempotencyKey);
    assert.equal(dryRunRequest.headers['x-auth-content-hash'], sha256Hex(dryRunRequest.rawBody));
    assert.equal(applyRequest.headers['x-auth-content-hash'], sha256Hex(applyRequest.rawBody));
    assert.deepEqual(seenReceipts, [
      dryRunReceipt.receiptHash,
      dryRunReceipt.receiptHash,
    ]);
    assertReceiptBinding(dryRunReceipt, dryRunPlan, idempotencyKey);
    assert.equal(summary.sessionUserIdentityBinding.ok, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameUser, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sameSession, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.manageOptions, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.receiptBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.checks.sessionUserBindingPresent, true);
    assert.equal(summary.sessionUserIdentityBinding.receipt.receiptHash, dryRunReceipt.receiptHash);

    assertHashFields(downgradeEvidence, [
      'caseHash',
      'scopeHash',
      'sessionHash',
      'identityHash',
      'authSessionHash',
      'planHash',
      'canonicalPlanHash',
      'receiptHash',
      'requestHash',
      'requiredCapabilityHash',
      'issuedCapabilityHash',
      'observedCapabilityHash',
    ]);
    assert.equal(downgradeEvidence.planHash, dryRunReceipt.planHash);
    assert.equal(downgradeEvidence.canonicalPlanHash, digest(dryRunPlan));
    assert.equal(downgradeEvidence.receiptHash, dryRunReceipt.receiptHash);
    assert.equal(downgradeEvidence.requestHash, applyRequest.headers['x-auth-content-hash']);
    assert.equal(downgradeEvidence.blockedBefore.receiptMovement, true);
    assert.equal(downgradeEvidence.blockedBefore.mutationCapableWork, true);
    assert.deepEqual(downgradeEvidence.receiptMovementCounts, {
      read: 0,
      moved: 0,
      mutated: 0,
    });
    assert.deepEqual(downgradeEvidence.mutationEventCounts, {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    });
    assert.equal(summary.apply.idempotency.idempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(summary.apply.idempotency.requestHash, applyRequest.headers['x-auth-content-hash']);
    assertHashOnlySupportEnvelope(downgradeEvidence);
    assertNoRawValues({
      downgradeEvidence,
      applyIdempotency: summary.apply.idempotency,
    }, [
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
      applyRequest.rawBody,
      JSON.stringify(dryRunPlan),
    ]);

    return downgradeEvidence;
  } finally {
    restore();
  }
}

test('RPP-0578 v4 route rejects capability downgrades before receipt movement and mutation authority', () => {
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const capabilityMatches = functionBody('reprint_push_lab_rest_signed_session_capability_matches');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const subjectBinding = functionBody('reprint_push_lab_rest_authenticated_receipt_subject_binding');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

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
  assertBefore(
    apply,
    "reprint_push_lab_rest_require_signed_request($request, 'apply')",
    'reprint_push_lab_rest_json_payload($request)',
  );
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );

  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\) \$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'issue'\s*=>\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(subjectBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\) \(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(subjectBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(subjectBinding, /'authSessionHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$session\)\)/);
  assert.match(subjectBinding, /'pushSessionHash'\s*=>\s*\(string\) \(\$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(subjectBinding, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(issueBinding, /'sessionHash'\s*=>\s*\(string\) \(\$session\['sessionHash'\] \?\? \$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\) \(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(issueBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(issueBinding, /'requiredCapability'\s*=>\s*\(string\) \(\$session\['requiredCapability'\]/);
  assert.match(issueBinding, /'capabilityHash'\s*=>\s*\(string\) \(\$session\['capabilityHash'\]/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assert.match(validateReceipt, /Receipt session user identity binding does not match the current authenticated user\./);
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt session user identity binding does not match the current authenticated user.',
  );
});

test('RPP-0578 v4 positive support path binds dry-run receipt subject hashes before apply authority', async () => {
  await runPositiveSupportPath();
});

test('RPP-0578 v4 downgrade cases preserve bound receipt and stop before receipt movement or mutation work', async () => {
  const positiveSupport = await runPositiveSupportPath();
  const downgradeCases = [];

  for (const scenario of [
    {
      id: 'observed-current-user-denied',
      observedCapabilityHash: fixtureHash('capability-denied-current-user'),
    },
    {
      id: 'issued-capability-grant-removed',
      observedCapabilityHash: fixtureHash('capability-grant-removed'),
    },
    {
      id: 'capability-hash-mismatch',
      observedCapabilityHash: fixtureHash('capability-hash-mismatch'),
    },
  ]) {
    downgradeCases.push(await runDowngradeCase(scenario));
  }

  const supportEnvelope = rejectionSupportEnvelope({ positiveSupport, downgradeCases });
  assert.equal(supportEnvelope.productionBacked, false);
  assert.equal(supportEnvelope.releaseGate, 'NO-GO');
  assert.equal(supportEnvelope.supportStatus, 'support-only-bound-and-rejected');
  assert.equal(supportEnvelope.downgradeRejections.length, 3);
  assert.equal(supportEnvelope.releaseMovement.allowed, false);
  assertHashFields(supportEnvelope, [
    'proofHash',
    'sliceHash',
    'variantHash',
    'positiveSupportHash',
    'routeProfileHash',
    'releaseMovement.reasonHash',
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
    'dryRunReceipt.mutationSetHash',
    'dryRunReceipt.preconditionSetHash',
  ]);
  for (const [index, rejection] of supportEnvelope.downgradeRejections.entries()) {
    assertHashFields(rejection, [
      'caseHash',
      'scopeHash',
      'sessionHash',
      'identityHash',
      'authSessionHash',
      'planHash',
      'canonicalPlanHash',
      'receiptHash',
      'requestHash',
      'requiredCapabilityHash',
      'issuedCapabilityHash',
      'observedCapabilityHash',
    ]);
    assert.equal(rejection.code, 'SIGNED_SESSION_CAPABILITY_DOWNGRADED');
    assert.equal(rejection.phase, 'before-receipt-movement');
    assert.equal(rejection.signedRequestPhase, 'before-canonical-verification');
    assert.equal(rejection.authorization, 'mutation-authority-denied');
    assert.equal(rejection.blockedBefore.receiptMovement, true);
    assert.equal(rejection.blockedBefore.mutationCapableWork, true);
    assert.deepEqual(rejection.receiptMovementCounts, {
      read: 0,
      moved: 0,
      mutated: 0,
    });
    assert.deepEqual(rejection.mutationEventCounts, {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    });
    assert.equal(
      rejection.canonicalPlanHash,
      supportEnvelope.downgradeRejections[index].planHash,
    );
  }
  assert.deepEqual(supportEnvelope.dryRunReceipt.binds, {
    samePlan: true,
    sameCanonicalPlan: true,
    sameScope: true,
    sameIdentity: true,
    sameAuthSession: true,
    sameSession: true,
    requiredCapability: true,
    capabilityHashPresent: true,
  });
  assertHashOnlySupportEnvelope(supportEnvelope);
  assertNoRawValues(supportEnvelope, [
    sourceUrl,
    sessionId,
    credential.username,
    credential.password,
    authScope,
    requiredCapability,
    fixturePath,
  ]);
});

test('RPP-0578 v4 evidence doc records support-only hash-only NO-GO scope', () => {
  const evidence = readFileSync(evidencePath, 'utf8');

  assert.match(evidence, /^# RPP-0578 capability downgrade rejection, variant 4$/m);
  assert.match(evidence, /local executor-auth support evidence only/);
  assert.match(evidence, /Final release remains\s+\*\*NO-GO\*\*/);
  assert.match(evidence, /SIGNED_SESSION_CAPABILITY_DOWNGRADED/);
  assert.match(evidence, /session, identity, scope, and canonical\s+plan hash/);
  assert.match(evidence, /hash-only/i);
  assert.doesNotMatch(evidence, /https?:\/\//);
  assert.doesNotMatch(evidence, /\b(?:test|docs|src|scripts)\//);
  assert.doesNotMatch(evidence, /applicationPassword|credentialHash|password|username|nonce|token|session id|file path/i);
});
