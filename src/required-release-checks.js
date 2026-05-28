const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const REQUIRED_CHECK_DATA = [
  {
    id: 'release-gates-evaluator',
    title: 'Release gates evaluator contract',
    area: 'release-gates',
    ownerScope: 'release-gates',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/release-gates.test.js',
    artifacts: [
      'src/release-gates.js',
      'test/release-gates.test.js',
      'docs/evidence/ao-release-gates.md',
    ],
    staleAfterMs: DAY_MS,
  },
  {
    id: 'recovery-journal-proof',
    title: 'Recovery journal durability and restart proof',
    area: 'recovery-journal',
    ownerScope: 'recovery',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/recovery-journal.test.js',
    artifacts: [
      'src/recovery-journal.js',
      'test/recovery-journal.test.js',
      'docs/evidence/ao-journal-recovery.md',
      'fixtures/protocol/push-production-journal-lease-recovery-inspect-contract.json',
    ],
    staleAfterMs: DAY_MS,
  },
  {
    id: 'auth-inspect-proof',
    title: 'Auth inspect and lease fencing proof',
    area: 'auth-inspect',
    ownerScope: 'auth',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/authenticated-http-push-client.test.js',
    artifacts: [
      'src/authenticated-http-push-client.js',
      'test/authenticated-http-push-client.test.js',
      'docs/evidence/ao-executor-auth-leases.md',
      'fixtures/protocol/push-auth-session-fencing-contract.json',
    ],
    staleAfterMs: 12 * HOUR_MS,
  },
  {
    id: 'graph-identity-proof',
    title: 'Graph identity inventory proof',
    area: 'graph-identity',
    ownerScope: 'graph',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/graph-mapping-inventory.test.js',
    artifacts: [
      'scripts/bench/graph-mapping-inventory.js',
      'test/graph-mapping-inventory.test.js',
      'docs/evidence/ao-graph-identity.md',
    ],
    staleAfterMs: 7 * DAY_MS,
  },
  {
    id: 'plugin-driver-proof',
    title: 'Plugin driver guard proof',
    area: 'plugin-driver',
    ownerScope: 'plugin-driver',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/production-plugin-package-scenarios.test.js',
    artifacts: [
      'scripts/playground/production-plugin-package-scenarios.js',
      'test/production-plugin-package-scenarios.test.js',
      'plugins/reprint-push/reprint-push.php',
      'docs/evidence/ao-plugin-driver.md',
    ],
    staleAfterMs: DAY_MS,
  },
  {
    id: 'route-proof-contracts',
    title: 'Route proof and push ladder contract',
    area: 'route-proof',
    ownerScope: 'routes',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/protocol-fixtures.test.js',
    artifacts: [
      'fixtures/protocol/push-production-route-matrix-contract.json',
      'fixtures/protocol/push-production-ladder-contract.json',
      'docs/protocol.md',
      'docs/executor.md',
    ],
    staleAfterMs: 7 * DAY_MS,
  },
  {
    id: 'evidence-coverage-proof',
    title: 'Evidence coverage generated harness proof',
    area: 'evidence-coverage',
    ownerScope: 'evidence',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/generated-push-harness.test.js',
    artifacts: [
      'test/generated-push-harness.test.js',
      'docs/generated-push-harness.md',
      'docs/scenario-matrix.md',
    ],
    staleAfterMs: 2 * DAY_MS,
  },
  {
    id: 'operator-proof',
    title: 'Operator-visible release proof',
    area: 'operator-proof',
    ownerScope: 'operator',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/release-gates.test.js',
    artifacts: [
      'docs/evidence/ao-release-gates.md',
      'docs/evidence/ao-progress-report.md',
      'progress.html',
    ],
    staleAfterMs: 6 * HOUR_MS,
  },
  {
    id: 'artifact-redaction-proof',
    title: 'Artifact redaction proof',
    area: 'artifact-redaction',
    ownerScope: 'artifact-integrity',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/evidence-redaction.test.js',
    artifacts: [
      'src/evidence-redaction.js',
      'test/evidence-redaction.test.js',
      'docs/evidence/ao-evidence-redaction.md',
      'docs/scenario-matrix.md',
    ],
    staleAfterMs: 7 * DAY_MS,
  },
  {
    id: 'provenance-proof',
    title: 'Immutable pull-to-push provenance proof',
    area: 'provenance',
    ownerScope: 'artifact-integrity',
    severity: 'blocking',
    productionRequired: true,
    command: 'node --test test/protocol-compatibility.test.js',
    artifacts: [
      'src/protocol-compatibility.js',
      'test/protocol-compatibility.test.js',
      'fixtures/protocol/push-production-pull-bridge-contract.json',
      'docs/protocol.md',
    ],
    staleAfterMs: 7 * DAY_MS,
  },
];

