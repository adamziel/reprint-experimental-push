import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/dry-run`;
const authScope = 'reprint-push-lab:authenticated-http-push';
const driftedScope = 'reprint-push-lab:drifted-authenticated-http-push';
const credential = {
  username: 'rpp_0563_admin',
  password: 'rpp-0563-application-password-should-not-leak',
};
const sessionId = 'psh_rpp_0563_raw_session_id';
const driftedSessionId = 'psh_rpp_0563_drifted_session_id';
const idempotencyKey = 'idem-rpp-0563-raw-idempotency-key';
const signedTimestamp = '1780000563';
const signedNonce = 'rpp0563acceptednonce';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const hashPattern = /^[a-f0-9]{64}$/;

const readyPlan = {
  id: 'plan-rpp-0563-dry-run-v4',
  status: 'ready',
  summary: {
    creates: 0,
    updates: 1,
    deletes: 0,
    conflicts: 0,
    blockers: 0,
  },
  mutations: [
    {
      action: 'update',
      resourceType: 'wp_option',
      resourceKey: 'wp_option:blogname',
      beforeHash: `sha256:${sha256Hex('remote-blogname')}`,
      afterHash: `sha256:${sha256Hex('local-blogname-rpp-0563')}`,
    },
  ],
  conflicts: [],
  blockers: [],
  generatedAt: proofCapturedAt,
};

const driftedPlan = {
  ...readyPlan,
  id: 'plan-rpp-0563-dry-run-v4-drifted',
  summary: {
    ...readyPlan.summary,
    updates: 2,
  },
  mutations: [
    {
      ...readyPlan.mutations[0],
      afterHash: `sha256:${sha256Hex('drifted-local-blogname-rpp-0563')}`,
    },
  ],
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

function hmacHex(key, value) {
  return createHmac('sha256', key).update(String(value), 'utf8').digest('hex');
}

function labSigningKey(value = credential) {
  return hmacHex(value.password, `reprint-push-lab-v1\n${value.username}`);
}

function credentialHash(value = credential) {
  return sha256Hex(`${value.username}\n${value.password}`);
}

function basicAuth(value = credential) {
  return `Basic ${Buffer.from(`${value.username}:${value.password}`, 'utf8').toString('base64')}`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey: key }) {
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    pathname,
    '',
    contentHash,
    session,
    key,
  ].join('\n');
}

function signedDryRunHeaders({
  rawBody,
  session = sessionId,
  idempotency = idempotencyKey,
  contentHash = sha256Hex(rawBody),
  timestamp = signedTimestamp,
  nonce = signedNonce,
} = {}) {
  const signingKey = labSigningKey();
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: idempotency,
  });

  return {
    authorization: basicAuth(),
    'content-type': 'application/json',
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`),
    'X-Reprint-Push-Signature': hmacHex(signingKey, canonical),
    'X-Reprint-Push-Session': session,
    'X-Reprint-Push-Idempotency-Key': idempotency,
  };
}

function createLocalProductionDryRunRoute() {
  const state = {
    requests: [],
    jsonParseAttempts: 0,
    dryRunWorkAttempts: 0,
    receiptMintAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };

  async function fetchHandler(url, options = {}) {
    const requestUrl = new URL(String(url));
    const method = options.method || 'GET';
    const headers = headerEntries(options.headers || {});
    const rawBody = typeof options.body === 'string' ? options.body : '';
    state.requests.push({ method, pathname: requestUrl.pathname, headers, rawBody });

    assert.equal(method, 'POST');
    assert.equal(requestUrl.pathname, endpointPath);

    return handleDryRunRequest({ method, pathname: requestUrl.pathname, headers, rawBody, state });
  }

  return { state, fetchHandler };
}

