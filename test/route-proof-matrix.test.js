import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROUTE_PROOF_MATRIX_CONTRACT_ID,
  ROUTE_PROOF_MATRIX_ROUTE_ORDER,
  buildRouteProofMatrixContract,
  formatRouteProofMatrixContract,
  productionRouteProofEntries,
  validateRouteProofMatrix,
} from '../src/route-proof-matrix.js';

const fixtureUrl = new URL('../fixtures/protocol/push-route-proof-matrix-contract.json', import.meta.url);

function routeById(routes, id) {
  const route = routes.find((entry) => entry.id === id);
  assert.ok(route, `missing route ${id}`);
  return route;
}

function failureByCode(validation, routeId, code) {
  const failure = validation.failures.find((entry) => entry.routeId === routeId && entry.code === code);
  assert.ok(failure, `missing ${code} for ${routeId}; observed ${JSON.stringify(validation.failures)}`);
  assert.equal(validation.ok, false);
  assert.equal(validation.status, 'failed-closed');
  assert.equal(validation.fail_closed, true);
  assert.ok(failure.failClosedReason.includes('fails closed'));
  return failure;
}

test('default production route proof matrix has stable ordered routes with explicit methods, permissions, and mutation boundaries', () => {
  const routes = productionRouteProofEntries();
  const validation = validateRouteProofMatrix(routes);

  assert.equal(validation.ok, true);
  assert.deepEqual(routes.map((route) => route.id), ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.deepEqual(routes.map((route) => route.methods), [
    ['GET'],
    ['POST'],
    ['POST'],
    ['GET'],
    ['POST'],
    ['POST'],
  ]);

  for (const route of routes) {
    assert.equal(route.identity.namespace, 'reprint/v1', route.id);
    assert.match(route.identity.path, /^\/push\//, route.id);
    assert.equal(route.permission.capability, 'manage_options', route.id);
    assert.equal(route.permission.callback, 'reprint_push_lab_rest_authenticated_permission', route.id);
    assert.ok(route.permission.evidence.length >= 3, route.id);
    assert.equal(typeof route.mutation.readOnly, 'boolean', route.id);
    assert.equal(typeof route.mutation.mutates, 'boolean', route.id);
    assert.ok(route.mutation.boundary.length > 0, route.id);
    assert.ok(route.failClosed.absentEvidence.includes('fails closed'), route.id);
    assert.ok(route.failClosed.contradictoryEvidence.includes('fails closed'), route.id);
  }

  assert.deepEqual(routeById(routes, 'preflight').mutation, {
    classification: 'protocol-state-only',
    readOnly: false,
    mutates: false,
    boundary: 'May mint or verify a short-lived push session; must not change remote content, files, database resources, durable journal rows, or recovery state.',
    evidence: [
      'runs before dry-run and apply in the stage order',
      'binds one remote identity and one persisted pull base before any content mutation',
    ],
  });
  assert.deepEqual(routeById(routes, 'apply').mutation, {
    classification: 'mutating-write',
    readOnly: false,
    mutates: true,
    boundary: 'May commit planned remote changes only after dry-run eligibility, push session continuity, and fresh live hash revalidation before every batch and storage boundary.',
    evidence: [
      'apply is the production content-mutating write route',
      'apply must reject before mutation when preconditions or live hashes fail',
    ],
  });
  assert.equal(routeById(routes, 'journal').mutation.readOnly, true);
  assert.equal(routeById(routes, 'journal').mutation.mutates, false);
  assert.equal(routeById(routes, 'recovery-inspect').mutation.readOnly, true);
  assert.equal(routeById(routes, 'recovery-inspect').mutation.mutates, false);
  assert.equal(routeById(routes, 'recovery-repair').mutation.mutates, true);
});

test('machine-readable fixture contract is emitted with stable ordering', () => {
  const contract = buildRouteProofMatrixContract();
  const fixtureText = readFileSync(fixtureUrl, 'utf8');
  const fixture = JSON.parse(fixtureText);

  assert.equal(contract.contract_id, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.equal(fixture.contract_id, ROUTE_PROOF_MATRIX_CONTRACT_ID);
  assert.deepEqual(fixture.route_order, ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.deepEqual(fixture.routes.map((route) => route.id), ROUTE_PROOF_MATRIX_ROUTE_ORDER);
  assert.deepEqual(fixture, contract);
  assert.equal(fixtureText, formatRouteProofMatrixContract(contract));
  assert.equal(fixture.validation.ok, true);
  assert.deepEqual(fixture.validation.failures, []);
});

test('validator fails closed when apply is marked read-only', () => {
  const routes = productionRouteProofEntries();
  const apply = routeById(routes, 'apply');
  apply.mutation.classification = 'readOnly';
  apply.mutation.readOnly = true;
  apply.mutation.mutates = false;

  const validation = validateRouteProofMatrix(routes);
  const failure = failureByCode(validation, 'apply', 'ROUTE_MUTATION_BOUNDARY_MISMATCH');

  assert.deepEqual(failure.expected, {
    readOnly: false,
    mutates: true,
    classification: 'mutating-write',
  });
  assert.deepEqual(failure.observed, {
    readOnly: true,
    mutates: false,
    classification: 'readOnly',
  });
  assert.match(failure.failClosedReason, /Apply route proof fails closed/);
});

test('validator fails closed when journal is marked mutating', () => {
  const routes = productionRouteProofEntries();
  const journal = routeById(routes, 'journal');
  journal.mutation.classification = 'mutating-write';
  journal.mutation.readOnly = false;
  journal.mutation.mutates = true;

  const validation = validateRouteProofMatrix(routes);
  const failure = failureByCode(validation, 'journal', 'ROUTE_MUTATION_BOUNDARY_MISMATCH');

  assert.deepEqual(failure.expected, {
    readOnly: true,
    mutates: false,
    classification: 'readOnly',
  });
  assert.deepEqual(failure.observed, {
    readOnly: false,
    mutates: true,
    classification: 'mutating-write',
  });
  assert.match(failure.failClosedReason, /Journal route proof fails closed/);
});

test('validator fails closed when capability evidence is missing', () => {
  const routes = productionRouteProofEntries();
  const dryRun = routeById(routes, 'dry-run');
  delete dryRun.permission.capability;

  const validation = validateRouteProofMatrix(routes);
  const failure = failureByCode(validation, 'dry-run', 'ROUTE_CAPABILITY_EVIDENCE_REQUIRED');

  assert.equal(failure.field, 'permission');
  assert.equal(failure.expected.capability, 'manage_options');
  assert.equal(failure.observed.capability, undefined);
  assert.match(failure.failClosedReason, /Dry-run route proof fails closed/);
});

test('validator fails closed when a route advertises the wrong method', () => {
  const routes = productionRouteProofEntries();
  const preflight = routeById(routes, 'preflight');
  preflight.methods = ['POST'];

  const validation = validateRouteProofMatrix(routes);
  const failure = failureByCode(validation, 'preflight', 'ROUTE_METHOD_MISMATCH');

  assert.deepEqual(failure.expected, ['GET']);
  assert.deepEqual(failure.observed, ['POST']);
  assert.match(failure.failClosedReason, /Preflight route proof fails closed/);
});

test('validator fails closed when route identity evidence is missing', () => {
  const routes = productionRouteProofEntries();
  const recoveryInspect = routeById(routes, 'recovery-inspect');
  delete recoveryInspect.identity.path;

  const validation = validateRouteProofMatrix(routes);
  const failure = failureByCode(validation, 'recovery-inspect', 'ROUTE_IDENTITY_REQUIRED');

  assert.equal(failure.field, 'identity');
  assert.equal(failure.expected.path, '/push/recovery/inspect');
  assert.equal(failure.observed.path, null);
  assert.match(failure.failClosedReason, /Recovery inspect route proof fails closed/);
});
