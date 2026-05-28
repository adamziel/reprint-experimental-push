const ROUTE_NAMESPACE = 'reprint/v1';
const PERMISSION_CAPABILITY = 'manage_options';
const PERMISSION_CALLBACK = 'reprint_push_lab_rest_authenticated_permission';

export const ROUTE_PROOF_MATRIX_CONTRACT_ID = 'push-route-proof-matrix-contract-v1';
export const ROUTE_PROOF_MATRIX_SCHEMA_VERSION = 1;
export const ROUTE_PROOF_MATRIX_ROUTE_ORDER = Object.freeze([
  'preflight',
  'dry-run',
  'apply',
  'journal',
  'recovery-inspect',
  'recovery-repair',
]);

const FAIL_CLOSED_POLICY = Object.freeze({
  absentEvidence: 'Route proof matrix evidence fails closed when route identity, methods, manage_options permission evidence, or mutation boundary evidence is absent.',
  contradictoryEvidence: 'Route proof matrix evidence fails closed when observed method, permission, readOnly, or mutates evidence contradicts the production push route contract.',
});

const DEFAULT_PERMISSION_EVIDENCE = Object.freeze([
  'permission_callback requires authenticated WordPress Application Password identity before route execution',
  'permission_callback requires current_user_can("manage_options") and returns 403 otherwise',
  'route response evidence exposes authorized.capabilities.manage_options for release review',
]);

