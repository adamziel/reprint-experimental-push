import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { runAuthenticatedHttpPush } from '../src/authenticated-http-push-client.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sourcePostResourceKey = 'row:["wp_postmeta","meta_id:38201"]';
const unsupportedTargetResourceKey = 'row:["wp_posts","ID:38202"]';
const forbiddenFixtureValues = Object.freeze([
  'RPP-0382 private unsupported nav target',
  'RPP-0382 private nav body',
  'RPP-0382 private thumbnail meta payload',
]);
const sha256HexPattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function featuredImageUnsupportedSurfaceSnapshots() {
  const base = {
    files: {},
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0382 base parent post',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_postmeta: {},
    },
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts['ID:38202'] = {
    ID: 38202,
    post_title: 'RPP-0382 private unsupported nav target',
    post_content: 'RPP-0382 private nav body',
    post_status: 'publish',
    post_type: 'nav_menu_item',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_postmeta['meta_id:38201'] = {
    meta_id: 38201,
    post_id: 1,
    meta_key: '_thumbnail_id',
    meta_value: '38202',
    private_payload: 'RPP-0382 private thumbnail meta payload',
  };

  return { base, local, remote };
}

async function withReleaseVerifierProbeServer(remoteSnapshot, callback) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const path = url.pathname;
    const body = await readRequestBody(request);
    requests.push({ method: request.method, path, bodyLength: body.length });

    if (request.method === 'GET' && path === '/wp-json/reprint/v1/push/preflight') {
      writeJson(response, 200, {
        ok: true,
        routeProfile: 'production-shaped',
        session: {
          id: 'psh_RPP0382session01',
          type: 'push-session',
        },
        auth: {
          identity: {
            userId: 382,
            userLogin: 'rpp0382-admin',
            capabilities: {
              manage_options: true,
            },
          },
          session: {
            id: 'psh_RPP0382session01',
            type: 'push-session',
            status: 'active',
            expiresAt: '2026-06-30T00:00:00.000Z',
          },
        },
      });
      return;
    }

    if (request.method === 'GET' && path === '/wp-json/reprint/v1/push/snapshot') {
      writeJson(response, 200, {
        ok: true,
        snapshot: remoteSnapshot,
      });
      return;
    }

    if (path === '/wp-json/reprint/v1/push/dry-run' || path === '/wp-json/reprint/v1/push/apply') {
      writeJson(response, 500, {
        ok: false,
        code: 'RPP_0382_UNEXPECTED_MUTATION_ROUTE',
      });
      return;
    }

    writeJson(response, 404, {
      ok: false,
      code: 'RPP_0382_ROUTE_NOT_FOUND',
      path,
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server should listen on a TCP address');
    return await callback(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function graphBlockers(plan) {
  return plan.blockers.filter((blocker) => blocker.class === 'stale-wordpress-graph-identity');
}

function hashOnlyGraphBlockerEvidence(blocker) {
  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    resolutionPolicy: blocker.resolutionPolicy,
    reasonHash: digest(blocker.reason || ''),
    baseHash: blocker.baseHash || null,
    localHash: blocker.localHash || null,
    remoteHash: blocker.remoteHash || null,
    change: blocker.change ? {
      base: blocker.change.base ? { state: blocker.change.base.state, hash: blocker.change.base.hash } : null,
      local: blocker.change.local ? { state: blocker.change.local.state, hash: blocker.change.local.hash } : null,
      remote: blocker.change.remote ? { state: blocker.change.remote.state, hash: blocker.change.remote.hash } : null,
    } : null,
    references: (blocker.references || []).map((reference) => ({
      relationshipKey: reference.relationshipKey || null,
      relationshipType: reference.relationshipType || null,
      sourceResourceKey: reference.sourceResourceKey || null,
      targetResourceKey: reference.targetResourceKey || null,
      targetBaseHash: reference.targetBaseHash || null,
      targetLocalHash: reference.targetLocalHash || null,
      targetRemoteHash: reference.targetRemoteHash || null,
      targetSupportClass: reference.targetSupport?.className || null,
      targetSupportReasonHash: reference.targetSupport?.reason
        ? digest(reference.targetSupport.reason)
        : null,
    })),
  };
}

function releaseVerifierHashOnlyEvidence(proof) {
  return {
    rpp: 'RPP-0382',
    evidenceSource: 'featured-image-attachment-reference-release-verifier-v5',
    verifier: {
      source: 'runAuthenticatedHttpPush production-shaped release verifier path',
      ok: proof.ok === true,
      code: proof.code || null,
      mode: proof.mode || null,
      planStatus: proof.plan?.status || proof.planObject?.status || null,
      dryRunAttempted: proof.dryRun !== null,
      applyAttempted: proof.apply !== null,
      durableJournalAttempted: proof.dbJournal !== null,
    },
    plan: {
      status: proof.planObject?.status || null,
      mutationCount: proof.planObject?.mutations?.length ?? null,
      preconditionCount: proof.planObject?.preconditions?.length ?? null,
      blockerCount: proof.planObject?.blockers?.length ?? null,
      planHash: proof.planObject ? digest(proof.planObject) : null,
    },
    graphIdentity: {
      relationshipType: 'featured-image-attachment',
      sourceResourceKey: sourcePostResourceKey,
      unsupportedTargetResourceKey,
      blockerCount: graphBlockers(proof.planObject || { blockers: [] }).length,
      blockers: graphBlockers(proof.planObject || { blockers: [] }).map(hashOnlyGraphBlockerEvidence),
      format: 'hash-only',
      rawValuesIncluded: false,
    },
  };
}

function assertNoRawFixtureValues(value) {
  const json = JSON.stringify(value);
  for (const forbidden of forbiddenFixtureValues) {
    assert.equal(json.includes(forbidden), false, `leaked raw fixture value: ${forbidden}`);
  }
  assert.equal(json.includes('post_title'), false, 'hash-only evidence must not expose post_title fields');
  assert.equal(json.includes('post_content'), false, 'hash-only evidence must not expose post_content fields');
  assert.equal(json.includes('private_payload'), false, 'hash-only evidence must not expose private_payload fields');
  assert.equal(json.includes('\"meta_value\":'), false, 'hash-only evidence must not expose raw meta_value fields');
}

function assertHashOnlyBlocker(blocker) {
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.baseHash, sha256HexPattern);
  assert.match(blocker.localHash, sha256HexPattern);
  assert.match(blocker.remoteHash, sha256HexPattern);
  assert.match(blocker.change.local.hash, sha256HexPattern);
  assert.equal(Object.hasOwn(blocker.change.local, 'value'), false);
  assert.equal(Object.hasOwn(blocker.change.remote, 'value'), false);
}

test('RPP-0382 release verifier fails closed for unsupported featured image attachment targets with hash-only evidence', async () => {
  const { base, local, remote } = featuredImageUnsupportedSurfaceSnapshots();

  await withReleaseVerifierProbeServer(remote, async (sourceUrl, requests) => {
    const proof = await runAuthenticatedHttpPush({
      sourceUrl,
      base,
      local,
      username: 'rpp0382-admin',
      applicationPassword: 'rpp0382-application-password',
      idempotencyKey: 'rpp-0382-featured-image-attachment-release-verifier',
      routeProfile: 'production-shaped',
      dryRunOnly: false,
      requestTimeoutMs: 1_000,
      now: fixedNow,
    });
    const plan = proof.planObject;
    const postmetaBlocker = plan.blockers.find((blocker) => blocker.resourceKey === sourcePostResourceKey);
    const targetBlocker = plan.blockers.find((blocker) => blocker.resourceKey === unsupportedTargetResourceKey);
    const reference = postmetaBlocker.references.find((entry) =>
      entry.relationshipType === 'featured-image-attachment');
    const evidence = releaseVerifierHashOnlyEvidence(proof);

    assert.equal(proof.ok, false);
    assert.equal(proof.code, 'PLAN_NOT_READY_LOCALLY');
    assert.equal(proof.plan.status, 'blocked');
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.summary.mutations, 0);
    assert.equal(plan.mutations.length, 0);
    assert.equal(plan.preconditions.length, 0);
    assert.equal(proof.dryRun, null);
    assert.equal(proof.apply, null);
    assert.equal(proof.dbJournal, null);
    assert.equal(requests.filter((request) => request.path.endsWith('/dry-run')).length, 0);
    assert.equal(requests.filter((request) => request.path.endsWith('/apply')).length, 0);

    assertHashOnlyBlocker(postmetaBlocker);
    assertHashOnlyBlocker(targetBlocker);
    assert.equal(reference.relationshipKey, 'wp_postmeta.meta_value');
    assert.equal(reference.relationshipType, 'featured-image-attachment');
    assert.equal(reference.targetResourceKey, unsupportedTargetResourceKey);
    assert.equal(reference.targetSupport.supported, false);
    assert.equal(reference.targetSupport.className, 'stale-wordpress-graph-identity');
    assert.match(reference.targetSupport.reason, /unsupported post graph surface nav_menu_item/);
    assert.equal(reference.targetChange.localChange, 'create');
    assert.equal(reference.targetChange.remoteChange, 'unchanged');
    assert.equal(Object.hasOwn(reference.targetChange.local, 'value'), false);
    assert.match(reference.targetLocalHash, sha256HexPattern);
    assert.match(reference.targetRemoteHash, sha256HexPattern);

    assert.equal(evidence.verifier.code, 'PLAN_NOT_READY_LOCALLY');
    assert.equal(evidence.verifier.dryRunAttempted, false);
    assert.equal(evidence.verifier.applyAttempted, false);
    assert.equal(evidence.graphIdentity.blockerCount, 2);
    assert.equal(evidence.graphIdentity.blockers.some((entry) =>
      entry.references.some((candidate) => candidate.relationshipType === 'featured-image-attachment')), true);
    assert.match(evidence.plan.planHash, sha256HexPattern);
    assertNoRawFixtureValues(evidence);
    assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, {
      label: 'RPP-0382 release verifier featured image graph evidence',
    }));
    assert.throws(() => applyPlan(remote, plan), (error) => {
      assert.equal(error instanceof PushPlanError, true);
      assert.equal(error.code, 'PLAN_NOT_READY');
      assert.deepEqual(error.details, { status: 'blocked' });
      return true;
    });
  });
});
