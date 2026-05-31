import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');

const sourceUrl = 'https://rpp-0573-source.invalid';
const routePrefix = '/wp-json/reprint/v1/push';
const endpointPath = `${routePrefix}/dry-run`;
const authScope = 'reprint-push-lab:authenticated-http-push';
const driftedScope = 'reprint-push-lab:drifted-scope';
const proofCapturedAt = '2026-05-31T12:57:03Z';
const freshExpiresAt = '2026-05-31T13:02:03Z';
const signedTimestamp = '1780000573';
const signedNonce = 'rpp0573acceptednonce';
const idempotencyKey = 'idem-rpp-0573-raw-idempotency-key';
const sessionId = 'psh_rpp_0573_primary_session';
const sessionDriftId = 'psh_rpp_0573_session_drift';
const identityDriftSessionId = 'psh_rpp_0573_identity_drift';
const scopeDriftSessionId = 'psh_rpp_0573_scope_drift';
const hashPattern = /^[a-f0-9]{64}$/;

const primaryCredential = {
  username: 'rpp_0573_admin',
  password: 'rpp-0573-application-password-should-not-leak',
};
const identityDriftCredential = {
  username: 'rpp_0573_drift_admin',
  password: 'rpp-0573-identity-drift-password-should-not-leak',
};

const primaryIdentity = {
  userId: 573,
  userLogin: primaryCredential.username,
  capabilities: { manage_options: true },
};
const identityDriftIdentity = {
  userId: 1573,
  userLogin: identityDriftCredential.username,
  capabilities: { manage_options: true },
};

const readyPlan = {
  id: 'plan-rpp-0573-subject-bound-nonce-v4',
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
      resourceKey: 'wp_option:blogdescription',
      beforeHash: `sha256:${sha256Hex('remote-tagline-rpp-0573')}`,
      afterHash: `sha256:${sha256Hex('local-tagline-rpp-0573')}`,
    },
  ],
  conflicts: [],
  blockers: [],
  generatedAt: proofCapturedAt,
};

