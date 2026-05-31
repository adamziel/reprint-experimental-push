import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authenticatedHttpClient } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const fixedSession = 'psh_01j00000000000000000000555';
const idempotencyKey = 'idem-rpp-0555-generated-v3';
const credential = {
  username: 'rpp_0555_admin',
  password: 'rpp-0555-application-password-should-not-leak',
};
const hashPattern = /^[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
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

function requestPath(url) {
  const parsed = new URL(String(url));
  return `${parsed.pathname}${parsed.search}`;
}

function pathOnly(url) {
  return new URL(String(url)).pathname;
}

function routeName(pathname) {
  if (pathname.endsWith('/dry-run')) {
    return 'dry-run';
  }
  if (pathname.endsWith('/apply')) {
    return 'apply';
  }
  if (pathname.endsWith('/recovery/inspect')) {
    return 'recovery-inspect';
  }
  if (pathname.endsWith('/db-journal')) {
    return 'db-journal';
  }
  return 'unknown';
}

function summarizeRequest(request) {
  const headers = request.headers;
  const pathname = pathOnly(request.url);
  const name = routeName(pathname);
  const mutating = name === 'dry-run' || name === 'apply';
  const readOnly = name === 'recovery-inspect' || name === 'db-journal';
  const session = headers['x-reprint-push-session'] || '';
  const observedIdempotencyKey = headers['x-reprint-push-idempotency-key'] || '';
  const requestHash = headers['x-auth-content-hash'] || '';
  const authSignature = headers['x-auth-signature'] || '';
  const pushSignature = headers['x-reprint-push-signature'] || '';

  return {
    route: name,
    method: request.method,
    requestPath: requestPath(request.url),
    mutating,
    readOnly,
    sessionBound: Boolean(session),
    sessionHash: session ? sha256Hex(session) : null,
    idempotencyRequired: mutating,
    idempotencyRejected: readOnly,
    idempotencyKeyPresent: Boolean(observedIdempotencyKey),
    idempotencyKeyHash: observedIdempotencyKey ? sha256Hex(observedIdempotencyKey) : null,
    requestHash: requestHash || null,
    signed: Boolean(authSignature && pushSignature),
    signedHeaderHash: authSignature && pushSignature
      ? digest({
        authSignatureHash: sha256Hex(authSignature),
        pushSignatureHash: sha256Hex(pushSignature),
      })
      : null,
  };
}

function buildRouteEvidence(routeRequests) {
  const routes = routeRequests.map(summarizeRequest);
  const mutatingRoutes = routes.filter((route) => route.mutating);
  const readOnlyRoutes = routes.filter((route) => route.readOnly);
  const mutatingContractOk = mutatingRoutes.length === 2
    && mutatingRoutes.every((route) => (
      route.sessionBound
      && route.idempotencyRequired
      && route.idempotencyKeyPresent
      && route.signed
    ));
  const readOnlyContractOk = readOnlyRoutes.length === 2
    && readOnlyRoutes.every((route) => (
      route.sessionBound
      && route.idempotencyRejected
      && !route.idempotencyKeyPresent
      && route.signed
    ));

  return {
    schemaVersion: 1,
    proofClass: 'generated-idempotency-key-requirement',
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
    mutatingContractOk,
    readOnlyContractOk,
    mutatingRoutes,
    readOnlyRoutes,
    proofHash: digest(routes.map((route) => ({
      route: route.route,
      method: route.method,
      requestPath: route.requestPath,
      mutating: route.mutating,
      readOnly: route.readOnly,
      sessionHash: route.sessionHash,
      idempotencyKeyHash: route.idempotencyKeyHash,
      requestHash: route.requestHash,
      signedHeaderHash: route.signedHeaderHash,
    }))),
  };
}

function rejectionCase({ id, method, route, options, error }) {
  return {
    id,
    method,
    route,
    rejectedBeforeFetch: true,
    rawValueIncluded: false,
    code: errorCode(error),
    errorHash: sha256Hex(error.message),
    sessionHash: options.session ? sha256Hex(options.session) : null,
    idempotencyKeyHash: options.idempotencyKey ? sha256Hex(options.idempotencyKey) : null,
  };
}

function errorCode(error) {
  if (/Missing push idempotencyKey/.test(error.message)) {
    return 'MUTATING_IDEMPOTENCY_KEY_REQUIRED';
  }
  if (/Invalid push idempotencyKey/.test(error.message)) {
    return 'MUTATING_IDEMPOTENCY_KEY_INVALID';
  }
  if (/Read-only signed request must not carry/.test(error.message)) {
    return 'READ_ONLY_IDEMPOTENCY_KEY_REJECTED';
  }
  return 'UNEXPECTED_IDEMPOTENCY_CONTRACT_ERROR';
}

function captureThrow(buildCase) {
  let captured = null;
  assert.throws(() => {
    try {
      buildCase();
    } catch (error) {
      captured = error;
      throw error;
    }
  });
  assert.ok(captured, 'expected a synchronous idempotency contract rejection');
  return captured;
}

function buildIdempotencyRequirementReceipt({
  routeEvidence,
  rejectionEvidence,
  source = sourceUrl,
  capturedAt = '2026-05-31T00:00:00.000Z',
}) {
  const contractOk = routeEvidence.mutatingContractOk
    && routeEvidence.readOnlyContractOk
    && rejectionEvidence.ok === true;
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0555',
    proofClass: 'generated-idempotency-key-requirement',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    ok: contractOk,
    status: contractOk ? 'support_only' : 'blocked',
    code: contractOk
      ? 'LOCAL_IDEMPOTENCY_KEY_REQUIREMENT_SUPPORT_ONLY'
      : 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE',
    capturedAt,
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    sourceSummary: {
      sourceUrlHash: sha256Hex(source),
      rawUrlIncluded: false,
    },
    authSummary: {
      credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
      userLoginHash: sha256Hex(credential.username),
      sessionIdHash: sha256Hex(fixedSession),
      sessionBound: true,
    },
    routeEvidence,
    rejectionEvidence,
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local idempotency-key requirement proof is support-only until checked production evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed idempotency-key requirement proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function buildVerifyReleaseStyleSummary(receipt) {
  const reason = receipt.ok === true
    ? 'PRODUCTION_EVIDENCE_REQUIRED'
    : receipt.code;
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`,
    mutationAttempted: false,
    productionIdempotencyKeyRequirement: {
      ok: receipt.ok === true,
      summaryPath: 'productionIdempotencyKeyRequirement',
      receiptHash: receipt.receiptHash,
      routeEvidence: receipt.routeEvidence,
      rejectionEvidence: receipt.rejectionEvidence,
      redaction: receipt.redaction,
      required: [
        'mutating signed requests carry one idempotency key',
        'mutating signed requests fail closed without an idempotency key',
        'read-only signed routes carry no mutating idempotency key',
        'read-only signed routes fail closed when an idempotency key is supplied',
        'hash-only route evidence',
      ],
      scope: receipt.evidenceScope,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: receipt.ok === true
        ? 'production-backed idempotency-key requirement proof required before release movement'
        : 'idempotency-key requirement proof is incomplete',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed idempotency-key requirement proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function collectIdempotencyRouteEvidenceBlocks(value, blocks = []) {
  if (!value || typeof value !== 'object') {
    return blocks;
  }
  if (value.proofClass === 'generated-idempotency-key-requirement' && value.routeProfile === 'production-shaped') {
    blocks.push(value);
  }
  for (const child of Object.values(value)) {
    collectIdempotencyRouteEvidenceBlocks(child, blocks);
  }
  return blocks;
}

function assertHashFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertHashWhenPresent(value, fields) {
  for (const field of fields) {
    if (value[field] !== null && value[field] !== undefined) {
      assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
    }
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `generated support evidence leaked raw value ${rawValue}`,
    );
  }
}

test('RPP-0555 v3 generated route evidence keeps mutating idempotency bound and read-only idempotency-free', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options = {}) => {
    seen.push({
      url: String(url),
      method: options.method || 'GET',
      headers: headerEntries(options.headers || {}),
      rawBody: typeof options.body === 'string' ? options.body : '',
    });
    return jsonResponse({ ok: true });
  };

  try {
    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 1_000,
    });
    const planBody = { plan: { id: 'plan-rpp-0555-generated-v3' } };

    await client.signedPost('/dry-run', planBody, {
      session: fixedSession,
      idempotencyKey,
    });
    await client.signedPost('/apply', {
      ...planBody,
      receipt: { receiptHash: sha256Hex('rpp-0555-dry-run-receipt') },
    }, {
      session: fixedSession,
      idempotencyKey,
    });
    await client.signedPost('/recovery/inspect', planBody, {
      session: fixedSession,
      readOnly: true,
    });
    await client.signedGet('/db-journal?limit=80', {
      session: fixedSession,
      readOnly: true,
      retryable: true,
    });

    const routeEvidence = buildRouteEvidence(seen);
    const rejectionEvidence = buildGeneratedRejectionEvidence(client);
    const receipt = buildIdempotencyRequirementReceipt({ routeEvidence, rejectionEvidence });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
    const routeEvidenceBlocks = collectIdempotencyRouteEvidenceBlocks(verifyReleaseSummary);
    const rawHeaderValues = seen.flatMap((request) => [
      request.headers.authorization,
      request.headers['x-reprint-push-session'],
      request.headers['x-reprint-push-idempotency-key'],
      request.headers['x-auth-signature'],
      request.headers['x-reprint-push-signature'],
      request.headers['x-auth-nonce'],
      request.rawBody,
    ]);

    assert.deepEqual(
      seen.map((request) => `${request.method} ${requestPath(request.url)}`),
      [
        `POST ${routePrefix}/dry-run`,
        `POST ${routePrefix}/apply`,
        `POST ${routePrefix}/recovery/inspect`,
        `GET ${routePrefix}/db-journal?limit=80`,
      ],
    );
    assert.equal(routeEvidence.mutatingContractOk, true);
    assert.equal(routeEvidence.readOnlyContractOk, true);
    assert.deepEqual(routeEvidence.mutatingRoutes.map((route) => route.route), ['dry-run', 'apply']);
    assert.deepEqual(routeEvidence.readOnlyRoutes.map((route) => route.route), ['recovery-inspect', 'db-journal']);
    assert.deepEqual(
      routeEvidence.mutatingRoutes.map((route) => route.idempotencyKeyPresent),
      [true, true],
    );
    assert.deepEqual(
      routeEvidence.readOnlyRoutes.map((route) => route.idempotencyKeyPresent),
      [false, false],
    );
    for (const route of [...routeEvidence.mutatingRoutes, ...routeEvidence.readOnlyRoutes]) {
      assertHashWhenPresent(route, [
        'sessionHash',
        'idempotencyKeyHash',
        'requestHash',
        'signedHeaderHash',
      ]);
    }
    assertHashFields(routeEvidence, ['proofHash']);

    assert.equal(rejectionEvidence.ok, true);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.status, 'support_only');
    assert.equal(receipt.releaseStatus, 'NO-GO');
    assert.equal(receipt.releaseMovement.allowed, false);
    assertHashFields(receipt.sourceSummary, ['sourceUrlHash']);
    assertHashFields(receipt.authSummary, ['credentialHash', 'userLoginHash', 'sessionIdHash']);
    assert.match(receipt.receiptHash, hashPattern);

    assert.equal(verifyReleaseSummary.ok, false);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
    assert.equal(verifyReleaseSummary.productionIdempotencyKeyRequirement.ok, true);
    assert.equal(routeEvidenceBlocks.length, 1);
    assert.deepEqual(
      routeEvidenceBlocks[0],
      verifyReleaseSummary.productionIdempotencyKeyRequirement.routeEvidence,
    );
    assertNoRawValues(verifyReleaseSummary, [
      sourceUrl,
      credential.username,
      credential.password,
      fixedSession,
      idempotencyKey,
      ...rawHeaderValues,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0555 v3 generated negative matrix fails closed before transport for idempotency contract drift', () => {
  const client = authenticatedHttpClient({
    sourceUrl,
    credential,
    routeProfile: 'production-shaped',
    requestTimeoutMs: 1,
  });
  const rejectionEvidence = buildGeneratedRejectionEvidence(client);
  const routeEvidence = {
    schemaVersion: 1,
    proofClass: 'generated-idempotency-key-requirement',
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
    mutatingContractOk: true,
    readOnlyContractOk: true,
    mutatingRoutes: [],
    readOnlyRoutes: [],
    proofHash: digest(rejectionEvidence.cases),
  };
  const receipt = buildIdempotencyRequirementReceipt({ routeEvidence, rejectionEvidence });
  const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
  const routeEvidenceBlocks = collectIdempotencyRouteEvidenceBlocks(verifyReleaseSummary);

  assert.equal(rejectionEvidence.ok, true);
  assert.deepEqual(
    rejectionEvidence.cases.map((entry) => entry.code),
    [
      'MUTATING_IDEMPOTENCY_KEY_REQUIRED',
      'MUTATING_IDEMPOTENCY_KEY_REQUIRED',
      'MUTATING_IDEMPOTENCY_KEY_INVALID',
      'READ_ONLY_IDEMPOTENCY_KEY_REJECTED',
      'READ_ONLY_IDEMPOTENCY_KEY_REJECTED',
    ],
  );
  assert.deepEqual(
    rejectionEvidence.cases.map((entry) => entry.rejectedBeforeFetch),
    [true, true, true, true, true],
  );
  for (const entry of rejectionEvidence.cases) {
    assertHashFields(entry, ['errorHash']);
    assertHashWhenPresent(entry, ['sessionHash', 'idempotencyKeyHash']);
    assert.equal(entry.rawValueIncluded, false);
  }
  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.productionIdempotencyKeyRequirement.rejectionEvidence.ok, true);
  assert.equal(routeEvidenceBlocks.length, 1);
  assertNoRawValues(verifyReleaseSummary, [
    sourceUrl,
    credential.username,
    credential.password,
    fixedSession,
    idempotencyKey,
  ]);
});

test('RPP-0555 v3 generated summary rejects spoofed idempotency success without route evidence', () => {
  const incompleteRouteEvidence = {
    schemaVersion: 1,
    proofClass: 'generated-idempotency-key-requirement',
    routeProfile: 'production-shaped',
    restNamespace: 'reprint/v1',
    routePrefix: '/push',
    mutatingContractOk: false,
    readOnlyContractOk: false,
    mutatingRoutes: [],
    readOnlyRoutes: [],
    proofHash: digest([]),
  };
  const rejectionEvidence = {
    ok: true,
    cases: [],
    proofHash: digest([]),
  };
  const receipt = buildIdempotencyRequirementReceipt({
    routeEvidence: incompleteRouteEvidence,
    rejectionEvidence,
  });
  const verifyReleaseSummary = buildVerifyReleaseStyleSummary(receipt);
  const routeEvidenceBlocks = collectIdempotencyRouteEvidenceBlocks(verifyReleaseSummary);

  assert.equal(receipt.ok, false);
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.code, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
  assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
  assert.equal(verifyReleaseSummary.statusMarker, '[verify-release:held exit=1 reason=IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE mutationAttempted=false]');
  assert.equal(verifyReleaseSummary.productionIdempotencyKeyRequirement.ok, false);
  assert.equal(verifyReleaseSummary.releaseMovement.allowed, false);
  assert.equal(verifyReleaseSummary.boundary.verdict, 'IDEMPOTENCY_KEY_REQUIREMENT_INCOMPLETE');
  assert.equal(routeEvidenceBlocks.length, 1);
});

function buildGeneratedRejectionEvidence(client) {
  const cases = [];
  const missingDryRunOptions = { session: fixedSession };
  const missingApplyOptions = { session: fixedSession };
  const invalidApplyOptions = { session: fixedSession, idempotencyKey: '   ' };
  const readOnlyInspectOptions = { session: fixedSession, readOnly: true, idempotencyKey };
  const readOnlyJournalOptions = { session: fixedSession, readOnly: true, idempotencyKey };

  cases.push(rejectionCase({
    id: 'dry-run-missing-idempotency-key',
    method: 'POST',
    route: '/push/dry-run',
    options: missingDryRunOptions,
    error: captureThrow(() => client.signedPost('/dry-run', { plan: { id: 'missing-dry-run' } }, missingDryRunOptions)),
  }));
  cases.push(rejectionCase({
    id: 'apply-missing-idempotency-key',
    method: 'POST',
    route: '/push/apply',
    options: missingApplyOptions,
    error: captureThrow(() => client.signedPost('/apply', { plan: { id: 'missing-apply' } }, missingApplyOptions)),
  }));
  cases.push(rejectionCase({
    id: 'apply-invalid-idempotency-key',
    method: 'POST',
    route: '/push/apply',
    options: invalidApplyOptions,
    error: captureThrow(() => client.signedPost('/apply', { plan: { id: 'invalid-apply' } }, invalidApplyOptions)),
  }));
  cases.push(rejectionCase({
    id: 'recovery-inspect-read-only-rejects-idempotency-key',
    method: 'POST',
    route: '/push/recovery/inspect',
    options: readOnlyInspectOptions,
    error: captureThrow(() => client.signedPost('/recovery/inspect', { plan: { id: 'read-only-inspect' } }, readOnlyInspectOptions)),
  }));
  cases.push(rejectionCase({
    id: 'db-journal-read-only-rejects-idempotency-key',
    method: 'GET',
    route: '/push/db-journal?limit=80',
    options: readOnlyJournalOptions,
    error: captureThrow(() => client.signedGet('/db-journal?limit=80', readOnlyJournalOptions)),
  }));

  return {
    ok: cases.length === 5
      && cases.every((entry) => entry.rejectedBeforeFetch === true)
      && cases.some((entry) => entry.code === 'MUTATING_IDEMPOTENCY_KEY_REQUIRED')
      && cases.some((entry) => entry.code === 'READ_ONLY_IDEMPOTENCY_KEY_REJECTED'),
    cases,
    proofHash: digest(cases),
  };
}