export const REQUIRED_RELEASE_CHECK_SEVERITIES = Object.freeze({
  blocking: 'blocking',
  nonBlocking: 'non-blocking',
});

export const REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS = Object.freeze([
  'ok',
  'releaseReady',
  'requiredCount',
  'passedCount',
  'missingChecks',
  'staleChecks',
  'nonBlockingChecks',
]);

export const REQUIRED_RELEASE_CHECKS = deepFreeze(
  REQUIRED_CHECK_DATA.map((check) => ({
    ...check,
    artifacts: [...check.artifacts],
  })),
);

export const REQUIRED_RELEASE_CHECKS_CONTRACT = deepFreeze({
  contract_id: 'push-required-release-checks-contract',
  schema_version: 1,
  purpose: 'Standalone local release-movement contract: CI and release gates enumerate mandatory commands and evidence artifacts without depending on GitHub branch protection or external services.',
  summary_fields: [...REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS],
  release_movement_policy: {
    external_services: 'not required',
    branch_protection: 'not consulted',
    releaseReady: 'true only when every blocking production-required check has a passed observation with the exact command, all mandatory artifacts, and a non-stale observedAt timestamp',
    stale_policy: 'production-required observations fail closed when observedAt is missing, invalid, in the future, or older than staleAfterMs',
  },
  checks: REQUIRED_RELEASE_CHECKS,
});

export function validateRequiredReleaseChecks(checks = REQUIRED_RELEASE_CHECKS) {
  const errors = [];
  const ids = new Set();

  if (!Array.isArray(checks) || checks.length === 0) {
    errors.push(contractError(null, 'REQUIRED_RELEASE_CHECKS_EMPTY', 'At least one required release check must be defined.'));
    return deepFreeze({ ok: false, errors });
  }

  for (const check of checks) {
    const id = typeof check?.id === 'string' ? check.id.trim() : '';

    if (!id) {
      errors.push(contractError(check, 'REQUIRED_RELEASE_CHECK_ID_REQUIRED', 'Required release checks must have a stable id.'));
    } else if (ids.has(id)) {
      errors.push(contractError(check, 'DUPLICATE_REQUIRED_RELEASE_CHECK_ID', `Required release check id ${id} is duplicated.`));
    } else {
      ids.add(id);
    }

    if (!isNonEmptyString(check?.command)) {
      errors.push(contractError(check, 'REQUIRED_RELEASE_CHECK_COMMAND_REQUIRED', `Required release check ${id || '(missing id)'} must define a local command.`));
    }

    if (!Array.isArray(check?.artifacts) || check.artifacts.length === 0 || check.artifacts.some((artifact) => !isNonEmptyString(artifact))) {
      errors.push(contractError(check, 'REQUIRED_RELEASE_CHECK_ARTIFACTS_REQUIRED', `Required release check ${id || '(missing id)'} must define one or more artifact paths.`));
    }

    if (!isNonEmptyString(check?.ownerScope)) {
      errors.push(contractError(check, 'REQUIRED_RELEASE_CHECK_OWNER_SCOPE_REQUIRED', `Required release check ${id || '(missing id)'} must define an owner scope.`));
    }

    if (!knownSeverity(check?.severity)) {
      errors.push(contractError(check, 'UNKNOWN_REQUIRED_RELEASE_CHECK_SEVERITY', `Required release check ${id || '(missing id)'} has unknown severity ${String(check?.severity || '')}.`));
    }

    if (!Number.isInteger(check?.staleAfterMs) || check.staleAfterMs <= 0) {
      errors.push(contractError(check, 'REQUIRED_RELEASE_CHECK_STALE_AFTER_MS_REQUIRED', `Required release check ${id || '(missing id)'} must define a positive staleAfterMs.`));
    }
  }

  return deepFreeze({
    ok: errors.length === 0,
    errors,
  });
}

