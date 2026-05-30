import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const trustedDbJournalScope = 'checked live production-shaped journal surface; not local Playground fixture only';
const session = {
  type: 'production-auth-session',
  status: 'active',
  id: 'psh_01j00000000000000000000000',
  expiresAt: '2030-01-01T00:00:00Z',
};
const auth = {
  identity: {
    userLogin: 'reprint_push_admin',
    capabilities: { manage_options: true },
  },
  session,
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerEntries(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [
    key.toLowerCase(),
    value,
  ]));
}

function dbJournalBody() {
  return {
    ok: true,
    auth,
    dbJournal: {
      scope: trustedDbJournalScope,
      latestRows: [
        { sequence: 1, event: 'idempotency-opened' },
        { sequence: 2, event: 'mutation-applied' },
        { sequence: 3, event: 'apply-committed' },
        { sequence: 4, event: 'apply-replayed', appliedCount: 0 },
      ],
      claim: {
        status: 'active',
        activeClaimId: session.id,
        activeClaimKeyHash: session.id,
        activeClaimSequence: 1,
        activeClaimEvent: 'recovery-claim-opened',
        staleClaimRejected: false,
      },
      ownership: {
        ownsJournal: true,
        restartReadable: true,
        productionAdapter: 'filesystem-compare-rename',
        supportedSurface: 'claim-fenced-restart-readable',
      },
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: session.id,
        claimKeyHash: session.id,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'filesystem-compare-rename',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
      leaseFence: {
        boundary: 'filesystem-compare-rename',
        claimKeyUnique: true,
        fsyncEvidence: true,
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
  };
}

test('RPP-0516 production apply route replays a committed same-key same-body request before conflict handling', () => {
  const applyWithJournal = functionBody('reprint_push_lab_rest_apply_with_db_journal');

  assertBefore(
    applyWithJournal,
    "reprint_push_lab_db_journal_committed_row_for_key($context['idempotencyKeyHash'])",
    "reprint_push_lab_db_journal_key_has_different_request($context['idempotencyKeyHash'], $context['requestHash'])",
  );
  assertBefore(
    applyWithJournal,
    "reprint_push_lab_db_journal_terminal_row_for_key($context['idempotencyKeyHash'])",
    "reprint_push_lab_db_journal_try_open_idempotency($context)",
  );
  assert.match(applyWithJournal, /\$committed\['request_hash'\]\s*\?\?\s*''\)\s*===\s*\$context\['requestHash'\]/);
  assert.match(applyWithJournal, /reprint_push_lab_db_journal_replay_result\(\$committed\)/);
  assert.match(applyWithJournal, /reprint_push_lab_db_journal_append_event\('apply-replayed'/);
  assert.match(applyWithJournal, /'appliedCount'\s*=>\s*0/);
  assert.match(applyWithJournal, /'freshMutationWork'\s*=>\s*false/);
});

test('RPP-0516 executor records same-key same-body replay proof with fresh nonce over the local fake endpoint pattern', async () => {
  const originalFetch = global.fetch;
  const applyRequests = [];
  let applyCount = 0;

  global.fetch = async (url, options = {}) => {
    const pathname = String(url);
    if (pathname.includes('/preflight')) {
      return json({
        ok: true,
        auth,
        session: { id: session.id },
      });
    }
    if (pathname.includes('/snapshot')) {
      return json({
        ok: true,
        snapshot: { resources: [] },
      });
    }
    if (pathname.includes('/dry-run')) {
      return json({
        ok: true,
        mode: 'dry-run',
        auth,
        receipt: { receiptHash: 'receipt-rpp-0516' },
      });
    }
    if (pathname.includes('/recovery/inspect')) {
      return json({
        ok: true,
        auth,
        recovery: {
          state: 'fully-updated-remote',
          counts: { old: 0, new: 1, blockedUnknown: 0, total: 1 },
          journal: { integrity: { status: 'ok' } },
        },
      });
    }
    if (pathname.includes('/db-journal')) {
      return json(dbJournalBody());
    }
    if (pathname.includes('/apply')) {
      applyCount += 1;
      const headers = headerEntries(options.headers);
      applyRequests.push({
        body: String(options.body || ''),
        idempotencyKey: headers['x-reprint-push-idempotency-key'],
        nonce: headers['x-auth-nonce'],
        contentHash: headers['x-auth-content-hash'],
        authSignature: headers['x-auth-signature'],
        pushSignature: headers['x-reprint-push-signature'],
      });

      return json({
        ok: true,
        mode: 'apply',
        applied: 1,
        code: applyCount === 1 ? 'APPLIED' : 'BATCH_ALREADY_COMMITTED',
        responseSchemaVersion: 1,
        auth,
        receipt: { receiptHash: 'receipt-rpp-0516' },
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        idempotency: {
          replayed: applyCount !== 1,
          freshMutationWork: applyCount === 1,
          conflict: false,
          status: applyCount === 1 ? 'fresh' : 'replayed',
        },
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  try {
    const summary = await runAuthenticatedHttpPush({
      sourceUrl: 'http://127.0.0.1:8080',
      base: { resources: [] },
      local: { resources: [] },
      username: 'reprint_push_admin',
      applicationPassword: 'reprint-push-admin-app-password',
      idempotencyKey: 'idem-rpp-0516-same-key-body',
      routeProfile: 'production-shaped',
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.code, undefined);
    assert.equal(summary.sameKeySameBodyReplay?.proved, true);
    assert.equal(summary.sameKeySameBodyReplay?.verdict, 'SAME_KEY_SAME_BODY_REPLAY_PROVEN');
    assert.equal(summary.sameKeySameBodyReplay?.signedContentHashesMatch, true);
    assert.equal(summary.sameKeySameBodyReplay?.signedContentHashMatchesSubmittedBody, true);
    assert.equal(summary.sameKeySameBodyReplay?.replayed, true);
    assert.equal(summary.sameKeySameBodyReplay?.noFreshMutationWork, true);
    assert.equal(summary.sameKeySameBodyReplay?.replayEquivalent, true);
    assert.equal(summary.replay?.idempotency?.replayed, true);
    assert.equal(summary.replay?.idempotency?.freshMutationWork, false);
    assert.equal(summary.replayEquivalence?.equivalent, true);
    assert.equal(applyRequests.length, 2);
    assert.equal(applyRequests[0].idempotencyKey, 'idem-rpp-0516-same-key-body');
    assert.equal(applyRequests[1].idempotencyKey, 'idem-rpp-0516-same-key-body');
    assert.equal(applyRequests[0].body, applyRequests[1].body);
    assert.equal(applyRequests[0].contentHash, applyRequests[1].contentHash);
    assert.notEqual(applyRequests[0].nonce, applyRequests[1].nonce);
    assert.notEqual(applyRequests[0].authSignature, applyRequests[1].authSignature);
    assert.equal(applyRequests[0].pushSignature, applyRequests[1].pushSignature);
    assert.match(summary.sameKeySameBodyReplay.requestBodyHash, /^[a-f0-9]{64}$/);
    assert.match(summary.sameKeySameBodyReplay.idempotencyKeyHash, /^[a-f0-9]{64}$/);
    assert.equal(summary.sameKeySameBodyReplay.applyContentHash, summary.sameKeySameBodyReplay.requestBodyHash);
    assert.equal(summary.sameKeySameBodyReplay.replayContentHash, summary.sameKeySameBodyReplay.requestBodyHash);
  } finally {
    global.fetch = originalFetch;
  }
});
