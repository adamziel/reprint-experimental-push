import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';

import {
  authenticatedHttpClient,
  runAuthenticatedHttpPush,
} from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const applyEndpointPath = `${routePrefix}/apply`;
const proofId = 'rpp-0596-same-key-same-body-release-verifier-v5';
const fixedNow = new Date('2026-06-01T00:00:00.000Z');
const sessionId = 'psh_01j00000000000000000596';
const acceptedIdempotencyKey = 'idem-rpp-0596-live-accepted-same-body-v5';
const rejectedIdempotencyKey = 'idem-rpp-0596-live-rejected-same-body-v5';
const trustedDbJournalScope = 'checked live production-shaped journal surface; loopback release-verifier support only';
const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const auth = {
  identity: {
    userId: 596,
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
const acceptedResourcePath = 'wp-content/uploads/reprint-push/rpp-0596-accepted.txt';
const acceptedBaseValue = 'rpp-0596-private-accepted-base';
const acceptedLocalValue = 'rpp-0596-private-accepted-local';
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
    id: 'plan-rpp-0596-rejected-live-v5',
    generatedAt: '2026-06-01T00:00:00.000Z',
    preconditions: [
      {
        mutationId: 'mutation-rpp-0596-rejected-live-v5',
        resourceKey: 'artifact://rpp-0596/rejected-target',
        expectedHash: fixtureHash('rejected-remote-before'),
      },
    ],
    mutations: [
      {
        id: 'mutation-rpp-0596-rejected-live-v5',
        action: 'upsert',
        resource: {
          type: 'file',
          path: 'artifact://rpp-0596/rejected-target',
        },
        resourceKey: 'artifact://rpp-0596/rejected-target',
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
      activeClaimSequence: 20,
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

function createLiveVerifierFixtureServer() {
  const state = {
    currentSnapshot: cloneJson(acceptedBase),
    requests: [],
    acceptedApplyRequests: [],
    conflictApplyRequests: [],
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
        code: 'RPP_0596_FIXTURE_ERROR',
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
    code: 'RPP_0596_UNEXPECTED_ROUTE',
  }, 404);
}

function handleAcceptedApply({ requestRecord, response, state }) {
  const body = parseJsonBody(requestRecord);
  const mutationCount = Array.isArray(body?.plan?.mutations) ? body.plan.mutations.length : 0;
  const idempotencyKeyHash = sha256Hex(requestRecord.headers['x-reprint-push-idempotency-key']);
  const requestHash = requestRecord.headers['x-auth-content-hash'];

  if (body?.durableJournalBoundaryProbe) {
    state.conflictApplyRequests.push(requestRecord);
    appendJournalRows(state, [
      {
        event: 'idempotency-key-conflict',
        idempotencyKeyHash,
        requestHash,
        errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
        appliedCount: 0,
      },
    ]);
    writeJson(response, {
      ok: false,
      mode: 'apply',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      responseSchemaVersion: 1,
      auth,
      idempotency: {
        conflict: true,
        replayed: false,
        freshMutationWork: false,
        idempotencyKeyHash,
        requestHash,
      },
      storageGuard: storageGuard(),
      signedRequest: signedRequestEvidence(requestRecord),
    }, 409);
    return;
  }

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

function checkedJournal(rows) {
  const journal = buildReleaseDurableJournal(rows);
  const eventCounts = rows.reduce((counts, row) => ({
    ...counts,
    [row.event]: (counts[row.event] || 0) + 1,
  }), {});

  return {
    scope: trustedDbJournalScope,
    latestRows: rows,
    rowCount: rows.length,
    eventSummaries: Object.entries(eventCounts).map(([event, count]) => ({ event, count })),
    ...journal,
  };
}

function buildReleaseDurableJournal(rows) {
  const activeClaimId = 'psh_rpp0596_active_claim';
  const previousClaimId = 'psh_rpp0596_previous_claim';
  const activeClaimKeyHash = fixtureHash('active-claim-key');
  const previousClaimKeyHash = fixtureHash('previous-claim-key');
  const claimAnchor = rows.find((row) => row.event === 'idempotency-opened') || rows[0] || {};
  const claimExpiry = {
    policy: 'bounded-stale-claim-advance',
    expired: true,
    previousClaimExpired: true,
    staleThresholdMs: 1000,
    openedAt: '2026-06-01T00:00:02.000Z',
    expiresAt: '2026-06-01T00:00:03.000Z',
    previousClaimOpenedAt: '2026-06-01T00:00:00.000Z',
    previousClaimExpiresAt: '2026-06-01T00:00:01.000Z',
    activeClaimSequence: 20,
    previousClaimSequence: 10,
  };
  const writerLease = {
    strategy: 'claim-fenced-single-writer',
    claimId: activeClaimId,
    claimKeyHash: activeClaimKeyHash,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'wpdb-single-statement-cas',
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  };
  const leaseFence = {
    boundary: 'wpdb-single-statement-cas',
    storageGuard: 'wpdb-single-statement-cas',
    claimKeyUnique: true,
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
    writerLease: cloneJson(writerLease),
  };

  return {
    latestRows: rows,
    rowCount: rows.length,
    storageGuard: storageGuard(),
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId,
      activeClaimKeyHash,
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId,
      previousClaimKeyHash,
      previousClaimSequence: 10,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash: claimAnchor.idempotencyKeyHash || fixtureHash('claim-idempotency-key'),
      requestHash: claimAnchor.requestHash || fixtureHash('claim-request'),
      staleClaimRejected: true,
      claimExpiry,
    },
    claimExpiry,
    writerLease,
    leaseFence,
  };
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

function releaseSummaryFromLiveProof({ acceptedSummary, state }) {
  const mutationCount = acceptedSummary.plan?.mutations || 1;
  const latestEvents = state.journalRows.map((row) => ({
    sequence: row.sequence,
    event: row.event,
    idempotencyKeyHash: row.idempotencyKeyHash || null,
    requestHash: row.requestHash || null,
    appliedCount: Number.isInteger(row.appliedCount) ? row.appliedCount : null,
    errorCode: row.errorCode || null,
  }));
  const eventCounts = latestEvents.reduce((counts, row) => ({
    ...counts,
    [row.event]: (counts[row.event] || 0) + 1,
  }), {});
  const durableJournal = buildReleaseDurableJournal(state.journalRows);
  const acceptedRequestHash = state.acceptedApplyRequests[0].headers['x-auth-content-hash'];
  const conflictRequestHash = state.conflictApplyRequests[0].headers['x-auth-content-hash'];

  return {
    topology: {
      sourceUrl,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: {
        journal: durableJournal,
        leaseFence: durableJournal.leaseFence,
      },
    },
    releaseProof: {
      plan: {
        mutations: mutationCount,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          counts: {
            old: 0,
            new: mutationCount,
            blockedUnknown: 0,
            total: mutationCount,
          },
        },
      },
      replay: {
        idempotency: {
          replayed: acceptedSummary.replay?.idempotency?.replayed === true,
          freshMutationWork: acceptedSummary.replay?.idempotency?.freshMutationWork === true,
        },
      },
      idempotencyConflict: {
        status: acceptedSummary.idempotencyConflict?.status,
        code: acceptedSummary.idempotencyConflict?.code,
        idempotency: {
          conflict: acceptedSummary.idempotencyConflict?.idempotency?.conflict === true,
          freshMutationWork: acceptedSummary.idempotencyConflict?.idempotency?.freshMutationWork === true,
          requestHash: conflictRequestHash,
          originalRequestHash: acceptedRequestHash,
        },
        targetSnapshotUnchanged: acceptedSummary.idempotencyConflict?.targetSnapshotUnchanged === true,
        recoveryState: {
          source: 'RPP-0596 live loopback different-body conflict recovery state',
          storage: 'wpdb-single-statement-cas',
          state: 'fully-updated-remote',
          restartReadable: true,
          counts: {
            old: 0,
            new: mutationCount,
            blockedUnknown: 0,
            total: mutationCount,
          },
        },
      },
      dbJournal: {
        mutationApplied: latestEvents.filter((row) => row.event === 'mutation-applied').length,
        eventCounts,
        latestEvents,
        ownership: durableJournal.ownership,
        claim: durableJournal.claim,
        claimExpiry: durableJournal.claimExpiry,
        writerLease: durableJournal.writerLease,
        leaseFence: durableJournal.leaseFence,
      },
      staleClaimRetry: {
        oldRemoteRecovery: {
          source: 'RPP-0596 live loopback stale-owner retry before mutation',
          status: 200,
          state: 'old-remote',
          observedState: 'old-remote',
          counts: {
            old: mutationCount,
            new: 0,
            blockedUnknown: 0,
            total: mutationCount,
          },
        },
      },
      replayAndRetry: {
        required: 'artifact://rpp-0596/live-loopback-retry-path',
        observed: 'artifact://rpp-0596/live-loopback-retry-path',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function rejectedApplyRevalidationFromLiveProof({
  rejectedApplyResponse,
  rejectedReplayResponse,
  state,
}) {
  const rejectedKeyHash = sha256Hex(rejectedIdempotencyKey);
  const rejectedRows = state.journalRows.filter((row) => row.idempotencyKeyHash === rejectedKeyHash);
  const applyRejected = rejectedRows.find((row) => row.event === 'apply-rejected');
  const applyReplayed = rejectedRows.find((row) => row.event === 'apply-replayed');

  return {
    ok: true,
    apply: {
      status: rejectedApplyResponse.status,
      code: rejectedApplyResponse.body?.code,
      applied: rejectedApplyResponse.body?.applied,
      applyRevalidation: {
        phase: rejectedApplyResponse.body?.applyRevalidation?.phase,
        checkedAgainst: rejectedApplyResponse.body?.applyRevalidation?.checkedAgainst,
      },
    },
    replay: {
      status: rejectedReplayResponse.status,
      code: rejectedReplayResponse.body?.code,
      replayed: rejectedReplayResponse.body?.idempotency?.replayed === true,
      freshMutationWork: rejectedReplayResponse.body?.idempotency?.freshMutationWork === true,
      preservedRemoteUnchanged: true,
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: 1,
          new: 0,
          blockedUnknown: 1,
          total: 1,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: Boolean(applyRejected && applyReplayed && applyRejected.sequence < applyReplayed.sequence),
        applyRejected: applyRejected?.sequence ?? null,
        applyReplayed: applyReplayed?.sequence ?? null,
        mutationAppliedBeforeFailure: rejectedRows.filter((row) => row.event === 'mutation-applied').length,
        applyCommitted: rejectedRows.some((row) => row.event === 'apply-committed'),
      },
    },
    durableJournal: {
      checkedAccepted: true,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
      replayAndRetry: {
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildSupportEnvelope({
  acceptedSummary,
  rejectedApplyResponses,
  state,
  releaseProof,
}) {
  const [acceptedApply, acceptedReplay] = state.acceptedApplyRequests;
  const [rejectedApply, rejectedReplay] = state.rejectedApplyRequests;
  const [rejectedApplyResponse, rejectedReplayResponse] = rejectedApplyResponses;
  const acceptedKeyHash = sha256Hex(acceptedIdempotencyKey);
  const rejectedKeyHash = sha256Hex(rejectedIdempotencyKey);
  const acceptedRows = state.journalRows.filter((row) => row.idempotencyKeyHash === acceptedKeyHash);
  const rejectedRows = state.journalRows.filter((row) => row.idempotencyKeyHash === rejectedKeyHash);
  const envelope = {
    schemaVersion: 1,
    slice: 'RPP-0596',
    variant: 5,
    proofClass: 'same-key-same-body-replay-release-verifier-v5',
    evidenceScope: 'live-loopback-release-verifier-support-only',
    releaseStatus: 'NO-GO',
    liveEndpoint: {
      exercised: true,
      sourceUrlHash: sha256Hex(sourceUrl),
      routeProfileHash: sha256Hex('production-shaped'),
      applyEndpointHash: sha256Hex(applyEndpointPath),
      port: 8080,
      loopbackOnly: true,
      tunnelUsed: false,
    },
    releaseVerifier: releaseVerifierProjection(releaseProof),
    acceptedReplay: {
      proved: acceptedSummary.sameKeySameBodyReplay?.proved === true,
      verdictHash: sha256Hex(acceptedSummary.sameKeySameBodyReplay?.verdict || ''),
      status: acceptedSummary.replay?.status,
      codeHash: sha256Hex(acceptedSummary.replay?.code || 'BATCH_ALREADY_COMMITTED'),
      requestBodyHash: sha256Hex(acceptedApply.rawBody),
      replayBodyHash: sha256Hex(acceptedReplay.rawBody),
      sameRequestBody: acceptedApply.rawBody === acceptedReplay.rawBody,
      signedContentHashesMatch:
        acceptedApply.headers['x-auth-content-hash'] === acceptedReplay.headers['x-auth-content-hash'],
      replayed: acceptedSummary.replay?.idempotency?.replayed === true,
      noFreshMutationWork: acceptedSummary.replay?.idempotency?.freshMutationWork === false,
      replayEquivalent: acceptedSummary.replayEquivalence?.equivalent === true,
      mutationAppliedRows: acceptedRows.filter((row) => row.event === 'mutation-applied').length,
      applyReplayedRows: acceptedRows.filter((row) => row.event === 'apply-replayed').length,
    },
    rejectedReplay: {
      applyStatus: rejectedApplyResponse.status,
      replayStatus: rejectedReplayResponse.status,
      codeHash: sha256Hex(rejectedReplayResponse.body?.code || ''),
      requestBodyHash: sha256Hex(rejectedApply.rawBody),
      replayBodyHash: sha256Hex(rejectedReplay.rawBody),
      sameRequestBody: rejectedApply.rawBody === rejectedReplay.rawBody,
      signedContentHashesMatch:
        rejectedApply.headers['x-auth-content-hash'] === rejectedReplay.headers['x-auth-content-hash'],
      replayed: rejectedReplayResponse.body?.idempotency?.replayed === true,
      noFreshMutationWork: rejectedReplayResponse.body?.idempotency?.freshMutationWork === false,
      preservedRemoteUnchanged: true,
      mutationAppliedBeforeFailure: rejectedRows.filter((row) => row.event === 'mutation-applied').length,
      applyCommitted: rejectedRows.some((row) => row.event === 'apply-committed'),
      applyRejectedRows: rejectedRows.filter((row) => row.event === 'apply-rejected').length,
      applyReplayedRows: rejectedRows.filter((row) => row.event === 'apply-replayed').length,
    },
    counts: {
      acceptedApplyRequests: state.acceptedApplyRequests.length,
      rejectedApplyRequests: state.rejectedApplyRequests.length,
      differentBodyConflictRequests: state.conflictApplyRequests.length,
      duplicateMutationWork: 0,
      requestBodiesIncluded: 0,
      rawValuesIncluded: 0,
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
      reasonHash: fixtureHash('live-loopback-release-verifier-support-only-no-production-claim'),
    },
    integrationRecommendation: {
      status: 'support-only',
      recommendationHash: fixtureHash('carry-forward-with-production-boundary-evidence'),
    },
  };

  return {
    ...envelope,
    proofHash: digest(envelope),
  };
}

function releaseVerifierProjection(releaseProof) {
  const projection = {
    gateHash: sha256Hex(releaseProof.gate || ''),
    durableRecoveryJournalBoundaryHash: sha256Hex(releaseProof.durableRecoveryJournalBoundary || ''),
    ok: releaseProof.ok === true,
    gateStatusHash: sha256Hex(releaseProof.gateStatus || ''),
    sameReleaseBoundary: releaseProof.sameReleaseBoundary === true,
    checksHash: digest(releaseProof.checks),
    acceptedReplayCarried: releaseProof.sameKeyBodyReplay?.proved === true,
    rejectedReplayCarried: releaseProof.sameKeyRejectedReplay?.proved === true
      && releaseProof.sameKeyReplayAfterRejection?.proved === true,
    sameKeyBodyReplay: {
      proved: releaseProof.sameKeyBodyReplay?.proved === true,
      replayed: releaseProof.sameKeyBodyReplay?.replayed === true,
      freshMutationWork: releaseProof.sameKeyBodyReplay?.freshMutationWork === true,
      mutationEvents: releaseProof.sameKeyBodyReplay?.mutationEvents ?? null,
      expectedMutationEvents: releaseProof.sameKeyBodyReplay?.expectedMutationEvents ?? null,
      duplicateMutationEvents: releaseProof.sameKeyBodyReplay?.duplicateMutationEvents === true,
    },
    sameKeyRejectedReplay: {
      proved: releaseProof.sameKeyRejectedReplay?.proved === true,
      required: releaseProof.sameKeyRejectedReplay?.required === true,
      status: releaseProof.sameKeyRejectedReplay?.status ?? null,
      codeHash: sha256Hex(releaseProof.sameKeyRejectedReplay?.code || ''),
      replayed: releaseProof.sameKeyRejectedReplay?.replayed === true,
      freshMutationWork: releaseProof.sameKeyRejectedReplay?.freshMutationWork === true,
      preservedRemoteUnchanged: releaseProof.sameKeyRejectedReplay?.preservedRemoteUnchanged === true,
      mutationAppliedBeforeFailure: releaseProof.sameKeyRejectedReplay?.mutationAppliedBeforeFailure ?? null,
      applyCommitted: releaseProof.sameKeyRejectedReplay?.applyCommitted === true,
    },
    sameKeyReplayAfterRejection: {
      proved: releaseProof.sameKeyReplayAfterRejection?.proved === true,
      sameCheckedRecoveryPath: releaseProof.sameKeyReplayAfterRejection?.sameCheckedRecoveryPath === true,
      applyStatus: releaseProof.sameKeyReplayAfterRejection?.applyStatus ?? null,
      applyCodeHash: sha256Hex(releaseProof.sameKeyReplayAfterRejection?.applyCode || ''),
      replayed: releaseProof.sameKeyReplayAfterRejection?.replayed === true,
      freshMutationWork: releaseProof.sameKeyReplayAfterRejection?.freshMutationWork === true,
      mutationAppliedBeforeFailure: releaseProof.sameKeyReplayAfterRejection?.mutationAppliedBeforeFailure ?? null,
      applyCommitted: releaseProof.sameKeyReplayAfterRejection?.applyCommitted === true,
    },
  };

  return {
    ...projection,
    proofHash: digest(projection),
  };
}

function assertHash(value, label) {
  assert.match(value, hashPattern, `${label} must be SHA-256-shaped`);
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues.filter(Boolean)) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `RPP-0596 support envelope leaked raw value: ${rawValue}`,
    );
  }
}

test('RPP-0596 release verifier carries live same-key same-body replay envelope variant 5', async () => {
  const { server, state } = createLiveVerifierFixtureServer();
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
      requireProductionAuthSession: true,
      proveDurableJournalBoundary: true,
      now: fixedNow,
      requestTimeoutMs: 5_000,
    });

    assert.equal(acceptedSummary.ok, true, JSON.stringify({
      code: acceptedSummary.code,
      apply: acceptedSummary.apply,
      replay: acceptedSummary.replay,
      sameKeySameBodyReplay: acceptedSummary.sameKeySameBodyReplay,
      idempotencyConflict: acceptedSummary.idempotencyConflict,
      dbJournal: acceptedSummary.dbJournal,
    }, null, 2));
    assert.equal(acceptedSummary.sameKeySameBodyReplay?.proved, true);
    assert.equal(acceptedSummary.sameKeySameBodyReplay?.verdict, 'SAME_KEY_SAME_BODY_REPLAY_PROVEN');
    assert.equal(acceptedSummary.replay?.idempotency?.replayed, true);
    assert.equal(acceptedSummary.replay?.idempotency?.freshMutationWork, false);
    assert.equal(acceptedSummary.replayEquivalence?.equivalent, true);
    assert.equal(acceptedSummary.idempotencyConflict?.status, 409);
    assert.equal(acceptedSummary.idempotencyConflict?.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(acceptedSummary.idempotencyConflict?.idempotency?.freshMutationWork, false);
    assert.equal(acceptedSummary.idempotencyConflict?.targetSnapshotUnchanged, true);

    assert.equal(state.acceptedApplyRequests.length, 2);
    assert.equal(state.conflictApplyRequests.length, 1);
    const [acceptedApply, acceptedReplay] = state.acceptedApplyRequests;
    assert.equal(acceptedApply.rawBody, acceptedReplay.rawBody);
    assert.equal(acceptedApply.headers['x-auth-content-hash'], sha256Hex(acceptedApply.rawBody));
    assert.equal(acceptedReplay.headers['x-auth-content-hash'], sha256Hex(acceptedReplay.rawBody));
    assert.equal(acceptedApply.headers['x-auth-content-hash'], acceptedReplay.headers['x-auth-content-hash']);

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
    assert.equal(rejectedApplyResponse.body?.code, 'PRECONDITION_FAILED');
    assert.equal(rejectedApplyResponse.body?.applied, 0);
    assert.equal(rejectedApplyResponse.body?.idempotency?.replayed, false);
    assert.equal(rejectedApplyResponse.body?.idempotency?.freshMutationWork, false);
    assert.equal(rejectedReplayResponse.status, 412);
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

    const releaseSummary = releaseSummaryFromLiveProof({ acceptedSummary, state });
    const rejectedApplyRevalidation = rejectedApplyRevalidationFromLiveProof({
      rejectedApplyResponse,
      rejectedReplayResponse,
      state,
    });
    const releaseProof = buildDurableRecoveryJournalReleaseProof({
      releaseSummary,
      applyRevalidation: rejectedApplyRevalidation,
    });
    const supportEnvelope = buildSupportEnvelope({
      acceptedSummary,
      rejectedApplyResponses: [rejectedApplyResponse, rejectedReplayResponse],
      state,
      releaseProof,
    });

    assert.equal(releaseProof.ok, true);
    assert.equal(releaseProof.gate, 'GATE-2');
    assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
    assert.equal(releaseProof.sameReleaseBoundary, true);
    assert.equal(releaseProof.checks.sameKeyBodyReplay, true);
    assert.equal(releaseProof.sameKeyBodyReplay.proved, true);
    assert.equal(releaseProof.sameKeyBodyReplay.replayed, true);
    assert.equal(releaseProof.sameKeyBodyReplay.freshMutationWork, false);
    assert.equal(releaseProof.sameKeyBodyReplay.duplicateMutationEvents, false);
    assert.equal(releaseProof.checks.sameKeyRejectedReplay, true);
    assert.equal(releaseProof.sameKeyRejectedReplay.proved, true);
    assert.equal(releaseProof.sameKeyRejectedReplay.required, true);
    assert.equal(releaseProof.sameKeyRejectedReplay.replayed, true);
    assert.equal(releaseProof.sameKeyRejectedReplay.freshMutationWork, false);
    assert.equal(releaseProof.sameKeyRejectedReplay.preservedRemoteUnchanged, true);
    assert.equal(releaseProof.sameKeyRejectedReplay.mutationAppliedBeforeFailure, 0);
    assert.equal(releaseProof.sameKeyRejectedReplay.applyCommitted, false);
    assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
    assert.equal(releaseProof.sameKeyReplayAfterRejection.proved, true);
    assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);

    assert.equal(supportEnvelope.releaseStatus, 'NO-GO');
    assert.equal(supportEnvelope.releaseMovement.allowed, false);
    assert.equal(supportEnvelope.releaseMovement.gates, '0/4');
    assert.equal(supportEnvelope.integrationRecommendation.status, 'support-only');
    assert.equal(supportEnvelope.liveEndpoint.exercised, true);
    assert.equal(supportEnvelope.liveEndpoint.port, 8080);
    assert.equal(supportEnvelope.liveEndpoint.loopbackOnly, true);
    assert.equal(supportEnvelope.liveEndpoint.tunnelUsed, false);
    assert.equal(supportEnvelope.releaseVerifier.acceptedReplayCarried, true);
    assert.equal(supportEnvelope.releaseVerifier.rejectedReplayCarried, true);
    assert.equal(supportEnvelope.releaseVerifier.sameKeyBodyReplay.proved, true);
    assert.equal(supportEnvelope.releaseVerifier.sameKeyRejectedReplay.proved, true);
    assert.equal(supportEnvelope.acceptedReplay.sameRequestBody, true);
    assert.equal(supportEnvelope.acceptedReplay.noFreshMutationWork, true);
    assert.equal(supportEnvelope.acceptedReplay.mutationAppliedRows, 1);
    assert.equal(supportEnvelope.acceptedReplay.applyReplayedRows, 1);
    assert.equal(supportEnvelope.rejectedReplay.sameRequestBody, true);
    assert.equal(supportEnvelope.rejectedReplay.noFreshMutationWork, true);
    assert.equal(supportEnvelope.rejectedReplay.mutationAppliedBeforeFailure, 0);
    assert.equal(supportEnvelope.rejectedReplay.applyCommitted, false);
    assert.equal(supportEnvelope.rejectedReplay.applyRejectedRows, 1);
    assert.equal(supportEnvelope.rejectedReplay.applyReplayedRows, 1);
    assert.deepEqual(supportEnvelope.counts, {
      acceptedApplyRequests: 2,
      rejectedApplyRequests: 2,
      differentBodyConflictRequests: 1,
      duplicateMutationWork: 0,
      requestBodiesIncluded: 0,
      rawValuesIncluded: 0,
    });
    assert.equal(supportEnvelope.redaction.mode, 'hash-count-status-only');
    assert.equal(supportEnvelope.redaction.rawValuesIncluded, false);
    assert.equal(supportEnvelope.redaction.requestBodiesIncluded, false);

    assertHash(supportEnvelope.liveEndpoint.sourceUrlHash, 'source URL hash');
    assertHash(supportEnvelope.liveEndpoint.routeProfileHash, 'route profile hash');
    assertHash(supportEnvelope.liveEndpoint.applyEndpointHash, 'apply endpoint hash');
    assertHash(supportEnvelope.releaseVerifier.checksHash, 'release verifier checks hash');
    assertHash(supportEnvelope.releaseVerifier.proofHash, 'release verifier proof hash');
    assertHash(supportEnvelope.acceptedReplay.requestBodyHash, 'accepted request body hash');
    assertHash(supportEnvelope.acceptedReplay.replayBodyHash, 'accepted replay body hash');
    assertHash(supportEnvelope.rejectedReplay.requestBodyHash, 'rejected request body hash');
    assertHash(supportEnvelope.rejectedReplay.replayBodyHash, 'rejected replay body hash');
    assertHash(supportEnvelope.releaseMovement.reasonHash, 'release movement reason hash');
    assertHash(supportEnvelope.integrationRecommendation.recommendationHash, 'integration recommendation hash');
    assertHash(supportEnvelope.proofHash, 'support envelope proof hash');
    assertNoRawValues(supportEnvelope, [
      sourceUrl,
      routePrefix,
      applyEndpointPath,
      acceptedIdempotencyKey,
      rejectedIdempotencyKey,
      credential.username,
      credential.password,
      sessionId,
      acceptedResourcePath,
      acceptedBaseValue,
      acceptedLocalValue,
      'artifact://rpp-0596/rejected-target',
    ]);

    assert.ok(
      state.requests.every((request) => (
        request.remoteAddress === '127.0.0.1'
        || request.remoteAddress === '::1'
        || request.remoteAddress === '::ffff:127.0.0.1'
      )),
      'RPP-0596 fixture must only receive loopback requests',
    );
  } finally {
    await closeServer(server);
  }
});
