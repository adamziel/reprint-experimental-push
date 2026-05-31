import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';

import {
  authenticatedHttpClient,
  runAuthenticatedHttpPush,
} from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const proofId = 'rpp-0576-same-key-same-body-replay-v4';
const trustedDbJournalScope = 'checked live loopback endpoint surface; not production proof';
const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const sessionId = 'psh_01j00000000000000000576';
const acceptedIdempotencyKey = 'idem-rpp-0576-live-accepted-same-body-v4';
const rejectedIdempotencyKey = 'idem-rpp-0576-live-rejected-same-body-v4';
const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const auth = {
  identity: {
    userId: 576,
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
const acceptedResourcePath = 'wp-content/uploads/reprint-push/rpp-0576-accepted.txt';
const acceptedBaseValue = 'rpp-0576-private-accepted-base';
const acceptedLocalValue = 'rpp-0576-private-accepted-local';
const acceptedBase = {
  files: {
    [acceptedResourcePath]: acceptedBaseValue,
  },
  plugins: {},
  db: {},
};
const acceptedLocal = {
  files: {
    [acceptedResourcePath]: acceptedLocalValue,
  },
  plugins: {},
  db: {},
};
const rejectedPayload = {
  plan: {
    id: 'plan-rpp-0576-rejected-live-v4',
    generatedAt: '2026-06-01T00:00:00.000Z',
    preconditions: [
      {
        mutationId: 'mutation-rpp-0576-rejected-live-v4',
        resourceKey: 'artifact://rpp-0576/rejected-target',
        expectedHash: fixtureHash('rejected-remote-before'),
      },
    ],
    mutations: [
      {
        id: 'mutation-rpp-0576-rejected-live-v4',
        action: 'upsert',
        resource: {
          type: 'file',
          path: 'artifact://rpp-0576/rejected-target',
        },
        resourceKey: 'artifact://rpp-0576/rejected-target',
        remoteBeforeHash: fixtureHash('rejected-remote-before'),
        localHash: fixtureHash('rejected-local'),
        valueHash: fixtureHash('rejected-local'),
      },
    ],
  },
  receipt: {
    receiptHash: fixtureHash('rejected-dry-run-receipt'),
    planHash: fixtureHash('rejected-plan'),
    mutationCount: 1,
  },
};
const hashPattern = /^[a-f0-9]{64}$/;

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fixtureHash(label) {
  return sha256Hex(`${proofId}:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function headerEntries(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    Array.isArray(value) ? value.join(', ') : String(value),
  ]));
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

function receiptForPlan(plan, idempotencyKey) {
  const evidence = planEvidence(plan);
  const identityHash = digest(auth.identity);
  const pushSessionHash = fixtureHash('push-session');

  return {
    receiptHash: fixtureHash('dry-run-receipt'),
    planHash: digest(plan),
    preconditionSetHash: evidence.preconditionSetHash,
    mutationSetHash: evidence.mutationSetHash,
    mutationCount: Array.isArray(plan?.mutations) ? plan.mutations.length : 0,
    authBinding: {
      schemaVersion: 1,
      expiresAt: auth.session.expiresAt,
      identity: cloneJson(auth.identity),
      session: cloneJson(auth.session),
      binding: {
        identityHash,
        pushSessionHash,
        planHash: digest(plan),
      },
      pushSession: {
        sessionHash: pushSessionHash,
        signingKeyHash: fixtureHash('signing-key'),
        dryRunIdempotencyKeyHash: sha256Hex(idempotencyKey),
        issue: { identityHash },
      },
      sessionUser: {
        identityHash,
        userId: auth.identity.userId,
        userLoginHash: sha256Hex(auth.identity.userLogin),
        pushSessionHash,
        bindingHash: fixtureHash('session-user-binding'),
      },
    },
  };
}

function applyRevalidationEvidence(plan, receipt) {
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const evidence = planEvidence(plan);

  return {
    schemaVersion: 1,
    required: 'fresh-live-hashes-before-first-mutation',
    phase: 'before-first-mutation',
    checkedAgainst: 'live-remote',
    planHash: receipt.planHash || digest(plan),
    receiptHash: receipt.receiptHash,
    preconditionSetHash: receipt.preconditionSetHash || evidence.preconditionSetHash,
    mutationSetHash: receipt.mutationSetHash || evidence.mutationSetHash,
    mutationCount: mutations.length,
    verifiedCount: mutations.length,
    verifiedResourceKeys: mutations.map((mutation) => mutation.resourceKey),
    claim: {
      activeClaimId: sessionId,
      activeClaimKeyHash: fixtureHash('active-claim-key'),
      activeClaimSequence: 2,
      staleClaimRetry: false,
    },
  };
}

function storageGuard() {
  return {
    boundary: 'wpdb-single-statement-cas',
    operation: 'update',
    outcome: 'applied',
  };
}

function signedRequestEvidence(requestRecord) {
  return {
    signed: true,
    schemaVersion: 1,
    contentHash: requestRecord.headers['x-auth-content-hash'] || sha256Hex(requestRecord.rawBody),
    sessionHash: fixtureHash('signed-session'),
    signingKeyHash: fixtureHash('signing-key'),
    request: {
      method: requestRecord.method,
      path: requestRecord.pathname,
    },
  };
}

function checkedJournal(rows) {
  const activeClaimKeyHash = fixtureHash('active-claim-key');
  const eventCounts = rows.reduce((counts, row) => ({
    ...counts,
    [row.event]: (counts[row.event] || 0) + 1,
  }), {});

  return {
    scope: trustedDbJournalScope,
    latestRows: rows,
    rowCount: rows.length,
    eventSummaries: Object.entries(eventCounts).map(([event, count]) => ({ event, count })),
    claim: {
      status: 'active',
      activeClaimId: sessionId,
      activeClaimKeyHash,
      activeClaimSequence: 2,
      activeClaimEvent: 'recovery-claim-opened',
      staleClaimRejected: false,
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: sessionId,
      claimKeyHash: activeClaimKeyHash,
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: sessionId,
        claimKeyHash: activeClaimKeyHash,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  };
}

function createLiveReplayFixtureServer() {
  const state = {
    currentSnapshot: cloneJson(acceptedBase),
    requests: [],
    acceptedApplyRequests: [],
    rejectedApplyRequests: [],
    journalRows: [],
    acceptedApplyCount: 0,
    rejectedApplyCount: 0,
    nextSequence: 1,
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, sourceUrl);
    const rawBody = await readRequestBody(request);
    const requestRecord = {
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      rawBody,
      headers: headerEntries(request.headers),
      remoteAddress: request.socket.remoteAddress,
    };
    state.requests.push(requestRecord);

    try {
      await handleRequest({ requestRecord, response, state });
    } catch (error) {
      writeJson(response, {
        ok: false,
        code: 'RPP_0576_FIXTURE_ERROR',
        message: error.message,
      }, 500);
    }
  });

  return { server, state };
}

async function handleRequest({ requestRecord, response, state }) {
  if (requestRecord.method === 'GET' && requestRecord.pathname === `${routePrefix}/preflight`) {
    writeJson(response, {
      ok: true,
      auth,
      session: { id: sessionId, expiresAt: auth.session.expiresAt },
    });
    return;
  }

  if (requestRecord.method === 'GET' && requestRecord.pathname === `${routePrefix}/snapshot`) {
    writeJson(response, {
      ok: true,
      snapshot: cloneJson(state.currentSnapshot),
    });
    return;
  }

  if (requestRecord.method === 'POST' && requestRecord.pathname === `${routePrefix}/dry-run`) {
    const body = parseJsonBody(requestRecord);
    const idempotencyKey = requestRecord.headers['x-reprint-push-idempotency-key'];
    writeJson(response, {
      ok: true,
      mode: 'dry-run',
      responseSchemaVersion: 1,
      auth,
      receipt: receiptForPlan(body.plan, idempotencyKey),
      signedRequest: signedRequestEvidence(requestRecord),
    });
    return;
  }

  if (requestRecord.method === 'POST' && requestRecord.pathname === `${routePrefix}/apply`) {
    const idempotencyKey = requestRecord.headers['x-reprint-push-idempotency-key'];
    if (idempotencyKey === rejectedIdempotencyKey) {
      handleRejectedApply({ requestRecord, response, state });
    } else {
      handleAcceptedApply({ requestRecord, response, state });
    }
    return;
  }

  if (requestRecord.method === 'POST' && requestRecord.pathname === `${routePrefix}/recovery/inspect`) {
    const body = parseJsonBody(requestRecord);
    const mutationCount = Array.isArray(body?.plan?.mutations) ? body.plan.mutations.length : 0;
    writeJson(response, {
      ok: true,
      mode: 'inspect',
      responseSchemaVersion: 1,
      auth,
      recovery: {
        state: 'fully-updated-remote',
        counts: {
          old: 0,
          new: mutationCount,
          blockedUnknown: 0,
          total: mutationCount,
        },
        journal: {
          integrity: {
            status: 'ok',
            scope: trustedDbJournalScope,
          },
        },
      },
      signedRequest: signedRequestEvidence(requestRecord),
    });
    return;
  }

  if (requestRecord.method === 'GET' && requestRecord.pathname === `${routePrefix}/db-journal`) {
    writeJson(response, {
      ok: true,
      auth,
      dbJournal: checkedJournal(state.journalRows),
      storageGuard: storageGuard(),
    });
    return;
  }

  writeJson(response, {
    ok: false,
    code: 'RPP_0576_UNEXPECTED_ROUTE',
  }, 404);
}

function handleAcceptedApply({ requestRecord, response, state }) {
  const body = parseJsonBody(requestRecord);
  const mutationCount = Array.isArray(body?.plan?.mutations) ? body.plan.mutations.length : 0;
  const idempotencyKeyHash = sha256Hex(requestRecord.headers['x-reprint-push-idempotency-key']);
  const requestHash = requestRecord.headers['x-auth-content-hash'];
  state.acceptedApplyRequests.push(requestRecord);
  state.acceptedApplyCount += 1;

  if (state.acceptedApplyCount === 1) {
    state.currentSnapshot = cloneJson(acceptedLocal);
    appendJournalRows(state, [
      {
        event: 'idempotency-opened',
        idempotencyKeyHash,
        requestHash,
        appliedCount: 0,
      },
      {
        event: 'apply-started',
        idempotencyKeyHash,
        requestHash,
        appliedCount: 0,
      },
      {
        event: 'mutation-applied',
        idempotencyKeyHash,
        requestHash,
        appliedCount: mutationCount,
      },
      {
        event: 'apply-committed',
        idempotencyKeyHash,
        requestHash,
        appliedCount: mutationCount,
      },
    ]);
  } else {
    appendJournalRows(state, [
      {
        event: 'apply-replayed',
        idempotencyKeyHash,
        requestHash,
        appliedCount: 0,
      },
    ]);
  }

  writeJson(response, {
    ok: true,
    mode: 'apply',
    code: state.acceptedApplyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
    applied: mutationCount,
    responseSchemaVersion: 1,
    auth,
    receipt: body.receipt,
    idempotency: {
      replayed: state.acceptedApplyCount > 1,
      freshMutationWork: state.acceptedApplyCount === 1,
      conflict: false,
      idempotencyKeyHash,
      requestHash,
    },
    storageGuard: storageGuard(),
    signedRequest: signedRequestEvidence(requestRecord),
    applyRevalidation: applyRevalidationEvidence(body.plan, body.receipt),
  });
}

function handleRejectedApply({ requestRecord, response, state }) {
  const body = parseJsonBody(requestRecord);
  const mutationCount = Array.isArray(body?.plan?.mutations) ? body.plan.mutations.length : 0;
  const idempotencyKeyHash = sha256Hex(requestRecord.headers['x-reprint-push-idempotency-key']);
  const requestHash = requestRecord.headers['x-auth-content-hash'];
  state.rejectedApplyRequests.push(requestRecord);
  state.rejectedApplyCount += 1;

  appendJournalRows(state, [
    {
      event: state.rejectedApplyCount === 1 ? 'apply-rejected' : 'apply-replayed',
      idempotencyKeyHash,
      requestHash,
      errorCode: 'PRECONDITION_FAILED',
      appliedCount: 0,
    },
  ]);

  writeJson(response, {
    ok: false,
    mode: 'apply',
    code: 'PRECONDITION_FAILED',
    applied: 0,
    responseSchemaVersion: 1,
    auth,
    receipt: body.receipt,
    idempotency: {
      replayed: state.rejectedApplyCount > 1,
      freshMutationWork: false,
      conflict: false,
      status: state.rejectedApplyCount === 1 ? 'rejected' : 'replayed-rejection',
      idempotencyKeyHash,
      requestHash,
    },
    storageGuard: storageGuard(),
    signedRequest: signedRequestEvidence(requestRecord),
    applyRevalidation: {
      ...applyRevalidationEvidence(body.plan, body.receipt),
      mutationCount,
      verifiedCount: mutationCount,
    },
  }, 412);
}

function appendJournalRows(state, rows) {
  for (const row of rows) {
    state.journalRows.push({
      sequence: state.nextSequence,
      ...row,
    });
    state.nextSequence += 1;
  }
}

function parseJsonBody(requestRecord) {
  return requestRecord.rawBody ? JSON.parse(requestRecord.rawBody) : {};
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function writeJson(response, body, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json',
    connection: 'close',
  });
  response.end(JSON.stringify(body));
}

function listenOnSandboxPort(server) {
  return new Promise((resolve, reject) => {
    function onError(error) {
      reject(error);
    }
    server.once('error', onError);
    server.listen(8080, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function buildSupportEvidence({
  acceptedSummary,
  acceptedApplyRequests,
  rejectedApplyResponses,
  rejectedApplyRequests,
  state,
}) {
  const [acceptedApply, acceptedReplay] = acceptedApplyRequests;
  const [rejectedApply, rejectedReplay] = rejectedApplyRequests;
  const rejectedRows = state.journalRows.filter((row) => (
    row.idempotencyKeyHash === sha256Hex(rejectedIdempotencyKey)
  ));
  const acceptedReplayRows = state.journalRows.filter((row) => (
    row.idempotencyKeyHash === sha256Hex(acceptedIdempotencyKey)
    && row.event === 'apply-replayed'
  ));
  const evidence = {
    schemaVersion: 1,
    issue: 'RPP-0576',
    variant: 4,
    proofClass: 'same-key-same-body-replay-v4',
    evidenceScope: 'focused-live-loopback-endpoint-support-only',
    releaseStatus: 'NO-GO',
    liveEndpoint: {
      exercised: true,
      sourceUrlHash: sha256Hex(sourceUrl),
      routeProfile: 'production-shaped',
      port: 8080,
      loopbackOnly: true,
      tunnelUsed: false,
    },
    acceptedReplay: {
      proved: acceptedSummary.sameKeySameBodyReplay?.proved === true,
      status: acceptedSummary.replay?.status,
      code: acceptedSummary.replay?.code,
      requestBodyHash: acceptedSummary.sameKeySameBodyReplay?.requestBodyHash,
      applyContentHash: acceptedSummary.sameKeySameBodyReplay?.applyContentHash,
      replayContentHash: acceptedSummary.sameKeySameBodyReplay?.replayContentHash,
      sameRequestBody: acceptedApply?.rawBody === acceptedReplay?.rawBody,
      signedContentHashesMatch: acceptedSummary.sameKeySameBodyReplay?.signedContentHashesMatch,
      replayed: acceptedSummary.replay?.idempotency?.replayed === true,
      freshMutationWork: acceptedSummary.replay?.idempotency?.freshMutationWork === true,
      noFreshMutationWork: acceptedSummary.sameKeySameBodyReplay?.noFreshMutationWork === true,
      replayEquivalent: acceptedSummary.sameKeySameBodyReplay?.replayEquivalent === true,
      mutationAppliedRows: acceptedSummary.dbJournal?.mutationApplied,
      applyReplayedRows: acceptedReplayRows.length,
    },
    rejectedReplay: {
      applyStatus: rejectedApplyResponses[0].status,
      replayStatus: rejectedApplyResponses[1].status,
      code: rejectedApplyResponses[1].body?.code,
      requestBodyHash: sha256Hex(rejectedApply.rawBody),
      replayBodyHash: sha256Hex(rejectedReplay.rawBody),
      sameRequestBody: rejectedApply.rawBody === rejectedReplay.rawBody,
      applyContentHash: rejectedApply.headers['x-auth-content-hash'],
      replayContentHash: rejectedReplay.headers['x-auth-content-hash'],
      signedContentHashesMatch:
        rejectedApply.headers['x-auth-content-hash'] === rejectedReplay.headers['x-auth-content-hash'],
      replayed: rejectedApplyResponses[1].body?.idempotency?.replayed === true,
      freshMutationWork: rejectedApplyResponses[1].body?.idempotency?.freshMutationWork === true,
      noFreshMutationWork: rejectedApplyResponses[1].body?.idempotency?.freshMutationWork === false,
      mutationAppliedBeforeFailure: rejectedRows.filter((row) => row.event === 'mutation-applied').length,
      applyCommitted: rejectedRows.some((row) => row.event === 'apply-committed'),
      applyRejectedRows: rejectedRows.filter((row) => row.event === 'apply-rejected').length,
      applyReplayedRows: rejectedRows.filter((row) => row.event === 'apply-replayed').length,
    },
    redaction: {
      mode: 'hash-count-status-only',
      rawValuesIncluded: false,
      requestBodiesIncluded: false,
      idempotencyKeysIncluded: false,
      credentialsIncluded: false,
      sessionIdsIncluded: false,
      sourceUrlsIncluded: false,
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reasonHash: fixtureHash('live-loopback-support-only-no-production-claim'),
    },
    integrationRecommendation: {
      status: 'support-only',
      recommendationHash: fixtureHash('carry-forward-with-production-boundary-evidence'),
    },
  };

  return {
    ...evidence,
    proofHash: digest(evidence),
  };
}

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} must be SHA-256-shaped`);
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0576 support evidence leaked raw value: ${rawValue}`,
    );
  }
}

test('RPP-0576 live loopback endpoint replays same-key same-body accepted and rejected results', async () => {
  const { server, state } = createLiveReplayFixtureServer();
  await listenOnSandboxPort(server);

  try {
    const acceptedSummary = await runAuthenticatedHttpPush({
      sourceUrl,
      base: acceptedBase,
      local: acceptedLocal,
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey: acceptedIdempotencyKey,
      routeProfile: 'production-shaped',
      now: fixedNow,
      requestTimeoutMs: 5_000,
    });

    assert.equal(acceptedSummary.ok, true, JSON.stringify({
      code: acceptedSummary.code,
      apply: acceptedSummary.apply,
      replay: acceptedSummary.replay,
      sameKeySameBodyReplay: acceptedSummary.sameKeySameBodyReplay,
      dbJournal: acceptedSummary.dbJournal,
    }, null, 2));
    assert.equal(acceptedSummary.sameKeySameBodyReplay?.proved, true);
    assert.equal(acceptedSummary.sameKeySameBodyReplay?.verdict, 'SAME_KEY_SAME_BODY_REPLAY_PROVEN');
    assert.equal(acceptedSummary.sameKeySameBodyReplay?.signedContentHashesMatch, true);
    assert.equal(acceptedSummary.sameKeySameBodyReplay?.signedContentHashMatchesSubmittedBody, true);
    assert.equal(acceptedSummary.replay?.idempotency?.replayed, true);
    assert.equal(acceptedSummary.replay?.idempotency?.freshMutationWork, false);
    assert.equal(acceptedSummary.replayEquivalence?.equivalent, true);
    assert.equal(acceptedSummary.dbJournal?.eventCounts?.['apply-replayed'], 1);
    assert.equal(acceptedSummary.dbJournal?.mutationApplied, 1);
    assert.equal(acceptedSummary.after?.finalMatchesLocal, true);

    assert.equal(state.acceptedApplyRequests.length, 2);
    const [acceptedApply, acceptedReplay] = state.acceptedApplyRequests;
    assert.equal(acceptedApply.rawBody, acceptedReplay.rawBody);
    assert.equal(
      acceptedApply.headers['x-auth-content-hash'],
      sha256Hex(acceptedApply.rawBody),
    );
    assert.equal(
      acceptedReplay.headers['x-auth-content-hash'],
      sha256Hex(acceptedReplay.rawBody),
    );
    assert.equal(
      acceptedApply.headers['x-auth-content-hash'],
      acceptedReplay.headers['x-auth-content-hash'],
    );
    assert.notEqual(acceptedApply.headers['x-auth-nonce'], acceptedReplay.headers['x-auth-nonce']);
    assert.notEqual(acceptedApply.headers['x-auth-signature'], acceptedReplay.headers['x-auth-signature']);
    assert.equal(acceptedApply.headers['x-reprint-push-signature'], acceptedReplay.headers['x-reprint-push-signature']);

    const client = authenticatedHttpClient({
      sourceUrl,
      credential,
      routeProfile: 'production-shaped',
      requestTimeoutMs: 5_000,
    });
    const rejectedApplyResponse = await client.signedPost('/apply', rejectedPayload, {
      session: sessionId,
      idempotencyKey: rejectedIdempotencyKey,
    });
    const rejectedReplayResponse = await client.signedPost('/apply', rejectedPayload, {
      session: sessionId,
      idempotencyKey: rejectedIdempotencyKey,
    });

    assert.equal(rejectedApplyResponse.status, 412);
    assert.equal(rejectedApplyResponse.body?.ok, false);
    assert.equal(rejectedApplyResponse.body?.code, 'PRECONDITION_FAILED');
    assert.equal(rejectedApplyResponse.body?.applied, 0);
    assert.equal(rejectedApplyResponse.body?.idempotency?.replayed, false);
    assert.equal(rejectedApplyResponse.body?.idempotency?.freshMutationWork, false);

    assert.equal(rejectedReplayResponse.status, 412);
    assert.equal(rejectedReplayResponse.body?.ok, false);
    assert.equal(rejectedReplayResponse.body?.code, 'PRECONDITION_FAILED');
    assert.equal(rejectedReplayResponse.body?.applied, 0);
    assert.equal(rejectedReplayResponse.body?.idempotency?.replayed, true);
    assert.equal(rejectedReplayResponse.body?.idempotency?.freshMutationWork, false);

    assert.equal(state.rejectedApplyRequests.length, 2);
    const [rejectedApply, rejectedReplay] = state.rejectedApplyRequests;
    assert.equal(rejectedApply.rawBody, rejectedReplay.rawBody);
    assert.equal(rejectedApply.headers['x-auth-content-hash'], sha256Hex(rejectedApply.rawBody));
    assert.equal(rejectedReplay.headers['x-auth-content-hash'], sha256Hex(rejectedReplay.rawBody));
    assert.equal(rejectedApply.headers['x-auth-content-hash'], rejectedReplay.headers['x-auth-content-hash']);
    assert.notEqual(rejectedApply.headers['x-auth-nonce'], rejectedReplay.headers['x-auth-nonce']);
    assert.notEqual(rejectedApply.headers['x-auth-signature'], rejectedReplay.headers['x-auth-signature']);
    assert.equal(rejectedApply.headers['x-reprint-push-signature'], rejectedReplay.headers['x-reprint-push-signature']);

    const rejectedRows = state.journalRows.filter((row) => (
      row.idempotencyKeyHash === sha256Hex(rejectedIdempotencyKey)
    ));
    assert.deepEqual(rejectedRows.map((row) => row.event), [
      'apply-rejected',
      'apply-replayed',
    ]);
    assert.equal(rejectedRows.filter((row) => row.event === 'mutation-applied').length, 0);
    assert.equal(rejectedRows.some((row) => row.event === 'apply-committed'), false);
    assert.equal(rejectedRows[0].requestHash, rejectedRows[1].requestHash);
    assert.equal(rejectedRows[0].appliedCount, 0);
    assert.equal(rejectedRows[1].appliedCount, 0);

    assert.ok(
      state.requests.every((request) => (
        request.remoteAddress === '127.0.0.1'
        || request.remoteAddress === '::1'
        || request.remoteAddress === '::ffff:127.0.0.1'
      )),
      'RPP-0576 fixture must only receive loopback requests',
    );

    const supportEvidence = buildSupportEvidence({
      acceptedSummary,
      acceptedApplyRequests: state.acceptedApplyRequests,
      rejectedApplyResponses: [rejectedApplyResponse, rejectedReplayResponse],
      rejectedApplyRequests: state.rejectedApplyRequests,
      state,
    });

    assert.equal(supportEvidence.liveEndpoint.exercised, true);
    assert.equal(supportEvidence.liveEndpoint.port, 8080);
    assert.equal(supportEvidence.liveEndpoint.loopbackOnly, true);
    assert.equal(supportEvidence.liveEndpoint.tunnelUsed, false);
    assert.equal(supportEvidence.acceptedReplay.proved, true);
    assert.equal(supportEvidence.acceptedReplay.sameRequestBody, true);
    assert.equal(supportEvidence.acceptedReplay.noFreshMutationWork, true);
    assert.equal(supportEvidence.acceptedReplay.applyReplayedRows, 1);
    assert.equal(supportEvidence.rejectedReplay.applyStatus, 412);
    assert.equal(supportEvidence.rejectedReplay.replayStatus, 412);
    assert.equal(supportEvidence.rejectedReplay.sameRequestBody, true);
    assert.equal(supportEvidence.rejectedReplay.replayed, true);
    assert.equal(supportEvidence.rejectedReplay.noFreshMutationWork, true);
    assert.equal(supportEvidence.rejectedReplay.mutationAppliedBeforeFailure, 0);
    assert.equal(supportEvidence.rejectedReplay.applyCommitted, false);
    assert.equal(supportEvidence.rejectedReplay.applyRejectedRows, 1);
    assert.equal(supportEvidence.rejectedReplay.applyReplayedRows, 1);
    assert.equal(supportEvidence.releaseStatus, 'NO-GO');
    assert.equal(supportEvidence.releaseMovement.allowed, false);
    assertHash(supportEvidence.liveEndpoint.sourceUrlHash, 'source URL hash');
    assertHash(supportEvidence.acceptedReplay.requestBodyHash, 'accepted request body hash');
    assertHash(supportEvidence.rejectedReplay.requestBodyHash, 'rejected request body hash');
    assertHash(supportEvidence.rejectedReplay.replayBodyHash, 'rejected replay body hash');
    assertHash(supportEvidence.releaseMovement.reasonHash, 'release movement reason hash');
    assertHash(supportEvidence.integrationRecommendation.recommendationHash, 'integration recommendation hash');
    assertHash(supportEvidence.proofHash, 'support proof hash');
    assertNoRawValues(supportEvidence, [
      sourceUrl,
      acceptedIdempotencyKey,
      rejectedIdempotencyKey,
      credential.username,
      credential.password,
      sessionId,
      acceptedResourcePath,
      acceptedBaseValue,
      acceptedLocalValue,
      'artifact://rpp-0576/rejected-target',
    ]);
  } finally {
    await closeServer(server);
  }
});
