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
const sha256Pattern = /^[a-f0-9]{64}$/;
const skewSeconds = 300;
const fixedNowSeconds = 1_716_500_060;
const fixedTimestamp = '1716500000';
const checkedCommand = 'timeout 300s npm run verify:release';
const proofCapturedAt = '2026-05-31T15:00:00.000Z';
const sessionId = `psh_${fixtureHash('session-id').slice(0, 30)}`;
const idempotencyKey = `idem-${fixtureHash('idempotency-key').slice(0, 32)}`;
const validDryRunRawBody = JSON.stringify({
  plan: {
    id: `plan-${fixtureHash('dry-run-plan').slice(0, 12)}`,
    mutations: [],
  },
});
const validApplyRawBody = JSON.stringify({
  plan: {
    id: `plan-${fixtureHash('apply-plan').slice(0, 12)}`,
    mutations: [
      {
        id: `mutation-${fixtureHash('mutation-id').slice(0, 12)}`,
        resourceKey: fixtureHash('resource-key'),
      },
    ],
  },
  receipt: {
    receiptHash: fixtureHash('receipt'),
    planHash: fixtureHash('apply-plan-hash'),
  },
});
const malformedRawBody = '{"plan":';
const credential = {
  username: `u_${fixtureHash('principal').slice(0, 20)}`,
  password: fixtureHash('application-password'),
};
const credentialHash = sha256Hex(`${credential.username}\n${credential.password}`);
const signingKey = hmacHex(credential.password, `reprint-push-lab-v1\n${credential.username}`);
const signingKeyHash = sha256Hex(signingKey);
const sourceHash = fixtureHash('source');
const sourceUrlHash = fixtureHash('source-url');
const identityHash = fixtureHash('identity');
const validSession = {
  id: sessionId,
  sessionHash: sha256Hex(sessionId),
  credentialHash,
  signingKeyHash,
  identityHash,
  capabilityGranted: true,
  requiredCapability: 'manage_options',
  capabilityHash: fixtureHash('capability-granted'),
  sourceHash,
  sourceUrlHash,
  expiresAtUnix: fixedNowSeconds + 120,
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
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`rpp-0592:${label}`);
}

function base64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function authHeader() {
  return `Basic ${base64(`${credential.username}:${credential.password}`)}`;
}

function rawUrlDecodeQueryPart(value) {
  return decodeURIComponent(String(value).replace(/\+/g, '%20'));
}

function rawUrlEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(query) {
  if (!query) {
    return '';
  }

  return query
    .split('&')
    .map((part, index) => {
      if (!part) {
        return null;
      }
      const [key, value = ''] = part.split('=', 2);
      return {
        key: rawUrlDecodeQueryPart(key),
        value: rawUrlDecodeQueryPart(value),
        index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.key !== right.key) {
        return left.key < right.key ? -1 : 1;
      }
      if (left.value !== right.value) {
        return left.value < right.value ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((pair) => `${rawUrlEncode(pair.key)}=${rawUrlEncode(pair.value)}`)
    .join('&');
}

function pushCanonicalString({ method, pathname, contentHash, session, idempotencyKey: requestIdempotencyKey }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    canonicalQuery(rawQuery),
    contentHash,
    session,
    requestIdempotencyKey,
  ].join('\n');
}

function rawQueryPushString({ method, pathname, contentHash, session, idempotencyKey: requestIdempotencyKey }) {
  const [rawPath, rawQuery = ''] = pathname.split('?', 2);
  return [
    'REPRINT-PUSH-LAB-V1',
    method.toUpperCase(),
    rawPath || '/',
    rawQuery,
    contentHash,
    session,
    requestIdempotencyKey,
  ].join('\n');
}

function lowerCaseHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function signatureHeader(hex, format = 'hex') {
  if (format === 'prefixed') {
    return `sha256=${hex}`;
  }
  if (format === 'base64') {
    return Buffer.from(hex, 'hex').toString('base64');
  }
  return hex;
}

function signatureMatches(supplied, expectedHex) {
  let normalized = String(supplied || '').trim().toLowerCase();
  if (normalized.startsWith('sha256=')) {
    normalized = normalized.slice('sha256='.length);
  }
  if (/^[a-f0-9]{64}$/.test(normalized)) {
    return normalized === expectedHex;
  }

  const decoded = Buffer.from(String(supplied || ''), 'base64');
  return decoded.length > 0 && decoded.equals(Buffer.from(expectedHex, 'hex'));
}

function buildSignedRequest({
  method = 'POST',
  pathname = '/wp-json/reprint/v1/push/apply',
  rawBody = validApplyRawBody,
  session = sessionId,
  requestIdempotencyKey = idempotencyKey,
  nonce = 'rpp-0592-nonce-0001',
  timestamp = fixedTimestamp,
  pushSignatureFormat = 'hex',
  authSignatureFormat = 'hex',
} = {}) {
  const contentHash = sha256Hex(rawBody);
  const authString = `${nonce}${timestamp}${contentHash}`;
  const pushCanonical = pushCanonicalString({
    method,
    pathname,
    contentHash,
    session,
    idempotencyKey: requestIdempotencyKey,
  });
  const authSignatureHex = hmacHex(signingKey, authString);
  const pushSignatureHex = hmacHex(signingKey, pushCanonical);

  return {
    method,
    pathname,
    rawBody,
    headers: lowerCaseHeaders({
      authorization: authHeader(),
      'X-Auth-Content-Hash': contentHash,
      'X-Auth-Timestamp': timestamp,
      'X-Auth-Nonce': nonce,
      'X-Auth-Signature': signatureHeader(authSignatureHex, authSignatureFormat),
      'X-Reprint-Push-Signature': signatureHeader(pushSignatureHex, pushSignatureFormat),
      'X-Reprint-Push-Session': session,
      'X-Reprint-Push-Idempotency-Key': requestIdempotencyKey,
    }),
    expected: {
      authSignatureHex,
      pushCanonicalHash: sha256Hex(pushCanonical),
      pushSignatureHex,
    },
  };
}

function newVerifierState() {
  return {
    nonceClaims: new Set(),
    sessions: new Map([[sessionId, { ...validSession }]]),
    counters: {
      jsonParse: 0,
      nonceClaim: 0,
      receiptMint: 0,
      receiptValidate: 0,
      dbJournalOpen: 0,
      dbJournalAppend: 0,
      mutation: 0,
    },
  };
}

function signatureFailure(code, status, extra = {}) {
  return {
    ok: false,
    code,
    status,
    signature: {
      required: true,
      status,
    },
    ...extra,
  };
}

function parseSignedTimestamp(timestamp) {
  if (/^\d{10}$/.test(timestamp)) {
    return Number(timestamp);
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function verifySignedRequest(request, mode, state) {
  const headers = lowerCaseHeaders(request.headers);
  if (headers.authorization !== authHeader()) {
    return signatureFailure('SIGNED_AUTH_UNAVAILABLE', 401);
  }

  const contentHash = String(headers['x-auth-content-hash'] || '').trim().toLowerCase();
  const timestamp = String(headers['x-auth-timestamp'] || '').trim();
  const nonce = String(headers['x-auth-nonce'] || '').trim();
  const authSignature = String(headers['x-auth-signature'] || '').trim();
  const pushSignature = String(headers['x-reprint-push-signature'] || '').trim();
  const session = String(headers['x-reprint-push-session'] || '').trim();
  const requestIdempotencyKey = String(headers['x-reprint-push-idempotency-key'] || '').trim();

  for (const [header, value] of [
    ['X-Auth-Content-Hash', contentHash],
    ['X-Auth-Timestamp', timestamp],
    ['X-Auth-Nonce', nonce],
    ['X-Auth-Signature', authSignature],
    ['X-Reprint-Push-Signature', pushSignature],
  ]) {
    if (value === '') {
      return signatureFailure('SIGNED_HEADER_REQUIRED', 401, { header });
    }
  }

  if (mode !== 'preflight') {
    if (session === '') {
      return signatureFailure('SIGNED_SESSION_REQUIRED', 401);
    }
    if (requestIdempotencyKey === '') {
      return signatureFailure('MISSING_IDEMPOTENCY_KEY', 400);
    }
  }

  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    return signatureFailure('SIGNED_CONTENT_HASH_INVALID', 400);
  }
  if (sha256Hex(request.rawBody) !== contentHash) {
    return signatureFailure('SIGNED_CONTENT_HASH_MISMATCH', 401);
  }

  const timestampSeconds = parseSignedTimestamp(timestamp);
  if (timestampSeconds === null || Math.abs(fixedNowSeconds - timestampSeconds) > skewSeconds) {
    return signatureFailure('SIGNED_TIMESTAMP_INVALID', 401);
  }

  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) {
    return signatureFailure('SIGNED_NONCE_INVALID', 400);
  }

  const expectedAuthSignature = hmacHex(signingKey, `${nonce}${timestamp}${contentHash}`);
  if (!signatureMatches(authSignature, expectedAuthSignature)) {
    return signatureFailure('SIGNED_AUTH_SIGNATURE_MISMATCH', 401);
  }

  let signedSession = null;
  if (mode !== 'preflight') {
    signedSession = state.sessions.get(session);
    if (!signedSession) {
      return signatureFailure('SIGNED_SESSION_INVALID', 401);
    }
    if (signedSession.expiresAtUnix < fixedNowSeconds) {
      return signatureFailure('SIGNED_SESSION_EXPIRED', 401);
    }
    if (signedSession.capabilityGranted !== true) {
      return signatureFailure('SIGNED_SESSION_CAPABILITY_DOWNGRADED', 403);
    }
    if (
      signedSession.credentialHash !== credentialHash
      || signedSession.signingKeyHash !== signingKeyHash
      || signedSession.identityHash !== identityHash
      || signedSession.sourceHash !== sourceHash
      || signedSession.sourceUrlHash !== sourceUrlHash
    ) {
      return signatureFailure('SIGNED_SESSION_BINDING_MISMATCH', 401);
    }
  }

  const canonical = pushCanonicalString({
    method: request.method,
    pathname: request.pathname,
    contentHash,
    session: mode === 'preflight' ? '' : session,
    idempotencyKey: mode === 'preflight' ? '' : requestIdempotencyKey,
  });
  const expectedPushSignature = hmacHex(signingKey, canonical);
  if (!signatureMatches(pushSignature, expectedPushSignature)) {
    return signatureFailure('SIGNED_PUSH_SIGNATURE_MISMATCH', 401, {
      canonicalHash: sha256Hex(canonical),
    });
  }

  const nonceHash = sha256Hex(nonce);
  state.counters.nonceClaim += 1;
  if (state.nonceClaims.has(nonceHash)) {
    return signatureFailure('SIGNED_NONCE_REPLAYED', 409);
  }
  state.nonceClaims.add(nonceHash);

  return {
    ok: true,
    status: 200,
    signature: {
      schemaVersion: 1,
      contentHash,
      nonceHash,
      sessionHash: signedSession?.sessionHash || '',
      signingKeyHash,
      request: {
        method: request.method.toUpperCase(),
        path: request.pathname.split('?', 2)[0] || '/',
        canonicalQuery: canonicalQuery(request.pathname.split('?', 2)[1] || ''),
        idempotencyKeyHash: requestIdempotencyKey ? sha256Hex(requestIdempotencyKey) : '',
        canonicalHash: sha256Hex(canonical),
      },
    },
  };
}

function runAuthenticatedRoute(request, mode, state) {
  const verification = verifySignedRequest(request, mode, state);
  if (verification.ok !== true) {
    return {
      ...verification,
      counters: { ...state.counters },
    };
  }

  state.counters.jsonParse += 1;
  let payload;
  try {
    payload = JSON.parse(request.rawBody);
  } catch {
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      status: 400,
      counters: { ...state.counters },
    };
  }

  if (mode === 'dry-run') {
    state.counters.receiptMint += 1;
  }
  if (mode === 'apply') {
    state.counters.receiptValidate += 1;
    state.counters.dbJournalOpen += 1;
    state.counters.dbJournalAppend += 1;
    state.counters.mutation += 1;
  }

  return {
    ok: true,
    status: 200,
    payloadHash: digest(payload),
    signature: verification.signature,
    counters: { ...state.counters },
  };
}

function hashOnlyEnvelope({ canonicalResults, positiveResults, negativeResults }) {
  return {
    schemaVersion: 1,
    slice: 'RPP-0592',
    variant: 5,
    status: 'support_only',
    generatedAt: '2026-05-31T00:00:00.000Z',
    canonicalGroups: canonicalResults.map((result) => ({
      caseHash: fixtureHash(`canonical:${result.name}`),
      methodHash: sha256Hex(result.method),
      leftRequestHash: digest({
        canonicalHash: result.left.signature.request.canonicalHash,
        canonicalQueryHash: sha256Hex(result.left.signature.request.canonicalQuery),
      }),
      rightRequestHash: digest({
        canonicalHash: result.right.signature.request.canonicalHash,
        canonicalQueryHash: sha256Hex(result.right.signature.request.canonicalQuery),
      }),
      normalizedCanonicalHash: result.left.signature.request.canonicalHash,
      normalizedQueryHash: sha256Hex(result.left.signature.request.canonicalQuery),
      pushSignatureHash: sha256Hex(result.pushSignatureHex),
      rawValuesIncluded: false,
    })),
    positivePaths: positiveResults.map((result) => ({
      caseHash: fixtureHash(`positive:${result.name}`),
      modeHash: sha256Hex(result.mode),
      requestHash: digest({
        bodyHash: sha256Hex(result.request.rawBody),
        pathHash: sha256Hex(result.request.pathname),
        methodHash: sha256Hex(result.request.method),
      }),
      payloadHash: result.payloadHash,
      canonicalHash: result.signature.request.canonicalHash,
      countersHash: digest(result.counters),
      rawValuesIncluded: false,
    })),
    negativeCases: negativeResults.map((result) => ({
      caseHash: fixtureHash(`negative:${result.name}`),
      code: result.code,
      status: result.status,
      requestHash: digest({
        bodyHash: sha256Hex(result.request.rawBody),
        pathHash: sha256Hex(result.request.pathname),
        methodHash: sha256Hex(result.request.method),
      }),
      parsedJson: result.counters.jsonParse > 0,
      nonceClaimed: result.counters.nonceClaim > 0,
      receiptMinted: result.counters.receiptMint > 0,
      receiptValidated: result.counters.receiptValidate > 0,
      dbJournalOpened: result.counters.dbJournalOpen > 0,
      dbJournalAppended: result.counters.dbJournalAppend > 0,
      mutated: result.counters.mutation > 0,
      receiptWorkStarted: result.counters.receiptMint > 0
        || result.counters.receiptValidate > 0,
      mutationCapableWorkStarted: result.counters.dbJournalOpen > 0
        || result.counters.dbJournalAppend > 0
        || result.counters.mutation > 0,
      releaseMovementAllowed: false,
      rawValuesIncluded: false,
    })),
  };
}

function validHash(value) {
  return sha256Pattern.test(String(value || ''));
}

function buildCanonicalizationReceipt(envelope, routeAssertionCount) {
  const canonicalOk = envelope.canonicalGroups.length === 4
    && envelope.canonicalGroups.every((entry) => (
      validHash(entry.caseHash)
      && validHash(entry.methodHash)
      && validHash(entry.leftRequestHash)
      && validHash(entry.rightRequestHash)
      && validHash(entry.normalizedCanonicalHash)
      && validHash(entry.normalizedQueryHash)
      && validHash(entry.pushSignatureHash)
      && entry.rawValuesIncluded === false
    ));
  const positiveOk = envelope.positivePaths.length === 2
    && envelope.positivePaths.every((entry) => (
      validHash(entry.caseHash)
      && validHash(entry.modeHash)
      && validHash(entry.requestHash)
      && validHash(entry.payloadHash)
      && validHash(entry.canonicalHash)
      && validHash(entry.countersHash)
      && entry.rawValuesIncluded === false
    ));
  const negativeOk = envelope.negativeCases.length >= 24
    && envelope.negativeCases.every((entry) => (
      validHash(entry.caseHash)
      && validHash(entry.requestHash)
      && entry.parsedJson === false
      && entry.receiptMinted === false
      && entry.receiptValidated === false
      && entry.dbJournalOpened === false
      && entry.dbJournalAppended === false
      && entry.mutated === false
      && entry.receiptWorkStarted === false
      && entry.mutationCapableWorkStarted === false
      && entry.releaseMovementAllowed === false
      && entry.rawValuesIncluded === false
    ));
  const sourceOk = routeAssertionCount >= 8;
  const ok = canonicalOk && positiveOk && negativeOk && sourceOk;
  const receiptCore = {
    schemaVersion: 1,
    slice: 'RPP-0592',
    variant: 5,
    proofClass: 'request-signature-canonicalization-release-verifier-v5',
    evidenceScope: 'local-executor-auth-support',
    releaseStatus: 'NO-GO',
    ok,
    status: ok ? 'support_only' : 'blocked',
    code: ok
      ? 'LOCAL_REQUEST_SIGNATURE_CANONICALIZATION_V5_SUPPORT_ONLY'
      : 'REQUEST_SIGNATURE_CANONICALIZATION_INCOMPLETE',
    capturedAtHash: sha256Hex(proofCapturedAt),
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
    },
    canonicalProof: {
      groupCount: envelope.canonicalGroups.length,
      acceptedOnlyAfterCanonicalSignature: canonicalOk,
      proofHash: digest(envelope.canonicalGroups),
    },
    positiveProof: {
      pathCount: envelope.positivePaths.length,
      parseAfterSignatureProof: positiveOk,
      receiptAfterSignatureProof: positiveOk,
      mutationAfterSignatureProof: positiveOk,
      proofHash: digest(envelope.positivePaths),
    },
    negativeProof: {
      caseCount: envelope.negativeCases.length,
      malformedTamperedStaleOrDrifted: true,
      rejectedBeforeJsonParsing: negativeOk,
      rejectedBeforeReceiptWork: negativeOk,
      rejectedBeforeMutationCapableWork: negativeOk,
      rejectedBeforeReleaseMovement: negativeOk,
      proofHash: digest(envelope.negativeCases),
    },
    sourceAssertions: {
      routeAssertionCount,
      verifierBeforeJsonReceiptMutation: sourceOk,
      proofHash: fixtureHash(`route-order:${routeAssertionCount}`),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'local request signature canonicalization proof is support-only until checked production evidence exists',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production request signature canonicalization proof',
      status: 'blocked',
      verdict: ok ? 'PRODUCTION_EVIDENCE_REQUIRED' : 'REQUEST_SIGNATURE_CANONICALIZATION_INCOMPLETE',
    },
  };

  return {
    ...receiptCore,
    receiptHash: digest(receiptCore),
  };
}

