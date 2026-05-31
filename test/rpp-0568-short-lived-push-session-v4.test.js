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
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'https://rpp-0568-source.invalid';
const routePrefix = '/wp-json/reprint/v1/push';
const dryRunRouteBinding = '/push/dry-run';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const unexpiredReceiptExpiry = '2026-05-31T00:05:00Z';
const expiredReceiptExpiry = '2026-05-30T23:59:59Z';
const sessionToken = 'psh_rpp_0568_generated_session_000000';
const authScope = 'reprint-push-lab:authenticated-http-push';
const hashPattern = /^[a-f0-9]{64}$/;

const credential = {
  username: 'rpp_0568_admin',
  password: 'rpp-0568-private-application-password',
};

const grantedAuth = {
  identity: {
    userId: 568,
    userLogin: credential.username,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: sessionToken,
    expiresAt: '2030-01-01T00:00:00Z',
  },
};

const fixturePath = 'wp-content/uploads/reprint-push/rpp-0568-short-lived-v4.txt';

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
  return sha256Hex(`rpp-0568:${label}`);
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
        [fixturePath]: 'rpp-0568 base short-lived push session content',
      },
      plugins: {},
      db: {},
    },
    local: {
      files: {
        [fixturePath]: 'rpp-0568 local short-lived push session content',
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

function rebuildReceiptHash(receipt) {
  const rebuilt = cloneJson(receipt);
  delete rebuilt.receiptHash;
  rebuilt.receiptHash = digest(rebuilt);
  return rebuilt;
}

function refreshSubjectBinding(receipt) {
  const subject = receipt.authBinding?.binding;
  if (subject && typeof subject === 'object') {
    delete subject.bindingHash;
    subject.bindingHash = digest(subject);
  }
  return receipt;
}

function refreshIssueBinding(receipt) {
  const issue = receipt.authBinding?.pushSession?.issue;
  if (issue && typeof issue === 'object') {
    delete issue.issueHash;
    issue.issueHash = digest(issue);
  }
  return receipt;
}

function receiptForPlan(plan, idempotencyKey, dryRunRawBodyHash, { expiresAt = unexpiredReceiptExpiry } = {}) {
  const evidence = planEvidence(plan);
  const planHash = digest(plan);
  const identityHash = digest(grantedAuth.identity);
  const authSessionHash = digest(grantedAuth.session);
  const pushSessionHash = sha256Hex(sessionToken);
  const signingKeyHash = fixtureHash('signing-key');
  const scopeHash = sha256Hex(authScope);
  const sourceUrlHash = sha256Hex(sourceUrl);
  const subjectBinding = withBindingHash({
    schemaVersion: 1,
    scopeHash,
    identityHash,
    authSessionHash,
    pushSessionHash,
    planHash,
  });
  const issue = withIssueHash({
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: pushSessionHash,
    signingKeyHash,
    scopeHash,
    identityHash,
    userIdentityHash: fixtureHash('user-identity'),
    requiredCapability: 'manage_options',
    capabilityHash: fixtureHash('capability-granted'),
    sourceHash: fixtureHash('source'),
    sourceUrlHash,
    issuedAt: '2026-05-31T00:00:00Z',
    expiresAt,
    ttlSeconds: 300,
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
        sourceUrlHash,
        restNamespace: 'reprint/v1',
        routeProfile: 'production-shaped',
        labBacked: false,
      },
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: dryRunRouteBinding,
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
      expiresAt,
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
    sessionHash: sha256Hex(sessionToken),
    signingKeyHash: fixtureHash('signing-key'),
    session: {
      schemaVersion: 1,
      type: 'short-lived-push-session',
      sessionHash: sha256Hex(sessionToken),
      userIdentityHash: fixtureHash('user-identity'),
      requiredCapability: 'manage_options',
      capabilityHash: fixtureHash('capability-granted'),
      sourceHash: fixtureHash('source'),
      sourceUrlHash: sha256Hex(sourceUrl),
      issuedAt: '2026-05-31T00:00:00Z',
      expiresAt: unexpiredReceiptExpiry,
      ttlSeconds: 300,
    },
    request: {
      method: 'POST',
      path: pathname,
      canonicalHash: fixtureHash(`${pathname}:canonical`),
      idempotencyKeyHash: fixtureHash(`${pathname}:idempotency-key`),
    },
  };
}

function mutateReceiptForNegativeCase(receipt, kind) {
  const mutated = cloneJson(receipt);

  switch (kind) {
    case 'session-drift':
      mutated.authBinding.pushSession.sessionHash = fixtureHash('drifted-push-session');
      break;
    case 'identity-drift':
      mutated.authBinding.binding.identityHash = fixtureHash('drifted-identity');
      refreshSubjectBinding(mutated);
      break;
    case 'scope-drift':
      mutated.authBinding.binding.scopeHash = fixtureHash('drifted-scope');
      refreshSubjectBinding(mutated);
      break;
    case 'auth-session-drift':
      mutated.authBinding.binding.authSessionHash = fixtureHash('drifted-auth-session');
      refreshSubjectBinding(mutated);
      break;
    case 'plan-drift':
      mutated.authBinding.binding.planHash = fixtureHash('drifted-plan');
      refreshSubjectBinding(mutated);
      break;
    case 'missing-subject-binding':
      delete mutated.authBinding.binding;
      break;
    case 'missing-issue-binding':
      delete mutated.authBinding.pushSession.issue;
      break;
    default:
      throw new Error(`Unknown negative receipt case: ${kind}`);
  }

  refreshIssueBinding(mutated);
  return rebuildReceiptHash(mutated);
}

function receiptBindingEvidence(receipt) {
  const binding = receipt.authBinding?.binding || {};
  const pushSession = receipt.authBinding?.pushSession || {};
  const issue = pushSession.issue || {};
  const sessionUser = receipt.authBinding?.sessionUser || {};

  return {
    receiptHash: receipt.receiptHash,
    planHash: receipt.planHash,
    bindingHash: binding.bindingHash || null,
    issueHash: issue.issueHash || null,
    scopeHash: binding.scopeHash || null,
    identityHash: binding.identityHash || null,
    authSessionHash: binding.authSessionHash || null,
    pushSessionHash: binding.pushSessionHash || pushSession.sessionHash || null,
    issueSessionHash: issue.sessionHash || null,
    issueScopeHash: issue.scopeHash || null,
    issueIdentityHash: issue.identityHash || null,
    sessionUserBindingHash: sessionUser.bindingHash || null,
    sessionUserIdentityHash: sessionUser.identityHash || null,
    dryRunContentHash: pushSession.dryRunContentHash || null,
    dryRunIdempotencyKeyHash: pushSession.dryRunIdempotencyKeyHash || null,
    receiptExpiryHash: sha256Hex(receipt.authBinding?.expiresAt || ''),
  };
}

function bindingProofEnvelope({ receipt, plan, dryRunRequest, afterSnapshotHash }) {
  const binding = receipt.authBinding.binding;
  const pushSession = receipt.authBinding.pushSession;
  const issue = pushSession.issue;
  const sessionUser = receipt.authBinding.sessionUser;
  const envelope = {
    schemaVersion: 1,
    slice: 'RPP-0568',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    receipt: {
      receiptHash: receipt.receiptHash,
      planHash: receipt.planHash,
      canonicalPlanHash: digest(plan),
      bindingHash: binding.bindingHash,
      issueHash: issue.issueHash,
      sessionUserBindingHash: sessionUser.bindingHash,
    },
    subject: {
      scopeHash: binding.scopeHash,
      identityHash: binding.identityHash,
      authSessionHash: binding.authSessionHash,
      pushSessionHash: binding.pushSessionHash,
      planHash: binding.planHash,
    },
    issue: {
      sessionHash: issue.sessionHash,
      signingKeyHash: issue.signingKeyHash,
      scopeHash: issue.scopeHash,
      identityHash: issue.identityHash,
      userIdentityHash: issue.userIdentityHash,
      capabilityHash: issue.capabilityHash,
      sourceHash: issue.sourceHash,
      sourceUrlHash: issue.sourceUrlHash,
      ttlSeconds: issue.ttlSeconds,
    },
    request: {
      dryRunContentHash: pushSession.dryRunContentHash,
      dryRunRawBodyHash: receipt.authBinding.request.dryRunRawBodyHash,
      dryRunCanonicalHash: pushSession.dryRunCanonicalHash,
      dryRunIdempotencyKeyHash: pushSession.dryRunIdempotencyKeyHash,
      planPayloadHash: receipt.authBinding.request.planPayloadHash,
      requestHash: dryRunRequest.headers['x-auth-content-hash'],
    },
    noMutation: {
      dryRunOnly: true,
      applyAttempted: false,
      mutationPrepared: 0,
      mutationApplied: 0,
      afterSnapshotHash,
    },
  };
  envelope.proofHash = digest(envelope);
  return envelope;
}

function refusalEvidence({ kind, receipt, code, reason, requestHash, applyAttempted }) {
  const envelope = {
    schemaVersion: 1,
    slice: 'RPP-0568',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    negativeCaseHash: sha256Hex(kind),
    code,
    reasonHash: sha256Hex(reason),
    receipt: receiptBindingEvidence(receipt),
    requestHash,
    applyAttempted,
    beforeMutationCapableWork: true,
    mutationPrepared: 0,
    mutationApplied: 0,
  };
  envelope.refusalHash = digest(envelope);
  return envelope;
}

function assertHashOrNull(value, label) {
  if (value === null) {
    return;
  }
  assert.match(value, hashPattern, `${label} must be a bare sha256 digest or null`);
}

function assertHashFields(value, paths) {
  for (const pathExpression of paths) {
    const actual = pathExpression.split('.').reduce((current, key) => current?.[key], value);
    assert.match(actual, hashPattern, `${pathExpression} must be a bare sha256 digest`);
  }
}

function assertReceiptEvidenceIsHashOnly(evidence) {
  for (const [field, value] of Object.entries(evidence.receipt)) {
    assertHashOrNull(value, `receipt.${field}`);
  }
  assertHashFields(evidence, [
    'negativeCaseHash',
    'reasonHash',
    'requestHash',
    'refusalHash',
  ]);
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

function assertReceiptBinding(receipt, plan, idempotencyKey) {
  const binding = receipt.authBinding.binding;
  const issue = receipt.authBinding.pushSession.issue;
  const sessionUser = receipt.authBinding.sessionUser;
  const planHash = digest(plan);

  assert.equal(receipt.planHash, planHash);
  assert.equal(receipt.authBinding.planHash, planHash);
  assert.equal(binding.planHash, planHash);
  assert.equal(receipt.authBinding.plan.planHash, planHash);
  assert.equal(receipt.authBinding.request.planHash, planHash);
  assert.equal(receipt.authBinding.request.planPayloadHash, planHash);
  assert.equal(receipt.authBinding.scope, authScope);
  assert.equal(binding.scopeHash, sha256Hex(authScope));
  assert.equal(binding.identityHash, digest(grantedAuth.identity));
  assert.equal(binding.authSessionHash, digest(grantedAuth.session));
  assert.equal(binding.pushSessionHash, sha256Hex(sessionToken));
  assert.equal(issue.type, 'short-lived-push-session');
  assert.equal(issue.sessionHash, binding.pushSessionHash);
  assert.equal(issue.identityHash, binding.identityHash);
  assert.equal(issue.scopeHash, binding.scopeHash);
  assert.equal(issue.signingKeyHash, receipt.authBinding.pushSession.signingKeyHash);
  assert.equal(issue.ttlSeconds, 300);
  assert.equal(sessionUser.identityHash, binding.identityHash);
  assert.equal(sessionUser.authSessionHash, binding.authSessionHash);
  assert.equal(sessionUser.pushSessionHash, binding.pushSessionHash);
  assert.equal(sessionUser.manageOptions, true);
  assert.equal(
    receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
    sha256Hex(idempotencyKey),
  );
}

function negativeCaseMessage(kind) {
  if (kind === 'session-drift') {
    return 'Receipt signed session binding does not match the current request.';
  }
  if (kind === 'missing-issue-binding') {
    return 'Receipt short-lived push session issue binding does not match the current request.';
  }
  return 'Receipt subject binding does not match the current session, identity, scope, and plan hash.';
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
  const idempotencyKey = 'idem-rpp-0568-bound-dry-run-v4';
  let dryRunReceipt = null;
  let dryRunPlan = null;
  let afterSnapshotHash = '';
  const { seen, restore } = installFetch(({ pathname, body, contentHash }) => {
    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth: cloneJson(grantedAuth),
        session: {
          id: sessionToken,
          sessionHash: sha256Hex(sessionToken),
          expiresAt: unexpiredReceiptExpiry,
        },
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

    throw new Error(`unexpected mutation path for RPP-0568 dry-run proof: ${pathname}`);
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
    assert.equal(dryRunRequest.headers['x-reprint-push-session'], sessionToken);
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

    const proofEnvelope = bindingProofEnvelope({
      receipt: dryRunReceipt,
      plan: dryRunPlan,
      dryRunRequest,
      afterSnapshotHash,
    });
    assertHashFields(proofEnvelope, [
      'proofHash',
      'receipt.receiptHash',
      'receipt.planHash',
      'receipt.canonicalPlanHash',
      'receipt.bindingHash',
      'receipt.issueHash',
      'receipt.sessionUserBindingHash',
      'subject.scopeHash',
      'subject.identityHash',
      'subject.authSessionHash',
      'subject.pushSessionHash',
      'subject.planHash',
      'issue.sessionHash',
      'issue.signingKeyHash',
      'issue.scopeHash',
      'issue.identityHash',
      'issue.userIdentityHash',
      'issue.capabilityHash',
      'issue.sourceHash',
      'issue.sourceUrlHash',
      'request.dryRunContentHash',
      'request.dryRunRawBodyHash',
      'request.dryRunCanonicalHash',
      'request.dryRunIdempotencyKeyHash',
      'request.planPayloadHash',
      'request.requestHash',
      'noMutation.afterSnapshotHash',
    ]);
    assert.equal(proofEnvelope.receipt.planHash, proofEnvelope.receipt.canonicalPlanHash);
    assert.equal(proofEnvelope.receipt.planHash, proofEnvelope.subject.planHash);
    assert.equal(proofEnvelope.receipt.planHash, proofEnvelope.request.planPayloadHash);
    assert.equal(proofEnvelope.subject.identityHash, proofEnvelope.issue.identityHash);
    assert.equal(proofEnvelope.subject.scopeHash, proofEnvelope.issue.scopeHash);
    assert.equal(proofEnvelope.subject.pushSessionHash, proofEnvelope.issue.sessionHash);
    assert.equal(proofEnvelope.request.dryRunContentHash, proofEnvelope.request.dryRunRawBodyHash);
    assert.equal(proofEnvelope.request.dryRunContentHash, proofEnvelope.request.requestHash);
    assert.equal(proofEnvelope.issue.ttlSeconds, 300);
    assert.equal(proofEnvelope.supportOnly, true);
    assert.equal(proofEnvelope.releaseGate, 'NO-GO');
    assert.equal(proofEnvelope.noMutation.applyAttempted, false);
    assert.equal(proofEnvelope.noMutation.mutationPrepared, 0);
    assert.equal(proofEnvelope.noMutation.mutationApplied, 0);
    assertNoRawValues(proofEnvelope, [
      sourceUrl,
      sessionToken,
      credential.username,
      credential.password,
      authScope,
      idempotencyKey,
      fixturePath,
      JSON.stringify(dryRunPlan),
      JSON.stringify(base),
      JSON.stringify(local),
    ]);

    return proofEnvelope;
  } finally {
    restore();
  }
}

async function runNegativeReceiptCase(kind) {
  const { base, local } = fixtureSnapshots();
  const idempotencyKey = `idem-rpp-0568-${kind}-v4`;
  const isExpired = kind === 'expired-receipt';
  const expectedCode = isExpired ? 'AUTH_RECEIPT_EXPIRED' : 'AUTH_RECEIPT_MISMATCH';
  const expectedReason = isExpired
    ? 'Authenticated dry-run receipt has expired.'
    : negativeCaseMessage(kind);
  let dryRunReceipt = null;
  let mutationPrepared = 0;
  let mutationApplied = 0;
  let refusal = null;

  const { seen, restore } = installFetch(({ pathname, body, contentHash }) => {
    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth: cloneJson(grantedAuth),
        session: {
          id: sessionToken,
          sessionHash: sha256Hex(sessionToken),
          expiresAt: unexpiredReceiptExpiry,
        },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: cloneJson(base),
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      const receipt = receiptForPlan(body.plan, idempotencyKey, contentHash, {
        expiresAt: isExpired ? expiredReceiptExpiry : unexpiredReceiptExpiry,
      });
      dryRunReceipt = isExpired ? receipt : mutateReceiptForNegativeCase(receipt, kind);
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
      assert.equal(isExpired, false, 'expired receipt must fail before apply transport');
      refusal = refusalEvidence({
        kind,
        receipt: body.receipt,
        code: expectedCode,
        reason: expectedReason,
        requestHash: contentHash,
        applyAttempted: true,
      });
      return jsonResponse({
        ok: false,
        mode: 'apply',
        code: expectedCode,
        responseSchemaVersion: 1,
        auth: cloneJson(grantedAuth),
        receiptRefusal: refusal,
        idempotency: {
          conflict: false,
          replayed: false,
          freshMutationWork: false,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: contentHash,
        },
        signedRequest: signedRequest(pathname, contentHash),
      }, 409);
    }

    mutationPrepared += 1;
    mutationApplied += 1;
    throw new Error(`unexpected mutation path for ${kind}: ${pathname}`);
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
    assert.equal(summary.code, expectedCode);
    assert.equal(summary.replay, null);
    assert.equal(summary.recoveryInspect, null);
    assert.equal(summary.dbJournal, null);
    assert.equal(mutationPrepared, 0);
    assert.equal(mutationApplied, 0);

    if (isExpired) {
      assert.equal(summary.apply, null);
      assert.deepEqual(summary.receiptExpiry, {
        phase: 'dry-run',
        field: 'receipt.authBinding.expiresAt',
        required: 'unexpired',
        observed: expiredReceiptExpiry,
        verdict: 'AUTH_RECEIPT_EXPIRED',
      });
      refusal = refusalEvidence({
        kind,
        receipt: dryRunReceipt,
        code: expectedCode,
        reason: expectedReason,
        requestHash: fixtureHash('no-apply-request'),
        applyAttempted: false,
      });
      assert.deepEqual(
        seen.map((entry) => entry.pathname),
        [
          `${routePrefix}/preflight`,
          `${routePrefix}/snapshot`,
          `${routePrefix}/dry-run`,
        ],
      );
    } else {
      assert.equal(summary.apply.status, 409);
      assert.equal(summary.apply.code, expectedCode);
      assert.equal(summary.apply.idempotency.freshMutationWork, false);
      assert.equal(summary.apply.idempotency.replayed, false);
      assert.equal(summary.apply.idempotency.conflict, false);
      assert.deepEqual(
        seen.map((entry) => entry.pathname),
        [
          `${routePrefix}/preflight`,
          `${routePrefix}/snapshot`,
          `${routePrefix}/dry-run`,
          `${routePrefix}/apply`,
        ],
      );
    }

    assertReceiptEvidenceIsHashOnly(refusal);
    assert.equal(refusal.code, expectedCode);
    assert.equal(refusal.beforeMutationCapableWork, true);
    assert.equal(refusal.mutationPrepared, 0);
    assert.equal(refusal.mutationApplied, 0);
    assertNoRawValues({
      refusal,
      idempotencyKeyHash: summary.idempotencyKeyHash,
    }, [
      sourceUrl,
      sessionToken,
      credential.username,
      credential.password,
      authScope,
      idempotencyKey,
      fixturePath,
      JSON.stringify(base),
      JSON.stringify(local),
      JSON.stringify(dryRunReceipt),
    ]);

    return refusal;
  } finally {
    restore();
  }
}

test('RPP-0568 v4 route validates bound dry-run receipts before mutation-capable work', () => {
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const subjectBinding = functionBody('reprint_push_lab_rest_authenticated_receipt_subject_binding');
  const issueBinding = functionBody('reprint_push_lab_rest_authenticated_push_session_issue_binding');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(dryRun, 'return $signature_error;', 'reprint_push_lab_rest_protocol_response');
  assertBefore(
    dryRun,
    'reprint_push_lab_rest_protocol_response',
    'reprint_push_lab_rest_bind_authenticated_receipt',
  );
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );

  assert.match(bindReceipt, /\$signed_request\s*=\s*reprint_push_lab_rest_signed_request_evidence\(\$request\)/);
  assert.match(bindReceipt, /\$profile\s*=\s*reprint_push_lab_rest_route_profile\(\$request\)/);
  assert.match(bindReceipt, /\$auth\s*=\s*reprint_push_lab_rest_auth_evidence\(\$request\)/);
  assert.match(bindReceipt, /\$plan_payload_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\) \$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'binding'\s*=>\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'issue'\s*=>\s*reprint_push_lab_rest_authenticated_push_session_issue_binding/);
  assert.match(bindReceipt, /'sessionUser'\s*=>\s*reprint_push_lab_rest_authenticated_user_identity_binding/);
  assert.match(bindReceipt, /'planPayloadHash'\s*=>\s*\$plan_payload_hash/);
  assert.match(bindReceipt, /'expiresAt'\s*=>\s*gmdate\('Y-m-d\\TH:i:s\\Z',\s*time\(\) \+ 300\)/);
  assert.match(bindReceipt, /unset\(\$receipt\['receiptHash'\]\)/);
  assert.match(bindReceipt, /\$receipt\['receiptHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$receipt\)\)/);

  assert.match(subjectBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(subjectBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(subjectBinding, /'authSessionHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$session\)\)/);
  assert.match(subjectBinding, /'pushSessionHash'\s*=>\s*\(string\)\s*\(\$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(subjectBinding, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(subjectBinding, /\$binding\['bindingHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$binding\)\)/);

  assert.match(issueBinding, /'type'\s*=>\s*'short-lived-push-session'/);
  assert.match(issueBinding, /'sessionHash'\s*=>\s*\(string\)\s*\(\$session\['sessionHash'\] \?\? \$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'signingKeyHash'\s*=>\s*\(string\)\s*\(\$signed_request\['signingKeyHash'\] \?\? ''\)/);
  assert.match(issueBinding, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(issueBinding, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(issueBinding, /'ttlSeconds'\s*=>\s*REPRINT_PUSH_LAB_SIGNED_SESSION_TTL/);
  assert.match(issueBinding, /\$issue\['issueHash'\]\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$issue\)\)/);

  assert.match(validateReceipt, /Authenticated apply requires an auth-bound dry-run receipt\./);
  assert.match(validateReceipt, /Receipt hash does not match receipt body\./);
  assert.match(validateReceipt, /Receipt auth scope does not match authenticated push scope\./);
  assert.match(validateReceipt, /Receipt plan hash binding does not match the supplied plan\./);
  assert.match(validateReceipt, /Authenticated dry-run receipt has expired\./);
  assert.match(validateReceipt, /Receipt auth identity or session does not match the current request\./);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt signed session binding does not match the current request\./);
  assert.match(validateReceipt, /Receipt short-lived push session issue binding does not match the current request\./);
  assert.match(validateReceipt, /Receipt session user identity binding does not match the current authenticated user\./);
  assert.match(validateReceipt, /Production-shaped apply must reuse the dry-run receipt idempotency binding\./);
  assertBefore(
    validateReceipt,
    '$expires_at = strtotime',
    '$current = reprint_push_lab_rest_auth_evidence($request);',
  );
  assertBefore(
    validateReceipt,
    '$expected_subject_binding = reprint_push_lab_rest_authenticated_receipt_subject_binding',
    '$push_session = isset($binding[\'pushSession\'])',
  );
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    '$session_user = isset($binding[\'sessionUser\'])',
  );
  assertBefore(
    validateReceipt,
    '$expected_issue_binding = reprint_push_lab_rest_authenticated_push_session_issue_binding',
    'Receipt dry-run body binding is incomplete.',
  );
});

test('RPP-0568 v4 dry-run receipt binds session identity scope auth session and plan hash', async () => {
  const proofEnvelope = await runBoundDryRunProof();

  const aggregate = {
    schemaVersion: 1,
    slice: 'RPP-0568',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    receiptHash: proofEnvelope.receipt.receiptHash,
    planHash: proofEnvelope.receipt.planHash,
    bindingHash: proofEnvelope.receipt.bindingHash,
    issueHash: proofEnvelope.receipt.issueHash,
    sessionUserBindingHash: proofEnvelope.receipt.sessionUserBindingHash,
    proofHash: proofEnvelope.proofHash,
  };
  aggregate.aggregateHash = digest(aggregate);

  assertHashFields(aggregate, [
    'receiptHash',
    'planHash',
    'bindingHash',
    'issueHash',
    'sessionUserBindingHash',
    'proofHash',
    'aggregateHash',
  ]);
  assertNoRawValues(aggregate, [
    sourceUrl,
    sessionToken,
    credential.username,
    credential.password,
    authScope,
    fixturePath,
  ]);
});

test('RPP-0568 v4 rejects drift expiry and missing bindings before mutation work', async () => {
  const refusalEnvelopes = [];
  for (const kind of [
    'session-drift',
    'identity-drift',
    'scope-drift',
    'auth-session-drift',
    'plan-drift',
    'missing-subject-binding',
    'missing-issue-binding',
    'expired-receipt',
  ]) {
    refusalEnvelopes.push(await runNegativeReceiptCase(kind));
  }

  const aggregate = {
    schemaVersion: 1,
    slice: 'RPP-0568',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    caseCount: refusalEnvelopes.length,
    refusalHashes: refusalEnvelopes.map((envelope) => envelope.refusalHash),
    negativeCaseHashes: refusalEnvelopes.map((envelope) => envelope.negativeCaseHash),
    receiptHashes: refusalEnvelopes.map((envelope) => envelope.receipt.receiptHash),
    planHashes: refusalEnvelopes.map((envelope) => envelope.receipt.planHash),
    beforeMutationCapableWork: refusalEnvelopes.every((envelope) => envelope.beforeMutationCapableWork),
    mutationPreparedTotal: refusalEnvelopes.reduce((total, envelope) => total + envelope.mutationPrepared, 0),
    mutationAppliedTotal: refusalEnvelopes.reduce((total, envelope) => total + envelope.mutationApplied, 0),
  };
  aggregate.aggregateHash = digest(aggregate);

  assert.equal(aggregate.caseCount, 8);
  assert.equal(aggregate.beforeMutationCapableWork, true);
  assert.equal(aggregate.mutationPreparedTotal, 0);
  assert.equal(aggregate.mutationAppliedTotal, 0);
  assertHashFields(aggregate, ['aggregateHash']);
  for (const hash of [
    ...aggregate.refusalHashes,
    ...aggregate.negativeCaseHashes,
    ...aggregate.receiptHashes,
    ...aggregate.planHashes,
  ]) {
    assert.match(hash, hashPattern);
  }
  assertNoRawValues(aggregate, [
    sourceUrl,
    sessionToken,
    credential.username,
    credential.password,
    authScope,
    fixturePath,
  ]);
});
