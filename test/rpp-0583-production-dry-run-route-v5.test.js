import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/dry-run`;
const dryRunRouteBinding = '/push/dry-run';
const restNamespace = 'reprint/v1';
const routeProfile = 'production-shaped';
const authScope = 'reprint-push-lab:authenticated-http-push';
const fixedNow = new Date('2026-05-31T12:00:00.000Z');
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:05:00Z';
const sessionId = 'psh_rpp_0583_generated_session_000001';
const idempotencyKey = 'idem-rpp-0583-production-dry-run-route-v5';
const fixturePath = 'wp-content/uploads/reprint-push/rpp-0583-production-dry-run-v5.txt';
const hashPattern = /^[a-f0-9]{64}$/;

const credential = {
  username: 'rpp_0583_admin',
  password: 'rpp-0583-application-password-should-not-leak',
};

const grantedAuth = {
  identity: {
    userId: 583,
    userLogin: credential.username,
    capabilities: { manage_options: true },
  },
  session: {
    type: 'production-auth-session',
    status: 'active',
    id: sessionId,
    expiresAt: '2030-01-01T00:00:00Z',
  },
};

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
  return sha256Hex(`rpp-0583:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
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
        [fixturePath]: 'rpp-0583 base dry-run route content',
      },
      plugins: {},
      db: {},
    },
    local: {
      files: {
        [fixturePath]: 'rpp-0583 local dry-run route content',
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

function withDigestField(value, field) {
  const copy = { ...value };
  copy[field] = digest(copy);
  return copy;
}

function receiptForPlan(plan, dryRunRawBodyHash) {
  const evidence = planEvidence(plan);
  const planHash = digest(plan);
  const identityHash = digest(grantedAuth.identity);
  const authSessionHash = digest(grantedAuth.session);
  const pushSessionHash = sha256Hex(sessionId);
  const signingKeyHash = fixtureHash('signing-key');
  const scopeHash = sha256Hex(authScope);
  const sourceUrlHash = sha256Hex(sourceUrl);
  const subject = withDigestField({
    schemaVersion: 1,
    scopeHash,
    identityHash,
    authSessionHash,
    pushSessionHash,
    planHash,
  }, 'bindingHash');
  const issue = withDigestField({
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
    issuedAt: proofCapturedAt,
    expiresAt: freshExpiresAt,
    ttlSeconds: 300,
  }, 'issueHash');
  const sessionUser = withDigestField({
    schemaVersion: 1,
    required: 'same authenticated user identity for push session, dry-run receipt, and apply',
    userId: grantedAuth.identity.userId,
    userLoginHash: sha256Hex(grantedAuth.identity.userLogin),
    identityHash,
    authSessionHash,
    pushSessionHash,
    manageOptions: true,
  }, 'bindingHash');

  const receipt = {
    schemaVersion: 1,
    type: 'dry-run',
    ok: true,
    mode: 'dry-run',
    planHash,
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      schemaVersion: 1,
      scope: authScope,
      planHash,
      binding: subject,
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
        restNamespace,
        routeProfile,
        labBacked: true,
      },
      request: {
        restNamespace,
        dryRunRoute: dryRunRouteBinding,
        routeProfile,
        labBacked: true,
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
      issuedAt: proofCapturedAt,
      expiresAt: freshExpiresAt,
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
    timestamp: '1780000583',
    nonceHash: fixtureHash('dry-run-nonce'),
    sessionHash: sha256Hex(sessionId),
    signingKeyHash: fixtureHash('signing-key'),
    session: {
      schemaVersion: 1,
      type: 'short-lived-push-session',
      sessionHash: sha256Hex(sessionId),
      userIdentityHash: fixtureHash('user-identity'),
      requiredCapability: 'manage_options',
      capabilityHash: fixtureHash('capability-granted'),
      sourceHash: fixtureHash('source'),
      sourceUrlHash: sha256Hex(sourceUrl),
      issuedAt: proofCapturedAt,
      expiresAt: freshExpiresAt,
      ttlSeconds: 300,
    },
    request: {
      method: 'POST',
      pathHash: sha256Hex(pathname),
      canonicalQueryHash: sha256Hex(''),
      canonicalHash: fixtureHash(`${pathname}:canonical`),
      idempotencyKeyHash: sha256Hex(idempotencyKey),
    },
  };
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

async function runReleaseVerifierDryRunRoute() {
  const { base, local } = fixtureSnapshots();
  const state = {
    dryRunReceiptMintAttempts: 0,
    applyCapableWorkAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };
  let dryRunReceipt = null;
  let dryRunPlan = null;
  let afterSnapshotHash = '';
  const { seen, restore } = installFetch(({ pathname, body, contentHash }) => {
    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth: cloneJson(grantedAuth),
        session: {
          id: sessionId,
          sessionHash: sha256Hex(sessionId),
          expiresAt: freshExpiresAt,
        },
        routeProfile: {
          profile: routeProfile,
          restNamespace,
          routePrefix: '/push',
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

    if (pathname === endpointPath) {
      state.dryRunReceiptMintAttempts += 1;
      dryRunPlan = body.plan;
      dryRunReceipt = receiptForPlan(dryRunPlan, contentHash);
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth: cloneJson(grantedAuth),
        routeProfile: {
          profile: routeProfile,
          restNamespace,
          routePrefix: '/push',
          labBacked: true,
        },
        dryRunOnly: {
          readOnly: true,
          mutates: false,
        },
        planHash: dryRunReceipt.planHash,
        receipt: dryRunReceipt,
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    state.applyCapableWorkAttempts += 1;
    state.mutationCapableWorkAttempts += 1;
    throw new Error(`unexpected release verifier route for RPP-0583: ${pathname}`);
  });

  try {
    const runSummary = await runAuthenticatedHttpPush({
      sourceUrl,
      base,
      local,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile,
      dryRunOnly: true,
      requireProductionAuthSession: true,
      now: fixedNow,
    });
    const dryRunRequest = seen.find((entry) => entry.pathname === endpointPath);
    assert.ok(dryRunRequest);

    return {
      base,
      local,
      runSummary,
      dryRunReceipt,
      dryRunPlan,
      dryRunRequest,
      afterSnapshotHash,
      seen,
      state,
    };
  } finally {
    restore();
  }
}

function currentApplyContext(plan) {
  const planHash = digest(plan);
  return {
    scope: authScope,
    identity: cloneJson(grantedAuth.identity),
    session: cloneJson(grantedAuth.session),
    planHash,
    signedRequest: {
      sessionHash: sha256Hex(sessionId),
      signingKeyHash: fixtureHash('signing-key'),
      request: {
        idempotencyKeyHash: sha256Hex(idempotencyKey),
      },
    },
  };
}

function expectedSubjectBinding(planHash) {
  return withDigestField({
    schemaVersion: 1,
    scopeHash: sha256Hex(authScope),
    identityHash: digest(grantedAuth.identity),
    authSessionHash: digest(grantedAuth.session),
    pushSessionHash: sha256Hex(sessionId),
    planHash,
  }, 'bindingHash');
}

function expectedIssueBinding(planHash) {
  const subject = expectedSubjectBinding(planHash);
  return withDigestField({
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: sha256Hex(sessionId),
    signingKeyHash: fixtureHash('signing-key'),
    scopeHash: subject.scopeHash,
    identityHash: subject.identityHash,
    userIdentityHash: fixtureHash('user-identity'),
    requiredCapability: 'manage_options',
    capabilityHash: fixtureHash('capability-granted'),
    sourceHash: fixtureHash('source'),
    sourceUrlHash: sha256Hex(sourceUrl),
    issuedAt: proofCapturedAt,
    expiresAt: freshExpiresAt,
    ttlSeconds: 300,
  }, 'issueHash');
}

function expectedSessionUserBinding() {
  return withDigestField({
    schemaVersion: 1,
    required: 'same authenticated user identity for push session, dry-run receipt, and apply',
    userId: grantedAuth.identity.userId,
    userLoginHash: sha256Hex(grantedAuth.identity.userLogin),
    identityHash: digest(grantedAuth.identity),
    authSessionHash: digest(grantedAuth.session),
    pushSessionHash: sha256Hex(sessionId),
    manageOptions: true,
  }, 'bindingHash');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isHash(value) {
  return typeof value === 'string' && hashPattern.test(value);
}

function validateReceiptBindingBeforeApply({ receipt, plan }) {
  const binding = isObject(receipt?.authBinding) ? receipt.authBinding : {};
  const subject = isObject(binding.binding) ? binding.binding : {};
  const identity = isObject(binding.identity) ? binding.identity : {};
  const session = isObject(binding.session) ? binding.session : {};
  const pushSession = isObject(binding.pushSession) ? binding.pushSession : {};
  const issue = isObject(pushSession.issue) ? pushSession.issue : {};
  const sessionUser = isObject(binding.sessionUser) ? binding.sessionUser : {};
  const request = isObject(binding.request) ? binding.request : {};
  const planBinding = isObject(binding.plan) ? binding.plan : {};
  const current = currentApplyContext(plan);
  const expectedSubject = expectedSubjectBinding(current.planHash);
  const expectedIssue = expectedIssueBinding(current.planHash);
  const expectedSessionUser = expectedSessionUserBinding();
  const receiptWithoutHash = isObject(receipt) ? withoutKey(receipt, 'receiptHash') : {};

  const checks = {
    receiptHashPresent: typeof receipt?.receiptHash === 'string',
    receiptHashShape: isHash(receipt?.receiptHash),
    receiptHashMatchesBody: receipt?.receiptHash === digest(receiptWithoutHash),
    authBindingPresent: isObject(receipt?.authBinding),
    subjectBindingPresent: isObject(binding.binding),
    scopePresent: typeof binding.scope === 'string' && binding.scope.length > 0,
    scopeHashShape: isHash(subject.scopeHash),
    scopeMatchesCurrent: binding.scope === current.scope
      && subject.scopeHash === expectedSubject.scopeHash
      && issue.scopeHash === expectedIssue.scopeHash,
    identityBindingPresent: isObject(binding.identity),
    identityHashShape: isHash(subject.identityHash),
    identityMatchesCurrent: digest(identity) === digest(current.identity)
      && subject.identityHash === expectedSubject.identityHash
      && issue.identityHash === expectedIssue.identityHash
      && sessionUser.identityHash === expectedSessionUser.identityHash,
    authSessionBindingPresent: isObject(binding.session),
    authSessionHashShape: isHash(subject.authSessionHash),
    pushSessionBindingPresent: isObject(binding.pushSession),
    pushSessionHashShape: isHash(subject.pushSessionHash)
      && isHash(pushSession.sessionHash)
      && isHash(issue.sessionHash),
    sessionMatchesCurrent: digest(session) === digest(current.session)
      && subject.authSessionHash === expectedSubject.authSessionHash
      && subject.pushSessionHash === current.signedRequest.sessionHash
      && pushSession.sessionHash === current.signedRequest.sessionHash
      && pushSession.signingKeyHash === current.signedRequest.signingKeyHash
      && issue.sessionHash === current.signedRequest.sessionHash
      && sessionUser.authSessionHash === expectedSessionUser.authSessionHash
      && sessionUser.pushSessionHash === current.signedRequest.sessionHash,
    planBindingPresent: isObject(binding.plan),
    planHashShape: isHash(receipt?.planHash)
      && isHash(binding.planHash)
      && isHash(subject.planHash)
      && isHash(planBinding.planHash),
    planMatchesCurrent: receipt?.planHash === current.planHash
      && binding.planHash === current.planHash
      && subject.planHash === current.planHash
      && request.planHash === current.planHash
      && request.planPayloadHash === current.planHash
      && planBinding.planHash === current.planHash
      && planBinding.planPayloadHash === current.planHash,
    requestBindingPresent: isObject(binding.request),
    dryRunRoutePresent: typeof request.dryRunRoute === 'string' && request.dryRunRoute.length > 0,
    routeMatchesProductionDryRun: request.restNamespace === restNamespace
      && request.dryRunRoute === dryRunRouteBinding
      && request.routeProfile === routeProfile,
    subjectBindingHashShape: isHash(subject.bindingHash),
    subjectBindingHashMatchesBody: subject.bindingHash === digest(withoutKey(subject, 'bindingHash')),
    subjectBindingMatchesCurrent: Object.entries(expectedSubject)
      .every(([field, value]) => subject[field] === value),
    issueBindingPresent: isObject(pushSession.issue),
    issueHashShape: isHash(issue.issueHash),
    issueMatchesCurrent: Object.entries(expectedIssue)
      .every(([field, value]) => issue[field] === value),
    sessionUserBindingPresent: isObject(binding.sessionUser),
    sessionUserBindingMatchesCurrent: Object.entries(expectedSessionUser)
      .every(([field, value]) => sessionUser[field] === value),
  };

  const ok = Object.values(checks).every((value) => value === true);
  return {
    ok,
    code: ok ? 'DRY_RUN_RECEIPT_BINDING_ACCEPTED' : receiptBindingFailureCode(checks),
    checks,
  };
}

function receiptBindingFailureCode(checks) {
  if (!checks.receiptHashPresent || !checks.receiptHashShape || !checks.receiptHashMatchesBody) {
    return 'DRY_RUN_RECEIPT_HASH_MALFORMED';
  }
  if (!checks.authBindingPresent) {
    return 'DRY_RUN_RECEIPT_AUTH_BINDING_REQUIRED';
  }
  if (!checks.subjectBindingPresent) {
    return 'DRY_RUN_RECEIPT_SUBJECT_BINDING_REQUIRED';
  }
  if (!checks.scopePresent) {
    return 'DRY_RUN_RECEIPT_SCOPE_BINDING_REQUIRED';
  }
  if (!checks.scopeHashShape || !checks.scopeMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_SCOPE_BINDING_MALFORMED';
  }
  if (!checks.identityBindingPresent) {
    return 'DRY_RUN_RECEIPT_IDENTITY_BINDING_REQUIRED';
  }
  if (!checks.identityHashShape || !checks.identityMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_IDENTITY_BINDING_MALFORMED';
  }
  if (!checks.authSessionBindingPresent || !checks.pushSessionBindingPresent) {
    return 'DRY_RUN_RECEIPT_SESSION_BINDING_REQUIRED';
  }
  if (!checks.authSessionHashShape || !checks.pushSessionHashShape || !checks.sessionMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_SESSION_BINDING_MALFORMED';
  }
  if (!checks.planBindingPresent) {
    return 'DRY_RUN_RECEIPT_PLAN_HASH_BINDING_REQUIRED';
  }
  if (!checks.planHashShape || !checks.planMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_PLAN_HASH_BINDING_MALFORMED';
  }
  if (!checks.requestBindingPresent || !checks.dryRunRoutePresent) {
    return 'DRY_RUN_RECEIPT_ROUTE_BINDING_REQUIRED';
  }
  if (!checks.routeMatchesProductionDryRun) {
    return 'DRY_RUN_RECEIPT_ROUTE_BINDING_MALFORMED';
  }
  if (!checks.subjectBindingHashShape || !checks.subjectBindingHashMatchesBody || !checks.subjectBindingMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_SUBJECT_BINDING_MALFORMED';
  }
  if (!checks.issueBindingPresent || !checks.issueHashShape || !checks.issueMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_SESSION_BINDING_MALFORMED';
  }
  if (!checks.sessionUserBindingPresent || !checks.sessionUserBindingMatchesCurrent) {
    return 'DRY_RUN_RECEIPT_IDENTITY_BINDING_MALFORMED';
  }
  return 'DRY_RUN_RECEIPT_BINDING_MALFORMED';
}

function createApplyReceiptGate() {
  const state = {
    receiptValidationAttempts: 0,
    trustedReceiptAttempts: 0,
    applyCapableWorkAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };

  function evaluate({ receipt, plan, caseName = 'accepted' }) {
    state.receiptValidationAttempts += 1;
    const validation = validateReceiptBindingBeforeApply({ receipt, plan });
    if (!validation.ok) {
      return malformedBindingEvidence({ caseName, receipt, plan, validation, state });
    }

    state.trustedReceiptAttempts += 1;
    return acceptedBindingEvidence({ receipt, plan, validation, state });
  }

  return { state, evaluate };
}

function receiptHashLengths(receipt) {
  const binding = receipt?.authBinding || {};
  const subject = binding.binding || {};
  const pushSession = binding.pushSession || {};
  const issue = pushSession.issue || {};
  const sessionUser = binding.sessionUser || {};
  return {
    receiptHashLength: String(receipt?.receiptHash || '').length,
    planHashLength: String(receipt?.planHash || '').length,
    scopeHashLength: String(subject.scopeHash || '').length,
    identityHashLength: String(subject.identityHash || '').length,
    authSessionHashLength: String(subject.authSessionHash || '').length,
    pushSessionHashLength: String(subject.pushSessionHash || pushSession.sessionHash || '').length,
    bindingHashLength: String(subject.bindingHash || '').length,
    issueHashLength: String(issue.issueHash || '').length,
    sessionUserBindingHashLength: String(sessionUser.bindingHash || '').length,
    dryRunIdempotencyKeyHashLength: String(pushSession.dryRunIdempotencyKeyHash || '').length,
  };
}

function acceptedBindingEvidence({ receipt, plan, validation, state }) {
  const lengths = receiptHashLengths(receipt);
  const evidence = {
    schemaVersion: 1,
    slice: 'RPP-0583',
    variant: 5,
    status: 'support_only',
    releaseStatus: 'NO-GO',
    ok: true,
    code: validation.code,
    evidenceScope: 'local-lab-support',
    capturedAt: proofCapturedAt,
    receiptBinding: {
      ...lengths,
      scopeMatchesCurrent: validation.checks.scopeMatchesCurrent,
      identityMatchesCurrent: validation.checks.identityMatchesCurrent,
      sessionMatchesCurrent: validation.checks.sessionMatchesCurrent,
      planHashMatchesCurrent: validation.checks.planMatchesCurrent,
      routeMatchesProductionDryRun: validation.checks.routeMatchesProductionDryRun,
      receiptHashMatchesBody: validation.checks.receiptHashMatchesBody,
      proofHash: digest({
        receiptHash: receipt.receiptHash,
        planHash: digest(plan),
        checks: validation.checks,
      }),
    },
    applyBoundary: {
      receiptValidationAttempts: state.receiptValidationAttempts,
      trustedReceiptAttempts: state.trustedReceiptAttempts,
      applyCapableWorkAttempts: state.applyCapableWorkAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      bindingValidatedBeforeApplyCapableWork: state.applyCapableWorkAttempts === 0,
    },
  };
  evidence.proofHash = digest(evidence);
  return evidence;
}

function malformedBindingEvidence({ caseName, receipt, plan, validation, state }) {
  const lengths = receiptHashLengths(receipt);
  const evidence = {
    schemaVersion: 1,
    slice: 'RPP-0583',
    variant: 5,
    status: 'blocked',
    releaseStatus: 'NO-GO',
    ok: false,
    code: validation.code,
    evidenceScope: 'local-lab-support',
    capturedAt: proofCapturedAt,
    negativeCaseHash: sha256Hex(caseName),
    expectedPlanHash: digest(plan),
    receiptBinding: {
      ...lengths,
      authBindingPresent: validation.checks.authBindingPresent,
      subjectBindingPresent: validation.checks.subjectBindingPresent,
      scopeBound: validation.checks.scopePresent
        && validation.checks.scopeHashShape
        && validation.checks.scopeMatchesCurrent,
      identityBound: validation.checks.identityBindingPresent
        && validation.checks.identityHashShape
        && validation.checks.identityMatchesCurrent,
      sessionBound: validation.checks.authSessionBindingPresent
        && validation.checks.pushSessionBindingPresent
        && validation.checks.authSessionHashShape
        && validation.checks.pushSessionHashShape
        && validation.checks.sessionMatchesCurrent,
      planHashBound: validation.checks.planBindingPresent
        && validation.checks.planHashShape
        && validation.checks.planMatchesCurrent,
      routeBound: validation.checks.requestBindingPresent
        && validation.checks.dryRunRoutePresent
        && validation.checks.routeMatchesProductionDryRun,
      receiptHashBound: validation.checks.receiptHashShape
        && validation.checks.receiptHashMatchesBody,
      proofHash: digest({
        caseNameHash: sha256Hex(caseName),
        code: validation.code,
        checks: validation.checks,
        expectedPlanHash: digest(plan),
      }),
    },
    applyBoundary: {
      receiptValidationAttempts: state.receiptValidationAttempts,
      trustedReceiptAttempts: state.trustedReceiptAttempts,
      applyCapableWorkAttempts: state.applyCapableWorkAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      failedBeforeApplyCapableWork: state.applyCapableWorkAttempts === 0,
      failedBeforeMutationCapableWork: state.mutationCapableWorkAttempts === 0,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('malformed dry-run receipt binding is support-only blocked evidence'),
    },
  };
  evidence.proofHash = digest(evidence);
  return evidence;
}

function releaseVerifierDryRunRouteSummary({
  runSummary,
  receipt,
  plan,
  dryRunRequest,
  afterSnapshotHash,
  state,
}) {
  const gate = createApplyReceiptGate();
  const accepted = gate.evaluate({ receipt, plan });
  const validation = validateReceiptBindingBeforeApply({ receipt, plan });
  const summary = {
    schemaVersion: 1,
    slice: 'RPP-0583',
    variant: 5,
    proofClass: 'release-verifier-production-dry-run-route-carry-through',
    evidenceScope: 'local-lab-support',
    status: 'support_only',
    releaseStatus: 'NO-GO',
    ok: runSummary.ok === true && accepted.ok === true,
    code: 'LOCAL_RELEASE_VERIFIER_DRY_RUN_ROUTE_SUPPORT_ONLY',
    capturedAt: proofCapturedAt,
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    releaseVerifier: {
      summaryCount: 1,
      mode: runSummary.mode,
      routeProfile: runSummary.source.routeProfile,
      dryRunStatus: runSummary.dryRun.status,
      planStatus: runSummary.plan.status,
      dryRunOnlyNoApply: runSummary.apply === null
        && runSummary.replay === null
        && runSummary.recoveryInspect === null
        && runSummary.dbJournal === null,
      summaryHash: digest({
        mode: runSummary.mode,
        source: {
          routeProfile: runSummary.source.routeProfile,
          namespace: runSummary.source.namespace,
          routePrefix: runSummary.source.routePrefix,
        },
        dryRun: {
          status: runSummary.dryRun.status,
          receiptHash: runSummary.dryRun.receiptHash,
          requestPathHash: sha256Hex(runSummary.dryRun.request.pathname),
        },
        sessionUserIdentityBindingOk: runSummary.sessionUserIdentityBinding.ok,
      }),
    },
    routeEvidence: {
      endpointPathHash: sha256Hex(endpointPath),
      requestPathHash: sha256Hex(dryRunRequest.pathname),
      dryRunRouteHash: sha256Hex(dryRunRouteBinding),
      restNamespaceHash: sha256Hex(restNamespace),
      routeProfile,
      method: dryRunRequest.headers['x-auth-content-hash'] ? 'POST' : 'UNKNOWN',
      productionDryRunPathMatched: dryRunRequest.pathname === endpointPath,
      proofHash: digest({
        endpointPathHash: sha256Hex(endpointPath),
        requestPathHash: sha256Hex(dryRunRequest.pathname),
        dryRunRouteHash: sha256Hex(dryRunRouteBinding),
        restNamespaceHash: sha256Hex(restNamespace),
        routeProfile,
      }),
    },
    receipt: {
      receiptHash: receipt.receiptHash,
      receiptHashMatchesSummary: runSummary.dryRun.receiptHash === receipt.receiptHash,
      planHash: receipt.planHash,
      canonicalPlanHash: digest(plan),
      planHashMatchesSummary: receipt.planHash === digest(plan),
      bindingHash: receipt.authBinding.binding.bindingHash,
      issueHash: receipt.authBinding.pushSession.issue.issueHash,
      sessionUserBindingHash: receipt.authBinding.sessionUser.bindingHash,
    },
    subjectBinding: {
      scopeHash: receipt.authBinding.binding.scopeHash,
      identityHash: receipt.authBinding.binding.identityHash,
      authSessionHash: receipt.authBinding.binding.authSessionHash,
      pushSessionHash: receipt.authBinding.binding.pushSessionHash,
      planHash: receipt.authBinding.binding.planHash,
      bindingHash: receipt.authBinding.binding.bindingHash,
      scopeMatchesCurrent: validation.checks.scopeMatchesCurrent,
      identityMatchesCurrent: validation.checks.identityMatchesCurrent,
      sessionMatchesCurrent: validation.checks.sessionMatchesCurrent,
      planHashMatchesCurrent: validation.checks.planMatchesCurrent,
      bindingHashMatchesBody: validation.checks.subjectBindingHashMatchesBody,
    },
    requestBinding: {
      dryRunContentHash: receipt.authBinding.pushSession.dryRunContentHash,
      dryRunRawBodyHash: receipt.authBinding.request.dryRunRawBodyHash,
      dryRunCanonicalHash: receipt.authBinding.pushSession.dryRunCanonicalHash,
      dryRunIdempotencyKeyHash: receipt.authBinding.pushSession.dryRunIdempotencyKeyHash,
      planPayloadHash: receipt.authBinding.request.planPayloadHash,
      requestHash: dryRunRequest.headers['x-auth-content-hash'],
    },
    trustBoundary: {
      receiptValidationAttempts: accepted.applyBoundary.receiptValidationAttempts,
      trustedReceiptAttempts: accepted.applyBoundary.trustedReceiptAttempts,
      dryRunReceiptMintAttempts: state.dryRunReceiptMintAttempts,
      applyCapableWorkAttempts: state.applyCapableWorkAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      bindingValidatedBeforeApplyCapableWork: accepted.applyBoundary.bindingValidatedBeforeApplyCapableWork,
      proofHash: digest({
        validation: accepted.receiptBinding.proofHash,
        dryRunReceiptMintAttempts: state.dryRunReceiptMintAttempts,
        applyCapableWorkAttempts: state.applyCapableWorkAttempts,
        mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      }),
    },
    noMutation: {
      dryRunOnly: true,
      afterSnapshotHash,
      applyAttempted: false,
      mutationPrepared: 0,
      mutationApplied: 0,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('local release verifier dry-run route receipt binding proof is support-only'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex(
        'checked production dry-run route receipt binding in release verifier summary',
      ),
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
  summary.proofHash = digest(summary);
  return summary;
}

function rebuildReceiptHash(receipt) {
  const rebuilt = cloneJson(receipt);
  delete rebuilt.receiptHash;
  rebuilt.receiptHash = digest(rebuilt);
  return rebuilt;
}

function refreshSubjectHash(receipt) {
  const subject = receipt.authBinding?.binding;
  if (isObject(subject)) {
    delete subject.bindingHash;
    subject.bindingHash = digest(subject);
  }
  return receipt;
}

function mutateReceiptForCase(receipt, caseName) {
  const mutated = cloneJson(receipt);

  switch (caseName) {
    case 'missing-subject-binding':
      delete mutated.authBinding.binding;
      break;
    case 'malformed-subject-binding-hash':
      mutated.authBinding.binding.bindingHash = 'not-a-sha256-binding-hash';
      break;
    case 'missing-scope-binding':
      delete mutated.authBinding.scope;
      break;
    case 'malformed-scope-hash':
      mutated.authBinding.binding.scopeHash = 'not-a-sha256-scope-hash';
      refreshSubjectHash(mutated);
      break;
    case 'missing-identity-binding':
      delete mutated.authBinding.identity;
      break;
    case 'malformed-identity-hash':
      mutated.authBinding.binding.identityHash = 'not-a-sha256-identity-hash';
      refreshSubjectHash(mutated);
      break;
    case 'missing-session-binding':
      delete mutated.authBinding.session;
      break;
    case 'malformed-push-session-hash':
      mutated.authBinding.pushSession.sessionHash = 'not-a-sha256-session-hash';
      break;
    case 'missing-plan-binding':
      delete mutated.authBinding.plan;
      break;
    case 'malformed-plan-hash':
      mutated.planHash = 'not-a-sha256-plan-hash';
      break;
    case 'missing-route-binding':
      delete mutated.authBinding.request.dryRunRoute;
      break;
    case 'malformed-receipt-hash':
      mutated.receiptHash = 'not-a-sha256-receipt-hash';
      return mutated;
    default:
      throw new Error(`Unknown RPP-0583 receipt mutation case: ${caseName}`);
  }

  return rebuildReceiptHash(mutated);
}

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} must be a bare sha256 hash`);
}

function assertHashFields(value, paths) {
  for (const pathExpression of paths) {
    const actual = pathExpression.split('.').reduce((current, key) => current?.[key], value);
    assertHash(actual, pathExpression);
  }
}

function assertHashLengths(value, fields) {
  for (const field of fields) {
    assert.equal(value[field], 64, `${field} must report a 64-character hash`);
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

function assertSupportEvidenceIsRedacted(value, label) {
  assertNoRawValues(value, [
    sourceUrl,
    endpointPath,
    dryRunRouteBinding,
    restNamespace,
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    authScope,
    fixturePath,
  ]);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0583 v5 production apply keeps dry-run receipt validation before apply-capable work', () => {
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
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

  assert.match(bindReceipt, /\$plan_payload_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(bindReceipt, /'scope'\s*=>\s*\(string\) \$profile\['authScope'\]/);
  assert.match(bindReceipt, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(bindReceipt, /'binding'\s*=>\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(bindReceipt, /'identity'\s*=>\s*\$auth\['identity'\]/);
  assert.match(bindReceipt, /'session'\s*=>\s*\$auth\['session'\]/);
  assert.match(bindReceipt, /'pushSession'\s*=>\s*\[/);
  assert.match(bindReceipt, /'planPayloadHash'\s*=>\s*\$plan_payload_hash/);

  assert.match(validateReceipt, /Authenticated apply requires an auth-bound dry-run receipt\./);
  assert.match(validateReceipt, /Receipt hash does not match receipt body\./);
  assert.match(validateReceipt, /Receipt auth scope does not match authenticated push scope\./);
  assert.match(validateReceipt, /Receipt plan hash binding does not match the supplied plan\./);
  assert.match(validateReceipt, /Receipt auth identity or session does not match the current request\./);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt signed session binding does not match the current request\./);
  assert.match(validateReceipt, /Production-shaped apply must reuse the dry-run receipt idempotency binding\./);
  assertBefore(
    validateReceipt,
    '$expected_subject_binding = reprint_push_lab_rest_authenticated_receipt_subject_binding',
    '$push_session = isset($binding[\'pushSession\'])',
  );
});

test('RPP-0583 v5 carries production dry-run route evidence through one release verifier summary', async () => {
  const {
    base,
    local,
    runSummary,
    dryRunReceipt,
    dryRunPlan,
    dryRunRequest,
    afterSnapshotHash,
    seen,
    state,
  } = await runReleaseVerifierDryRunRoute();
  const summary = releaseVerifierDryRunRouteSummary({
    runSummary,
    receipt: dryRunReceipt,
    plan: dryRunPlan,
    dryRunRequest,
    afterSnapshotHash,
    state,
  });

  assert.equal(runSummary.ok, true);
  assert.equal(runSummary.mode, 'dry-run');
  assert.equal(runSummary.dryRun.status, 200);
  assert.equal(runSummary.dryRun.receiptHash, dryRunReceipt.receiptHash);
  assert.equal(runSummary.apply, null);
  assert.equal(runSummary.replay, null);
  assert.equal(runSummary.recoveryInspect, null);
  assert.equal(runSummary.dbJournal, null);
  assert.deepEqual(
    seen.map((entry) => entry.pathname),
    [
      `${routePrefix}/preflight`,
      `${routePrefix}/snapshot`,
      endpointPath,
      `${routePrefix}/snapshot`,
    ],
  );
  assert.equal(dryRunRequest.headers['x-reprint-push-session'], sessionId);
  assert.equal(dryRunRequest.headers['x-reprint-push-idempotency-key'], idempotencyKey);
  assert.equal(dryRunRequest.headers['x-auth-content-hash'], sha256Hex(dryRunRequest.rawBody));
  assert.deepEqual(dryRunPlan, runSummary.planObject);

  assert.equal(summary.ok, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.releaseStatus, 'NO-GO');
  assert.equal(summary.releaseMovement.allowed, false);
  assert.equal(summary.releaseVerifier.summaryCount, 1);
  assert.equal(summary.releaseVerifier.mode, 'dry-run');
  assert.equal(summary.releaseVerifier.routeProfile, routeProfile);
  assert.equal(summary.releaseVerifier.dryRunStatus, 200);
  assert.equal(summary.releaseVerifier.dryRunOnlyNoApply, true);
  assert.equal(summary.routeEvidence.productionDryRunPathMatched, true);
  assert.equal(summary.receipt.receiptHashMatchesSummary, true);
  assert.equal(summary.receipt.planHashMatchesSummary, true);
  assert.equal(summary.subjectBinding.scopeMatchesCurrent, true);
  assert.equal(summary.subjectBinding.identityMatchesCurrent, true);
  assert.equal(summary.subjectBinding.sessionMatchesCurrent, true);
  assert.equal(summary.subjectBinding.planHashMatchesCurrent, true);
  assert.equal(summary.subjectBinding.bindingHashMatchesBody, true);
  assert.equal(summary.trustBoundary.receiptValidationAttempts, 1);
  assert.equal(summary.trustBoundary.trustedReceiptAttempts, 1);
  assert.equal(summary.trustBoundary.dryRunReceiptMintAttempts, 1);
  assert.equal(summary.trustBoundary.applyCapableWorkAttempts, 0);
  assert.equal(summary.trustBoundary.mutationCapableWorkAttempts, 0);
  assert.equal(summary.trustBoundary.bindingValidatedBeforeApplyCapableWork, true);
  assert.equal(summary.noMutation.applyAttempted, false);
  assert.equal(summary.noMutation.mutationPrepared, 0);
  assert.equal(summary.noMutation.mutationApplied, 0);

  assertHashFields(summary, [
    'proofHash',
    'releaseVerifier.summaryHash',
    'routeEvidence.endpointPathHash',
    'routeEvidence.requestPathHash',
    'routeEvidence.dryRunRouteHash',
    'routeEvidence.restNamespaceHash',
    'routeEvidence.proofHash',
    'receipt.receiptHash',
    'receipt.planHash',
    'receipt.canonicalPlanHash',
    'receipt.bindingHash',
    'receipt.issueHash',
    'receipt.sessionUserBindingHash',
    'subjectBinding.scopeHash',
    'subjectBinding.identityHash',
    'subjectBinding.authSessionHash',
    'subjectBinding.pushSessionHash',
    'subjectBinding.planHash',
    'subjectBinding.bindingHash',
    'requestBinding.dryRunContentHash',
    'requestBinding.dryRunRawBodyHash',
    'requestBinding.dryRunCanonicalHash',
    'requestBinding.dryRunIdempotencyKeyHash',
    'requestBinding.planPayloadHash',
    'requestBinding.requestHash',
    'trustBoundary.proofHash',
    'noMutation.afterSnapshotHash',
    'releaseMovement.reasonHash',
    'boundary.firstRemainingProductionBoundaryHash',
  ]);
  assert.equal(summary.receipt.planHash, summary.receipt.canonicalPlanHash);
  assert.equal(summary.receipt.planHash, summary.subjectBinding.planHash);
  assert.equal(summary.requestBinding.dryRunContentHash, summary.requestBinding.dryRunRawBodyHash);
  assert.equal(summary.requestBinding.dryRunContentHash, summary.requestBinding.requestHash);
  assertSupportEvidenceIsRedacted({
    summary,
    runIdempotencyHash: runSummary.idempotencyKeyHash,
  }, 'RPP-0583 release verifier dry-run route summary');
  assertNoRawValues(summary, [
    JSON.stringify(base),
    JSON.stringify(local),
    JSON.stringify(dryRunPlan),
  ]);
});

test('RPP-0583 v5 rejects missing or malformed receipt binding fields before apply-capable work', async () => {
  const { dryRunReceipt, dryRunPlan } = await runReleaseVerifierDryRunRoute();
  const negativeCases = [
    ['missing-subject-binding', 'DRY_RUN_RECEIPT_SUBJECT_BINDING_REQUIRED', 'subjectBindingPresent'],
    ['malformed-subject-binding-hash', 'DRY_RUN_RECEIPT_SUBJECT_BINDING_MALFORMED', 'subjectBindingHashShape'],
    ['missing-scope-binding', 'DRY_RUN_RECEIPT_SCOPE_BINDING_REQUIRED', 'scopePresent'],
    ['malformed-scope-hash', 'DRY_RUN_RECEIPT_SCOPE_BINDING_MALFORMED', 'scopeHashShape'],
    ['missing-identity-binding', 'DRY_RUN_RECEIPT_IDENTITY_BINDING_REQUIRED', 'identityBindingPresent'],
    ['malformed-identity-hash', 'DRY_RUN_RECEIPT_IDENTITY_BINDING_MALFORMED', 'identityHashShape'],
    ['missing-session-binding', 'DRY_RUN_RECEIPT_SESSION_BINDING_REQUIRED', 'authSessionBindingPresent'],
    ['malformed-push-session-hash', 'DRY_RUN_RECEIPT_SESSION_BINDING_MALFORMED', 'pushSessionHashShape'],
    ['missing-plan-binding', 'DRY_RUN_RECEIPT_PLAN_HASH_BINDING_REQUIRED', 'planBindingPresent'],
    ['malformed-plan-hash', 'DRY_RUN_RECEIPT_PLAN_HASH_BINDING_MALFORMED', 'planHashShape'],
    ['missing-route-binding', 'DRY_RUN_RECEIPT_ROUTE_BINDING_REQUIRED', 'dryRunRoutePresent'],
    ['malformed-receipt-hash', 'DRY_RUN_RECEIPT_HASH_MALFORMED', 'receiptHashShape'],
  ];
  const refusals = [];

  for (const [caseName, expectedCode, expectedFailedCheck] of negativeCases) {
    const receipt = mutateReceiptForCase(dryRunReceipt, caseName);
    const gate = createApplyReceiptGate();
    const validation = validateReceiptBindingBeforeApply({ receipt, plan: dryRunPlan });
    const evidence = gate.evaluate({ receipt, plan: dryRunPlan, caseName });

    assert.equal(validation.ok, false, caseName);
    assert.equal(validation.code, expectedCode, caseName);
    assert.equal(validation.checks[expectedFailedCheck], false, caseName);
    assert.equal(evidence.ok, false, caseName);
    assert.equal(evidence.status, 'blocked', caseName);
    assert.equal(evidence.code, expectedCode, caseName);
    assert.equal(evidence.releaseStatus, 'NO-GO', caseName);
    assert.equal(evidence.releaseMovement.allowed, false, caseName);
    assert.equal(evidence.applyBoundary.receiptValidationAttempts, 1, caseName);
    assert.equal(evidence.applyBoundary.trustedReceiptAttempts, 0, caseName);
    assert.equal(evidence.applyBoundary.applyCapableWorkAttempts, 0, caseName);
    assert.equal(evidence.applyBoundary.mutationCapableWorkAttempts, 0, caseName);
    assert.equal(evidence.applyBoundary.failedBeforeApplyCapableWork, true, caseName);
    assert.equal(evidence.applyBoundary.failedBeforeMutationCapableWork, true, caseName);
    assertHashFields(evidence, [
      'proofHash',
      'negativeCaseHash',
      'expectedPlanHash',
      'receiptBinding.proofHash',
      'releaseMovement.reasonHash',
    ]);
    assertSupportEvidenceIsRedacted(evidence, `RPP-0583 negative ${caseName}`);
    refusals.push(evidence);
  }

  const aggregate = {
    schemaVersion: 1,
    slice: 'RPP-0583',
    variant: 5,
    status: 'blocked',
    releaseStatus: 'NO-GO',
    caseCount: refusals.length,
    refusalHashes: refusals.map((evidence) => evidence.proofHash),
    negativeCaseHashes: refusals.map((evidence) => evidence.negativeCaseHash),
    beforeApplyCapableWork: refusals.every((evidence) =>
      evidence.applyBoundary.failedBeforeApplyCapableWork === true),
    beforeMutationCapableWork: refusals.every((evidence) =>
      evidence.applyBoundary.failedBeforeMutationCapableWork === true),
    applyCapableWorkAttempts: refusals.reduce(
      (total, evidence) => total + evidence.applyBoundary.applyCapableWorkAttempts,
      0,
    ),
    mutationCapableWorkAttempts: refusals.reduce(
      (total, evidence) => total + evidence.applyBoundary.mutationCapableWorkAttempts,
      0,
    ),
  };
  aggregate.aggregateHash = digest(aggregate);

  assert.equal(aggregate.caseCount, negativeCases.length);
  assert.equal(aggregate.beforeApplyCapableWork, true);
  assert.equal(aggregate.beforeMutationCapableWork, true);
  assert.equal(aggregate.applyCapableWorkAttempts, 0);
  assert.equal(aggregate.mutationCapableWorkAttempts, 0);
  assertHashFields(aggregate, ['aggregateHash']);
  for (const hash of [
    ...aggregate.refusalHashes,
    ...aggregate.negativeCaseHashes,
  ]) {
    assertHash(hash, 'aggregate refusal hash');
  }
  const completeBindingRefusal = refusals.find((evidence) =>
    evidence.code === 'DRY_RUN_RECEIPT_ROUTE_BINDING_REQUIRED');
  assert.ok(completeBindingRefusal);
  assertHashLengths(completeBindingRefusal.receiptBinding, [
    'receiptHashLength',
    'planHashLength',
    'scopeHashLength',
    'identityHashLength',
    'authSessionHashLength',
    'pushSessionHashLength',
    'bindingHashLength',
    'issueHashLength',
    'sessionUserBindingHashLength',
    'dryRunIdempotencyKeyHashLength',
  ]);
  assertSupportEvidenceIsRedacted(aggregate, 'RPP-0583 malformed receipt aggregate');
});