function buildVerifyReleaseStyleSummary(receipt) {
  const reason = receipt.ok === true ? 'PRODUCTION_EVIDENCE_REQUIRED' : receipt.code;
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    commandHash: sha256Hex('npm run verify:release'),
    checkedCommandHash: sha256Hex(checkedCommand),
    statusMarker: `[verify-release:held exit=1 reason=${reason} mutationAttempted=false]`,
    mutationAttempted: false,
    productionRequestSignatureCanonicalization: {
      ok: receipt.ok === true,
      summaryPath: 'productionRequestSignatureCanonicalization',
      receiptHash: receipt.receiptHash,
      canonicalProof: receipt.canonicalProof,
      positiveProof: receipt.positiveProof,
      negativeProof: receipt.negativeProof,
      sourceAssertions: receipt.sourceAssertions,
      redaction: receipt.redaction,
      requiredHash: digest([
        'canonical query normalization before push HMAC verification',
        'malformed signed requests fail before JSON parsing',
        'tampered signed requests fail before receipt work',
        'stale signed requests fail before mutation-capable work',
        'drifted signed evidence cannot move release gates',
      ]),
      scopeHash: sha256Hex(receipt.evidenceScope),
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: receipt.ok === true
        ? 'production-backed request signature canonicalization proof required before release movement'
        : 'request signature canonicalization proof is incomplete',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production request signature canonicalization proof',
      status: 'blocked',
      verdict: reason,
    },
  };
}