function handleDryRunRequest({ method, pathname, headers, rawBody, state }) {
  const authError = authenticateDryRunRequest({ method, pathname, headers, rawBody });
  if (authError) {
    return jsonResponse({
      ok: false,
      code: authError.code,
      mode: 'dry-run',
      evidence: {
        bodyHash: sha256Hex(rawBody),
        sessionHash: headers['x-reprint-push-session']
          ? sha256Hex(headers['x-reprint-push-session'])
          : null,
        idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
          ? sha256Hex(headers['x-reprint-push-idempotency-key'])
          : null,
        mutationAttempted: false,
      },
    }, authError.status);
  }

  state.jsonParseAttempts += 1;
  const payload = JSON.parse(rawBody);
  state.dryRunWorkAttempts += 1;
  state.receiptMintAttempts += 1;

  return jsonResponse(dryRunBody({ payload, rawBody, headers }));
}

function authenticateDryRunRequest({ method, pathname, headers, rawBody }) {
  if (headers.authorization !== basicAuth()) {
    return { code: 'reprint_push_lab_auth_required', status: 401 };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { code: 'SIGNED_HEADER_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-session']) {
    return { code: 'SIGNED_SESSION_REQUIRED', status: 401 };
  }

  if (!headers['x-reprint-push-idempotency-key']) {
    return { code: 'MISSING_IDEMPOTENCY_KEY', status: 400 };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 };
  }

  const signingKey = labSigningKey();
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'],
    idempotencyKey: headers['x-reprint-push-idempotency-key'],
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  return null;
}

function dryRunBody({ payload, rawBody, headers }) {
  const plan = payload.plan || {};
  const planHash = digest(plan);
  const session = headers['x-reprint-push-session'] || sessionId;
  const key = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const identity = authenticatedIdentity();
  const authSession = authenticatedSession({ session });
  const signedRequest = signedRequestEvidence({
    contentHash,
    headers,
    session,
    idempotencyKey: key,
    identity,
  });
  const receipt = {
    schemaVersion: 1,
    type: 'dry-run',
    ok: true,
    mode: 'dry-run',
    planHash,
    preconditionSetHash: digest({
      planHash,
      phase: 'preconditions',
      resources: ['wp_option:blogname'],
    }),
    mutationSetHash: digest({
      planHash,
      phase: 'mutations',
      mutations: plan.mutations || [],
    }),
    mutationCount: Array.isArray(plan.mutations) ? plan.mutations.length : 0,
    authBinding: receiptAuthBinding({
      identity,
      authSession,
      signedRequest,
      planHash,
      payload,
    }),
  };
  receipt.receiptHash = digest(receipt);

  return {
    ok: true,
    mode: 'dry-run',
    routeProfile: {
      profile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      labBacked: true,
    },
    dryRunOnly: {
      readOnly: true,
      mutates: false,
    },
    planHash,
    auth: {
      identity,
      session: authSession,
    },
    signedRequest,
    receipt,
  };
}

function authenticatedIdentity(overrides = {}) {
  const { capabilities, ...rest } = overrides;
  return {
    userLogin: credential.username,
    userId: 563,
    capabilities: {
      manage_options: true,
      ...(capabilities || {}),
    },
    ...rest,
  };
}

function authenticatedSession({ session = sessionId, expiresAt = freshExpiresAt } = {}) {
  return {
    type: 'production-auth-session',
    status: 'active',
    id: session,
    applicationPasswordUuid: 'app-pass-rpp-0563',
    credentialHash: credentialHash(),
    revoked: false,
    cleanedUp: false,
    playgroundFallback: false,
    warning: '',
    expiresAt,
  };
}

function signedSessionRecord({ session = sessionId, identity = authenticatedIdentity() } = {}) {
  return {
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: sha256Hex(session),
    userIdentityHash: digest({
      userId: identity.userId,
      userLogin: identity.userLogin,
    }),
    requiredCapability: 'manage_options',
    capabilityHash: sha256Hex('manage_options:true'),
    sourceHash: digest({
      sourceUrlHash: sha256Hex(sourceUrl),
      restNamespace: 'reprint/v1',
      routeProfile: 'production-shaped',
    }),
    sourceUrlHash: sha256Hex(sourceUrl),
    issuedAt: '2026-05-31T11:59:00Z',
    expiresAt: freshExpiresAt,
    ttlSeconds: 300,
  };
}