const ROUTE_DEFINITIONS = Object.freeze([
  routeDefinition({
    id: 'preflight',
    stage: 'push_preflight',
    path: '/push/preflight',
    routeName: 'preflight',
    methods: ['GET'],
    classification: 'protocol-state-only',
    readOnly: false,
    mutates: false,
    mutationBoundary: 'May mint or verify a short-lived push session; must not change remote content, files, database resources, durable journal rows, or recovery state.',
    mutationEvidence: [
      'runs before dry-run and apply in the stage order',
      'binds one remote identity and one persisted pull base before any content mutation',
    ],
    rpp: ['RPP-0011'],
    failClosed: {
      absentEvidence: 'Preflight route proof fails closed before dry-run or apply when route identity, GET method, manage_options capability, or boundary evidence is missing.',
      contradictoryEvidence: 'Preflight route proof fails closed when it is not the expected GET /push/preflight route or it claims content mutation authority.',
    },
  }),
  routeDefinition({
    id: 'dry-run',
    stage: 'push_plan_dry_run',
    path: '/push/dry-run',
    routeName: 'dry-run',
    methods: ['POST'],
    classification: 'non-mutating-receipt',
    readOnly: false,
    mutates: false,
    mutationBoundary: 'May validate a canonical plan and return an eligibility receipt; receipt is not a lock and must not authorize apply without fresh revalidation.',
    mutationEvidence: [
      'dry-run and apply are separate remote operations',
      'dry-run receipt never replaces apply-time live hash checks',
    ],
    rpp: ['RPP-0012'],
    failClosed: {
      absentEvidence: 'Dry-run route proof fails closed before apply when route identity, POST method, manage_options capability, or eligibility boundary evidence is missing.',
      contradictoryEvidence: 'Dry-run route proof fails closed when it is not the expected POST /push/dry-run route or it claims direct remote mutation authority.',
    },
  }),
  routeDefinition({
    id: 'apply',
    stage: 'push_batch_apply',
    path: '/push/apply',
    routeName: 'apply',
    methods: ['POST'],
    classification: 'mutating-write',
    readOnly: false,
    mutates: true,
    mutationBoundary: 'May commit planned remote changes only after dry-run eligibility, push session continuity, and fresh live hash revalidation before every batch and storage boundary.',
    mutationEvidence: [
      'apply is the production content-mutating write route',
      'apply must reject before mutation when preconditions or live hashes fail',
    ],
    rpp: ['RPP-0013'],
    failClosed: {
      absentEvidence: 'Apply route proof fails closed before mutation when route identity, POST method, manage_options capability, or pre-mutation boundary evidence is missing.',
      contradictoryEvidence: 'Apply route proof fails closed when it is marked read-only, omits mutates=true, uses the wrong method, or lacks pre-mutation rejection evidence.',
    },
  }),
  routeDefinition({
    id: 'journal',
    stage: 'push_journal',
    path: '/push/journal',
    routeName: 'journal',
    methods: ['GET'],
    classification: 'readOnly',
    readOnly: true,
    mutates: false,
    mutationBoundary: 'Reads durable journal evidence for review; must not append, repair, finalize, roll back, or otherwise authorize mutation.',
    mutationEvidence: [
      'journal inspection is read-only and never authorizes mutation by itself',
      'journal readback happens after apply without broadening mutation authority',
    ],
    rpp: ['RPP-0014'],
    failClosed: {
      absentEvidence: 'Journal route proof fails closed when route identity, GET method, manage_options capability, or read-only evidence is missing.',
      contradictoryEvidence: 'Journal route proof fails closed when it is marked mutating or when it claims repair/apply authority.',
    },
  }),
  routeDefinition({
    id: 'recovery-inspect',
    stage: 'push_recover inspect',
    path: '/push/recovery/inspect',
    routeName: 'recovery-inspect',
    methods: ['POST'],
    classification: 'readOnly',
    readOnly: true,
    mutates: false,
    mutationBoundary: 'Reads the journal and fresh live hashes to classify finish, rollback, retry, or block before any mutating repair.',
    mutationEvidence: [
      'recovery inspect stays read-only and classifies before repair',
      'read-only signed POST is allowed only for inspect-style recovery evidence',
    ],
    rpp: ['RPP-0015'],
    failClosed: {
      absentEvidence: 'Recovery inspect route proof fails closed when route identity, POST method, manage_options capability, or read-only classification evidence is missing.',
      contradictoryEvidence: 'Recovery inspect route proof fails closed when it is marked mutating or when it skips inspect-before-repair classification.',
    },
  }),
  routeDefinition({
    id: 'recovery-repair',
    stage: 'push_recover auto|finish|rollback',
    path: '/push/recovery/repair',
    routeName: 'recovery-repair',
    methods: ['POST'],
    classification: 'mutating-repair',
    readOnly: false,
    mutates: true,
    mutationBoundary: 'May finish or roll back partial apply state only after recovery-inspect proves the repair branch safe with the same auth floor and fresh live hashes.',
    mutationEvidence: [
      'mutating recovery must follow inspect-first evidence',
      'repair authority is narrower than apply and is fenced by journal rows, leases, and fresh live hashes',
    ],
    rpp: [],
    failClosed: {
      absentEvidence: 'Recovery repair route proof fails closed when route identity, POST method, manage_options capability, or inspect-first repair evidence is missing.',
      contradictoryEvidence: 'Recovery repair route proof fails closed when it is marked read-only, skips recovery-inspect, or lacks mutating repair fences.',
    },
  }),
]);

const EXPECTED_BY_ID = new Map(ROUTE_DEFINITIONS.map((route) => [route.id, route]));

export function productionRouteProofEntries() {
  return deepClone(ROUTE_DEFINITIONS);
}