function collectCanonicalizationSummaries(value, summaries = []) {
  if (!value || typeof value !== 'object') {
    return summaries;
  }
  if (
    value.summaryPath === 'productionRequestSignatureCanonicalization'
    && value.ok === true
  ) {
    summaries.push(value);
  }
  for (const child of Object.values(value)) {
    collectCanonicalizationSummaries(child, summaries);
  }
  return summaries;
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(serialized.includes(rawValue), false, `support evidence leaked raw value ${rawValue}`);
  }
}

function validHashOnlyEnvelopeFixture() {
  return {
    schemaVersion: 1,
    slice: 'RPP-0592',
    variant: 5,
    status: 'support_only',
    generatedAt: '2026-05-31T00:00:00.000Z',
    canonicalGroups: Array.from({ length: 4 }, (_, index) => ({
      caseHash: fixtureHash(`summary-canonical-case-${index}`),
      methodHash: fixtureHash(`summary-canonical-method-${index}`),
      leftRequestHash: fixtureHash(`summary-canonical-left-${index}`),
      rightRequestHash: fixtureHash(`summary-canonical-right-${index}`),
      normalizedCanonicalHash: fixtureHash(`summary-canonical-normalized-${index}`),
      normalizedQueryHash: fixtureHash(`summary-canonical-query-${index}`),
      pushSignatureHash: fixtureHash(`summary-canonical-signature-${index}`),
      rawValuesIncluded: false,
    })),
    positivePaths: Array.from({ length: 2 }, (_, index) => ({
      caseHash: fixtureHash(`summary-positive-case-${index}`),
      modeHash: fixtureHash(`summary-positive-mode-${index}`),
      requestHash: fixtureHash(`summary-positive-request-${index}`),
      payloadHash: fixtureHash(`summary-positive-payload-${index}`),
      canonicalHash: fixtureHash(`summary-positive-canonical-${index}`),
      countersHash: fixtureHash(`summary-positive-counters-${index}`),
      rawValuesIncluded: false,
    })),
    negativeCases: Array.from({ length: 28 }, (_, index) => ({
      caseHash: fixtureHash(`summary-negative-case-${index}`),
      code: index % 2 === 0 ? 'SIGNED_PUSH_SIGNATURE_MISMATCH' : 'SIGNED_TIMESTAMP_INVALID',
      status: index % 3 === 0 ? 400 : 401,
      requestHash: fixtureHash(`summary-negative-request-${index}`),
      parsedJson: false,
      nonceClaimed: false,
      receiptMinted: false,
      receiptValidated: false,
      dbJournalOpened: false,
      dbJournalAppended: false,
      mutated: false,
      receiptWorkStarted: false,
      mutationCapableWorkStarted: false,
      releaseMovementAllowed: false,
      rawValuesIncluded: false,
    })),
  };
}