function signedRequestEvidence({
  contentHash,
  headers,
  session = sessionId,
  idempotencyKey: key = idempotencyKey,
  identity = authenticatedIdentity(),
}) {
  const signedSession = signedSessionRecord({ session, identity });
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: key,
  });

  return {
    signed: true,
    schemaVersion: 1,
    contentHash,
    timestamp: headers['x-auth-timestamp'] || signedTimestamp,
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    sessionHash: signedSession.sessionHash,
    signingKeyHash: sha256Hex(labSigningKey()),
    session: signedSession,
    request: {
      method: 'POST',
      pathHash: sha256Hex(endpointPath),
      canonicalQueryHash: sha256Hex(''),
      idempotencyKeyHash: sha256Hex(key),
      canonicalHash: sha256Hex(canonical),
    },
  };
}

function receiptAuthBinding({ identity, authSession, signedRequest, planHash, payload }) {
  const subject = receiptSubjectBinding({
    scope: authScope,
    identity,
    authSession,
    signedRequest,
    planHash,
  });

  return {
    schemaVersion: 1,
    scope: authScope,
    planHash,
    binding: subject,
    identity,
    session: authSession,
    pushSession: {
      sessionHash: signedRequest.sessionHash,
      signingKeyHash: signedRequest.signingKeyHash,
      issue: pushSessionIssueBinding({
        scope: authScope,
        identity,
        signedRequest,
        subject,
      }),
      dryRunNonceHash: signedRequest.nonceHash,
      dryRunContentHash: signedRequest.contentHash,
      dryRunCanonicalHash: signedRequest.request.canonicalHash,
      dryRunIdempotencyKeyHash: signedRequest.request.idempotencyKeyHash,
    },
    sessionUser: sessionUserBinding({
      identity,
      authSession,
      signedRequest,
    }),
    source: {
      sourceUrlHash: sha256Hex(sourceUrl),
      sourceHash: signedRequest.session.sourceHash,
      restNamespaceHash: sha256Hex('reprint/v1'),
      routeProfile: 'production-shaped',
      labBacked: true,
    },
    request: {
      restNamespace: 'reprint/v1',
      dryRunRoute: '/push/dry-run',
      routeProfile: 'production-shaped',
      labBacked: true,
      planHash,
      planPayloadHash: planHash,
      dryRunBodyHash: digest(payload),
      dryRunRawBodyHash: signedRequest.contentHash,
    },
    plan: {
      schemaVersion: 1,
      planHash,
      planPayloadHash: planHash,
    },
    issuedAt: proofCapturedAt,
    expiresAt: freshExpiresAt,
  };
}

function receiptSubjectBinding({ scope, identity, authSession, signedRequest, planHash }) {
  const binding = {
    schemaVersion: 1,
    scopeHash: sha256Hex(scope),
    identityHash: digest(identity),
    authSessionHash: digest(authSession),
    pushSessionHash: signedRequest.sessionHash,
    planHash,
  };
  binding.bindingHash = digest(binding);
  return binding;
}

function pushSessionIssueBinding({ scope, identity, signedRequest, subject }) {
  const issue = {
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: signedRequest.session.sessionHash,
    signingKeyHash: signedRequest.signingKeyHash,
    scopeHash: subject.scopeHash || sha256Hex(scope),
    identityHash: digest(identity),
    userIdentityHash: signedRequest.session.userIdentityHash,
    requiredCapability: signedRequest.session.requiredCapability,
    capabilityHash: signedRequest.session.capabilityHash,
    sourceHash: signedRequest.session.sourceHash,
    sourceUrlHash: signedRequest.session.sourceUrlHash,
    issuedAt: signedRequest.session.issuedAt,
    expiresAt: signedRequest.session.expiresAt,
    ttlSeconds: 300,
  };
  issue.issueHash = digest(issue);
  return issue;
}

function sessionUserBinding({ identity, authSession, signedRequest }) {
  const capabilities = identity.capabilities || {};
  const binding = {
    schemaVersion: 1,
    requiredHash: sha256Hex('same authenticated user identity for push session, dry-run receipt, and apply'),
    userIdHash: sha256Hex(String(identity.userId)),
    userLoginHash: sha256Hex(identity.userLogin),
    identityHash: digest(identity),
    authSessionHash: digest(authSession),
    pushSessionHash: signedRequest.sessionHash,
    manageOptions: capabilities.manage_options === true,
  };
  binding.bindingHash = digest(binding);
  return binding;
}

