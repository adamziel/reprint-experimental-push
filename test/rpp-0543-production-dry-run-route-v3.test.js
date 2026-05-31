import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'https://source.example.test/wp';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/dry-run`;
const authScope = 'reprint-push-lab:authenticated-http-push';
const credential = {
  username: 'rpp_0543_admin',
  password: 'rpp-0543-application-password-should-not-leak',
};
const wrongCredential = {
  username: credential.username,
  password: 'rpp-0543-wrong-application-password',
};
const sessionId = 'psh_rpp_0543_raw_session_id';
const invalidSessionId = 'psh_rpp_0543_missing_session_00000001';
const idempotencyKey = 'idem-rpp-0543-raw-idempotency-key';
const signedTimestamp = '1780000000';
const signedNonce = 'rpp0543acceptednonce';
const malformedJsonBody = '{"plan":';
const proofCapturedAt = '2026-05-31T12:00:00Z';
const proofStaleCapturedAt = '2026-05-31T11:49:00Z';
const freshExpiresAt = '2026-05-31T12:04:00Z';
const staleExpiresAt = '2026-05-31T11:59:00Z';
const proofFreshnessMs = 5 * 60 * 1000;
const hashPattern = /^[a-f0-9]{64}$/;

const readyPlan = {
  id: 'plan-rpp-0543-dry-run-v3',
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
      afterHash: `sha256:${sha256Hex('local-blogname')}`,
    },
  ],
  conflicts: [],
  blockers: [],
  generatedAt: proofCapturedAt,
};

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

function withoutHeader(headers, header) {
  const copy = { ...headers };
  delete copy[header];
  delete copy[header.toLowerCase()];
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
  authSignature,
  pushSignature,
  value = credential,
} = {}) {
  const signingKey = labSigningKey(value);
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: idempotency,
  });
  return {
    authorization: basicAuth(value),
    'content-type': 'application/json',
    'X-Auth-Content-Hash': contentHash,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': authSignature || hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`),
    'X-Reprint-Push-Signature': pushSignature || hmacHex(signingKey, canonical),
    ...(session === undefined ? {} : { 'X-Reprint-Push-Session': session }),
    ...(idempotency === undefined ? {} : { 'X-Reprint-Push-Idempotency-Key': idempotency }),
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
    return jsonResponse(authFailureBody(authError.code, headers, rawBody), authError.status);
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
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 };
  }

  if (headers['x-reprint-push-session'] !== sessionId) {
    return { code: 'SIGNED_SESSION_INVALID', status: 401 };
  }

  return null;
}

function authFailureBody(code, headers, rawBody) {
  return {
    ok: false,
    code,
    mode: 'dry-run',
    evidence: {
      schemaVersion: 1,
      sourceUrlHash: sha256Hex(sourceUrl),
      credentialHeaderHash: headers.authorization ? sha256Hex(headers.authorization) : null,
      bodyHash: sha256Hex(rawBody),
      sessionIdHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      idempotencyKeyHash: headers['x-reprint-push-idempotency-key']
        ? sha256Hex(headers['x-reprint-push-idempotency-key'])
        : null,
      mutationAttempted: false,
    },
  };
}