test('RPP-0592 v5 release verifier accepts normalized request shapes only after canonical signature proof', () => {
  const canonicalCases = [
    {
      name: 'sorts-query-keys-and-drops-empty-segments',
      method: 'get',
      leftPath: '/wp-json/reprint/v1/push/db-journal?z=1&&a=2',
      rightPath: '/wp-json/reprint/v1/push/db-journal?a=2&z=1',
      expectedQuery: 'a=2&z=1',
      rawBody: '',
      leftFormat: 'hex',
      rightFormat: 'prefixed',
    },
    {
      name: 'normalizes-plus-percent-and-rfc3986-encoding',
      method: 'GET',
      leftPath: '/wp-json/reprint/v1/push/db-journal?q=hello+world&mark=%7E%21',
      rightPath: '/wp-json/reprint/v1/push/db-journal?mark=~%21&q=hello%20world',
      expectedQuery: 'mark=~%21&q=hello%20world',
      rawBody: '',
      leftFormat: 'base64',
      rightFormat: 'hex',
    },
    {
      name: 'sorts-duplicate-values-as-a-multiset',
      method: 'GET',
      leftPath: '/wp-json/reprint/v1/push/db-journal?scope=write&scope=read&limit=080&scope=read',
      rightPath: '/wp-json/reprint/v1/push/db-journal?scope=read&limit=080&scope=write&scope=read',
      expectedQuery: 'limit=080&scope=read&scope=read&scope=write',
      rawBody: '',
      leftFormat: 'prefixed',
      rightFormat: 'base64',
    },
    {
      name: 'normalizes-empty-values-and-encoded-slashes',
      method: 'POST',
      leftPath: '/wp-json/reprint/v1/push/apply?empty=&weird=a%2Fb&space=a+b&flag',
      rightPath: '/wp-json/reprint/v1/push/apply?flag=&space=a%20b&weird=a%2Fb&empty',
      expectedQuery: 'empty=&flag=&space=a%20b&weird=a%2Fb',
      rawBody: validApplyRawBody,
      leftFormat: 'hex',
      rightFormat: 'hex',
    },
  ];

  const results = canonicalCases.map((canonicalCase, index) => {
    const nonce = `rpp-0592-canon-${String(index).padStart(2, '0')}`;
    const leftRequest = buildSignedRequest({
      method: canonicalCase.method,
      pathname: canonicalCase.leftPath,
      rawBody: canonicalCase.rawBody,
      nonce,
      pushSignatureFormat: canonicalCase.leftFormat,
    });
    const rightRequest = buildSignedRequest({
      method: canonicalCase.method.toUpperCase(),
      pathname: canonicalCase.rightPath,
      rawBody: canonicalCase.rawBody,
      nonce: `${nonce}-right`,
      pushSignatureFormat: canonicalCase.rightFormat,
      authSignatureFormat: index % 2 === 0 ? 'prefixed' : 'base64',
    });

    assert.equal(leftRequest.expected.pushCanonicalHash, rightRequest.expected.pushCanonicalHash, canonicalCase.name);
    assert.equal(leftRequest.expected.pushSignatureHex, rightRequest.expected.pushSignatureHex, canonicalCase.name);

    const left = verifySignedRequest(leftRequest, 'journal-inspect', newVerifierState());
    const right = verifySignedRequest(rightRequest, 'journal-inspect', newVerifierState());
    assert.equal(left.ok, true, canonicalCase.name);
    assert.equal(right.ok, true, canonicalCase.name);
    assert.equal(left.signature.request.canonicalQuery, canonicalCase.expectedQuery);
    assert.equal(right.signature.request.canonicalQuery, canonicalCase.expectedQuery);
    assert.equal(left.signature.request.canonicalHash, right.signature.request.canonicalHash);
    assert.match(left.signature.request.canonicalHash, sha256Pattern);

    const rawOrderRequest = buildSignedRequest({
      method: canonicalCase.method,
      pathname: canonicalCase.leftPath,
      rawBody: canonicalCase.rawBody,
      nonce: `${nonce}-raw-order`,
      pushSignatureFormat: canonicalCase.leftFormat,
    });
    const rawOrderString = rawQueryPushString({
      method: canonicalCase.method,
      pathname: canonicalCase.leftPath,
      contentHash: sha256Hex(canonicalCase.rawBody),
      session: sessionId,
      idempotencyKey,
    });
    rawOrderRequest.headers['x-reprint-push-signature'] = signatureHeader(
      hmacHex(signingKey, rawOrderString),
      canonicalCase.leftFormat,
    );
    const rawOrderState = newVerifierState();
    const rawOrder = verifySignedRequest(rawOrderRequest, 'journal-inspect', rawOrderState);
    assert.notEqual(sha256Hex(rawOrderString), leftRequest.expected.pushCanonicalHash, canonicalCase.name);
    assert.equal(rawOrder.ok, false, canonicalCase.name);
    assert.equal(rawOrder.code, 'SIGNED_PUSH_SIGNATURE_MISMATCH', canonicalCase.name);
    assert.equal(rawOrderState.counters.nonceClaim, 0, canonicalCase.name);

    return {
      name: canonicalCase.name,
      method: canonicalCase.method,
      left,
      right,
      pushSignatureHex: leftRequest.expected.pushSignatureHex,
    };
  });

  const envelope = hashOnlyEnvelope({
    canonicalResults: results,
    positiveResults: [],
    negativeResults: [],
  });
  for (const group of envelope.canonicalGroups) {
    assert.match(group.normalizedCanonicalHash, sha256Pattern);
    assert.match(group.normalizedQueryHash, sha256Pattern);
    assert.match(group.pushSignatureHash, sha256Pattern);
    assert.equal(group.rawValuesIncluded, false);
  }
});