export function summarizeRequiredReleaseChecks(options = {}) {
  const checks = Array.isArray(options.checks) ? options.checks : REQUIRED_RELEASE_CHECKS;
  const observations = normalizeObservations(options.observations || {});
  const now = timestampMs(options.now || new Date());
  const validation = validateRequiredReleaseChecks(checks);
  const missingChecks = validation.errors.map((error) => requiredCheckProblem({
    id: error.id,
    code: error.code,
    reason: error.reason,
    ownerScope: error.ownerScope,
    severity: error.severity,
    command: error.command,
    artifacts: error.artifacts,
  }));
  const staleChecks = [];
  const nonBlockingChecks = [];
  let requiredCount = 0;
  let passedCount = 0;

  for (const check of checks) {
    if (!canEvaluateCheck(check)) {
      continue;
    }

    const observation = observations.get(check.id);
    const result = evaluateRequiredReleaseCheckObservation(check, observation, now);

    if (check.severity === REQUIRED_RELEASE_CHECK_SEVERITIES.blocking) {
      requiredCount += 1;
      if (result.status === 'passed') {
        passedCount += 1;
      } else if (result.status === 'stale') {
        staleChecks.push(result.problem);
      } else {
        missingChecks.push(result.problem);
      }
    } else {
      nonBlockingChecks.push(nonBlockingCheckSummary(check, result));
    }
  }

  const ok = validation.ok && missingChecks.length === 0 && staleChecks.length === 0;
  const releaseReady = ok && requiredCount > 0 && passedCount === requiredCount;
  const summary = {
    ok,
    releaseReady,
    requiredCount,
    passedCount,
    missingChecks,
    staleChecks,
    nonBlockingChecks,
  };
  const summaryValidation = validateRequiredReleaseChecksSummary(summary);

  if (!summaryValidation.ok) {
    const invariantProblems = summaryValidation.errors.map((error) => requiredCheckProblem({
      id: 'required-release-checks-summary',
      code: error.code,
      reason: error.reason,
      ownerScope: 'release-gates',
      severity: REQUIRED_RELEASE_CHECK_SEVERITIES.blocking,
      command: 'summarizeRequiredReleaseChecks',
      artifacts: ['src/required-release-checks.js'],
    }));
    return deepFreeze({
      ok: false,
      releaseReady: false,
      requiredCount,
      passedCount,
      missingChecks: [...missingChecks, ...invariantProblems],
      staleChecks,
      nonBlockingChecks,
    });
  }

  return deepFreeze(summary);
}

