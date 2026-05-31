import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveReleaseVerifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-live-release-verify.mjs');
const liveReleaseVerifierSource = readFileSync(liveReleaseVerifierPath, 'utf8');
const sourceUrl = 'https://source.example.test';
const routePrefix = '/wp-json/reprint/v1/push';
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const credential = {
  username: 'rpp_0540_admin',
  password: 'rpp-0540-application-password-should-not-leak',
};
const idempotencyKey = 'idem-rpp-0540-raw-idempotency-key';
const sessionId = 'psh_rpp_0540_raw_session_id';
const rawPayload = 'rpp-0540-private-payload-value';
const rawOptionValue = 'rpp-0540-private-option-value';
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
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function productionAuditEventSchema() {
  return {
    schemaVersion: 1,
    schemaId: 'reprint-push-production-audit-event/v1',
    routeEvidence: {
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      journalRoute: '/push/db-journal',
      schemaRoute: '/push/db-journal/schema',
      checkedSurface: 'production-shaped-rest-route',
    },
    eventStore: {
      storage: 'wpdb',
      appendOnlyEvents: true,
      sequenceField: 'sequence',
      cursorPrefix: 'db-journal:',
    },
    eventShape: {
      type: 'object',
      required: ['schemaVersion', 'sequence', 'event', 'resourceHashEvidence'],
    },
    redaction: {
      format: 'hash-only',
      rawValuesIncluded: false,
      hashAlgorithm: 'sha256',
      hashOnlyFields: [
        'idempotencyKeyHash',
        'requestHash',
        'resourceHashEvidence.*Hash',
      ],
      forbiddenRawFields: [
        'value',
        'content',
        'payload',
        'post_content',
        'option_value',
        'meta_value',
      ],
    },
  };
}

