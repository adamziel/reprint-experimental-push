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
const sourceUrl = 'http://127.0.0.1:8080';
const routePrefix = '/wp-json/reprint/v1/push';
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sessionId = 'psh_01j00000000000000000537';
const credential = {
  username: 'reprint_push_admin',
  password: 'reprint-push-admin-app-password',
};
const auth = {
  identity: {
    userId: 537,
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
  return sha256Hex(`rpp-0537:${label}`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
      expiresAt: '2030-01-01T00:00:00Z',
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

function checkedJournal({ idempotencyKeyHash, requestHash, conflictRequestHash }) {
  const activeClaimKeyHash = fixtureHash('active-claim-key');
  const rows = [
    {
      sequence: 1,
      event: 'idempotency-opened',
      idempotencyKeyHash,
      requestHash,
    },
    {
      sequence: 2,
      event: 'apply-started',
      idempotencyKeyHash,
      requestHash,
    },
    {
      sequence: 3,
      event: 'mutation-applied',
      idempotencyKeyHash,
      requestHash,
      appliedCount: 1,
    },
    {
      sequence: 4,
      event: 'apply-committed',
      idempotencyKeyHash,
      requestHash,
      appliedCount: 1,
    },
    {
      sequence: 5,
      event: 'apply-replayed',
      idempotencyKeyHash,
      requestHash,
      appliedCount: 0,
    },
    {
      sequence: 6,
      event: 'idempotency-key-conflict',
      idempotencyKeyHash,
      requestHash: conflictRequestHash,
      errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
      appliedCount: 0,
    },
  ];

  return {
    scope: trustedDbJournalScope,
    latestRows: rows,
    rowCount: rows.length,
    eventSummaries: [
      { event: 'idempotency-opened', count: 1 },
      { event: 'apply-started', count: 1 },
      { event: 'mutation-applied', count: 1 },
      { event: 'apply-committed', count: 1 },
      { event: 'apply-replayed', count: 1 },
      { event: 'idempotency-key-conflict', count: 1 },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId: sessionId,
      activeClaimKeyHash,
      activeClaimSequence: 2,
      activeClaimEvent: 'stale-claim-rejected',
      previousClaimId: 'psh_01j00000000000000000536',
      previousClaimKeyHash: fixtureHash('previous-claim-key'),
      previousClaimSequence: 1,
      previousClaimEvent: 'recovery-claim-opened',
      idempotencyKeyHash,
      requestHash,
      staleClaimRejected: true,
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
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: sessionId,
        claimKeyHash: activeClaimKeyHash,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  };
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

test('RPP-0537 v2 route checks different-body idempotency conflict before mutation setup', () => {
  const applyWithJournal = functionBody('reprint_push_lab_rest_apply_with_db_journal');
  const conflictResult = functionBody('reprint_push_lab_rest_idempotency_conflict_result');

  assertBefore(
    applyWithJournal,
    'reprint_push_lab_db_journal_key_has_different_request',
    'reprint_push_lab_db_journal_try_open_idempotency',
  );
  assertBefore(
    applyWithJournal,
    'reprint_push_lab_rest_idempotency_conflict_result($context)',
    'reprint_push_lab_rest_run_db_journal_apply',
  );

  assert.match(conflictResult, /'code'\s*=>\s*'IDEMPOTENCY_KEY_CONFLICT'/);
  assert.match(conflictResult, /'status'\s*=>\s*'conflict'/);
  assert.match(conflictResult, /'freshMutationWork'\s*=>\s*false/);
  assert.match(conflictResult, /'mutationEventCounts'\s*=>\s*\$mutation_counts/);
});

test('RPP-0537 v2 proves same-key different-body conflict is hash-only before fresh mutation work', async () => {
  const originalFetch = global.fetch;
  const idempotencyKey = 'idem-rpp-0537-same-key-different-body-v2';
  const idempotencyKeyHash = sha256Hex(idempotencyKey);
  const receiptHash = fixtureHash('dry-run-receipt');
  const base = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0537.txt': 'base-body',
    },
    plugins: {},
    db: {},
  };
  const local = {
    files: {
      'wp-content/uploads/reprint-push/rpp-0537.txt': 'local-body',
    },
    plugins: {},
    db: {},
  };
  const seen = [];
  let currentSnapshot = base;
  let applyCount = 0;
  let mutationWorkCount = 0;
  let conflictMutationWorkCount = 0;
  let conflictResponseBody = null;

  global.fetch = async (url, options = {}) => {
    const urlString = String(url);
    const pathname = new URL(urlString).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    const headers = headerEntries(options.headers);
    const contentHash = headers['x-auth-content-hash'] || sha256Hex('');
    seen.push({ pathname, rawBody, body, headers });

    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth,
        session: { id: sessionId, expiresAt: auth.session.expiresAt },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: currentSnapshot,
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        responseSchemaVersion: 1,
        auth,
        receipt: receiptForPlan(body.plan, idempotencyKey),
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    if (pathname === `${routePrefix}/recovery/inspect`) {
      return jsonResponse({
        ok: true,
        mode: 'inspect',
        responseSchemaVersion: 1,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: body.plan.mutations.length, blockedUnknown: 0, total: body.plan.mutations.length },
          journal: { integrity: { status: 'ok' } },
        },
        signedRequest: signedRequest(pathname, contentHash),
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      assert.equal(headers['x-reprint-push-session'], sessionId);
      assert.equal(headers['x-reprint-push-idempotency-key'], idempotencyKey);

      if (body.durableJournalBoundaryProbe) {
        const applyRequests = seen.filter((entry) => entry.pathname === `${routePrefix}/apply`);
        const originalRequestHash = applyRequests[0].headers['x-auth-content-hash'];
        assert.equal(applyCount, 2, 'conflict probe must run after initial apply and same-body replay');
        assert.deepEqual(currentSnapshot, local, 'conflict probe must start from the already-applied target snapshot');

        conflictResponseBody = {
          ok: false,
          mode: 'apply',
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          responseSchemaVersion: 1,
          auth,
          idempotency: {
            conflict: true,
            replayed: false,
            freshMutationWork: false,
            status: 'conflict',
            idempotencyKeyHash,
            requestHash: contentHash,
            conflictingRequestHash: originalRequestHash,
            mutationEventCounts: {
              prepared: 0,
              applied: 0,
              preconditionFailed: 0,
            },
          },
          storageGuard: storageGuard(),
          signedRequest: signedRequest(pathname, contentHash),
        };

        return jsonResponse(conflictResponseBody, 409);
      }

      applyCount += 1;
      if (applyCount === 1) {
        mutationWorkCount += body.plan.mutations.length;
        currentSnapshot = local;
      }

      return jsonResponse({
        ok: true,
        mode: 'apply',
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        applied: body.plan.mutations.length,
        responseSchemaVersion: 1,
        auth,
        receipt: body.receipt,
        idempotency: {
          replayed: applyCount > 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
          status: applyCount === 1 ? 'fresh' : 'replayed',
          idempotencyKeyHash,
          requestHash: contentHash,
        },
        storageGuard: storageGuard(),
        signedRequest: signedRequest(pathname, contentHash),
        applyRevalidation: applyRevalidationEvidence(body.plan, body.receipt),
      });
    }

    if (pathname === `${routePrefix}/db-journal`) {
      const applyRequests = seen.filter((entry) => entry.pathname === `${routePrefix}/apply`);
      return jsonResponse({
        ok: true,
        auth,
        dbJournal: checkedJournal({
          idempotencyKeyHash,
          requestHash: applyRequests[0].headers['x-auth-content-hash'],
          conflictRequestHash: applyRequests[2].headers['x-auth-content-hash'],
        }),
        storageGuard: storageGuard(),
      });
    }

    throw new Error(`unexpected fetch to ${urlString}`);
  };

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
      proveDurableJournalBoundary: true,
      now: fixedNow,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.apply.receiptHash, receiptHash);
    assert.equal(summary.replay.receiptHash, receiptHash);
    assert.equal(summary.sameKeySameBodyReplay.proved, true);
    assert.equal(summary.sameKeySameBodyReplay.noFreshMutationWork, true);
    assert.equal(summary.replay.idempotency.replayed, true);
    assert.equal(summary.replay.idempotency.freshMutationWork, false);

    assert.equal(summary.idempotencyConflict.status, 409);
    assert.equal(summary.idempotencyConflict.code, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal(summary.idempotencyConflict.idempotency.conflict, true);
    assert.equal(summary.idempotencyConflict.idempotency.replayed, false);
    assert.equal(summary.idempotencyConflict.idempotency.freshMutationWork, false);
    assert.equal(summary.idempotencyConflict.idempotency.status, 'conflict');
    assert.equal(summary.idempotencyConflict.idempotency.idempotencyKeyHash, idempotencyKeyHash);
    assert.equal(summary.idempotencyConflict.hashOnly, true);
    assert.equal(summary.idempotencyConflict.targetSnapshotUnchanged, true);
    assert.equal(summary.idempotencyConflict.finalMatchesLocal, true);
    assert.match(summary.idempotencyConflict.idempotency.idempotencyKeyHash, /^[a-f0-9]{64}$/);
    assert.match(summary.idempotencyConflict.idempotency.requestHash, /^[a-f0-9]{64}$/);

    const applyRequests = seen.filter((entry) => entry.pathname === `${routePrefix}/apply`);
    assert.equal(applyRequests.length, 3);
    const [applyRequest, replayRequest, conflictRequest] = applyRequests;
    assert.deepEqual(applyRequest.body, replayRequest.body);
    assert.notDeepEqual(applyRequest.body, conflictRequest.body);
    assert.equal(conflictRequest.body.receipt.receiptHash, applyRequest.body.receipt.receiptHash);
    assert.equal(conflictRequest.body.durableJournalBoundaryProbe.type, 'same-key-different-body-conflict-before-mutation');

    for (const request of applyRequests) {
      assert.equal(request.headers['x-reprint-push-session'], sessionId);
      assert.equal(request.headers['x-reprint-push-idempotency-key'], idempotencyKey);
      assert.equal(request.headers['x-auth-content-hash'], sha256Hex(request.rawBody));
    }

    assert.equal(applyRequest.headers['x-auth-content-hash'], replayRequest.headers['x-auth-content-hash']);
    assert.notEqual(applyRequest.headers['x-auth-content-hash'], conflictRequest.headers['x-auth-content-hash']);
    assert.equal(summary.idempotencyConflict.idempotency.requestHash, conflictRequest.headers['x-auth-content-hash']);
    assert.equal(conflictResponseBody.idempotency.conflictingRequestHash, applyRequest.headers['x-auth-content-hash']);
    assert.notEqual(conflictResponseBody.idempotency.conflictingRequestHash, conflictResponseBody.idempotency.requestHash);
    assert.deepEqual(conflictResponseBody.idempotency.mutationEventCounts, {
      prepared: 0,
      applied: 0,
      preconditionFailed: 0,
    });

    assert.equal(applyRequest.headers['x-reprint-push-signature'], replayRequest.headers['x-reprint-push-signature']);
    assert.notEqual(applyRequest.headers['x-reprint-push-signature'], conflictRequest.headers['x-reprint-push-signature']);
    assert.notEqual(applyRequest.headers['x-auth-nonce'], replayRequest.headers['x-auth-nonce']);
    assert.notEqual(applyRequest.headers['x-auth-signature'], replayRequest.headers['x-auth-signature']);

    assert.equal(mutationWorkCount, 1);
    assert.equal(conflictMutationWorkCount, 0);
    assert.equal(summary.dbJournal.eventCounts['idempotency-opened'], 1);
    assert.equal(summary.dbJournal.eventCounts['mutation-applied'], 1);
    assert.equal(summary.dbJournal.eventCounts['apply-replayed'], 1);
    assert.equal(summary.dbJournal.eventCounts['idempotency-key-conflict'], 1);
    assert.equal(summary.dbJournal.mutationApplied, 1);
    assert.equal(summary.dbJournal.leaseFence.staleClaimRejected, true);
    assert.equal(
      summary.dbJournal.latestEvents.find((entry) => entry.event === 'idempotency-key-conflict')?.requestHash,
      conflictRequest.headers['x-auth-content-hash'],
    );
    assert.equal(
      summary.dbJournal.latestEvents.find((entry) => entry.event === 'idempotency-key-conflict')?.appliedCount,
      0,
    );

    assertNoRawValues(conflictResponseBody.idempotency, [
      idempotencyKey,
      credential.password,
      sessionId,
      base.files['wp-content/uploads/reprint-push/rpp-0537.txt'],
      local.files['wp-content/uploads/reprint-push/rpp-0537.txt'],
    ]);
    assertNoRawValues({
      sameKeySameBodyReplay: summary.sameKeySameBodyReplay,
      idempotencyConflict: summary.idempotencyConflict.idempotency,
    }, [
      idempotencyKey,
      credential.password,
      base.files['wp-content/uploads/reprint-push/rpp-0537.txt'],
      local.files['wp-content/uploads/reprint-push/rpp-0537.txt'],
      'durableJournalBoundaryProbe',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