export function validateRequiredReleaseChecksSummary(summary) {
  const errors = [];
  const missingChecks = Array.isArray(summary?.missingChecks) ? summary.missingChecks : [];
  const staleChecks = Array.isArray(summary?.staleChecks) ? summary.staleChecks : [];
  const requiredCount = Number.isInteger(summary?.requiredCount) ? summary.requiredCount : -1;
  const passedCount = Number.isInteger(summary?.passedCount) ? summary.passedCount : -1;

  for (const field of REQUIRED_RELEASE_CHECK_SUMMARY_FIELDS) {
    if (!Object.hasOwn(summary || {}, field)) {
      errors.push({
        code: 'REQUIRED_RELEASE_CHECK_SUMMARY_FIELD_MISSING',
        reason: `Required release checks summary is missing ${field}.`,
      });
    }
  }

  if (summary?.releaseReady === true && missingChecks.length > 0) {
    errors.push({
      code: 'RELEASE_READY_WITH_MISSING_REQUIRED_CHECKS',
      reason: 'releaseReady cannot be true while required checks are missing.',
    });
  }

  if (summary?.releaseReady === true && staleChecks.length > 0) {
    errors.push({
      code: 'RELEASE_READY_WITH_STALE_REQUIRED_CHECKS',
      reason: 'releaseReady cannot be true while production-required checks are stale.',
    });
  }

  if (summary?.releaseReady === true && passedCount < requiredCount) {
    errors.push({
      code: 'RELEASE_READY_WITH_INCOMPLETE_REQUIRED_CHECKS',
      reason: 'releaseReady cannot be true unless every required check passed.',
    });
  }

  return deepFreeze({
    ok: errors.length === 0,
    errors,
  });
}

function evaluateRequiredReleaseCheckObservation(check, observation, now) {
  if (!observation) {
    return {
      status: 'missing',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_OBSERVATION_MISSING',
        reason: `${check.id} has no observed release-check result.`,
      }),
    };
  }

  const passed = observationPassed(observation);
  if (passed !== true) {
    return {
      status: 'missing',
      problem: requiredCheckProblem({
        check,
        code: passed === false ? 'REQUIRED_RELEASE_CHECK_FAILED' : 'REQUIRED_RELEASE_CHECK_NOT_PASSED',
        reason: `${check.id} does not have a passed observation.`,
        observedStatus: observedStatus(observation),
        observedAt: observation.observedAt,
      }),
    };
  }

  const observedCommand = typeof observation.command === 'string' ? observation.command.trim() : '';
  if (!observedCommand) {
    return {
      status: 'missing',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_OBSERVED_COMMAND_MISSING',
        reason: `${check.id} passed without recording the required local command.`,
        observedAt: observation.observedAt,
      }),
    };
  }

  if (observedCommand !== check.command) {
    return {
      status: 'missing',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_COMMAND_MISMATCH',
        reason: `${check.id} observed command does not match the required local command.`,
        observedCommand,
        observedAt: observation.observedAt,
      }),
    };
  }

  const observedArtifacts = observedArtifactPaths(observation);
  const missingArtifacts = check.artifacts.filter((artifact) => !observedArtifacts.includes(artifact));
  if (missingArtifacts.length > 0) {
    return {
      status: 'missing',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_ARTIFACT_OBSERVATION_MISSING',
        reason: `${check.id} passed without recording every mandatory artifact path.`,
        missingArtifacts,
        observedAt: observation.observedAt,
      }),
    };
  }

  const observedAt = typeof observation.observedAt === 'string' ? observation.observedAt.trim() : '';
  const observedAtMs = timestampMs(observedAt);
  if (!observedAt || observedAtMs === null) {
    return {
      status: 'stale',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_OBSERVED_AT_REQUIRED',
        reason: `${check.id} must record an ISO observedAt timestamp before release movement.`,
        observedAt: observedAt || 'missing-observedAt',
        staleAfterMs: check.staleAfterMs,
      }),
    };
  }

  if (check.productionRequired !== false && observedAtMs > now) {
    return {
      status: 'stale',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_OBSERVED_AT_FUTURE',
        reason: `${check.id} observedAt is in the future relative to the evaluator clock.`,
        observedAt,
        staleAfterMs: check.staleAfterMs,
        ageMs: now - observedAtMs,
      }),
    };
  }

  const ageMs = now - observedAtMs;
  if (check.productionRequired !== false && ageMs > check.staleAfterMs) {
    return {
      status: 'stale',
      problem: requiredCheckProblem({
        check,
        code: 'REQUIRED_RELEASE_CHECK_STALE',
        reason: `${check.id} observation is stale for production release movement.`,
        observedAt,
        staleAfterMs: check.staleAfterMs,
        ageMs,
      }),
    };
  }

  return {
    status: 'passed',
    observedAt,
  };
}