test('RPP-0592 v5 positive support path reaches parsing receipt and mutation counters only after signature proof', () => {
  const positiveCases = [
    {
      name: 'dry-run-receipt-support-path',
      mode: 'dry-run',
      request: buildSignedRequest({
        pathname: '/wp-json/reprint/v1/push/dry-run?z=1&a=2',
        rawBody: validDryRunRawBody,
        nonce: 'rpp-0592-positive-dry-run',
        requestIdempotencyKey: `${idempotencyKey}-dry-run`,
      }),
      expectedCounters: {
        jsonParse: 1,
        nonceClaim: 1,
        receiptMint: 1,
        receiptValidate: 0,
        dbJournalOpen: 0,
        dbJournalAppend: 0,
        mutation: 0,
      },
    },
    {
      name: 'apply-mutation-support-path',
      mode: 'apply',
      request: buildSignedRequest({
        pathname: '/wp-json/reprint/v1/push/apply?z=1&a=2',
        rawBody: validApplyRawBody,
        nonce: 'rpp-0592-positive-apply',
        requestIdempotencyKey: `${idempotencyKey}-apply`,
      }),
      expectedCounters: {
        jsonParse: 1,
        nonceClaim: 1,
        receiptMint: 0,
        receiptValidate: 1,
        dbJournalOpen: 1,
        dbJournalAppend: 1,
        mutation: 1,
      },
    },
  ];

  const results = positiveCases.map((positiveCase) => {
    const result = runAuthenticatedRoute(positiveCase.request, positiveCase.mode, newVerifierState());
    assert.equal(result.ok, true, positiveCase.name);
    assert.deepEqual(result.counters, positiveCase.expectedCounters, positiveCase.name);
    assert.match(result.signature.request.canonicalHash, sha256Pattern);
    assert.match(result.payloadHash, sha256Pattern);
    return {
      name: positiveCase.name,
      mode: positiveCase.mode,
      request: positiveCase.request,
      payloadHash: result.payloadHash,
      signature: result.signature,
      counters: result.counters,
    };
  });

  const envelope = hashOnlyEnvelope({
    canonicalResults: [],
    positiveResults: results,
    negativeResults: [],
  });
  for (const supportPath of envelope.positivePaths) {
    assert.match(supportPath.requestHash, sha256Pattern);
    assert.match(supportPath.payloadHash, sha256Pattern);
    assert.match(supportPath.canonicalHash, sha256Pattern);
    assert.match(supportPath.countersHash, sha256Pattern);
    assert.equal(supportPath.rawValuesIncluded, false);
  }
});