function functionBody(source, name) {
  const declaration = `function ${name}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const signatureEnd = source.indexOf(') {', start);
  const open = signatureEnd === -1
    ? source.indexOf('{', start)
    : signatureEnd + 2;
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function countAuditSchemaBlocks(value) {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  const ownCount = value.schemaId === 'reprint-push-production-audit-event/v1' ? 1 : 0;
  return ownCount + Object.values(value).reduce(
    (count, child) => count + countAuditSchemaBlocks(child),
    0,
  );
}

function assertHashOnlyFields(value, fields) {
  for (const field of fields) {
    assert.match(value[field], hashPattern, `${field} must be a bare sha256 hash`);
  }
}

function assertNoRawValues(value, rawValues) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `release evidence leaked raw value ${rawValue}`,
    );
  }
}

function buildVerifyReleaseStyleSummary(pushSummary) {
  const dbJournal = pushSummary.dbJournal || {};
  return {
    ok: false,
    releaseStatus: 'NO-GO',
    command: 'npm run verify:release',
    checkedCommand: 'timeout 300s npm run verify:release',
    statusMarker: '[verify-release:held exit=1 reason=PRODUCTION_EVIDENCE_REQUIRED mutationAttempted=false]',
    mutationAttempted: false,
    dbJournal: {
      status: dbJournal.status ?? null,
      ok: dbJournal.ok === true,
      scope: dbJournal.scope || null,
      rows: dbJournal.rows ?? null,
      rowCount: dbJournal.rowCount ?? null,
      applyCommitted: dbJournal.applyCommitted === true,
      mutationApplied: dbJournal.mutationApplied ?? null,
      idempotencyOpened: dbJournal.idempotencyOpened ?? null,
      eventCounts: dbJournal.eventCounts || {},
      latestEvents: dbJournal.latestEvents || [],
      auditEventSchema: dbJournal.auditEventSchema || null,
    },
    productionAuditEventSchema: {
      ok: dbJournal.auditEventSchema?.schemaId === 'reprint-push-production-audit-event/v1',
      summaryPath: 'dbJournal.auditEventSchema',
      schemaHash: dbJournal.auditEventSchema?.schemaHash || '',
      routeEvidence: dbJournal.auditEventSchema?.routeEvidence || null,
      redaction: dbJournal.auditEventSchema?.redaction || null,
      required: [
        'dbJournal.auditEventSchema.routeEvidence.journalRoute',
        'dbJournal.auditEventSchema.routeEvidence.schemaRoute',
        'dbJournal.auditEventSchema.redaction.rawValuesIncluded=false',
      ],
      scope: 'local-executor-auth-support',
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'production-backed endpoint proof required before release movement',
    },
    boundary: {
      firstRemainingProductionBoundary: 'checked production-backed endpoint proof',
      status: 'blocked',
      verdict: 'PRODUCTION_EVIDENCE_REQUIRED',
    },
  };
}

test('RPP-0540 v2 verify:release summary carries one production audit schema route-evidence block', async () => {
  const originalFetch = global.fetch;
  const auditEventSchema = productionAuditEventSchema();
  const auth = {
    identity: {
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
  const seen = [];
  let applyCount = 0;

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    const rawBody = typeof options.body === 'string' ? options.body : '';
    const headers = headerEntries(options.headers);
    seen.push({ pathname, rawBody, headers });

    if (pathname === `${routePrefix}/preflight`) {
      return jsonResponse({
        ok: true,
        auth,
        session: { id: sessionId },
      });
    }

    if (pathname === `${routePrefix}/snapshot`) {
      return jsonResponse({
        ok: true,
        snapshot: { resources: [] },
      });
    }

    if (pathname === `${routePrefix}/dry-run`) {
      return jsonResponse({
        ok: true,
        mode: 'dry-run',
        auth,
        receipt: { receiptHash: sha256Hex('rpp-0540-receipt') },
      });
    }

    if (pathname === `${routePrefix}/recovery/inspect`) {
      return jsonResponse({
        ok: true,
        auth,
        recovery: {
          state: 'ok',
          journal: { integrity: { status: 'ok' } },
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
        },
      });
    }

    if (pathname === `${routePrefix}/apply`) {
      applyCount += 1;
      return jsonResponse({
        ok: true,
        mode: 'apply',
        applied: 0,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth,
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        idempotency: {
          replayed: applyCount === 2,
          freshMutationWork: applyCount === 1,
          conflict: false,
          idempotencyKeyHash: sha256Hex(idempotencyKey),
          requestHash: headers['x-auth-content-hash'],
        },
      });
    }

    if (pathname === `${routePrefix}/db-journal`) {
      return jsonResponse({
        ok: true,
        auth,
        dbJournal: {
          scope: trustedDbJournalScope,
          auditEventSchema,
          latestRows: [
            {
              schemaVersion: 1,
              sequence: 1,
              event: 'idempotency-opened',
              idempotencyKeyHash: sha256Hex(idempotencyKey),
              requestHash: sha256Hex(rawPayload),
              resourceHashEvidence: { beforeHash: sha256Hex(rawOptionValue) },
            },
            {
              schemaVersion: 1,
              sequence: 2,
              event: 'mutation-applied',
              idempotencyKeyHash: sha256Hex(idempotencyKey),
              requestHash: sha256Hex(rawPayload),
              resourceHashEvidence: { afterHash: sha256Hex(`${rawOptionValue}:after`) },
            },
            {
              schemaVersion: 1,
              sequence: 3,
              event: 'apply-committed',
              idempotencyKeyHash: sha256Hex(idempotencyKey),
              requestHash: sha256Hex(rawPayload),
            },
          ],
          eventSummaries: [
            { event: 'idempotency-opened', count: 1 },
            { event: 'mutation-applied', count: 1 },
            { event: 'apply-committed', count: 1 },
          ],
          ownership: {
            ownsJournal: true,
            restartReadable: true,
            productionAdapter: 'filesystem-compare-rename',
            supportedSurface: 'claim-fenced-restart-readable',
          },
          leaseFence: {
            boundary: 'filesystem-compare-rename',
            claimKeyUnique: true,
            monotonicSequence: true,
            restartReadable: true,
            staleClaimRejected: false,
          },
        },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
      });
    }

    throw new Error(`unexpected fetch for RPP-0540: ${pathname}`);
  };

  try {
    const pushSummary = await runAuthenticatedHttpPush({
      sourceUrl,
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
    });
    const verifyReleaseSummary = buildVerifyReleaseStyleSummary(pushSummary);

    assert.equal(pushSummary.ok, true, JSON.stringify(pushSummary, null, 2));
    assert.deepEqual(
      seen.map((entry) => entry.pathname),
      [
        `${routePrefix}/preflight`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/dry-run`,
        `${routePrefix}/apply`,
        `${routePrefix}/recovery/inspect`,
        `${routePrefix}/apply`,
        `${routePrefix}/snapshot`,
        `${routePrefix}/db-journal`,
      ],
    );
    assert.equal(pushSummary.dbJournal.auditEventSchema.schemaVersion, 1);
    assert.equal(pushSummary.dbJournal.auditEventSchema.schemaId, 'reprint-push-production-audit-event/v1');
    assert.equal(pushSummary.dbJournal.auditEventSchema.schemaHash, digest(auditEventSchema));
    assert.deepEqual(pushSummary.dbJournal.auditEventSchema.routeEvidence, {
      routeProfile: 'production-shaped',
      restNamespace: 'reprint/v1',
      routePrefix: '/push',
      journalRoute: '/push/db-journal',
      schemaRoute: '/push/db-journal/schema',
      checkedSurface: 'production-shaped-rest-route',
    });
    assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.format, 'hash-only');
    assert.equal(pushSummary.dbJournal.auditEventSchema.redaction.rawValuesIncluded, false);
    assert.ok(pushSummary.dbJournal.auditEventSchema.eventRequiredFields.includes('resourceHashEvidence'));

    assert.equal(verifyReleaseSummary.productionAuditEventSchema.ok, true);
    assert.equal(verifyReleaseSummary.productionAuditEventSchema.summaryPath, 'dbJournal.auditEventSchema');
    assert.equal(
      verifyReleaseSummary.productionAuditEventSchema.schemaHash,
      pushSummary.dbJournal.auditEventSchema.schemaHash,
    );
    assert.deepEqual(
      verifyReleaseSummary.productionAuditEventSchema.routeEvidence,
      pushSummary.dbJournal.auditEventSchema.routeEvidence,
    );
    assert.equal(countAuditSchemaBlocks(verifyReleaseSummary), 1);
    assert.equal(verifyReleaseSummary.releaseStatus, 'NO-GO');
    assert.deepEqual(verifyReleaseSummary.releaseMovement, {
      allowed: false,
      gates: '0/4',
      reason: 'production-backed endpoint proof required before release movement',
    });
    assert.equal(verifyReleaseSummary.boundary.verdict, 'PRODUCTION_EVIDENCE_REQUIRED');

    assertNoRawValues(verifyReleaseSummary, [
      credential.username,
      credential.password,
      idempotencyKey,
      sessionId,
      rawPayload,
      rawOptionValue,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0540 v2 auth failure evidence stays hash-only and cannot move release', async () => {
  const originalFetch = global.fetch;
  const authFailureEvidence = {
    schemaVersion: 1,
    code: 'reprint_push_lab_auth_required',
    phase: 'schema-route-auth',
    credentialHash: sha256Hex(`${credential.username}\n${credential.password}`),
    sourceUrlHash: sha256Hex(sourceUrl),
    sessionHash: sha256Hex(sessionId),
    payloadHash: sha256Hex(rawPayload),
    idempotencyKeyHash: sha256Hex(idempotencyKey),
    mutationAttempted: false,
  };

  global.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    assert.equal(pathname, `${routePrefix}/preflight`);
    return jsonResponse({
      ok: false,
      code: 'reprint_push_lab_auth_required',
      evidence: authFailureEvidence,
    }, 401);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl,
      base: { resources: [] },
      local: { resources: [] },
      username: credential.username,
      applicationPassword: credential.password,
      idempotencyKey,
      routeProfile: 'production-shaped',
    });
    const heldSummary = {
      ok: false,
      releaseStatus: 'NO-GO',
      command: 'npm run verify:release',
      checkedCommand: 'timeout 300s npm run verify:release',
      statusMarker: '[verify-release:held exit=1 reason=reprint_push_lab_auth_required mutationAttempted=false]',
      preflight: summary.preflight,
      authFailure: authFailureEvidence,
      dbJournal: summary.dbJournal,
      releaseMovement: {
        allowed: false,
        gates: '0/4',
        reason: 'authenticated production audit schema route evidence is required',
      },
      boundary: {
        firstRemainingProductionBoundary: 'authenticated audit schema route proof',
        status: 'blocked',
        verdict: 'reprint_push_lab_auth_required',
      },
    };

    assert.equal(summary.ok, false);
    assert.equal(summary.preflight.status, 401);
    assert.equal(summary.code, 'reprint_push_lab_auth_required');
    assert.equal(summary.dbJournal, null);
    assert.equal(heldSummary.releaseStatus, 'NO-GO');
    assert.equal(heldSummary.releaseMovement.allowed, false);
    assertHashOnlyFields(authFailureEvidence, [
      'credentialHash',
      'sourceUrlHash',
      'sessionHash',
      'payloadHash',
      'idempotencyKeyHash',
    ]);
    assertNoRawValues(heldSummary, [
      credential.username,
      credential.password,
      idempotencyKey,
      sessionId,
      rawPayload,
      rawOptionValue,
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('RPP-0540 v2 combined verifier source preserves release proof dbJournal in one emitted summary', () => {
  const emitCombinedReleaseProof = functionBody(liveReleaseVerifierSource, 'emitCombinedReleaseProof');
  const topologyEvidence = functionBody(liveReleaseVerifierSource, 'buildReleaseTopologyEvidence');

  assert.match(emitCombinedReleaseProof, /\.\.\.verify,\s*gate2DurableRecoveryJournal:/s);
  assert.match(emitCombinedReleaseProof, /topologyEvidence:\s*buildReleaseTopologyEvidence\(/);
  assert.equal(
    (topologyEvidence.match(/auditEventSchema/g) || []).length,
    0,
    'topology evidence must not duplicate the dbJournal audit schema summary',
  );
  assert.equal(
    (emitCombinedReleaseProof.match(/dbJournal/g) || []).length,
    0,
    'combined proof should carry dbJournal through the release proof spread',
  );
});