function applyTrustContext({
  scope = authScope,
  identity = authenticatedIdentity(),
  session = sessionId,
  plan = readyPlan,
} = {}) {
  const authSession = authenticatedSession({ session });
  const signedSession = signedSessionRecord({ session, identity });
  return {
    scope,
    identity,
    session: authSession,
    expectedPlanHash: digest(plan),
    signedRequest: {
      schemaVersion: 1,
      sessionHash: signedSession.sessionHash,
      signingKeyHash: sha256Hex(labSigningKey()),
      session: signedSession,
      request: {
        idempotencyKeyHash: sha256Hex(idempotencyKey),
      },
    },
  };
}

function createReceiptTrustBoundary() {
  const state = {
    receiptValidationAttempts: 0,
    trustedReceiptAttempts: 0,
    mutationCapableWorkAttempts: 0,
  };

  function evaluate({ receipt, plan = readyPlan, current = applyTrustContext({ plan }) } = {}) {
    state.receiptValidationAttempts += 1;
    const validation = validateDryRunReceiptTrust({ receipt, plan, current });
    if (!validation.ok) {
      return trustEvidence({
        ok: false,
        code: driftCode(validation),
        receipt,
        plan,
        current,
        state,
        validation,
      });
    }

    state.trustedReceiptAttempts += 1;
    return trustEvidence({
      ok: true,
      code: 'LOCAL_DRY_RUN_RECEIPT_TRUST_SUPPORT_ONLY',
      receipt,
      plan,
      current,
      state,
      validation,
    });
  }

  return { state, evaluate };
}

function validateDryRunReceiptTrust({ receipt, plan = readyPlan, current = applyTrustContext({ plan }) } = {}) {
  const binding = receipt?.authBinding || {};
  const subject = binding.binding || {};
  const identity = binding.identity || {};
  const session = binding.session || {};
  const pushSession = binding.pushSession || {};
  const issue = pushSession.issue || {};
  const sessionUser = binding.sessionUser || {};
  const request = binding.request || {};
  const planBinding = binding.plan || {};
  const expectedPlanHash = digest(plan);
  const receiptWithoutHash = receipt ? withoutKey(receipt, 'receiptHash') : {};
  const expectedSubject = receiptSubjectBinding({
    scope: current.scope,
    identity: current.identity,
    authSession: current.session,
    signedRequest: current.signedRequest,
    planHash: expectedPlanHash,
  });
  const expectedIssue = pushSessionIssueBinding({
    scope: current.scope,
    identity: current.identity,
    signedRequest: current.signedRequest,
    subject: expectedSubject,
  });
  const expectedSessionUser = sessionUserBinding({
    identity: current.identity,
    authSession: current.session,
    signedRequest: current.signedRequest,
  });

  const receiptHashOk = typeof receipt?.receiptHash === 'string'
    && hashPattern.test(receipt.receiptHash)
    && receipt.receiptHash === digest(receiptWithoutHash);
  const scopeOk = binding.scope === current.scope
    && subject.scopeHash === expectedSubject.scopeHash
    && issue.scopeHash === expectedSubject.scopeHash;
  const identityOk = digest(identity) === digest(current.identity)
    && subject.identityHash === expectedSubject.identityHash
    && issue.identityHash === expectedIssue.identityHash
    && sessionUser.identityHash === expectedSessionUser.identityHash;
  const sessionOk = digest(session) === digest(current.session)
    && subject.authSessionHash === expectedSubject.authSessionHash
    && subject.pushSessionHash === current.signedRequest.sessionHash
    && pushSession.sessionHash === current.signedRequest.sessionHash
    && pushSession.signingKeyHash === current.signedRequest.signingKeyHash
    && issue.sessionHash === current.signedRequest.sessionHash
    && sessionUser.authSessionHash === expectedSessionUser.authSessionHash
    && sessionUser.pushSessionHash === current.signedRequest.sessionHash;
  const planOk = receipt?.planHash === expectedPlanHash
    && binding.planHash === expectedPlanHash
    && subject.planHash === expectedPlanHash
    && request.planHash === expectedPlanHash
    && request.planPayloadHash === expectedPlanHash
    && planBinding.planHash === expectedPlanHash
    && planBinding.planPayloadHash === expectedPlanHash;
  const routeOk = request.restNamespace === 'reprint/v1'
    && request.dryRunRoute === '/push/dry-run'
    && request.routeProfile === 'production-shaped';
  const subjectHashOk = subject.bindingHash === digest(withoutKey(subject, 'bindingHash'));
  const subjectMatchesExpected = Object.entries(expectedSubject)
    .every(([field, value]) => subject[field] === value);
  const issueMatchesExpected = Object.entries(expectedIssue)
    .every(([field, value]) => issue[field] === value);
  const sessionUserMatchesExpected = Object.entries(expectedSessionUser)
    .every(([field, value]) => sessionUser[field] === value);

  return {
    ok: receiptHashOk
      && scopeOk
      && identityOk
      && sessionOk
      && planOk
      && routeOk
      && subjectHashOk
      && subjectMatchesExpected
      && issueMatchesExpected
      && sessionUserMatchesExpected,
    receiptHash: receiptHashOk,
    scope: scopeOk,
    identity: identityOk,
    session: sessionOk,
    plan: planOk,
    route: routeOk,
    subjectHash: subjectHashOk,
    subject: subjectMatchesExpected,
    issue: issueMatchesExpected,
    sessionUser: sessionUserMatchesExpected,
  };
}