export function buildRouteProofMatrixContract(options = {}) {
  const routes = normalizeRouteOrder(options.routes || productionRouteProofEntries());
  const validation = validateRouteProofMatrix(routes);

  return deepFreeze({
    contract_id: ROUTE_PROOF_MATRIX_CONTRACT_ID,
    schema_version: ROUTE_PROOF_MATRIX_SCHEMA_VERSION,
    purpose: 'deterministic route proof matrix for production push route methods, permissions, and mutation boundaries without a live external service',
    route_order: [...ROUTE_PROOF_MATRIX_ROUTE_ORDER],
    permission_floor: {
      authentication: 'WordPress Application Password or stronger production auth session',
      capability: PERMISSION_CAPABILITY,
      permission_callback: PERMISSION_CALLBACK,
      fail_closed_when_missing: 'ROUTE_CAPABILITY_EVIDENCE_REQUIRED',
    },
    fail_closed_policy: {
      absent_evidence: FAIL_CLOSED_POLICY.absentEvidence,
      contradictory_evidence: FAIL_CLOSED_POLICY.contradictoryEvidence,
    },
    mutation_legend: [
      {
        classification: 'protocol-state-only',
        readOnly: false,
        mutates: false,
        meaning: 'route may mint or check short-lived protocol/session metadata but must not mutate remote content or recovery journal state',
      },
      {
        classification: 'non-mutating-receipt',
        readOnly: false,
        mutates: false,
        meaning: 'route may return eligibility receipt evidence but must not mutate remote content and cannot authorize apply without fresh revalidation',
      },
      {
        classification: 'readOnly',
        readOnly: true,
        mutates: false,
        meaning: 'route is inspection/classification only and cannot authorize or perform writes',
      },
      {
        classification: 'mutating-write',
        readOnly: false,
        mutates: true,
        meaning: 'route may mutate planned remote resources only behind explicit preconditions and fresh live hash checks',
      },
      {
        classification: 'mutating-repair',
        readOnly: false,
        mutates: true,
        meaning: 'route may finish or roll back partial apply state only after recovery inspect proves the branch safe',
      },
    ],
    routes,
    claimed_rpp_evidence: [
      'RPP-0011',
      'RPP-0012',
      'RPP-0013',
      'RPP-0014',
      'RPP-0015',
    ],
    validation: validationSummary(validation),
  });
}

export function formatRouteProofMatrixContract(contract = buildRouteProofMatrixContract()) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

export function validateRouteProofMatrix(routes) {
  const failures = [];
  const routeResults = [];

  if (!Array.isArray(routes)) {
    failures.push(matrixFailure({
      routeId: null,
      code: 'ROUTE_MATRIX_REQUIRED',
      field: 'routes',
      reason: 'Route proof matrix evidence fails closed because routes must be an array.',
      expected: 'array',
      observed: typeof routes,
    }));
    return validationResult(routeResults, failures);
  }

  const seen = new Set();
  for (const route of routes) {
    if (!hasNonEmptyString(route?.id)) {
      failures.push(matrixFailure({
        routeId: null,
        code: 'ROUTE_IDENTITY_REQUIRED',
        field: 'id',
        reason: FAIL_CLOSED_POLICY.absentEvidence,
        expected: ROUTE_PROOF_MATRIX_ROUTE_ORDER.join('|'),
        observed: route?.id ?? 'missing',
      }));
      continue;
    }
    if (seen.has(route.id)) {
      failures.push(matrixFailure({
        routeId: route.id,
        code: 'ROUTE_IDENTITY_CONFLICT',
        field: 'id',
        reason: routeFailClosedReason(route, EXPECTED_BY_ID.get(route.id), 'contradictoryEvidence'),
        expected: 'unique route id',
        observed: route.id,
      }));
    }
    seen.add(route.id);
  }

  const routeMap = new Map(routes.filter((route) => hasNonEmptyString(route?.id)).map((route) => [route.id, route]));

  for (const id of ROUTE_PROOF_MATRIX_ROUTE_ORDER) {
    const expected = EXPECTED_BY_ID.get(id);
    const route = routeMap.get(id);
    const routeFailures = [];

    if (!route) {
      routeFailures.push(matrixFailure({
        routeId: id,
        code: 'ROUTE_IDENTITY_REQUIRED',
        field: 'id',
        reason: expected.failClosed.absentEvidence,
        expected: id,
        observed: 'missing',
      }));
      failures.push(...routeFailures);
      routeResults.push(routeValidationResult(id, routeFailures));
      continue;
    }

    routeFailures.push(...validateRouteIdentity(route, expected));
    routeFailures.push(...validateRouteMethods(route, expected));
    routeFailures.push(...validateRoutePermission(route, expected));
    routeFailures.push(...validateRouteMutationBoundary(route, expected));
    routeFailures.push(...validateRouteFailClosedPolicy(route, expected));

    failures.push(...routeFailures);
    routeResults.push(routeValidationResult(id, routeFailures));
  }

  for (const route of routes) {
    if (hasNonEmptyString(route?.id) && !EXPECTED_BY_ID.has(route.id)) {
      failures.push(matrixFailure({
        routeId: route.id,
        code: 'ROUTE_IDENTITY_MISMATCH',
        field: 'id',
        reason: routeFailClosedReason(route, null, 'contradictoryEvidence'),
        expected: ROUTE_PROOF_MATRIX_ROUTE_ORDER.join('|'),
        observed: route.id,
      }));
    }
  }

  return validationResult(routeResults, failures);
}