const driftPlan = {
  ...readyPlan,
  id: 'plan-rpp-0573-drifted-plan-v4',
  summary: {
    ...readyPlan.summary,
    updates: 2,
  },
  mutations: [
    ...readyPlan.mutations,
    {
      action: 'update',
      resourceType: 'wp_option',
      resourceKey: 'wp_option:blogname',
      beforeHash: `sha256:${sha256Hex('remote-title-rpp-0573')}`,
      afterHash: `sha256:${sha256Hex('local-title-rpp-0573')}`,
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function credentialHash(credential) {
  return sha256Hex(`${credential.username}\n${credential.password}`);
}

function labSigningKey(credential) {
  return hmacHex(credential.password, `reprint-push-lab-v1\n${credential.username}`);
}

function basicAuth(credential) {
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`;
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

function headerEntries(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authSession({
  id,
  identity = primaryIdentity,
  credential = primaryCredential,
  scope = authScope,
  applicationPasswordUuid = 'app-pass-rpp-0573',
} = {}) {
  return {
    type: 'production-auth-session',
    status: 'active',
    id,
    applicationPasswordUuid,
    credentialHash: credentialHash(credential),
    scope,
    sourceUrlHash: sha256Hex(sourceUrl),
    revoked: false,
    cleanedUp: false,
    playgroundFallback: false,
    expiresAt: freshExpiresAt,
    userId: identity.userId,
    userLoginHash: sha256Hex(identity.userLogin),
  };
}

const sessionRegistry = new Map([
  [sessionId, {
    credential: primaryCredential,
    identity: primaryIdentity,
    scope: authScope,
    session: authSession({ id: sessionId }),
  }],
  [sessionDriftId, {
    credential: primaryCredential,
    identity: primaryIdentity,
    scope: authScope,
    session: authSession({ id: sessionDriftId }),
  }],
  [identityDriftSessionId, {
    credential: identityDriftCredential,
    identity: identityDriftIdentity,
    scope: authScope,
    session: authSession({
      id: identityDriftSessionId,
      identity: identityDriftIdentity,
      credential: identityDriftCredential,
      applicationPasswordUuid: 'app-pass-rpp-0573-identity-drift',
    }),
  }],
  [scopeDriftSessionId, {
    credential: primaryCredential,
    identity: primaryIdentity,
    scope: driftedScope,
    session: authSession({ id: scopeDriftSessionId, scope: driftedScope }),
  }],
]);

function signedDryRunHeaders({
  rawBody,
  session = sessionId,
  credential = primaryCredential,
  idempotency = idempotencyKey,
  timestamp = signedTimestamp,
  nonce = signedNonce,
} = {}) {
  const contentHash = sha256Hex(rawBody);
  const signingKey = labSigningKey(credential);
  const canonical = pushCanonicalString({
    method: 'POST',
    pathname: endpointPath,
    contentHash,
    session,
    idempotencyKey: idempotency,
  });

  return {
    authorization: basicAuth(credential),
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

function createSubjectBoundNonceReplayDryRunRoute() {
  const state = {
    requests: [],
    nonceClaims: new Map(),
    acceptedNonceClaims: [],
    jsonParseAttempts: 0,
    dryRunWorkAttempts: 0,
    receiptMintAttempts: 0,
    receiptMovementAttempts: 0,
    replayRejectedCount: 0,
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
  const auth = authenticateDryRunRequest({ method, pathname, headers, rawBody });
  if (auth.error) {
    return jsonResponse(authFailureBody({ code: auth.error.code, status: auth.error.status, headers, rawBody }), auth.error.status);
  }

  const incoming = preParseSubject({ method, pathname, headers, rawBody, auth });
  const nonceHash = incoming.nonceHash;
  const accepted = state.nonceClaims.get(nonceHash);
  if (accepted) {
    state.replayRejectedCount += 1;
    return jsonResponse(nonceReplayFailureBody({ accepted, incoming }), 409);
  }

  const claim = {
    schemaVersion: 1,
    nonceHash,
    timestampHash: incoming.timestampHash,
    sessionHash: incoming.sessionHash,
    identityHash: incoming.identityHash,
    authSessionHash: incoming.authSessionHash,
    scopeHash: incoming.scopeHash,
    contentHash: incoming.contentHash,
    canonicalRequestHash: incoming.canonicalRequestHash,
    idempotencyKeyHash: incoming.idempotencyKeyHash,
    preParseSubjectHash: incoming.preParseSubjectHash,
    acceptedBeforeJsonParse: true,
  };
  state.nonceClaims.set(nonceHash, claim);

  state.jsonParseAttempts += 1;
  const payload = JSON.parse(rawBody);
  const plan = payload.plan || {};
  claim.planHash = digest(plan);
  claim.subject = subjectBinding({ auth, planHash: claim.planHash });
  claim.subjectHash = digest(claim.subject);
  claim.claimHash = digest(withoutKey(claim, 'claimHash'));
  state.acceptedNonceClaims.push(claim);

  state.dryRunWorkAttempts += 1;
  state.receiptMintAttempts += 1;

  return jsonResponse(dryRunBody({ payload, rawBody, headers, auth, claim }));
}

function authenticateDryRunRequest({ method, pathname, headers, rawBody }) {
  const credential = [primaryCredential, identityDriftCredential]
    .find((candidate) => headers.authorization === basicAuth(candidate));
  if (!credential) {
    return { error: { code: 'reprint_push_lab_auth_required', status: 401 } };
  }

  const requiredSignedHeaders = [
    'x-auth-content-hash',
    'x-auth-timestamp',
    'x-auth-nonce',
    'x-auth-signature',
    'x-reprint-push-signature',
    'x-reprint-push-session',
    'x-reprint-push-idempotency-key',
  ];
  if (requiredSignedHeaders.some((header) => !headers[header])) {
    return { error: { code: 'SIGNED_HEADER_REQUIRED', status: 401 } };
  }

  const contentHash = sha256Hex(rawBody);
  if (headers['x-auth-content-hash'] !== contentHash) {
    return { error: { code: 'SIGNED_CONTENT_HASH_MISMATCH', status: 401 } };
  }

  const signingKey = labSigningKey(credential);
  const authSignature = hmacHex(
    signingKey,
    `${headers['x-auth-nonce']}${headers['x-auth-timestamp']}${contentHash}`,
  );
  if (headers['x-auth-signature'] !== authSignature) {
    return { error: { code: 'SIGNED_AUTH_SIGNATURE_MISMATCH', status: 401 } };
  }

  const session = sessionRegistry.get(headers['x-reprint-push-session']);
  if (!session) {
    return { error: { code: 'SIGNED_SESSION_INVALID', status: 401 } };
  }
  if (session.credential.username !== credential.username
    || session.credential.password !== credential.password) {
    return { error: { code: 'SIGNED_SESSION_BINDING_MISMATCH', status: 401 } };
  }

  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  if (headers['x-reprint-push-signature'] !== hmacHex(signingKey, canonical)) {
    return { error: { code: 'SIGNED_PUSH_SIGNATURE_MISMATCH', status: 401 } };
  }

  return {
    credential,
    identity: cloneJson(session.identity),
    session: cloneJson(session.session),
    scope: session.scope,
    signingKeyHash: sha256Hex(signingKey),
  };
}

function preParseSubject({ method, pathname, headers, rawBody, auth }) {
  const contentHash = headers['x-auth-content-hash'] || sha256Hex(rawBody);
  const canonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session: headers['x-reprint-push-session'] || '',
    idempotencyKey: headers['x-reprint-push-idempotency-key'] || '',
  });
  const subject = {
    schemaVersion: 1,
    nonceHash: sha256Hex(headers['x-auth-nonce'] || ''),
    timestampHash: sha256Hex(headers['x-auth-timestamp'] || ''),
    sessionHash: sha256Hex(headers['x-reprint-push-session'] || ''),
    identityHash: digest(auth.identity),
    authSessionHash: digest(auth.session),
    scopeHash: sha256Hex(auth.scope),
    contentHash,
    canonicalRequestHash: sha256Hex(canonical),
    idempotencyKeyHash: sha256Hex(headers['x-reprint-push-idempotency-key'] || ''),
  };
  subject.preParseSubjectHash = digest(subject);
  return subject;
}

function subjectBinding({ auth, planHash }) {
  const binding = {
    schemaVersion: 1,
    scopeHash: sha256Hex(auth.scope),
    identityHash: digest(auth.identity),
    authSessionHash: digest(auth.session),
    pushSessionHash: sha256Hex(auth.session.id),
    planHash,
  };
  binding.bindingHash = digest(binding);
  return binding;
}

function dryRunBody({ payload, rawBody, auth, claim }) {
  const receipt = {
    schemaVersion: 1,
    type: 'dry-run',
    ok: true,
    mode: 'dry-run',
    planHash: claim.planHash,
    authBinding: {
      schemaVersion: 1,
      scope: auth.scope,
      planHash: claim.planHash,
      binding: claim.subject,
      identity: cloneJson(auth.identity),
      session: cloneJson(auth.session),
      pushSession: {
        sessionHash: claim.sessionHash,
        signingKeyHash: auth.signingKeyHash,
        dryRunNonceHash: claim.nonceHash,
        dryRunContentHash: claim.contentHash,
        dryRunCanonicalHash: claim.canonicalRequestHash,
        dryRunIdempotencyKeyHash: claim.idempotencyKeyHash,
        nonceClaimHash: claim.claimHash,
      },
      source: {
        sourceUrlHash: sha256Hex(sourceUrl),
        restNamespace: 'reprint/v1',
        routeProfile: 'production-shaped',
        labBacked: true,
      },
      request: {
        restNamespace: 'reprint/v1',
        dryRunRoute: '/push/dry-run',
        routeProfile: 'production-shaped',
        labBacked: true,
        planHash: claim.planHash,
        planPayloadHash: claim.planHash,
        dryRunBodyHash: digest(payload),
        dryRunRawBodyHash: sha256Hex(rawBody),
      },
      plan: {
        schemaVersion: 1,
        planHash: claim.planHash,
        planPayloadHash: claim.planHash,
      },
      issuedAt: proofCapturedAt,
      expiresAt: freshExpiresAt,
    },
  };
  receipt.receiptHash = digest(receipt);

  return {
    ok: true,
    mode: 'dry-run',
    responseSchemaVersion: 1,
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
    planHash: claim.planHash,
    nonceStore: {
      status: 'accepted',
      acceptedBeforeJsonParse: true,
      nonceHash: claim.nonceHash,
      nonceClaimHash: claim.claimHash,
      subjectHash: claim.subjectHash,
    },
    receipt,
  };
}

function authFailureBody({ code, status, headers, rawBody }) {
  return {
    ok: false,
    code,
    mode: 'dry-run',
    status,
    evidence: {
      schemaVersion: 1,
      bodyHash: sha256Hex(rawBody),
      sessionHash: headers['x-reprint-push-session']
        ? sha256Hex(headers['x-reprint-push-session'])
        : null,
      nonceHash: headers['x-auth-nonce'] ? sha256Hex(headers['x-auth-nonce']) : null,
      receiptMinted: false,
      receiptMoved: false,
      mutationAttempted: false,
    },
  };
}

function nonceReplayFailureBody({ accepted, incoming }) {
  const drift = {
    session: accepted.sessionHash !== incoming.sessionHash,
    identity: accepted.identityHash !== incoming.identityHash,
    authSession: accepted.authSessionHash !== incoming.authSessionHash,
    scope: accepted.scopeHash !== incoming.scopeHash,
    body: accepted.contentHash !== incoming.contentHash,
    canonicalRequest: accepted.canonicalRequestHash !== incoming.canonicalRequestHash,
  };
  const body = {
    ok: false,
    code: 'SIGNED_NONCE_REPLAYED',
    mode: 'dry-run',
    evidence: {
      schemaVersion: 1,
      nonceHash: accepted.nonceHash,
      nonceClaimHash: accepted.claimHash,
      acceptedSubjectHash: accepted.subjectHash,
      incomingPreParseSubjectHash: incoming.preParseSubjectHash,
      accepted: {
        sessionHash: accepted.sessionHash,
        identityHash: accepted.identityHash,
        authSessionHash: accepted.authSessionHash,
        scopeHash: accepted.scopeHash,
        planHash: accepted.planHash,
        contentHash: accepted.contentHash,
        canonicalRequestHash: accepted.canonicalRequestHash,
      },
      incoming: {
        sessionHash: incoming.sessionHash,
        identityHash: incoming.identityHash,
        authSessionHash: incoming.authSessionHash,
        scopeHash: incoming.scopeHash,
        contentHash: incoming.contentHash,
        canonicalRequestHash: incoming.canonicalRequestHash,
        idempotencyKeyHash: incoming.idempotencyKeyHash,
      },
      drift,
      replayed: true,
      receiptMinted: false,
      receiptMoved: false,
      jsonParsed: false,
      mutationAttempted: false,
    },
  };
  body.evidence.refusalHash = digest(body.evidence);
  return body;
}

function validateReceiptBinding({ receipt, auth, plan }) {
  const binding = receipt?.authBinding || {};
  const subject = binding.binding || {};
  const pushSession = binding.pushSession || {};
  const request = binding.request || {};
  const planBinding = binding.plan || {};
  const expectedPlanHash = digest(plan);
  const receiptWithoutHash = receipt ? withoutKey(receipt, 'receiptHash') : {};
  const subjectWithoutHash = subject ? withoutKey(subject, 'bindingHash') : {};

  const checks = {
    receiptHash: typeof receipt?.receiptHash === 'string'
      && hashPattern.test(receipt.receiptHash)
      && receipt.receiptHash === digest(receiptWithoutHash),
    topLevelPlan: receipt?.planHash === expectedPlanHash
      && binding.planHash === expectedPlanHash,
    scope: binding.scope === auth.scope
      && subject.scopeHash === sha256Hex(auth.scope),
    identity: subject.identityHash === digest(auth.identity),
    authSession: subject.authSessionHash === digest(auth.session),
    session: subject.pushSessionHash === sha256Hex(auth.session.id)
      && pushSession.sessionHash === subject.pushSessionHash,
    plan: subject.planHash === expectedPlanHash
      && request.planHash === expectedPlanHash
      && request.planPayloadHash === expectedPlanHash
      && planBinding.planHash === expectedPlanHash
      && planBinding.planPayloadHash === expectedPlanHash,
    bindingHash: subject.bindingHash === digest(subjectWithoutHash),
    nonceClaim: typeof pushSession.nonceClaimHash === 'string'
      && hashPattern.test(pushSession.nonceClaimHash)
      && typeof pushSession.dryRunNonceHash === 'string'
      && hashPattern.test(pushSession.dryRunNonceHash),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    expectedPlanHash,
  };
}

function attemptReceiptMovement({ receipt, auth, plan, state }) {
  const validation = validateReceiptBinding({ receipt, auth, plan });
  if (!validation.ok) {
    const refusal = {
      schemaVersion: 1,
      slice: 'RPP-0573',
      variant: 4,
      supportOnly: true,
      releaseGate: 'NO-GO',
      code: 'AUTH_RECEIPT_SUBJECT_DRIFT',
      reasonHash: sha256Hex('Receipt subject binding does not match session identity scope and plan hash.'),
      receipt: receiptBindingEvidence(receipt),
      currentSubjectHash: digest({
        sessionHash: sha256Hex(auth.session.id),
        identityHash: digest(auth.identity),
        authSessionHash: digest(auth.session),
        scopeHash: sha256Hex(auth.scope),
        planHash: digest(plan),
      }),
      failedChecksHash: digest(validation.checks),
      beforeReceiptMovement: true,
      beforeMutationCapableWork: true,
      receiptMovementAttempts: state.receiptMovementAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
    };
    refusal.refusalHash = digest(refusal);
    return { ok: false, refusal };
  }

  state.receiptMovementAttempts += 1;
  state.mutationCapableWorkAttempts += 1;
  return { ok: true };
}

function receiptBindingEvidence(receipt) {
  const binding = receipt?.authBinding?.binding || {};
  const pushSession = receipt?.authBinding?.pushSession || {};

  return {
    receiptHash: receipt?.receiptHash || null,
    planHash: receipt?.planHash || null,
    bindingHash: binding.bindingHash || null,
    sessionHash: binding.pushSessionHash || pushSession.sessionHash || null,
    identityHash: binding.identityHash || null,
    authSessionHash: binding.authSessionHash || null,
    scopeHash: binding.scopeHash || null,
    dryRunNonceHash: pushSession.dryRunNonceHash || null,
    nonceClaimHash: pushSession.nonceClaimHash || null,
  };
}

function buildAcceptedSupportEvidence({ response, state }) {
  const body = response.body;
  const receipt = body.receipt;
  const binding = receipt.authBinding;
  const subject = binding.binding;
  const pushSession = binding.pushSession;
  const claim = state.acceptedNonceClaims.at(-1);
  const validation = validateReceiptBinding({
    receipt,
    auth: sessionRegistry.get(sessionId),
    plan: readyPlan,
  });

  const envelope = {
    schemaVersion: 1,
    slice: 'RPP-0573',
    variant: 4,
    proofClass: 'generated-local-subject-bound-nonce-replay-store',
    evidenceScope: 'local-generated-support',
    supportOnly: true,
    releaseGate: 'NO-GO',
    ok: response.status === 200 && body.ok === true && validation.ok,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    nonceStore: {
      acceptedNonceCount: state.acceptedNonceClaims.length,
      replayRejectedCount: state.replayRejectedCount,
      acceptedBeforeJsonParse: claim.acceptedBeforeJsonParse,
      nonceHash: claim.nonceHash,
      nonceClaimHash: claim.claimHash,
      preParseSubjectHash: claim.preParseSubjectHash,
      subjectHash: claim.subjectHash,
    },
    receipt: {
      receiptHash: receipt.receiptHash,
      planHash: receipt.planHash,
      canonicalPlanHash: digest(readyPlan),
      bindingHash: subject.bindingHash,
      dryRunNonceHash: pushSession.dryRunNonceHash,
      dryRunCanonicalHash: pushSession.dryRunCanonicalHash,
      dryRunIdempotencyKeyHash: pushSession.dryRunIdempotencyKeyHash,
      nonceClaimHash: pushSession.nonceClaimHash,
    },
    subject: {
      sessionHash: subject.pushSessionHash,
      identityHash: subject.identityHash,
      authSessionHash: subject.authSessionHash,
      scopeHash: subject.scopeHash,
      planHash: subject.planHash,
    },
    beforeMutation: {
      dryRunOnly: true,
      receiptMovementAttempts: state.receiptMovementAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
    },
    releaseMovement: {
      allowed: false,
      reasonHash: sha256Hex('local support proof requires production-owned replay store evidence'),
    },
  };
  envelope.proofHash = digest(envelope);
  return envelope;
}

function buildReplayRefusalEvidence({ kind, response, state }) {
  const body = response.body;
  const replayEvidence = body.evidence || {};
  const envelope = {
    schemaVersion: 1,
    slice: 'RPP-0573',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    negativeCaseHash: sha256Hex(kind),
    status: response.status,
    code: body.code || null,
    nonceHash: replayEvidence.nonceHash || null,
    nonceClaimHash: replayEvidence.nonceClaimHash || null,
    acceptedSubjectHash: replayEvidence.acceptedSubjectHash || null,
    incomingPreParseSubjectHash: replayEvidence.incomingPreParseSubjectHash || null,
    accepted: replayEvidence.accepted || {},
    incoming: replayEvidence.incoming || {},
    driftHash: digest(replayEvidence.drift || {}),
    replayRejected: body.code === 'SIGNED_NONCE_REPLAYED',
    stoppedBefore: {
      jsonParseAttempts: state.jsonParseAttempts,
      dryRunWorkAttempts: state.dryRunWorkAttempts,
      receiptMintAttempts: state.receiptMintAttempts,
      receiptMovementAttempts: state.receiptMovementAttempts,
      mutationCapableWorkAttempts: state.mutationCapableWorkAttempts,
      jsonParsedForReplay: replayEvidence.jsonParsed === true,
      receiptMintedForReplay: replayEvidence.receiptMinted === true,
      receiptMovedForReplay: replayEvidence.receiptMoved === true,
      mutationAttemptedForReplay: replayEvidence.mutationAttempted === true,
    },
  };
  envelope.refusalHash = digest(envelope);
  return envelope;
}

function buildMovementRefusalEvidence({ kind, refusal }) {
  const envelope = {
    schemaVersion: 1,
    slice: 'RPP-0573',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    negativeCaseHash: sha256Hex(kind),
    code: refusal.code,
    reasonHash: refusal.reasonHash,
    receipt: refusal.receipt,
    currentSubjectHash: refusal.currentSubjectHash,
    failedChecksHash: refusal.failedChecksHash,
    beforeReceiptMovement: refusal.beforeReceiptMovement,
    beforeMutationCapableWork: refusal.beforeMutationCapableWork,
    receiptMovementAttempts: refusal.receiptMovementAttempts,
    mutationCapableWorkAttempts: refusal.mutationCapableWorkAttempts,
    refusalHash: refusal.refusalHash,
  };
  envelope.aggregateHash = digest(envelope);
  return envelope;
}

async function requestLocalRoute(route, headers, rawBody = JSON.stringify({ plan: readyPlan })) {
  const response = await route.fetchHandler(new URL(endpointPath, sourceUrl), {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function assertHashFields(value, paths) {
  for (const pathExpression of paths) {
    const actual = pathExpression.split('.').reduce((current, key) => current?.[key], value);
    assert.match(actual, hashPattern, `${pathExpression} must be a bare sha256 digest`);
  }
}

function assertHashOrNull(value, label) {
  if (value === null) {
    return;
  }
  assert.match(value, hashPattern, `${label} must be a bare sha256 digest or null`);
}

function assertReceiptEvidenceHashOnly(evidence) {
  for (const [field, value] of Object.entries(evidence.receipt)) {
    assertHashOrNull(value, `receipt.${field}`);
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

function rawValuesForRedaction() {
  return [
    sourceUrl,
    primaryCredential.username,
    primaryCredential.password,
    identityDriftCredential.username,
    identityDriftCredential.password,
    sessionId,
    sessionDriftId,
    identityDriftSessionId,
    scopeDriftSessionId,
    idempotencyKey,
    signedNonce,
    authScope,
    driftedScope,
    readyPlan.id,
    driftPlan.id,
    readyPlan.mutations[0].resourceKey,
    driftPlan.mutations[1].resourceKey,
  ];
}

test('RPP-0573 v4 signed nonce replay checks precede dry-run parsing and receipt movement', () => {
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const verifySignedRequest = functionBody('reprint_push_lab_rest_verify_signed_request');
  const bindReceipt = functionBody('reprint_push_lab_rest_bind_authenticated_receipt');
  const subjectBindingSource = functionBody('reprint_push_lab_rest_authenticated_receipt_subject_binding');
  const validateReceipt = functionBody('reprint_push_lab_rest_validate_authenticated_receipt');

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(
    dryRun,
    'reprint_push_lab_rest_protocol_response',
    'reprint_push_lab_rest_json_payload',
  );
  assertBefore(
    verifySignedRequest,
    '$expected_push_signature = hash_hmac',
    '$nonce_claim = reprint_push_lab_rest_claim_signed_nonce',
  );
  assertBefore(
    verifySignedRequest,
    '$nonce_claim = reprint_push_lab_rest_claim_signed_nonce',
    "return reprint_push_lab_rest_signature_failure(\n                'SIGNED_NONCE_REPLAYED'",
  );
  assertBefore(
    apply,
    'reprint_push_lab_rest_validate_authenticated_receipt($request, $payload, $plan, $receipt_payload)',
    'reprint_push_lab_rest_apply_with_db_journal($request, true)',
  );

  assert.match(verifySignedRequest, /'contentHash'\s*=>\s*\$content_hash/);
  assert.match(verifySignedRequest, /'sessionHash'\s*=>\s*\(string\)\s*\(\$session\['sessionHash'\]/);
  assert.match(verifySignedRequest, /'identityHash'\s*=>\s*reprint_push_lab_rest_signed_identity_hash\(\$auth\)/);
  assert.match(verifySignedRequest, /'credentialHash'\s*=>\s*\(string\)\s*\(\$auth\['credentialHash'\]/);
  assert.match(verifySignedRequest, /'authSignatureHash'\s*=>\s*hash\('sha256',\s*\$expected_auth_signature\)/);
  assert.match(verifySignedRequest, /'pushSignatureHash'\s*=>\s*hash\('sha256',\s*\$expected_push_signature\)/);
  assert.match(bindReceipt, /'dryRunNonceHash'\s*=>\s*\$signed_request\['nonceHash'\]/);
  assert.match(bindReceipt, /'dryRunCanonicalHash'\s*=>\s*\(string\)\s*\(\$signed_request\['request'\]\['canonicalHash'\]/);
  assert.match(bindReceipt, /'dryRunIdempotencyKeyHash'\s*=>\s*\(string\)\s*\(\$signed_request\['request'\]\['idempotencyKeyHash'\]/);
  assert.match(subjectBindingSource, /'scopeHash'\s*=>\s*hash\('sha256',\s*\(string\)\s*\(\$profile\['authScope'\] \?\? ''\)\)/);
  assert.match(subjectBindingSource, /'identityHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$identity\)\)/);
  assert.match(subjectBindingSource, /'authSessionHash'\s*=>\s*hash\('sha256',\s*reprint_push_stable_json\(\$session\)\)/);
  assert.match(subjectBindingSource, /'pushSessionHash'\s*=>\s*\(string\)\s*\(\$signed_request\['sessionHash'\] \?\? ''\)/);
  assert.match(subjectBindingSource, /'planHash'\s*=>\s*\$plan_hash/);
  assert.match(validateReceipt, /Receipt subject binding does not match the current session, identity, scope, and plan hash\./);
});

test('RPP-0573 v4 accepted dry-run receipt binds nonce claim to subject material', async () => {
  const route = createSubjectBoundNonceReplayDryRunRoute();
  const rawBody = JSON.stringify({ plan: readyPlan });
  const headers = signedDryRunHeaders({ rawBody });
  const accepted = await requestLocalRoute(route, headers, rawBody);
  const receipt = accepted.body.receipt;
  const binding = receipt.authBinding;
  const subject = binding.binding;
  const pushSession = binding.pushSession;
  const claim = route.state.acceptedNonceClaims[0];
  const supportEvidence = buildAcceptedSupportEvidence({ response: accepted, state: route.state });

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ok, true);
  assert.equal(route.state.acceptedNonceClaims.length, 1);
  assert.equal(route.state.jsonParseAttempts, 1);
  assert.equal(route.state.dryRunWorkAttempts, 1);
  assert.equal(route.state.receiptMintAttempts, 1);
  assert.equal(route.state.receiptMovementAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);
  assert.equal(claim.acceptedBeforeJsonParse, true);
  assert.equal(claim.planHash, digest(readyPlan));
  assert.equal(claim.subject.planHash, digest(readyPlan));
  assert.equal(claim.subjectHash, digest(claim.subject));
  assert.equal(claim.claimHash, digest(withoutKey(claim, 'claimHash')));

  assert.equal(receipt.receiptHash, digest(withoutKey(receipt, 'receiptHash')));
  assert.equal(receipt.planHash, digest(readyPlan));
  assert.equal(binding.planHash, receipt.planHash);
  assert.equal(binding.request.planHash, receipt.planHash);
  assert.equal(binding.request.planPayloadHash, receipt.planHash);
  assert.equal(binding.plan.planHash, receipt.planHash);
  assert.equal(binding.plan.planPayloadHash, receipt.planHash);
  assert.equal(subject.scopeHash, sha256Hex(authScope));
  assert.equal(subject.identityHash, digest(primaryIdentity));
  assert.equal(subject.authSessionHash, digest(sessionRegistry.get(sessionId).session));
  assert.equal(subject.pushSessionHash, sha256Hex(sessionId));
  assert.equal(subject.planHash, digest(readyPlan));
  assert.equal(subject.bindingHash, digest(withoutKey(subject, 'bindingHash')));
  assert.equal(pushSession.sessionHash, subject.pushSessionHash);
  assert.equal(pushSession.dryRunNonceHash, sha256Hex(signedNonce));
  assert.equal(pushSession.dryRunContentHash, sha256Hex(rawBody));
  assert.equal(pushSession.dryRunCanonicalHash, claim.canonicalRequestHash);
  assert.equal(pushSession.dryRunIdempotencyKeyHash, sha256Hex(idempotencyKey));
  assert.equal(pushSession.nonceClaimHash, claim.claimHash);
  assert.equal(validateReceiptBinding({
    receipt,
    auth: sessionRegistry.get(sessionId),
    plan: readyPlan,
  }).ok, true);

  assert.equal(supportEvidence.ok, true);
  assert.equal(supportEvidence.supportOnly, true);
  assert.equal(supportEvidence.releaseGate, 'NO-GO');
  assert.equal(supportEvidence.releaseMovement.allowed, false);
  assert.equal(supportEvidence.redaction.rawValuesIncluded, false);
  assert.equal(supportEvidence.nonceStore.acceptedNonceCount, 1);
  assert.equal(supportEvidence.nonceStore.replayRejectedCount, 0);
  assert.equal(supportEvidence.nonceStore.acceptedBeforeJsonParse, true);
  assert.equal(supportEvidence.receipt.planHash, supportEvidence.receipt.canonicalPlanHash);
  assert.equal(supportEvidence.receipt.planHash, supportEvidence.subject.planHash);
  assert.equal(supportEvidence.beforeMutation.receiptMovementAttempts, 0);
  assert.equal(supportEvidence.beforeMutation.mutationCapableWorkAttempts, 0);
  assertHashFields(supportEvidence, [
    'proofHash',
    'nonceStore.nonceHash',
    'nonceStore.nonceClaimHash',
    'nonceStore.preParseSubjectHash',
    'nonceStore.subjectHash',
    'receipt.receiptHash',
    'receipt.planHash',
    'receipt.canonicalPlanHash',
    'receipt.bindingHash',
    'receipt.dryRunNonceHash',
    'receipt.dryRunCanonicalHash',
    'receipt.dryRunIdempotencyKeyHash',
    'receipt.nonceClaimHash',
    'subject.sessionHash',
    'subject.identityHash',
    'subject.authSessionHash',
    'subject.scopeHash',
    'subject.planHash',
    'releaseMovement.reasonHash',
  ]);
  assertNoRawValues(supportEvidence, rawValuesForRedaction());
});

test('RPP-0573 v4 replay and subject drift fail before parsing receipt movement or mutation work', async () => {
  const route = createSubjectBoundNonceReplayDryRunRoute();
  const rawBody = JSON.stringify({ plan: readyPlan });
  const headers = signedDryRunHeaders({ rawBody });
  const accepted = await requestLocalRoute(route, headers, rawBody);
  const acceptedReceipt = accepted.body.receipt;

  assert.equal(accepted.status, 200);
  assert.equal(route.state.jsonParseAttempts, 1);
  assert.equal(route.state.receiptMintAttempts, 1);
  assert.equal(route.state.receiptMovementAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);

  const replayCases = [
    {
      kind: 'exact-replay',
      rawBody,
      headers,
    },
    {
      kind: 'session-drift',
      rawBody,
      headers: signedDryRunHeaders({ rawBody, session: sessionDriftId }),
    },
    {
      kind: 'identity-drift',
      rawBody,
      headers: signedDryRunHeaders({
        rawBody,
        session: identityDriftSessionId,
        credential: identityDriftCredential,
      }),
    },
    {
      kind: 'scope-drift',
      rawBody,
      headers: signedDryRunHeaders({ rawBody, session: scopeDriftSessionId }),
    },
    {
      kind: 'plan-drift',
      rawBody: JSON.stringify({ plan: driftPlan }),
      headers: signedDryRunHeaders({ rawBody: JSON.stringify({ plan: driftPlan }) }),
    },
  ];

  const replayRefusals = [];
  for (const replayCase of replayCases) {
    const replayed = await requestLocalRoute(route, replayCase.headers, replayCase.rawBody);
    const refusal = buildReplayRefusalEvidence({
      kind: replayCase.kind,
      response: replayed,
      state: route.state,
    });
    replayRefusals.push(refusal);

    assert.equal(replayed.status, 409, replayCase.kind);
    assert.equal(replayed.body.ok, false, replayCase.kind);
    assert.equal(replayed.body.code, 'SIGNED_NONCE_REPLAYED', replayCase.kind);
    assert.equal(replayed.body.receipt, undefined, replayCase.kind);
    assert.equal(replayed.body.evidence.jsonParsed, false, replayCase.kind);
    assert.equal(replayed.body.evidence.receiptMinted, false, replayCase.kind);
    assert.equal(replayed.body.evidence.receiptMoved, false, replayCase.kind);
    assert.equal(replayed.body.evidence.mutationAttempted, false, replayCase.kind);
    assert.equal(refusal.replayRejected, true, replayCase.kind);
    assert.equal(refusal.stoppedBefore.jsonParseAttempts, 1, replayCase.kind);
    assert.equal(refusal.stoppedBefore.dryRunWorkAttempts, 1, replayCase.kind);
    assert.equal(refusal.stoppedBefore.receiptMintAttempts, 1, replayCase.kind);
    assert.equal(refusal.stoppedBefore.receiptMovementAttempts, 0, replayCase.kind);
    assert.equal(refusal.stoppedBefore.mutationCapableWorkAttempts, 0, replayCase.kind);
    assert.equal(refusal.stoppedBefore.jsonParsedForReplay, false, replayCase.kind);
    assert.equal(refusal.stoppedBefore.receiptMintedForReplay, false, replayCase.kind);
    assert.equal(refusal.stoppedBefore.receiptMovedForReplay, false, replayCase.kind);
    assert.equal(refusal.stoppedBefore.mutationAttemptedForReplay, false, replayCase.kind);
    assertHashFields(refusal, [
      'negativeCaseHash',
      'nonceHash',
      'nonceClaimHash',
      'acceptedSubjectHash',
      'incomingPreParseSubjectHash',
      'driftHash',
      'refusalHash',
      'accepted.sessionHash',
      'accepted.identityHash',
      'accepted.authSessionHash',
      'accepted.scopeHash',
      'accepted.planHash',
      'accepted.contentHash',
      'accepted.canonicalRequestHash',
      'incoming.sessionHash',
      'incoming.identityHash',
      'incoming.authSessionHash',
      'incoming.scopeHash',
      'incoming.contentHash',
      'incoming.canonicalRequestHash',
      'incoming.idempotencyKeyHash',
    ]);
    assertNoRawValues(refusal, rawValuesForRedaction());
  }

  assert.equal(route.state.replayRejectedCount, replayCases.length);
  assert.equal(route.state.acceptedNonceClaims.length, 1);
  assert.equal(route.state.jsonParseAttempts, 1);
  assert.equal(route.state.receiptMintAttempts, 1);
  assert.equal(route.state.receiptMovementAttempts, 0);
  assert.equal(route.state.mutationCapableWorkAttempts, 0);

  const primaryAuth = sessionRegistry.get(sessionId);
  const movementCases = [
    {
      kind: 'movement-session-drift',
      auth: sessionRegistry.get(sessionDriftId),
      plan: readyPlan,
    },
    {
      kind: 'movement-identity-drift',
      auth: sessionRegistry.get(identityDriftSessionId),
      plan: readyPlan,
    },
    {
      kind: 'movement-scope-drift',
      auth: sessionRegistry.get(scopeDriftSessionId),
      plan: readyPlan,
    },
    {
      kind: 'movement-plan-drift',
      auth: primaryAuth,
      plan: driftPlan,
    },
  ];
  const movementRefusals = [];
  for (const movementCase of movementCases) {
    const movement = attemptReceiptMovement({
      receipt: acceptedReceipt,
      auth: movementCase.auth,
      plan: movementCase.plan,
      state: route.state,
    });
    assert.equal(movement.ok, false, movementCase.kind);
    assert.equal(movement.refusal.beforeReceiptMovement, true, movementCase.kind);
    assert.equal(movement.refusal.beforeMutationCapableWork, true, movementCase.kind);
    assert.equal(movement.refusal.receiptMovementAttempts, 0, movementCase.kind);
    assert.equal(movement.refusal.mutationCapableWorkAttempts, 0, movementCase.kind);
    const evidence = buildMovementRefusalEvidence({
      kind: movementCase.kind,
      refusal: movement.refusal,
    });
    movementRefusals.push(evidence);
    assertReceiptEvidenceHashOnly(evidence);
    assertHashFields(evidence, [
      'negativeCaseHash',
      'reasonHash',
      'currentSubjectHash',
      'failedChecksHash',
      'refusalHash',
      'aggregateHash',
    ]);
    assertNoRawValues(evidence, rawValuesForRedaction());
  }

  const aggregate = {
    schemaVersion: 1,
    slice: 'RPP-0573',
    variant: 4,
    supportOnly: true,
    releaseGate: 'NO-GO',
    replayCaseCount: replayRefusals.length,
    movementCaseCount: movementRefusals.length,
    replayRefusalHashes: replayRefusals.map((refusal) => refusal.refusalHash),
    movementRefusalHashes: movementRefusals.map((refusal) => refusal.aggregateHash),
    beforeJsonParse: replayRefusals.every((refusal) => refusal.stoppedBefore.jsonParseAttempts === 1),
    beforeReceiptMovement: movementRefusals.every((refusal) => refusal.beforeReceiptMovement),
    beforeMutationCapableWork: movementRefusals.every((refusal) => refusal.beforeMutationCapableWork)
      && replayRefusals.every((refusal) => refusal.stoppedBefore.mutationCapableWorkAttempts === 0),
  };
  aggregate.aggregateHash = digest(aggregate);

  assert.equal(aggregate.replayCaseCount, 5);
  assert.equal(aggregate.movementCaseCount, 4);
  assert.equal(aggregate.beforeJsonParse, true);
  assert.equal(aggregate.beforeReceiptMovement, true);
  assert.equal(aggregate.beforeMutationCapableWork, true);
  assertHashFields(aggregate, ['aggregateHash']);
  for (const hash of [
    ...aggregate.replayRefusalHashes,
    ...aggregate.movementRefusalHashes,
  ]) {
    assert.match(hash, hashPattern);
  }
  assertNoRawValues(aggregate, rawValuesForRedaction());
});