function driftCode(validation) {
  if (!validation.scope) {
    return 'DRY_RUN_RECEIPT_SCOPE_BINDING_MISMATCH';
  }
  if (!validation.identity) {
    return 'DRY_RUN_RECEIPT_IDENTITY_BINDING_MISMATCH';
  }
  if (!validation.session) {
    return 'DRY_RUN_RECEIPT_SESSION_BINDING_MISMATCH';
  }
  if (!validation.plan) {
    return 'DRY_RUN_RECEIPT_PLAN_HASH_MISMATCH';
  }
  return 'DRY_RUN_RECEIPT_BINDING_MISMATCH';
}

function trustEvidence({ ok, code, receipt, plan, current, state, validation }) {
  const binding = receipt?.authBinding || {};
  const subject = binding.binding || {};
  const pushSession = binding.pushSession || {};
  const expectedPlanHash = digest(plan);
  const receiptBinding = {
    receiptHashLength: String(receipt?.receiptHash || '').length,
    scopeHashLength: String(subject.scopeHash || '').length,
    identityHashLength: String(subject.identityHash || '').length,
    authSessionHashLength: String(subject.authSessionHash || '').length,
    pushSessionHashLength: String(subject.pushSessionHash || '').length,
    planHashLength: String(subject.planHash || '').length,
    bindingHashLength: String(subject.bindingHash || '').length,
    idempotencyKeyHashLength: String(pushSession.dryRunIdempotencyKeyHash || '').length,
    scopeMatchesCurrent: validation.scope,
    identityMatchesCurrent: validation.identity,
    sessionMatchesCurrent: validation.session,
    planHashMatchesCurrent: validation.plan,
    receiptHashMatchesBody: validation.receiptHash,
    subjectBindingMatchesCurrent: validation.subject,
    issueBindingMatchesCurrent: validation.issue,
    sessionUserBindingMatchesCurrent: validation.sessionUser,
    proofHash: digest({
      code,
      receiptHash: receipt?.receiptHash || null,
      scopeMatchesCurrent: validation.scope,
      identityMatchesCurrent: validation.identity,
      sessionMatchesCurrent: validation.session,
      planHashMatchesCurrent: validation.plan,
      receiptHashMatchesBody: validation.receiptHash,
      subjectBindingMatchesCurrent: validation.subject,
      issueBindingMatchesCurrent: validation.issue,
      sessionUserBindingMatchesCurrent: validation.sessionUser,
    }),
  };

  return {
    schemaVersion: 1,
    slice: 'RPP-0563',
    variant: 4,
    proofClass: 'production-dry-run-receipt-trust-boundary',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    status: ok ? 'support_only' : 'blocked',
    ok,
    code,
    mutationAttempted: false,
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
    sourceSummary: {
      sourceUrlHash: sha256Hex(sourceUrl),
      routeProfile: 'production-shaped',
      rawUrlIncluded: false,
    },
    routeEvidence: {
      endpointPathHash: sha256Hex(endpointPath),
      routeProfile: 'production-shaped',
      restNamespaceHash: sha256Hex('reprint/v1'),
      routePrefixHash: sha256Hex('/push'),
      pathMatchesProductionDryRun: true,
      proofHash: digest({
        endpointPathHash: sha256Hex(endpointPath),
        routeProfile: 'production-shaped',
        restNamespaceHash: sha256Hex('reprint/v1'),
        routePrefixHash: sha256Hex('/push'),
      }),
    },
    authSummary: {
      credentialHash: credentialHash(),
      scopeHash: sha256Hex(current.scope),
      identityHash: digest(current.identity),
      authSessionHash: digest(current.session),
      pushSessionHash: current.signedRequest.sessionHash,
      signingKeyHashLength: String(current.signedRequest.signingKeyHash || '').length,
      rawIdentityIncluded: false,
    },
    planSummary: {
      expectedPlanHash,
      receiptPlanHashLength: String(receipt?.planHash || '').length,
      planHashMatchesExpected: receipt?.planHash === expectedPlanHash,
      rawPlanIncluded: false,
    },
    receiptBinding,
    trustBoundary: {
      receiptValidationAttempts: state.receiptValidationAttempts,
      receiptTrusted: ok,
      trustedReceiptAttempts: state.trustedReceiptAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      failBeforeMutationCapableWork: state.mutationCapableWorkAttempts === 0,
      proofHash: digest({
        code,
        receiptValidationAttempts: state.receiptValidationAttempts,
        trustedReceiptAttempts: state.trustedReceiptAttempts,
        mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: sha256Hex('local dry-run receipt trust proof is support-only until production-owned proof exists'),
    },
    boundary: {
      firstRemainingProductionBoundaryHash: sha256Hex(
        'checked production dry-run receipt binding proof for session identity scope and plan hash',
      ),
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

async function runAcceptedProductionDryRun() {
  const originalFetch = global.fetch;
  const route = createLocalProductionDryRunRoute();
  global.fetch = route.fetchHandler;

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
    });
    const dryRun = await client.signedPost('/dry-run', { plan: readyPlan }, {
      session: sessionId,
      idempotencyKey,
      timestamp: signedTimestamp,
      nonce: signedNonce,
    });

    return { dryRun, route };
  } finally {
    global.fetch = originalFetch;
  }
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
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

test('RPP-0563 v4 production apply validates dry-run receipt binding before mutation-capable work', () => {
  const applyCallback = functionBody('reprint_push_lab_rest_authenticated_apply');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assertBefore(
    applyCallback,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );
  assert.match(validateReceipt, /Receipt auth scope does not match authenticated push scope\./);
  assert.match(validateReceipt, /\$expected_plan_hash\s*=\s*hash\('sha256',\s*reprint_push_stable_json\(\$plan\)\)/);
  assert.match(validateReceipt, /Receipt plan hash binding does not match the supplied plan\./);
  assert.match(validateReceipt, /\$current\s*=\s*reprint_push_lab_rest_auth_evidence\(\$request\)/);
  assert.match(validateReceipt, /Receipt auth identity or session does not match the current request\./);
  assert.match(validateReceipt, /\$expected_subject_binding\s*=\s*reprint_push_lab_rest_authenticated_receipt_subject_binding/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
  assert.match(validateReceipt, /Receipt signed session binding does not match the current request\./);
  assert.match(validateReceipt, /Production-shaped apply must reuse the dry-run receipt idempotency binding\./);
});

test('RPP-0563 v4 binds production dry-run receipt to current session identity scope and plan hash', async () => {
  const { dryRun, route } = await runAcceptedProductionDryRun();
  const receipt = dryRun.body.receipt;
  const binding = receipt.authBinding;
  const subject = binding.binding;
  const current = applyTrustContext();
  const boundary = createReceiptTrustBoundary();
  const evidence = boundary.evaluate({ receipt, plan: readyPlan, current });

  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.request.pathname, endpointPath);
  assert.equal(dryRun.request.method, 'POST');
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.equal(dryRun.body.routeProfile.profile, 'production-shaped');
  assert.equal(dryRun.body.dryRunOnly.readOnly, true);
  assert.equal(dryRun.body.dryRunOnly.mutates, false);
  assert.equal(route.state.jsonParseAttempts, 1);
  assert.equal(route.state.dryRunWorkAttempts, 1);
  assert.equal(route.state.receiptMintAttempts, 1);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);

  assert.equal(receipt.planHash, digest(readyPlan));
  assert.equal(receipt.receiptHash, digest(withoutKey(receipt, 'receiptHash')));
  assert.equal(binding.scope, authScope);
  assert.equal(binding.planHash, receipt.planHash);
  assert.equal(binding.identity.userLogin, credential.username);
  assert.equal(binding.session.id, sessionId);
  assert.equal(subject.scopeHash, sha256Hex(authScope));
  assert.equal(subject.identityHash, digest(current.identity));
  assert.equal(subject.authSessionHash, digest(current.session));
  assert.equal(subject.pushSessionHash, sha256Hex(sessionId));
  assert.equal(subject.planHash, digest(readyPlan));
  assert.equal(subject.bindingHash, digest(withoutKey(subject, 'bindingHash')));

  assert.equal(evidence.ok, true);
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.code, 'LOCAL_DRY_RUN_RECEIPT_TRUST_SUPPORT_ONLY');
  assert.equal(evidence.releaseStatus, 'NO-GO');
  assert.equal(evidence.releaseMovement.allowed, false);
  assert.equal(evidence.mutationAttempted, false);
  assert.equal(evidence.trustBoundary.receiptTrusted, true);
  assert.equal(evidence.trustBoundary.receiptValidationAttempts, 1);
  assert.equal(evidence.trustBoundary.trustedReceiptAttempts, 1);
  assert.equal(evidence.trustBoundary.mutationCapableWorkAttempts, 0);
  assert.equal(evidence.trustBoundary.failBeforeMutationCapableWork, true);
  assert.equal(evidence.receiptBinding.scopeMatchesCurrent, true);
  assert.equal(evidence.receiptBinding.identityMatchesCurrent, true);
  assert.equal(evidence.receiptBinding.sessionMatchesCurrent, true);
  assert.equal(evidence.receiptBinding.planHashMatchesCurrent, true);
  assert.equal(evidence.receiptBinding.receiptHashMatchesBody, true);
  assert.equal(evidence.receiptBinding.subjectBindingMatchesCurrent, true);
  assert.equal(evidence.receiptBinding.issueBindingMatchesCurrent, true);
  assert.equal(evidence.receiptBinding.sessionUserBindingMatchesCurrent, true);
  assert.equal(evidence.redaction.rawValuesIncluded, false);
  assert.equal(evidence.productionInputs.productionUrlSupplied, false);
  assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);

  assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
  assertHashOnlyFields(evidence.routeEvidence, [
    'endpointPathHash',
    'restNamespaceHash',
    'routePrefixHash',
    'proofHash',
  ]);
  assertHashOnlyFields(evidence.authSummary, [
    'credentialHash',
    'scopeHash',
    'identityHash',
    'authSessionHash',
    'pushSessionHash',
  ]);
  assertHashOnlyFields(evidence.planSummary, ['expectedPlanHash']);
  assertHashOnlyFields(evidence.receiptBinding, ['proofHash']);
  assertHashOnlyFields(evidence.trustBoundary, ['proofHash']);
  assertHashLengths(evidence.receiptBinding, [
    'receiptHashLength',
    'scopeHashLength',
    'identityHashLength',
    'authSessionHashLength',
    'pushSessionHashLength',
    'planHashLength',
    'bindingHashLength',
    'idempotencyKeyHashLength',
  ]);
  assert.equal(evidence.authSummary.signingKeyHashLength, 64);
  assertNoRawValues(evidence, [
    sourceUrl,
    endpointPath,
    credential.username,
    credential.password,
    sessionId,
    driftedSessionId,
    idempotencyKey,
    signedNonce,
    authScope,
    JSON.stringify({ plan: readyPlan }),
  ]);
});