function routeDefinition({
  id,
  stage,
  path,
  routeName,
  methods,
  classification,
  readOnly,
  mutates,
  mutationBoundary,
  mutationEvidence,
  rpp,
  failClosed,
}) {
  return deepFreeze({
    id,
    stage,
    identity: {
      namespace: ROUTE_NAMESPACE,
      path,
      route: routeName,
      profile: 'production-shaped',
    },
    methods: [...methods],
    permission: {
      authentication: 'application-password-basic + signed production push request',
      capability: PERMISSION_CAPABILITY,
      callback: PERMISSION_CALLBACK,
      evidence: [...DEFAULT_PERMISSION_EVIDENCE],
    },
    mutation: {
      classification,
      readOnly,
      mutates,
      boundary: mutationBoundary,
      evidence: [...mutationEvidence],
    },
    failClosed: {
      absentEvidence: failClosed.absentEvidence,
      contradictoryEvidence: failClosed.contradictoryEvidence,
    },
    rpp: [...rpp],
  });
}

function normalizeRouteOrder(routes) {
  if (!Array.isArray(routes)) {
    return routes;
  }
  const routeMap = new Map(routes.filter((route) => hasNonEmptyString(route?.id)).map((route) => [route.id, route]));
  const ordered = [];
  for (const id of ROUTE_PROOF_MATRIX_ROUTE_ORDER) {
    if (routeMap.has(id)) {
      ordered.push(normalizeRoute(routeMap.get(id)));
    }
  }
  for (const route of routes) {
    if (!hasNonEmptyString(route?.id) || !EXPECTED_BY_ID.has(route.id)) {
      ordered.push(normalizeRoute(route));
    }
  }
  return ordered;
}

function normalizeRoute(route) {
  if (!route || typeof route !== 'object') {
    return route;
  }
  return {
    id: route.id,
    stage: route.stage,
    identity: route.identity ? {
      namespace: route.identity.namespace,
      path: route.identity.path,
      route: route.identity.route,
      profile: route.identity.profile,
    } : route.identity,
    methods: Array.isArray(route.methods) ? [...route.methods] : route.methods,
    permission: route.permission ? {
      authentication: route.permission.authentication,
      capability: route.permission.capability,
      callback: route.permission.callback,
      evidence: Array.isArray(route.permission.evidence) ? [...route.permission.evidence] : route.permission.evidence,
    } : route.permission,
    mutation: route.mutation ? {
      classification: route.mutation.classification,
      readOnly: route.mutation.readOnly,
      mutates: route.mutation.mutates,
      boundary: route.mutation.boundary,
      evidence: Array.isArray(route.mutation.evidence) ? [...route.mutation.evidence] : route.mutation.evidence,
    } : route.mutation,
    failClosed: route.failClosed ? {
      absentEvidence: route.failClosed.absentEvidence,
      contradictoryEvidence: route.failClosed.contradictoryEvidence,
    } : route.failClosed,
    rpp: Array.isArray(route.rpp) ? [...route.rpp] : route.rpp,
  };
}