function nonBlockingCheckSummary(check, result) {
  return stripUndefined({
    id: check.id,
    status: result.status,
    ownerScope: check.ownerScope,
    command: check.command,
    artifacts: [...check.artifacts],
    observedAt: result.observedAt || result.problem?.observedAt,
    code: result.problem?.code,
  });
}

function contractError(check, code, reason) {
  return deepFreeze(stripUndefined({
    id: typeof check?.id === 'string' && check.id.trim() ? check.id.trim() : 'missing-id',
    code,
    reason,
    ownerScope: isNonEmptyString(check?.ownerScope) ? check.ownerScope.trim() : '',
    severity: isNonEmptyString(check?.severity) ? check.severity.trim() : '',
    command: isNonEmptyString(check?.command) ? check.command.trim() : '',
    artifacts: Array.isArray(check?.artifacts) ? check.artifacts.filter(isNonEmptyString).map((artifact) => artifact.trim()) : [],
  }));
}

function requiredCheckProblem(input) {
  const check = input.check || {};
  return stripUndefined({
    id: input.id || check.id || 'missing-id',
    code: input.code,
    reason: input.reason,
    ownerScope: input.ownerScope || check.ownerScope || '',
    severity: input.severity || check.severity || '',
    command: input.command || check.command || '',
    artifacts: Array.isArray(input.artifacts) ? [...input.artifacts] : (Array.isArray(check.artifacts) ? [...check.artifacts] : []),
    observedStatus: input.observedStatus,
    observedCommand: input.observedCommand,
    observedAt: input.observedAt,
    staleAfterMs: input.staleAfterMs,
    ageMs: input.ageMs,
    missingArtifacts: input.missingArtifacts,
  });
}

function normalizeObservations(observations) {
  const normalized = new Map();
  if (Array.isArray(observations)) {
    for (const observation of observations) {
      if (isNonEmptyString(observation?.id)) {
        normalized.set(observation.id.trim(), observation);
      }
    }
    return normalized;
  }

  if (!isObject(observations)) {
    return normalized;
  }

  for (const [id, observation] of Object.entries(observations)) {
    if (isObject(observation)) {
      normalized.set(id, { id, ...observation });
    }
  }

  return normalized;
}

function observedArtifactPaths(observation) {
  const artifacts = Array.isArray(observation.artifacts)
    ? observation.artifacts
    : (Array.isArray(observation.artifactPaths) ? observation.artifactPaths : []);
  return artifacts.filter(isNonEmptyString).map((artifact) => artifact.trim());
}

function observationPassed(observation) {
  if (observation.passed === true || observation.ok === true || observation.status === 'passed') {
    return true;
  }
  if (observation.passed === false || observation.ok === false || observation.status === 'failed') {
    return false;
  }
  return null;
}

function observedStatus(observation) {
  if (isNonEmptyString(observation.status)) {
    return observation.status.trim();
  }
  if (typeof observation.passed === 'boolean') {
    return observation.passed ? 'passed' : 'failed';
  }
  if (typeof observation.ok === 'boolean') {
    return observation.ok ? 'passed' : 'failed';
  }
  return 'missing-status';
}

function canEvaluateCheck(check) {
  return isNonEmptyString(check?.id)
    && isNonEmptyString(check?.command)
    && Array.isArray(check?.artifacts)
    && check.artifacts.length > 0
    && check.artifacts.every(isNonEmptyString)
    && isNonEmptyString(check?.ownerScope)
    && knownSeverity(check?.severity)
    && Number.isInteger(check?.staleAfterMs)
    && check.staleAfterMs > 0;
}

function knownSeverity(severity) {
  return Object.values(REQUIRED_RELEASE_CHECK_SEVERITIES).includes(severity);
}

function timestampMs(value) {
  if (value instanceof Date) {
    return value.valueOf();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }

  if (isObject(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }

  return value;
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