test('RPP-0563 v4 rejects session identity scope and plan-hash drift before mutation-capable work', async () => {
  const { dryRun, route } = await runAcceptedProductionDryRun();
  const receipt = dryRun.body.receipt;
  const driftedIdentity = authenticatedIdentity({
    userLogin: 'rpp_0563_drifted_admin',
    userId: 1563,
  });
  const negativeCases = [
    {
      name: 'session-drift',
      expectedCode: 'DRY_RUN_RECEIPT_SESSION_BINDING_MISMATCH',
      expectedFlag: 'sessionMatchesCurrent',
      plan: readyPlan,
      current: applyTrustContext({ session: driftedSessionId }),
    },
    {
      name: 'identity-drift',
      expectedCode: 'DRY_RUN_RECEIPT_IDENTITY_BINDING_MISMATCH',
      expectedFlag: 'identityMatchesCurrent',
      plan: readyPlan,
      current: applyTrustContext({ identity: driftedIdentity }),
    },
    {
      name: 'scope-drift',
      expectedCode: 'DRY_RUN_RECEIPT_SCOPE_BINDING_MISMATCH',
      expectedFlag: 'scopeMatchesCurrent',
      plan: readyPlan,
      current: applyTrustContext({ scope: driftedScope }),
    },
    {
      name: 'plan-hash-drift',
      expectedCode: 'DRY_RUN_RECEIPT_PLAN_HASH_MISMATCH',
      expectedFlag: 'planHashMatchesCurrent',
      plan: driftedPlan,
      current: applyTrustContext({ plan: driftedPlan }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const boundary = createReceiptTrustBoundary();
    const evidence = boundary.evaluate({
      receipt,
      plan: negativeCase.plan,
      current: negativeCase.current,
    });

    assert.equal(evidence.ok, false, negativeCase.name);
    assert.equal(evidence.status, 'blocked', negativeCase.name);
    assert.equal(evidence.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(evidence.releaseStatus, 'NO-GO', negativeCase.name);
    assert.equal(evidence.releaseMovement.allowed, false, negativeCase.name);
    assert.equal(evidence.mutationAttempted, false, negativeCase.name);
    assert.equal(evidence.receiptBinding[negativeCase.expectedFlag], false, negativeCase.name);
    assert.equal(evidence.trustBoundary.receiptValidationAttempts, 1, negativeCase.name);
    assert.equal(evidence.trustBoundary.receiptTrusted, false, negativeCase.name);
    assert.equal(evidence.trustBoundary.trustedReceiptAttempts, 0, negativeCase.name);
    assert.equal(evidence.trustBoundary.mutationCapableWorkAttempts, 0, negativeCase.name);
    assert.equal(evidence.trustBoundary.failBeforeMutationCapableWork, true, negativeCase.name);
    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.routeEvidence, [
      'endpointPathHash',
      'restNamespaceHash',
      'routePrefixHash',
      'proofHash',
    ]);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'scopeHash',
      'identityHash',
      'authSessionHash',
      'pushSessionHash',
    ]);
    assertHashOnlyFields(evidence.planSummary, ['expectedPlanHash']);
    assertHashOnlyFields(evidence.receiptBinding, ['proofHash']);
    assertHashOnlyFields(evidence.trustBoundary, ['proofHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      endpointPath,
      credential.username,
      credential.password,
      sessionId,
      driftedSessionId,
      idempotencyKey,
      signedNonce,
      authScope,
      driftedScope,
      driftedIdentity.userLogin,
      JSON.stringify({ plan: readyPlan }),
      JSON.stringify({ plan: driftedPlan }),
    ]);
  }

  assert.equal(route.state.mutationCapableWorkAttempts, 0);
});