function validateRouteIdentity(route, expected) {
  const failures = [];
  const identity = route.identity;
  const missingIdentity = !hasNonEmptyString(route.id)
    || !hasNonEmptyString(route.stage)
    || !hasNonEmptyString(identity?.namespace)
    || !hasNonEmptyString(identity?.path)
    || !hasNonEmptyString(identity?.route)
    || !hasNonEmptyString(identity?.profile);

  if (missingIdentity) {
    failures.push(matrixFailure({
      routeId: route.id || expected.id,
      code: 'ROUTE_IDENTITY_REQUIRED',
      field: 'identity',
      reason: routeFailClosedReason(route, expected, 'absentEvidence'),
      expected: expectedIdentity(expected),
      observed: observedIdentity(route),
    }));
    return failures;
  }

  const expectedIdentityValue = expectedIdentity(expected);
  const observedIdentityValue = observedIdentity(route);
  if (route.id !== expected.id
    || route.stage !== expected.stage
    || identity.namespace !== expected.identity.namespace
    || identity.path !== expected.identity.path
    || identity.route !== expected.identity.route
    || identity.profile !== expected.identity.profile) {
    failures.push(matrixFailure({
      routeId: route.id,
      code: 'ROUTE_IDENTITY_MISMATCH',
      field: 'identity',
      reason: routeFailClosedReason(route, expected, 'contradictoryEvidence'),
      expected: expectedIdentityValue,
      observed: observedIdentityValue,
    }));
  }

  return failures;
}

function validateRouteMethods(route, expected) {
  const methods = route.methods;
  if (!Array.isArray(methods) || methods.length === 0 || !methods.every(hasNonEmptyString)) {
    return [matrixFailure({
      routeId: route.id || expected.id,
      code: 'ROUTE_METHOD_REQUIRED',
      field: 'methods',
      reason: routeFailClosedReason(route, expected, 'absentEvidence'),
      expected: expected.methods,
      observed: methods ?? 'missing',
    })];
  }

  const normalized = methods.map((method) => method.toUpperCase());
  if (!arraysEqual(normalized, expected.methods)) {
    return [matrixFailure({
      routeId: route.id,
      code: 'ROUTE_METHOD_MISMATCH',
      field: 'methods',
      reason: routeFailClosedReason(route, expected, 'contradictoryEvidence'),
      expected: expected.methods,
      observed: normalized,
    })];
  }

  return [];
}

function validateRoutePermission(route, expected) {
  const permission = route.permission;
  const missingPermission = !hasNonEmptyString(permission?.authentication)
    || !hasNonEmptyString(permission?.capability)
    || !hasNonEmptyString(permission?.callback)
    || !Array.isArray(permission?.evidence)
    || permission.evidence.length === 0
    || !permission.evidence.every(hasNonEmptyString);

  if (missingPermission) {
    return [matrixFailure({
      routeId: route.id || expected.id,
      code: 'ROUTE_CAPABILITY_EVIDENCE_REQUIRED',
      field: 'permission',
      reason: routeFailClosedReason(route, expected, 'absentEvidence'),
      expected: expected.permission,
      observed: permission ?? 'missing',
    })];
  }

  if (permission.capability !== expected.permission.capability
    || permission.callback !== expected.permission.callback) {
    return [matrixFailure({
      routeId: route.id,
      code: 'ROUTE_PERMISSION_MISMATCH',
      field: 'permission',
      reason: routeFailClosedReason(route, expected, 'contradictoryEvidence'),
      expected: {
        capability: expected.permission.capability,
        callback: expected.permission.callback,
      },
      observed: {
        capability: permission.capability,
        callback: permission.callback,
      },
    })];
  }

  return [];
}