test('RPP-0592 v5 malformed tampered stale or drifted signed evidence fails before parsing receipt mutation or release movement', () => {
  const negativeCases = [
    {
      name: 'missing-basic-auth',
      code: 'SIGNED_AUTH_UNAVAILABLE',
      mutate(request) {
        delete request.headers.authorization;
      },
    },
    {
      name: 'wrong-basic-auth',
      code: 'SIGNED_AUTH_UNAVAILABLE',
      mutate(request) {
        request.headers.authorization = `Basic ${base64('wrong:credential')}`;
      },
    },
    {
      name: 'missing-content-hash-header',
      code: 'SIGNED_HEADER_REQUIRED',
      mutate(request) {
        delete request.headers['x-auth-content-hash'];
      },
    },
    {
      name: 'missing-auth-signature-header',
      code: 'SIGNED_HEADER_REQUIRED',
      mutate(request) {
        delete request.headers['x-auth-signature'];
      },
    },
    {
      name: 'missing-push-signature-header',
      code: 'SIGNED_HEADER_REQUIRED',
      mutate(request) {
        delete request.headers['x-reprint-push-signature'];
      },
    },
    {
      name: 'missing-session',
      code: 'SIGNED_SESSION_REQUIRED',
      mutate(request) {
        delete request.headers['x-reprint-push-session'];
      },
    },
    {
      name: 'missing-idempotency-key',
      code: 'MISSING_IDEMPOTENCY_KEY',
      mutate(request) {
        delete request.headers['x-reprint-push-idempotency-key'];
      },
    },
    {
      name: 'invalid-content-hash-format',
      code: 'SIGNED_CONTENT_HASH_INVALID',
      mutate(request) {
        request.headers['x-auth-content-hash'] = 'not-a-sha256';
      },
    },
    {
      name: 'content-hash-mismatch',
      code: 'SIGNED_CONTENT_HASH_MISMATCH',
      mutate(request) {
        request.rawBody = `${request.rawBody}}`;
      },
    },
    {
      name: 'timestamp-invalid',
      code: 'SIGNED_TIMESTAMP_INVALID',
      mutate(request) {
        request.headers['x-auth-timestamp'] = 'not-a-timestamp';
      },
    },
    {
      name: 'timestamp-stale-past',
      code: 'SIGNED_TIMESTAMP_INVALID',
      mutate(request) {
        request.headers['x-auth-timestamp'] = String(fixedNowSeconds - skewSeconds - 1);
      },
    },
    {
      name: 'timestamp-stale-future',
      code: 'SIGNED_TIMESTAMP_INVALID',
      mutate(request) {
        request.headers['x-auth-timestamp'] = String(fixedNowSeconds + skewSeconds + 1);
      },
    },
    {
      name: 'nonce-invalid',
      code: 'SIGNED_NONCE_INVALID',
      mutate(request) {
        request.headers['x-auth-nonce'] = 'short';
      },
    },
    {
      name: 'auth-signature-tampered',
      code: 'SIGNED_AUTH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-auth-signature'] = fixtureHash('wrong-auth-signature');
      },
    },
    {
      name: 'session-invalid',
      code: 'SIGNED_SESSION_INVALID',
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('missing-session').slice(0, 30)}`;
      },
    },
    {
      name: 'session-expired',
      code: 'SIGNED_SESSION_EXPIRED',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('expired-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('expired-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('expired-session'),
          expiresAtUnix: fixedNowSeconds - 1,
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('expired-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'session-capability-downgraded',
      code: 'SIGNED_SESSION_CAPABILITY_DOWNGRADED',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('denied-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('denied-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('denied-session'),
          capabilityGranted: false,
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('denied-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'session-binding-mismatch',
      code: 'SIGNED_SESSION_BINDING_MISMATCH',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('mismatch-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('mismatch-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('mismatch-session'),
          sourceHash: fixtureHash('other-source'),
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('mismatch-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'session-credential-drift',
      code: 'SIGNED_SESSION_BINDING_MISMATCH',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('credential-drift-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('credential-drift-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('credential-drift-session'),
          credentialHash: fixtureHash('other-credential'),
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('credential-drift-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'session-signing-key-drift',
      code: 'SIGNED_SESSION_BINDING_MISMATCH',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('signing-key-drift-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('signing-key-drift-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('signing-key-drift-session'),
          signingKeyHash: fixtureHash('other-signing-key'),
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('signing-key-drift-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'session-identity-drift',
      code: 'SIGNED_SESSION_BINDING_MISMATCH',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('identity-drift-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('identity-drift-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('identity-drift-session'),
          identityHash: fixtureHash('other-identity'),
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('identity-drift-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'session-source-url-drift',
      code: 'SIGNED_SESSION_BINDING_MISMATCH',
      prepare(state) {
        state.sessions.set(`psh_${fixtureHash('source-url-drift-session-id').slice(0, 30)}`, {
          ...validSession,
          id: `psh_${fixtureHash('source-url-drift-session-id').slice(0, 30)}`,
          sessionHash: fixtureHash('source-url-drift-session'),
          sourceUrlHash: fixtureHash('other-source-url'),
        });
      },
      mutate(request) {
        request.headers['x-reprint-push-session'] = `psh_${fixtureHash('source-url-drift-session-id').slice(0, 30)}`;
      },
    },
    {
      name: 'push-signature-tampered',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-reprint-push-signature'] = fixtureHash('wrong-push-signature');
      },
    },
    {
      name: 'query-tampered-after-signing',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.pathname = '/wp-json/reprint/v1/push/apply?a=1&z=tampered';
      },
    },
    {
      name: 'method-drift-after-signing',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.method = 'PUT';
      },
    },
    {
      name: 'path-drift-after-signing',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.pathname = '/wp-json/reprint/v1/push/dry-run?a=1&z=2';
      },
    },
    {
      name: 'idempotency-header-tampered-after-signing',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-reprint-push-idempotency-key'] = `${idempotencyKey}-tampered`;
      },
    },
    {
      name: 'malformed-push-signature',
      code: 'SIGNED_PUSH_SIGNATURE_MISMATCH',
      mutate(request) {
        request.headers['x-reprint-push-signature'] = 'sha256=not-hex';
      },
    },
  ];

  const results = negativeCases.map((negativeCase, index) => {
    const state = newVerifierState();
    negativeCase.prepare?.(state);
    const request = buildSignedRequest({
      pathname: '/wp-json/reprint/v1/push/apply?a=1&z=2',
      rawBody: malformedRawBody,
      nonce: `rpp-0592-negative-${String(index).padStart(2, '0')}`,
    });
    negativeCase.mutate(request);

    const result = runAuthenticatedRoute(request, 'apply', state);
    assert.equal(result.ok, false, negativeCase.name);
    assert.equal(result.code, negativeCase.code, negativeCase.name);
    assert.equal(result.counters.jsonParse, 0, `${negativeCase.name} parsed JSON`);
    assert.equal(result.counters.nonceClaim, 0, `${negativeCase.name} claimed nonce`);
    assert.equal(result.counters.receiptMint, 0, `${negativeCase.name} minted receipt`);
    assert.equal(result.counters.receiptValidate, 0, `${negativeCase.name} validated receipt`);
    assert.equal(result.counters.dbJournalOpen, 0, `${negativeCase.name} opened journal`);
    assert.equal(result.counters.dbJournalAppend, 0, `${negativeCase.name} appended journal`);
    assert.equal(result.counters.mutation, 0, `${negativeCase.name} mutated`);
    return {
      name: negativeCase.name,
      request,
      code: result.code,
      status: result.status,
      counters: result.counters,
    };
  });

  const envelope = hashOnlyEnvelope({
    canonicalResults: [],
    positiveResults: [],
    negativeResults: results,
  });
  const serializedEnvelope = JSON.stringify(envelope);
  for (const rawValue of [
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    validDryRunRawBody,
    validApplyRawBody,
    malformedRawBody,
    '/wp-json/reprint/v1/push/apply?a=1&z=2',
    'rpp-0592-negative-00',
  ]) {
    assert.equal(serializedEnvelope.includes(rawValue), false, `evidence leaked ${rawValue}`);
  }
  for (const negativeCase of envelope.negativeCases) {
    assert.match(negativeCase.requestHash, sha256Pattern);
    assert.equal(negativeCase.parsedJson, false);
    assert.equal(negativeCase.nonceClaimed, false);
    assert.equal(negativeCase.receiptMinted, false);
    assert.equal(negativeCase.receiptValidated, false);
    assert.equal(negativeCase.dbJournalOpened, false);
    assert.equal(negativeCase.dbJournalAppended, false);
    assert.equal(negativeCase.mutated, false);
    assert.equal(negativeCase.receiptWorkStarted, false);
    assert.equal(negativeCase.mutationCapableWorkStarted, false);
    assert.equal(negativeCase.releaseMovementAllowed, false);
    assert.equal(negativeCase.rawValuesIncluded, false);
  }
});

test('RPP-0592 v5 verify:release summary carries one hash-only canonicalization proof and remains NO-GO', () => {
  const envelope = validHashOnlyEnvelopeFixture();
  const receipt = buildCanonicalizationReceipt(envelope, 8);
  const summary = buildVerifyReleaseStyleSummary(receipt);
  const summaries = collectCanonicalizationSummaries(summary);

  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, 'support_only');
  assert.equal(receipt.releaseStatus, 'NO-GO');
  assert.equal(receipt.releaseMovement.allowed, false);
  assert.equal(receipt.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.match(receipt.receiptHash, sha256Pattern);
  assert.match(receipt.canonicalProof.proofHash, sha256Pattern);
  assert.match(receipt.positiveProof.proofHash, sha256Pattern);
  assert.match(receipt.negativeProof.proofHash, sha256Pattern);
  assert.equal(receipt.canonicalProof.acceptedOnlyAfterCanonicalSignature, true);
  assert.equal(receipt.positiveProof.parseAfterSignatureProof, true);
  assert.equal(receipt.negativeProof.rejectedBeforeJsonParsing, true);
  assert.equal(receipt.negativeProof.rejectedBeforeReceiptWork, true);
  assert.equal(receipt.negativeProof.rejectedBeforeMutationCapableWork, true);
  assert.equal(receipt.negativeProof.rejectedBeforeReleaseMovement, true);

  assert.equal(summary.ok, false);
  assert.equal(summary.releaseStatus, 'NO-GO');
  assert.equal(summary.releaseMovement.allowed, false);
  assert.equal(summary.mutationAttempted, false);
  assert.equal(summary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');
  assert.equal(summary.productionRequestSignatureCanonicalization.ok, true);
  assert.equal(summary.productionRequestSignatureCanonicalization.receiptHash, receipt.receiptHash);
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0], summary.productionRequestSignatureCanonicalization);
  assert.match(summary.commandHash, sha256Pattern);
  assert.match(summary.checkedCommandHash, sha256Pattern);
  assert.match(summary.productionRequestSignatureCanonicalization.requiredHash, sha256Pattern);
  assert.match(summary.productionRequestSignatureCanonicalization.scopeHash, sha256Pattern);
  assertNoRawValues(summary, [
    credential.username,
    credential.password,
    sessionId,
    idempotencyKey,
    validDryRunRawBody,
    validApplyRawBody,
    malformedRawBody,
    '/wp-json/reprint/v1/push/apply?a=1&z=2',
    checkedCommand,
  ]);

  const malformedEnvelope = JSON.parse(JSON.stringify(envelope));
  malformedEnvelope.negativeCases[0].parsedJson = true;
  const blockedReceipt = buildCanonicalizationReceipt(malformedEnvelope, 8);
  const blockedSummary = buildVerifyReleaseStyleSummary(blockedReceipt);
  assert.equal(blockedReceipt.ok, false);
  assert.equal(blockedReceipt.status, 'blocked');
  assert.equal(blockedReceipt.code, 'REQUEST_SIGNATURE_CANONICALIZATION_INCOMPLETE');
  assert.equal(blockedSummary.productionRequestSignatureCanonicalization.ok, false);
  assert.equal(blockedSummary.releaseMovement.allowed, false);
  assert.equal(blockedSummary.boundary.verdict, 'REQUEST_SIGNATURE_CANONICALIZATION_INCOMPLETE');
});

test('RPP-0592 v5 authenticated route source orders canonical signature verification before JSON receipt and mutation work', () => {
  const verifier = functionBody('reprint_push_lab_rest_verify_signed_request');
  const canonicalQueryBody = functionBody('reprint_push_lab_rest_canonical_query');
  const dryRun = functionBody('reprint_push_lab_rest_authenticated_dry_run');
  const apply = functionBody('reprint_push_lab_rest_authenticated_apply');
  const dbJournal = functionBody('reprint_push_lab_rest_authenticated_db_journal');

  assertBefore(
    verifier,
    '$expected_auth_signature = hash_hmac',
    '$session = reprint_push_lab_rest_signed_session($session_id)',
  );
  assertBefore(
    verifier,
    'reprint_push_lab_rest_signed_session_capability_matches($session)',
    '$canonical = reprint_push_lab_rest_push_canonical_string',
  );
  assertBefore(
    verifier,
    '$canonical = reprint_push_lab_rest_push_canonical_string',
    '$expected_push_signature = hash_hmac',
  );
  assertBefore(
    verifier,
    'SIGNED_PUSH_SIGNATURE_MISMATCH',
    '$claim_nonce = !array_key_exists',
  );
  assertBefore(
    verifier,
    '$claim_nonce = !array_key_exists',
    'reprint_push_lab_rest_claim_signed_nonce($nonce',
  );
  assert.doesNotMatch(
    verifier,
    /reprint_push_lab_rest_json_payload|get_json_params|reprint_push_lab_rest_bind_authenticated_receipt|reprint_push_lab_rest_validate_authenticated_receipt|reprint_push_lab_rest_apply_with_db_journal|reprint_push_lab_db_journal_try_open_idempotency|reprint_push_protocol_run_payload/,
  );

  assert.match(canonicalQueryBody, /rawurldecode\(str_replace\('\+', '%20'/);
  assert.match(canonicalQueryBody, /\['key'\], \$a\['value'\], \$a\['index'\]/);
  assert.match(canonicalQueryBody, /rawurlencode\(\(string\) \$pair\['key'\]\) \. '=' \. rawurlencode\(\(string\) \$pair\['value'\]\)/);

  assertBefore(
    dryRun,
    "reprint_push_lab_rest_require_signed_request($request, 'dry-run')",
    'reprint_push_lab_rest_protocol_response',
  );
  assertBefore(dryRun, 'return $signature_error;', 'reprint_push_lab_rest_protocol_response');
  assertBefore(dryRun, 'reprint_push_lab_rest_protocol_response', 'reprint_push_lab_rest_json_payload($request)');
  assertBefore(dryRun, 'reprint_push_lab_rest_json_payload($request)', 'reprint_push_lab_rest_bind_authenticated_receipt');

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

  assertBefore(
    dbJournal,
    "reprint_push_lab_rest_require_signed_request($request, 'journal-inspect')",
    'reprint_push_lab_rest_db_journal($request)',
  );
});