function dryRunBody({ payload, rawBody, headers, expiresAt = freshExpiresAt }) {
  const plan = payload.plan || {};
  const planHash = digest(plan);
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const session = headers['x-reprint-push-session'] || sessionId;
  const key = headers['x-reprint-push-idempotency-key'] || idempotencyKey;
  const identity = authenticatedIdentity();
  const authSession = authenticatedSession({ session, expiresAt });
  const signedRequest = signedRequestEvidence({ contentHash, headers, session, idempotencyKey: key });
  const preconditionSetHash = digest({
    planHash,
    resources: ['wp_option:blogname'],
    phase: 'preconditions',
  });
  const mutationSetHash = digest({
    planHash,
    mutations: plan.mutations || [],
    phase: 'mutations',
  });
  const receipt = {
    schemaVersion: 1,
    type: 'dry-run',
    ok: true,
    mode: 'dry-run',
    planHash,
    preconditionSetHash,
    mutationSetHash,
    mutationCount: Array.isArray(plan.mutations) ? plan.mutations.length : 0,
    authBinding: authBinding({
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

function authenticatedIdentity() {
  return {
    userLogin: credential.username,
    userId: 543,
    capabilities: { manage_options: true },
  };
}

function authenticatedSession({ session = sessionId, expiresAt = freshExpiresAt } = {}) {
  return {
    type: 'production-auth-session',
    status: 'active',
    id: session,
    applicationPasswordUuid: 'app-pass-rpp-0543',
    credentialHash: credentialHash(),
    revoked: false,
    cleanedUp: false,
    playgroundFallback: false,
    warning: '',
    expiresAt,
  };
}

function signedSessionRecord({ session = sessionId } = {}) {
  const identity = authenticatedIdentity();
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

function signedRequestEvidence({ contentHash, headers, session, idempotencyKey: key }) {
  const signedSession = signedSessionRecord({ session });
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
      path: endpointPath,
      canonicalQuery: '',
      idempotencyKeyHash: sha256Hex(key),
      canonicalHash: sha256Hex(canonical),
    },
  };
}

function authBinding({ identity, authSession, signedRequest, planHash, payload }) {
  const subject = subjectBinding({ identity, authSession, signedRequest, planHash });
  const issue = pushSessionIssueBinding({ identity, signedRequest, subject });
  const sessionUser = sessionUserBinding({ identity, authSession, signedRequest });
  const binding = {
    schemaVersion: 1,
    scope: authScope,
    planHash,
    binding: subject,
    identity,
    session: authSession,
    pushSession: {
      sessionHash: signedRequest.sessionHash,
      signingKeyHash: signedRequest.signingKeyHash,
      issue,
      dryRunNonceHash: signedRequest.nonceHash,
      dryRunContentHash: signedRequest.contentHash,
      dryRunCanonicalHash: signedRequest.request.canonicalHash,
      dryRunIdempotencyKeyHash: signedRequest.request.idempotencyKeyHash,
    },
    sessionUser,
    source: {
      sourceUrlHash: sha256Hex(sourceUrl),
      sourceHash: signedRequest.session.sourceHash,
      restNamespace: 'reprint/v1',
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
    preconditions: {
      preconditionSetHash: '',
      mutationSetHash: '',
      mutationCount: Array.isArray(payload.plan?.mutations) ? payload.plan.mutations.length : 0,
    },
    issuedAt: proofCapturedAt,
    expiresAt: freshExpiresAt,
  };

  return binding;
}

function subjectBinding({ identity, authSession, signedRequest, planHash }) {
  const binding = {
    schemaVersion: 1,
    scopeHash: sha256Hex(authScope),
    identityHash: digest(identity),
    authSessionHash: digest(authSession),
    pushSessionHash: signedRequest.sessionHash,
    planHash,
  };
  binding.bindingHash = digest(binding);
  return binding;
}

function pushSessionIssueBinding({ identity, signedRequest, subject }) {
  const issue = {
    schemaVersion: 1,
    type: 'short-lived-push-session',
    sessionHash: signedRequest.session.sessionHash,
    signingKeyHash: signedRequest.signingKeyHash,
    scopeHash: subject.scopeHash,
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
    required: 'same authenticated user identity for push session, dry-run receipt, and apply',
    userId: identity.userId,
    userLoginHash: sha256Hex(identity.userLogin),
    identityHash: digest(identity),
    authSessionHash: digest(authSession),
    pushSessionHash: signedRequest.sessionHash,
    manageOptions: capabilities.manage_options === true,
  };
  binding.bindingHash = digest(binding);
  return binding;
}

function buildDryRunRouteSupportEvidence({
  dryRun = null,
  expectedPlan = readyPlan,
  source = sourceUrl,
  capturedAt = proofCapturedAt,
  evaluatedAt = proofCapturedAt,
} = {}) {
  const body = dryRun?.body || {};
  const routeProfile = body.routeProfile || {};
  const receipt = body.receipt || {};
  const binding = receipt.authBinding || {};
  const subject = binding.binding || {};
  const pushSession = binding.pushSession || {};
  const issue = pushSession.issue || {};
  const identity = binding.identity || body.auth?.identity || {};
  const session = binding.session || body.auth?.session || {};
  const requestPath = dryRun?.request?.pathname || null;
  const requestMethod = dryRun?.request?.method || 'POST';
  const expectedPlanHash = digest(expectedPlan);
  const bindingValidation = validateReceiptBinding({ receipt, expectedPlanHash });
  const routeEvidence = {
    method: requestMethod,
    endpointPath,
    requestPath,
    routeProfile: routeProfile.profile || null,
    restNamespace: routeProfile.restNamespace || null,
    routePrefix: routeProfile.routePrefix || null,
    labBacked: routeProfile.labBacked === true,
    proofHash: digest({
      method: requestMethod,
      endpointPath,
      requestPath,
      routeProfile: routeProfile.profile || null,
      restNamespace: routeProfile.restNamespace || null,
      routePrefix: routeProfile.routePrefix || null,
      status: dryRun?.status ?? null,
      mode: body.mode || null,
      capturedAt,
    }),
  };
  const base = {
    schemaVersion: 1,
    slice: 'RPP-0543',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    productionInputs: {
      productionUrlSupplied: false,
      productionCredentialsSupplied: false,
    },
    mutationAttempted: false,
    capturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(source),
      routeProfile: 'production-shaped',
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: credentialHash(),
      userLoginHash: identity.userLogin ? sha256Hex(identity.userLogin) : null,
      sessionIdHash: session.id ? sha256Hex(session.id) : null,
      sessionExpiresAtHash: session.expiresAt ? sha256Hex(session.expiresAt) : null,
      sessionType: session.type || null,
      sessionStatus: session.status || null,
      manageOptions: identity.capabilities?.manage_options === true,
      identityHashLength: String(subject.identityHash || '').length,
      authSessionHashLength: String(subject.authSessionHash || '').length,
      pushSessionHashLength: String(pushSession.sessionHash || '').length,
      signingKeyHashLength: String(pushSession.signingKeyHash || '').length,
    },
    routeEvidence,
    receiptBinding: {
      status: dryRun?.status ?? null,
      ok: body.ok === true,
      code: body.code || null,
      mode: body.mode || null,
      receiptHashLength: String(receipt.receiptHash || '').length,
      planHashMatchesExpected: receipt.planHash === expectedPlanHash,
      scopeHashLength: String(subject.scopeHash || '').length,
      identityHashLength: String(subject.identityHash || '').length,
      authSessionHashLength: String(subject.authSessionHash || '').length,
      pushSessionHashLength: String(subject.pushSessionHash || '').length,
      bindingHashLength: String(subject.bindingHash || '').length,
      issueHashLength: String(issue.issueHash || '').length,
      idempotencyKeyHashLength: String(pushSession.dryRunIdempotencyKeyHash || '').length,
      subjectBindingMatchesExpected: bindingValidation.subject === true,
      requestBindingMatchesExpected: bindingValidation.request === true,
      planBindingMatchesExpected: bindingValidation.plan === true,
      receiptHashMatchesBody: bindingValidation.receiptHash === true,
      sessionBindingMatchesSubject: bindingValidation.session === true,
      proofHash: digest({
        status: dryRun?.status ?? null,
        ok: body.ok === true,
        mode: body.mode || null,
        receiptHash: receipt.receiptHash || null,
        planHashMatchesExpected: receipt.planHash === expectedPlanHash,
        subjectBindingMatchesExpected: bindingValidation.subject === true,
        requestBindingMatchesExpected: bindingValidation.request === true,
        planBindingMatchesExpected: bindingValidation.plan === true,
        sessionBindingMatchesSubject: bindingValidation.session === true,
      }),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local dry-run route proof is support-only until production URL and credential proof exists',
    },
  };

  if (!dryRun || dryRun.status !== 200 || body.ok !== true || body.mode !== 'dry-run' || !receipt.authBinding) {
    return blockedDryRunEvidence(base, body.code || 'DRY_RUN_ROUTE_PROOF_REQUIRED');
  }

  if (!routeEvidenceIsFresh(capturedAt, evaluatedAt)) {
    return blockedDryRunEvidence(base, 'DRY_RUN_ROUTE_PROOF_STALE');
  }

  if (!isFreshProductionSession(session, evaluatedAt)) {
    return blockedDryRunEvidence(base, 'DRY_RUN_AUTH_SESSION_STALE');
  }

  if (!bindingValidation.ok) {
    return blockedDryRunEvidence(base, 'DRY_RUN_RECEIPT_BINDING_MISMATCH');
  }

  return {
    ...base,
    ok: true,
    status: 'support_only',
    code: 'LOCAL_DRY_RUN_ROUTE_SUPPORT_ONLY',
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed dry-run route receipt binding proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function validateReceiptBinding({ receipt, expectedPlanHash }) {
  const binding = receipt.authBinding || {};
  const subject = binding.binding || {};
  const identity = binding.identity || {};
  const session = binding.session || {};
  const pushSession = binding.pushSession || {};
  const request = binding.request || {};
  const plan = binding.plan || {};
  const subjectWithoutHash = withoutKey(subject, 'bindingHash');
  const receiptWithoutHash = withoutKey(receipt, 'receiptHash');
  const subjectOk = subject.schemaVersion === 1
    && subject.scopeHash === sha256Hex(binding.scope || '')
    && subject.identityHash === digest(identity)
    && subject.authSessionHash === digest(session)
    && subject.pushSessionHash === pushSession.sessionHash
    && subject.planHash === expectedPlanHash
    && subject.bindingHash === digest(subjectWithoutHash);
  const requestOk = request.restNamespace === 'reprint/v1'
    && request.dryRunRoute === '/push/dry-run'
    && request.routeProfile === 'production-shaped'
    && request.planHash === expectedPlanHash
    && request.planPayloadHash === expectedPlanHash;
  const planOk = plan.schemaVersion === 1
    && plan.planHash === expectedPlanHash
    && plan.planPayloadHash === expectedPlanHash;
  const sessionOk = pushSession.sessionHash === subject.pushSessionHash
    && pushSession.sessionHash === sha256Hex(session.id || '')
    && pushSession.issue?.sessionHash === pushSession.sessionHash
    && pushSession.issue?.identityHash === subject.identityHash
    && pushSession.issue?.scopeHash === subject.scopeHash;
  const receiptHashOk = typeof receipt.receiptHash === 'string'
    && hashPattern.test(receipt.receiptHash)
    && receipt.receiptHash === digest(receiptWithoutHash);
  const topLevelOk = binding.scope === authScope
    && receipt.planHash === expectedPlanHash
    && binding.planHash === expectedPlanHash;

  return {
    ok: subjectOk && requestOk && planOk && sessionOk && receiptHashOk && topLevelOk,
    subject: subjectOk,
    request: requestOk,
    plan: planOk,
    session: sessionOk,
    receiptHash: receiptHashOk,
    topLevel: topLevelOk,
  };
}

function blockedDryRunEvidence(base, code) {
  return {
    ...base,
    ok: false,
    status: 'blocked',
    code,
    boundary: {
      firstRemainingProductionBoundary: 'fresh production dry-run route receipt binding proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function routeEvidenceIsFresh(capturedAt, evaluatedAt) {
  return Date.parse(evaluatedAt) - Date.parse(capturedAt) <= proofFreshnessMs;
}

function isFreshProductionSession(session, evaluatedAt) {
  return session?.type === 'production-auth-session'
    && session?.status === 'active'
    && typeof session.expiresAt === 'string'
    && Date.parse(session.expiresAt) > Date.parse(evaluatedAt);
}

function summarizeNegativeAuthEvidence(response) {
  const evidence = response.body?.evidence || {};
  return {
    schemaVersion: 1,
    slice: 'RPP-0543',
    proofClass: 'real-endpoint-shaped-local-route',
    evidenceScope: 'local-lab-support',
    releaseStatus: 'NO-GO',
    status: 'blocked',
    mutationAttempted: false,
    sourceSummary: {
      sourceUrlHash: evidence.sourceUrlHash,
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHeaderHash: evidence.credentialHeaderHash,
      sessionIdHash: evidence.sessionIdHash,
      idempotencyKeyHash: evidence.idempotencyKeyHash,
    },
    routeEvidence: {
      method: 'POST',
      endpointPath,
      proofHash: digest({
        method: 'POST',
        endpointPath,
        status: response.status,
        code: response.body?.code || null,
      }),
    },
    negativeAuth: {
      status: response.status,
      code: response.body?.code || null,
      mode: response.body?.mode || null,
      payloadWouldFailIfParsed: true,
      jsonParsed: false,
      receiptMinted: false,
      mutationCapableWorkStarted: false,
      bodyHash: evidence.bodyHash,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'authenticated production dry-run route evidence is required',
    },
    boundary: {
      firstRemainingProductionBoundary: 'authenticated dry-run route receipt binding proof',
      status: 'blocked',
      verdict: response.body?.code || 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

function hasDryRunReceiptEvidence(response) {
  const body = response?.body || {};
  return Boolean(
    body.receipt
    || body.authBinding
    || body.planHash
    || body.preconditionSetHash
    || body.mutationSetHash
  );
}

async function requestLocalRoute(route, headers) {
  const response = await route.fetchHandler(new URL(endpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: malformedJsonBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function acceptedDryRunResponse({ expiresAt = freshExpiresAt } = {}) {
  const rawBody = JSON.stringify({ plan: readyPlan });
  const headers = headerEntries(signedDryRunHeaders({ rawBody }));
  return {
    status: 200,
    request: {
      method: 'POST',
      pathname: endpointPath,
    },
    body: dryRunBody({
      payload: { plan: readyPlan },
      rawBody,
      headers,
      expiresAt,
    }),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertHashOnlyWhenPresent(value, fields) {
  for (const field of fields) {
    if (value[field] !== null && value[field] !== undefined) {
      assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
    }
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

test('RPP-0543 v3 accepts production-shaped dry-run receipt binding as support-only', async () => {
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
    const evidence = buildDryRunRouteSupportEvidence({ dryRun });
    const receipt = dryRun.body.receipt;
    const binding = receipt.authBinding;
    const subject = binding.binding;
    const pushSession = binding.pushSession;

    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.request.pathname, endpointPath);
    assert.equal(dryRun.request.method, 'POST');
    assert.equal(dryRun.body.mode, 'dry-run');
    assert.equal(dryRun.body.routeProfile.profile, 'production-shaped');
    assert.equal(dryRun.body.routeProfile.restNamespace, 'reprint/v1');
    assert.equal(dryRun.body.routeProfile.routePrefix, '/push');
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
    assert.equal(binding.identity.capabilities.manage_options, true);
    assert.equal(binding.session.type, 'production-auth-session');
    assert.equal(binding.session.status, 'active');
    assert.equal(binding.session.id, sessionId);
    assert.equal(binding.request.restNamespace, 'reprint/v1');
    assert.equal(binding.request.dryRunRoute, '/push/dry-run');
    assert.equal(binding.request.routeProfile, 'production-shaped');
    assert.equal(binding.request.planHash, receipt.planHash);
    assert.equal(binding.plan.planHash, receipt.planHash);

    assert.equal(subject.scopeHash, sha256Hex(authScope));
    assert.equal(subject.identityHash, digest(binding.identity));
    assert.equal(subject.authSessionHash, digest(binding.session));
    assert.equal(subject.pushSessionHash, sha256Hex(sessionId));
    assert.equal(subject.pushSessionHash, pushSession.sessionHash);
    assert.equal(subject.planHash, receipt.planHash);
    assert.equal(subject.bindingHash, digest(withoutKey(subject, 'bindingHash')));
    assert.equal(pushSession.dryRunIdempotencyKeyHash, sha256Hex(idempotencyKey));
    assert.equal(pushSession.issue.sessionHash, pushSession.sessionHash);
    assert.equal(pushSession.issue.identityHash, subject.identityHash);
    assert.equal(pushSession.issue.scopeHash, subject.scopeHash);
    assert.match(pushSession.issue.issueHash, hashPattern);

    assert.equal(evidence.ok, true);
    assert.equal(evidence.status, 'support_only');
    assert.equal(evidence.releaseStatus, 'NO-GO');
    assert.equal(evidence.releaseMovement.allowed, false);
    assert.equal(evidence.mutationAttempted, false);
    assert.equal(evidence.productionInputs.productionUrlSupplied, false);
    assert.equal(evidence.productionInputs.productionCredentialsSupplied, false);
    assert.equal(evidence.routeEvidence.endpointPath, endpointPath);
    assert.equal(evidence.routeEvidence.requestPath, endpointPath);
    assert.equal(evidence.routeEvidence.routeProfile, 'production-shaped');
    assert.equal(evidence.routeEvidence.labBacked, true);
    assert.equal(evidence.receiptBinding.planHashMatchesExpected, true);
    assert.equal(evidence.receiptBinding.subjectBindingMatchesExpected, true);
    assert.equal(evidence.receiptBinding.requestBindingMatchesExpected, true);
    assert.equal(evidence.receiptBinding.planBindingMatchesExpected, true);
    assert.equal(evidence.receiptBinding.receiptHashMatchesBody, true);
    assert.equal(evidence.receiptBinding.sessionBindingMatchesSubject, true);
    assert.equal(evidence.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(evidence.redaction.rawValuesIncluded, false);

    assertHashOnlyFields(evidence.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(evidence.authSummary, [
      'credentialHash',
      'userLoginHash',
      'sessionIdHash',
      'sessionExpiresAtHash',
    ]);
    assertHashOnlyFields(evidence.routeEvidence, ['proofHash']);
    assertHashOnlyFields(evidence.receiptBinding, ['proofHash']);
    assertNoRawValues(evidence, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      signedNonce,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0543 v3 negative auth cases fail before JSON parsing or receipt minting', async () => {
  const route = createLocalProductionDryRunRoute();
  const negativeCases = [
    {
      name: 'missing-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
      },
    },
    {
      name: 'wrong-basic-auth-malformed-json',
      expectedStatus: 401,
      expectedCode: 'reprint_push_lab_auth_required',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(wrongCredential),
      },
    },
    {
      name: 'valid-auth-missing-signature-headers-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_HEADER_REQUIRED',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(),
      },
    },
    {
      name: 'valid-auth-missing-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_REQUIRED',
      headers: withoutHeader(
        signedDryRunHeaders({
          rawBody: malformedJsonBody,
          session: '',
        }),
        'X-Reprint-Push-Session',
      ),
    },
    {
      name: 'valid-auth-missing-idempotency-key-malformed-json',
      expectedStatus: 400,
      expectedCode: 'MISSING_IDEMPOTENCY_KEY',
      headers: withoutHeader(
        signedDryRunHeaders({
          rawBody: malformedJsonBody,
          idempotency: '',
        }),
        'X-Reprint-Push-Idempotency-Key',
      ),
    },
    {
      name: 'valid-auth-content-hash-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_CONTENT_HASH_MISMATCH',
      headers: signedDryRunHeaders({
        rawBody: malformedJsonBody,
        contentHash: '0'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-auth-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      headers: signedDryRunHeaders({
        rawBody: malformedJsonBody,
        authSignature: 'a'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-push-signature-mismatch-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      headers: signedDryRunHeaders({
        rawBody: malformedJsonBody,
        pushSignature: 'b'.repeat(64),
      }),
    },
    {
      name: 'valid-auth-invalid-session-malformed-json',
      expectedStatus: 401,
      expectedCode: 'SIGNED_SESSION_INVALID',
      headers: signedDryRunHeaders({
        rawBody: malformedJsonBody,
        session: invalidSessionId,
      }),
    },
  ];

  for (const negativeCase of negativeCases) {
    const result = await requestLocalRoute(route, negativeCase.headers);
    const summary = summarizeNegativeAuthEvidence(result);

    assert.equal(result.status, negativeCase.expectedStatus, `${negativeCase.name} status`);
    assert.equal(result.body.code, negativeCase.expectedCode, negativeCase.name);
    assert.equal(result.body.code === 'INVALID_ARGUMENT', false, `${negativeCase.name} parsed route JSON`);
    assert.equal(result.body.code === 'rest_invalid_json', false, `${negativeCase.name} parsed REST JSON`);
    assert.equal(hasDryRunReceiptEvidence(result), false, `${negativeCase.name} emitted dry-run receipt evidence`);
    assert.equal(summary.negativeAuth.payloadWouldFailIfParsed, true);
    assert.equal(summary.negativeAuth.jsonParsed, false);
    assert.equal(summary.negativeAuth.receiptMinted, false);
    assert.equal(summary.negativeAuth.mutationCapableWorkStarted, false);
    assert.equal(summary.releaseStatus, 'NO-GO');
    assert.equal(summary.releaseMovement.allowed, false);
    assert.equal(summary.mutationAttempted, false);
    assertHashOnlyFields(summary.sourceSummary, ['sourceUrlHash']);
    assertHashOnlyFields(summary.routeEvidence, ['proofHash']);
    assertHashOnlyFields(summary.negativeAuth, ['bodyHash']);
    assertHashOnlyWhenPresent(summary.authSummary, [
      'credentialHeaderHash',
      'sessionIdHash',
      'idempotencyKeyHash',
    ]);
    assertNoRawValues({
      response: result.body,
      summary,
    }, [
      sourceUrl,
      credential.username,
      credential.password,
      wrongCredential.password,
      sessionId,
      invalidSessionId,
      idempotencyKey,
      malformedJsonBody,
    ]);
  }

  assert.equal(route.state.jsonParseAttempts, 0);
  assert.equal(route.state.dryRunWorkAttempts, 0);
  assert.equal(route.state.receiptMintAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);
});

test('RPP-0543 v3 refuses stale and tampered dry-run receipt binding before release movement', () => {
  const accepted = acceptedDryRunResponse();
  const missing = buildDryRunRouteSupportEvidence({
    dryRun: null,
    evaluatedAt: proofCapturedAt,
  });
  const staleRoute = buildDryRunRouteSupportEvidence({
    dryRun: accepted,
    capturedAt: proofStaleCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const staleSession = buildDryRunRouteSupportEvidence({
    dryRun: acceptedDryRunResponse({ expiresAt: staleExpiresAt }),
    capturedAt: proofCapturedAt,
    evaluatedAt: proofCapturedAt,
  });
  const tamperedSubject = clone(accepted);
  tamperedSubject.body.receipt.authBinding.binding.identityHash = sha256Hex('tampered-identity');
  const tamperedPlan = clone(accepted);
  tamperedPlan.body.receipt.authBinding.plan.planHash = sha256Hex('tampered-plan');
  const tamperedSession = clone(accepted);
  tamperedSession.body.receipt.authBinding.pushSession.sessionHash = sha256Hex('tampered-session');

  const tamperedSubjectEvidence = buildDryRunRouteSupportEvidence({ dryRun: tamperedSubject });
  const tamperedPlanEvidence = buildDryRunRouteSupportEvidence({ dryRun: tamperedPlan });
  const tamperedSessionEvidence = buildDryRunRouteSupportEvidence({ dryRun: tamperedSession });

  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.code, 'DRY_RUN_ROUTE_PROOF_REQUIRED');
  assert.equal(missing.releaseStatus, 'NO-GO');
  assert.equal(missing.releaseMovement.allowed, false);
  assert.equal(missing.mutationAttempted, false);
  assert.equal(missing.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(staleRoute.ok, false);
  assert.equal(staleRoute.status, 'blocked');
  assert.equal(staleRoute.code, 'DRY_RUN_ROUTE_PROOF_STALE');
  assert.equal(staleRoute.releaseStatus, 'NO-GO');
  assert.equal(staleRoute.releaseMovement.allowed, false);
  assert.equal(staleRoute.boundary.firstRemainingProductionBoundary, 'fresh production dry-run route receipt binding proof');

  assert.equal(staleSession.ok, false);
  assert.equal(staleSession.status, 'blocked');
  assert.equal(staleSession.code, 'DRY_RUN_AUTH_SESSION_STALE');
  assert.equal(staleSession.releaseStatus, 'NO-GO');
  assert.equal(staleSession.releaseMovement.allowed, false);
  assert.equal(staleSession.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

  assert.equal(tamperedSubjectEvidence.ok, false);
  assert.equal(tamperedSubjectEvidence.status, 'blocked');
  assert.equal(tamperedSubjectEvidence.code, 'DRY_RUN_RECEIPT_BINDING_MISMATCH');
  assert.equal(tamperedSubjectEvidence.receiptBinding.subjectBindingMatchesExpected, false);
  assert.equal(tamperedSubjectEvidence.releaseMovement.allowed, false);

  assert.equal(tamperedPlanEvidence.ok, false);
  assert.equal(tamperedPlanEvidence.status, 'blocked');
  assert.equal(tamperedPlanEvidence.code, 'DRY_RUN_RECEIPT_BINDING_MISMATCH');
  assert.equal(tamperedPlanEvidence.receiptBinding.planBindingMatchesExpected, false);
  assert.equal(tamperedPlanEvidence.releaseMovement.allowed, false);

  assert.equal(tamperedSessionEvidence.ok, false);
  assert.equal(tamperedSessionEvidence.status, 'blocked');
  assert.equal(tamperedSessionEvidence.code, 'DRY_RUN_RECEIPT_BINDING_MISMATCH');
  assert.equal(tamperedSessionEvidence.receiptBinding.sessionBindingMatchesSubject, false);
  assert.equal(tamperedSessionEvidence.releaseMovement.allowed, false);

  assertHashOnlyFields(staleRoute.sourceSummary, ['sourceUrlHash']);
  assertHashOnlyFields(staleRoute.authSummary, [
    'credentialHash',
    'userLoginHash',
    'sessionIdHash',
    'sessionExpiresAtHash',
  ]);
  assertHashOnlyFields(staleRoute.routeEvidence, ['proofHash']);
  assertHashOnlyFields(staleRoute.receiptBinding, ['proofHash']);
  assertNoRawValues({
    missing,
    staleRoute,
    staleSession,
    tamperedSubjectEvidence,
    tamperedPlanEvidence,
    tamperedSessionEvidence,
  }, [
    sourceUrl,
    credential.username,
    credential.password,
    wrongCredential.password,
    sessionId,
    invalidSessionId,
    idempotencyKey,
  ]);
});
