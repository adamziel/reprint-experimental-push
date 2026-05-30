import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_terms: {},
      wp_termmeta: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertHashOnlyChangeEvidence(change) {
  assert.match(change.hash, hashPattern);
  assert.equal(Object.hasOwn(change, 'value'), false);
}

function assertTermmetaTermBlocker({
  plan,
  termmetaResourceKey,
  termResourceKey,
  expectedTargetRemoteChange,
  privateValues,
}) {
  const blocker = blockerFor(plan, termmetaResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'termmeta-term');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.blockers, 1);
  assert.equal(mutationFor(plan, termmetaResourceKey), undefined);
  assert.ok(blocker, 'missing termmeta graph blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.reason, /references graph identities without proven identity mapping or reference rewriting/);
  assert.ok(reference, 'missing termmeta term reference evidence');
  assert.equal(reference.relationshipKey, 'wp_termmeta.term_id');
  assert.equal(reference.sourceResourceKey, termmetaResourceKey);
  assert.equal(reference.targetResourceKey, termResourceKey);
  assert.equal(reference.targetTable, 'wp_terms');
  assert.equal(reference.targetChange.remoteChange, expectedTargetRemoteChange);

  for (const hash of [
    blocker.baseHash,
    blocker.localHash,
    blocker.remoteHash,
    reference.targetBaseHash,
    reference.targetLocalHash,
    reference.targetRemoteHash,
  ]) {
    assert.match(hash, hashPattern);
  }

  for (const change of [
    blocker.change.base,
    blocker.change.local,
    blocker.change.remote,
    reference.targetChange.base,
    reference.targetChange.local,
    reference.targetChange.remote,
  ]) {
    assertHashOnlyChangeEvidence(change);
  }

  const serialized = JSON.stringify({ blocker, reference });
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `termmeta blocker leaked ${privateValue}`);
  }

  return { blocker, reference };
}

function assertRefusesBeforeMutation(remote, plan) {
  const remoteBefore = cloneJson(remote);
  const beforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remoteBefore), beforeHash, 'blocked termmeta plan must refuse before mutation');
}

function assertRedactedLocalEvidence({ plan, blocker, rows, privateValues }) {
  const redacted = redactEvidence({
    rpp: 'RPP-0372',
    status: plan.status,
    summary: plan.summary,
    blocker,
    rawTermmetaProbe: {
      value: rows,
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), 'raw local probe should be redacted');
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, 'redacted probe should retain a hash only');
  for (const privateValue of privateValues) {
    assert.equal(serialized.includes(privateValue), false, `redacted evidence leaked ${privateValue}`);
  }
}

test('RPP-0372 fails closed when termmeta references an unsupported missing term target', () => {
  const termmetaResourceKey = rowResourceKey('wp_termmeta', 'meta_id:372');
  const termResourceKey = rowResourceKey('wp_terms', 'term_id:9372');
  const termmetaRow = {
    meta_id: 372,
    term_id: 9372,
    meta_key: '_rpp0372_missing_term_private_marker',
    meta_value: 'local-private-rpp0372-missing-termmeta-payload',
  };
  const privateValues = [
    termmetaRow.meta_key,
    termmetaRow.meta_value,
  ];
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_termmeta['meta_id:372'] = termmetaRow;

  const plan = planFor(base, local, remote);
  const { blocker, reference } = assertTermmetaTermBlocker({
    plan,
    termmetaResourceKey,
    termResourceKey,
    expectedTargetRemoteChange: 'unchanged',
    privateValues,
  });

  assert.equal(reference.targetChange.base.state, 'absent');
  assert.equal(reference.targetChange.local.state, 'absent');
  assert.equal(reference.targetChange.remote.state, 'absent');
  assert.equal(blocker.change.localChange, 'create');
  assert.equal(blocker.change.remoteChange, 'unchanged');
  assert.equal(reference.targetBaseHash, reference.targetLocalHash);
  assert.equal(reference.targetBaseHash, reference.targetRemoteHash);

  assertRefusesBeforeMutation(remote, plan);
  assertRedactedLocalEvidence({
    plan,
    blocker,
    rows: {
      termmeta: termmetaRow,
      term: null,
    },
    privateValues,
  });
});

test('RPP-0372 fails closed when a termmeta term target is stale on remote', () => {
  const termmetaResourceKey = rowResourceKey('wp_termmeta', 'meta_id:373');
  const termResourceKey = rowResourceKey('wp_terms', 'term_id:1372');
  const termRow = {
    term_id: 1372,
    name: 'Base Private RPP-0372 Stale Term',
    slug: 'base-private-rpp0372-stale-term',
    term_group: 0,
  };
  const remoteTermRow = {
    ...termRow,
    name: 'Remote Private RPP-0372 Stale Term',
    slug: 'remote-private-rpp0372-stale-term',
  };
  const termmetaRow = {
    meta_id: 373,
    term_id: 1372,
    meta_key: '_rpp0372_stale_term_private_marker',
    meta_value: 'local-private-rpp0372-stale-termmeta-payload',
  };
  const privateValues = [
    termRow.name,
    termRow.slug,
    remoteTermRow.name,
    remoteTermRow.slug,
    termmetaRow.meta_key,
    termmetaRow.meta_value,
  ];
  const base = baseSite();
  base.db.wp_terms['term_id:1372'] = termRow;
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_termmeta['meta_id:373'] = termmetaRow;
  remote.db.wp_terms['term_id:1372'] = remoteTermRow;

  const plan = planFor(base, local, remote);
  const { blocker, reference } = assertTermmetaTermBlocker({
    plan,
    termmetaResourceKey,
    termResourceKey,
    expectedTargetRemoteChange: 'update',
    privateValues,
  });
  const termDecision = decisionFor(plan, termResourceKey);

  assert.equal(reference.targetChange.base.state, 'present');
  assert.equal(reference.targetChange.local.state, 'present');
  assert.equal(reference.targetChange.remote.state, 'present');
  assert.equal(reference.targetLocalHash, reference.targetBaseHash);
  assert.notEqual(reference.targetRemoteHash, reference.targetBaseHash);
  assert.ok(termDecision, 'missing keep-remote decision for stale term target');
  assert.equal(termDecision.decision, 'keep-remote');
  assert.equal(termDecision.resourceKey, termResourceKey);

  assertRefusesBeforeMutation(remote, plan);
  assertRedactedLocalEvidence({
    plan,
    blocker,
    rows: {
      termmeta: termmetaRow,
      localTerm: termRow,
      remoteTerm: remoteTermRow,
    },
    privateValues,
  });
});