function validateRouteMutationBoundary(route, expected) {
  const mutation = route.mutation;
  const missingMutation = !hasNonEmptyString(mutation?.classification)
    || typeof mutation?.readOnly !== 'boolean'
    || typeof mutation?.mutates !== 'boolean'
    || !hasNonEmptyString(mutation?.boundary)
    || !Array.isArray(mutation?.evidence)
    || mutation.evidence.length === 0
    || !mutation.evidence.every(hasNonEmptyString);

  if (missingMutation) {
    return [matrixFailure({
      routeId: route.id || expected.id,
      code: 'ROUTE_MUTATION_BOUNDARY_REQUIRED',
      field: 'mutation',
      reason: routeFailClosedReason(route, expected, 'absentEvidence'),
      expected: expected.mutation,
      observed: mutation ?? 'missing',
    })];
  }

  if (mutation.readOnly === true && mutation.mutates === true) {
    return [matrixFailure({
      routeId: route.id,
      code: 'ROUTE_MUTATION_BOUNDARY_CONTRADICTORY',
      field: 'mutation',
      reason: routeFailClosedReason(route, expected, 'contradictoryEvidence'),
      expected: {
        readOnly: expected.mutation.readOnly,
        mutates: expected.mutation.mutates,
        classification: expected.mutation.classification,
      },
      observed: {
        readOnly: mutation.readOnly,
        mutates: mutation.mutates,
        classification: mutation.classification,
      },
    })];
  }

  if (mutation.readOnly !== expected.mutation.readOnly
    || mutation.mutates !== expected.mutation.mutates
    || mutation.classification !== expected.mutation.classification) {
    return [matrixFailure({
      routeId: route.id,
      code: 'ROUTE_MUTATION_BOUNDARY_MISMATCH',
      field: 'mutation',
      reason: routeFailClosedReason(route, expected, 'contradictoryEvidence'),
      expected: {
        readOnly: expected.mutation.readOnly,
        mutates: expected.mutation.mutates,
        classification: expected.mutation.classification,
      },
      observed: {
        readOnly: mutation.readOnly,
        mutates: mutation.mutates,
        classification: mutation.classification,
      },
    })];
  }

  return [];
}

function validateRouteFailClosedPolicy(route, expected) {
  if (!hasNonEmptyString(route.failClosed?.absentEvidence)
    || !hasNonEmptyString(route.failClosed?.contradictoryEvidence)) {
    return [matrixFailure({
      routeId: route.id || expected.id,
      code: 'ROUTE_FAIL_CLOSED_REASON_REQUIRED',
      field: 'failClosed',
      reason: expected.failClosed.absentEvidence,
      expected: expected.failClosed,
      observed: route.failClosed ?? 'missing',
    })];
  }
  return [];
}

function validationResult(routes, failures) {
  const ok = failures.length === 0;
  return deepFreeze({
    ok,
    status: ok ? 'satisfied' : 'failed-closed',
    fail_closed: true,
    checked_routes: ROUTE_PROOF_MATRIX_ROUTE_ORDER.length,
    route_order: [...ROUTE_PROOF_MATRIX_ROUTE_ORDER],
    reason: failures[0]?.failClosedReason || null,
    routes,
    failures,
  });
}

function validationSummary(validation) {
  return {
    ok: validation.ok,
    status: validation.status,
    fail_closed: validation.fail_closed,
    checked_routes: validation.checked_routes,
    route_order: [...validation.route_order],
    reason: validation.reason,
    routes: validation.routes.map((route) => ({
      id: route.id,
      ok: route.ok,
      status: route.status,
      failClosedReason: route.failClosedReason,
      failures: [...route.failures],
    })),
    failures: validation.failures.map((failure) => ({ ...failure })),
  };
}

function routeValidationResult(id, failures) {
  const ok = failures.length === 0;
  return {
    id,
    ok,
    status: ok ? 'satisfied' : 'failed-closed',
    failClosedReason: failures[0]?.failClosedReason || null,
    failures: failures.map((failure) => failure.code),
  };
}

function matrixFailure({ routeId, code, field, reason, expected, observed }) {
  return {
    routeId,
    code,
    field,
    failClosedReason: reason,
    expected: deepClone(expected),
    observed: deepClone(observed),
  };
}

function routeFailClosedReason(route, expected, type) {
  if (hasNonEmptyString(route?.failClosed?.[type])) {
    return route.failClosed[type];
  }
  if (hasNonEmptyString(expected?.failClosed?.[type])) {
    return expected.failClosed[type];
  }
  return FAIL_CLOSED_POLICY[type];
}

function expectedIdentity(route) {
  return {
    id: route.id,
    stage: route.stage,
    namespace: route.identity.namespace,
    path: route.identity.path,
    route: route.identity.route,
    profile: route.identity.profile,
  };
}

function observedIdentity(route) {
  return {
    id: route?.id ?? null,
    stage: route?.stage ?? null,
    namespace: route?.identity?.namespace ?? null,
    path: route?.identity?.path ?? null,
    route: route?.identity?.route ?? null,
    profile: route?.identity?.profile ?? null,
  };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function deepClone(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
