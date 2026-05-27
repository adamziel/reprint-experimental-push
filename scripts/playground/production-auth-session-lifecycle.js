export function isExpiredAuthSession(session, now = Date.now()) {
  if (!session || typeof session !== 'object') {
    return false;
  }

  const expiresAt = session.expiresAt;
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  const nowMs = now instanceof Date ? now.getTime() : now;
  return expiresAtMs <= nowMs;
}

export function evaluateProductionAuthSessionLifecycle(session, now = Date.now()) {
  const invalidLifecycleFlag = resolveInvalidAuthSessionLifecycleFlag(session);
  if (invalidLifecycleFlag) {
    return {
      ok: false,
      field: `auth.session.${invalidLifecycleFlag}`,
      required: 'boolean lifecycle flags',
      observed: `invalid-${invalidLifecycleFlag}`,
    };
  }

  const invalidIdentityField = resolveInvalidAuthSessionIdentityField(session);
  if (invalidIdentityField) {
    return {
      ok: false,
      field: `auth.session.${invalidIdentityField === 'expires-at' ? 'expiresAt' : invalidIdentityField}`,
      required: 'string lifecycle fields',
      observed: `invalid-${invalidIdentityField}`,
    };
  }

  const observedType = normalizeAuthSessionObservationField(session?.type) ?? 'missing';
  const observedStatus = normalizeAuthSessionObservationField(session?.status) ?? 'missing';
  const observedExpiresAt = normalizeAuthSessionObservationField(session?.expiresAt) ?? 'missing';
  const revoked = session?.revoked === true || session?.status === 'revoked';
  const cleanedUp = session?.cleanedUp === true || session?.cleanup === true || session?.status === 'cleaned-up';
  const rotated = session?.rotated === true || session?.status === 'rotated';
  const expired = session?.expired === true || session?.status === 'expired' || isExpiredAuthSession(session, now);

  if (observedType !== 'production-auth-session') {
    return {
      ok: false,
      field: 'auth.session.type',
      required: 'production-auth-session',
      observed: observedType,
    };
  }

  const productionSourceObservation = resolveProductionAuthSessionSourceObservation(session);
  if (productionSourceObservation) {
    return {
      ok: false,
      field: productionSourceObservation.field,
      required: 'production-backed auth',
      observed: productionSourceObservation.observed,
    };
  }

  if (revoked || cleanedUp) {
    return {
      ok: false,
      field: normalizeAuthSessionObservationField(session?.unrevokedField) || resolveProductionAuthSessionUnrevokedField(session),
      required: 'unrevoked',
      observed: revoked ? 'revoked' : 'cleaned-up',
    };
  }

  if (rotated) {
    return {
      ok: false,
      field: session?.rotated === true ? 'auth.session.rotated' : 'auth.session.status',
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (expired) {
    return {
      ok: false,
      field: resolveProductionAuthSessionExpiredField(session),
      required: 'unexpired',
      observed: observedStatus === 'expired' ? 'expired' : observedExpiresAt,
    };
  }

  if (observedStatus !== 'active') {
    return {
      ok: false,
      field: 'auth.session.status',
      required: 'active',
      observed: observedStatus,
    };
  }

  if (!session?.expiresAt) {
    return {
      ok: false,
      field: 'auth.session.expiresAt',
      required: 'unexpired',
      observed: observedExpiresAt,
    };
  }

  return {
    ok: true,
    required: 'production-auth-session lifecycle',
    observed: observedType,
  };
}

export function evaluateProductionAuthSessionLifecycleSummary(summary, now = Date.now()) {
  if (!summary || typeof summary !== 'object') {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'missing',
    };
  }

  const invalidSummaryFlag = resolveInvalidAuthSessionSummaryFlag(summary);
  if (invalidSummaryFlag) {
    return {
      ok: false,
      required: 'boolean lifecycle flags',
      observed: `invalid-${invalidSummaryFlag}`,
    };
  }

  if (summary.observations !== undefined && !Array.isArray(summary.observations)) {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'invalid-observations',
    };
  }

  const invalidSummaryObservationField = resolveInvalidAuthSessionSummaryObservationField(summary);
  if (invalidSummaryObservationField) {
    return invalidSummaryObservationField;
  }

  const issuedObservation = summary.issued;
  if (!issuedObservation || typeof issuedObservation !== 'object' || Array.isArray(issuedObservation)) {
    return {
      ok: false,
      required: 'issued preflight',
      observed: issuedObservation ? 'invalid-issued' : 'missing',
    };
  }

  if (issuedObservation.step !== 'preflight') {
    return {
      ok: false,
      required: 'issued preflight',
      observed: normalizeAuthSessionObservationStep(issuedObservation.step),
    };
  }

  const invalidIssuedObservation = resolveInvalidIssuedAuthSessionObservation(issuedObservation);
  if (invalidIssuedObservation) {
    return invalidIssuedObservation;
  }

  const issuedLifecycle = evaluateProductionAuthSessionLifecycle(issuedObservation, now);
  if (!issuedLifecycle.ok) {
    return issuedLifecycle;
  }

  const observations = Array.isArray(summary.observations) ? summary.observations : [];
  if (observations.length > 0) {
    const issuedIndex = observations.findIndex((observation) =>
      observation
      && typeof observation === 'object'
      && observation.step === 'preflight',
    );
    if (issuedIndex < 0) {
      const readBeforeIssued = observations.find((observation) =>
        observation
        && typeof observation === 'object'
        && isAuthSessionReadStep(observation.step),
      );
      if (readBeforeIssued) {
        return {
          ok: false,
          required: 'issued preflight',
          observed: 'missing',
        };
      }
    }
    if (issuedIndex > 0) {
      for (const observation of observations.slice(0, issuedIndex)) {
        if (!observation || typeof observation !== 'object') {
          continue;
        }
        if (isAuthSessionReadStep(observation.step)) {
          return {
            ok: false,
            required: 'issued preflight',
            observed: observation.step || 'out-of-order',
          };
        }
      }
    }

    const subsequentIssuedObservation = issuedIndex >= 0
      ? observations.slice(issuedIndex + 1).find((observation) =>
        observation
        && typeof observation === 'object'
        && observation.step === 'preflight')
      : null;
    if (subsequentIssuedObservation) {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'reissued',
      };
    }

    const mismatchedIssuedObservation = resolveMismatchedSummaryIssuedObservation(issuedObservation, observations);
    if (mismatchedIssuedObservation) {
      return mismatchedIssuedObservation;
    }
  }

  const readObservation = summary.read;
  if (!readObservation || typeof readObservation !== 'object' || Array.isArray(readObservation)) {
    return {
      ok: false,
      required: 'preserved read',
      observed: readObservation ? 'invalid-read' : 'missing',
    };
  }

  if (!isAuthSessionReadStep(readObservation.step)) {
    return {
      ok: false,
      required: 'preserved read',
      observed: normalizeAuthSessionObservationStep(readObservation.step),
    };
  }

  const invalidReadObservation = resolveInvalidReadAuthSessionObservation(readObservation);
  if (invalidReadObservation) {
    return invalidReadObservation;
  }

  const readLifecycle = evaluateProductionAuthSessionLifecycle(readObservation, now);
  if (!readLifecycle.ok) {
    return readLifecycle;
  }

  const issuedSessionId = normalizeAuthSessionObservationId(summary.issued?.id);
  const readSessionId = normalizeAuthSessionObservationId(readObservation.id);
  if (!issuedSessionId || !readSessionId || issuedSessionId !== readSessionId) {
    return {
      ok: false,
      field: readObservation.status === 'rotated' ? 'auth.session.status' : 'auth.session.rotated',
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  const mismatchedSummaryObservation = resolveMismatchedSummaryObservationSession(summary, issuedSessionId);
  if (mismatchedSummaryObservation) {
    return mismatchedSummaryObservation;
  }

  if (readObservation.preserved !== true) {
    return {
      ok: false,
      field: 'auth.session.preserved',
      required: 'preserved read',
      observed: readObservation.rotated ? 'rotated' : 'unpreserved',
    };
  }

  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'invalid-observation',
      };
    }

    if (observation.step === null || observation.step === undefined || observation.step === '') {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'missing-phase',
      };
    }

    if (typeof observation.step !== 'string') {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'invalid-step',
      };
    }

    const observationSessionId = normalizeAuthSessionObservationId(observation.id);
    if (observation.id !== undefined && observation.id !== null && !observationSessionId) {
      return {
        ok: false,
        required: 'string lifecycle fields',
        observed: 'invalid-id',
      };
    }

    if (
      observation.step !== 'preflight'
      && isAuthSessionReadStep(observation.step)
      && !observationSessionId
    ) {
      return {
        ok: false,
        field: observation.status === 'rotated' ? 'auth.session.status' : 'auth.session.rotated',
        required: 'preserved read',
        observed: 'rotated',
      };
    }
    if (observationSessionId && observationSessionId !== issuedSessionId) {
      return {
        ok: false,
        field: observation.status === 'rotated' ? 'auth.session.status' : 'auth.session.rotated',
        required: 'preserved read',
        observed: 'rotated',
      };
    }

    const invalidObservationLifecycleFlag = resolveInvalidAuthSessionLifecycleFlag(observation);
    if (invalidObservationLifecycleFlag) {
      return {
        ok: false,
        required: 'boolean lifecycle flags',
        observed: `invalid-${invalidObservationLifecycleFlag}`,
      };
    }

    if (observation.rotated) {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'rotated',
      };
    }

    if (
      observation.step !== 'preflight'
      && isAuthSessionReadStep(observation.step)
      && observation.preserved !== true
    ) {
      return {
        ok: false,
        field: 'auth.session.preserved',
        required: 'preserved read',
        observed: observation.rotated ? 'rotated' : 'unpreserved',
      };
    }

    const lifecycle = evaluateProductionAuthSessionLifecycle(observation, now);
    if (!lifecycle.ok) {
      return lifecycle;
    }

    if (
      observation.step !== null
      && observation.step !== undefined
      && observation.step !== 'preflight'
      && !isAuthSessionReadStep(observation.step)
    ) {
      return {
        ok: false,
        required: 'preserved read',
        observed: normalizeAuthSessionObservationStep(observation.step),
      };
    }
  }

  const mismatchedReadObservation = resolveMismatchedSummaryReadObservation(readObservation, observations);
  if (mismatchedReadObservation) {
    return mismatchedReadObservation;
  }

  const mismatchedPreservedObservation = resolveMismatchedSummaryPreservedObservation(summary.preserved, observations);
  if (mismatchedPreservedObservation) {
    return mismatchedPreservedObservation;
  }

  const mismatchedExpiredObservation = resolveMismatchedSummaryLifecycleMarkerObservation(
    'expired',
    summary.expired,
    observations,
  );
  if (mismatchedExpiredObservation) {
    return mismatchedExpiredObservation;
  }

  const mismatchedRevokedObservation = resolveMismatchedSummaryLifecycleMarkerObservation(
    'revoked',
    summary.revoked,
    observations,
  );
  if (mismatchedRevokedObservation) {
    return mismatchedRevokedObservation;
  }

  const mismatchedCleanedUpObservation = resolveMismatchedSummaryLifecycleMarkerObservation(
    'cleanedUp',
    resolveSummaryCleanedUpObservation(summary),
    observations,
  );
  if (mismatchedCleanedUpObservation) {
    return mismatchedCleanedUpObservation;
  }

  const mismatchedRotatedObservation = resolveMismatchedSummaryLifecycleMarkerObservation(
    'rotated',
    summary.rotated,
    observations,
  );
  if (mismatchedRotatedObservation) {
    return mismatchedRotatedObservation;
  }

  if (summary.rotated) {
    return {
      ok: false,
      field: normalizeAuthSessionObservationField(summary.rotated.rotatedField)
        || (summary.rotated.status === 'rotated' ? 'auth.session.status' : 'auth.session.rotated'),
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (summary.revoked || summary.cleanedUp || summary.cleanup) {
    return {
      ok: false,
      field: summary.revoked
        ? (
          normalizeAuthSessionObservationField(summary.revoked.unrevokedField)
          || resolveProductionAuthSessionUnrevokedField(summary.revoked)
        )
        : summary.cleanedUp
          ? (
            normalizeAuthSessionObservationField(summary.cleanedUp.unrevokedField)
            || resolveProductionAuthSessionUnrevokedField(summary.cleanedUp)
          )
          : 'auth.session.cleanup',
      required: 'unrevoked',
      observed: summary.revoked ? 'revoked' : 'cleaned-up',
    };
  }

  if (summary.expired) {
    return {
      ok: false,
      field: normalizeAuthSessionObservationField(summary.expired.expiredField)
        || (summary.expired.status === 'expired' ? 'auth.session.status' : 'auth.session.expired'),
      required: 'unexpired',
      observed: summary.expired.expiresAt || 'expired',
    };
  }

  return {
    ok: true,
    required: 'production-auth-session lifecycle',
    observed: 'active-unexpired-preserved',
  };
}

export function summarizeProductionAuthSessionLifecycleTrace(trace) {
  if (!Array.isArray(trace) || trace.length === 0) {
    return null;
  }

  const observations = trace.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return {
        step: null,
        id: null,
        type: null,
        status: null,
        expiresAt: null,
        invalidLifecycleFlag: null,
        invalidIdentityField: null,
        expired: false,
        revoked: false,
        cleanedUp: false,
        rotated: false,
        preserved: false,
      };
    }

    return {
      step: entry.step ?? null,
      id: entry.id ?? null,
      type: entry.type ?? null,
      status: entry.status ?? null,
      expiresAt: entry.expiresAt ?? null,
      invalidLifecycleFlag: resolveInvalidAuthSessionLifecycleFlag(entry),
      ...(resolveInvalidAuthSessionIdentityField(entry)
        ? { invalidIdentityField: resolveInvalidAuthSessionIdentityField(entry) }
        : {}),
      ...(typeof entry.unrevokedField === 'string' ? { unrevokedField: entry.unrevokedField } : {}),
      ...(typeof entry.expiredField === 'string' ? { expiredField: entry.expiredField } : {}),
      ...(typeof entry.rotatedField === 'string' ? { rotatedField: entry.rotatedField } : {}),
      expired: entry.expired === true || entry.status === 'expired' || isExpiredAuthSession(entry),
      revoked: entry.revoked === true || entry.status === 'revoked',
      cleanedUp: entry.cleanedUp === true || entry.cleanup === true || entry.status === 'cleaned-up',
      cleanup: entry.cleanup === true,
      rotated: entry.rotated === true || entry.status === 'rotated',
      preserved: isAuthSessionReadStep(entry.step) && entry.preserved === true,
      ...(entry.playgroundFallback === true ? { playgroundFallback: true } : {}),
      ...(typeof entry.warning === 'string' ? { warning: entry.warning } : {}),
    };
  });
  const readObservation = [...observations]
    .reverse()
    .find((entry) => isAuthSessionReadStep(entry.step)) ?? null;

  return {
    issued: observations.find((entry) => entry.step === 'preflight') ?? null,
    read: readObservation,
    expired: observations.find((entry) => entry.expired) ?? null,
    revoked: observations.find((entry) => entry.revoked) ?? null,
    cleanedUp: observations.find((entry) => entry.cleanedUp) ?? null,
    rotated: observations.find((entry) => entry.rotated) ?? null,
    preserved: observations.find((entry) => entry.preserved) ?? null,
    observations,
  };
}

function isAuthSessionReadStep(step) {
  return step === 'dry-run'
    || step === 'apply'
    || step === 'recovery-inspect'
    || step === 'replay'
    || step === 'journal';
}

function normalizeAuthSessionObservationId(id) {
  if (typeof id !== 'string') {
    return null;
  }

  const normalized = id.trim();
  if (
    !normalized
    || normalized !== id
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeAuthSessionObservationField(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeAuthSessionObservationStep(step) {
  if (step === null || step === undefined || step === '') {
    return 'missing';
  }

  if (typeof step !== 'string') {
    return 'invalid-step';
  }

  return step;
}

function resolveProductionAuthSessionUnrevokedField(observation) {
  if (observation?.status === 'revoked') {
    return 'auth.session.status';
  }

  if (observation?.revoked === true) {
    return 'auth.session.revoked';
  }

  if (observation?.status === 'cleaned-up') {
    return 'auth.session.status';
  }

  if (observation?.cleanup === true) {
    return 'auth.session.cleanup';
  }

  if (observation?.cleanedUp === true) {
    return 'auth.session.cleanedUp';
  }

  return 'auth.session.cleanedUp';
}

function resolveProductionAuthSessionExpiredField(observation) {
  if (observation?.status === 'expired') {
    return 'auth.session.status';
  }

  if (observation?.expired === true) {
    return 'auth.session.expired';
  }

  return 'auth.session.expiresAt';
}

function resolveProductionAuthSessionSourceObservation(observation) {
  if (observation?.playgroundFallback === true) {
    return {
      field: 'auth.session.playgroundFallback',
      observed: 'playground-fallback',
    };
  }

  const warning = normalizeAuthSessionObservationField(observation?.warning);
  if (warning) {
    return {
      field: 'auth.session.warning',
      observed: warning,
    };
  }

  return null;
}

function resolveInvalidAuthSessionLifecycleFlag(observation) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  if (typeof observation.invalidLifecycleFlag === 'string' && observation.invalidLifecycleFlag) {
    return observation.invalidLifecycleFlag;
  }

  const lifecycleFlags = ['expired', 'revoked', 'cleanedUp', 'cleanup', 'rotated', 'preserved', 'playgroundFallback'];
  for (const flag of lifecycleFlags) {
    const value = observation[flag];
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return flag;
    }
  }

  return null;
}

function resolveInvalidAuthSessionIdentityField(observation) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  if (typeof observation.invalidIdentityField === 'string' && observation.invalidIdentityField) {
    return observation.invalidIdentityField;
  }

  if (observation.id !== undefined && observation.id !== null && !normalizeAuthSessionObservationId(observation.id)) {
    return 'id';
  }

  const identityFields = [
    ['type', 'type'],
    ['status', 'status'],
    ['expiresAt', 'expires-at'],
  ];

  for (const [field, label] of identityFields) {
    const value = observation[field];
    if (value !== undefined && value !== null && !normalizeAuthSessionObservationField(value)) {
      return label;
    }
  }

  if (
    observation.warning !== undefined
    && observation.warning !== null
    && !normalizeAuthSessionObservationField(observation.warning)
  ) {
    return 'warning';
  }

  return null;
}

function resolveInvalidAuthSessionSummaryFlag(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  if (
    summary.cleanup !== undefined
    && summary.cleanup !== null
    && typeof summary.cleanup !== 'boolean'
    && (typeof summary.cleanup !== 'object' || Array.isArray(summary.cleanup))
  ) {
    return 'cleanup';
  }

  const summaryObservationFields = ['expired', 'revoked', 'cleanedUp', 'rotated', 'preserved'];
  for (const field of summaryObservationFields) {
    const value = summary[field];
    if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
      return field;
    }
  }

  return null;
}

function resolveInvalidAuthSessionSummaryObservationField(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  for (const [field, observation] of getSummaryObservationEntries(summary)) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      continue;
    }

    const normalizedStep = normalizeAuthSessionObservationStep(observation.step);
    if (normalizedStep === 'missing') {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'missing-phase',
      };
    }

    if (normalizedStep === 'invalid-step') {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'invalid-step',
      };
    }

    const invalidLifecycleFlag = resolveInvalidAuthSessionLifecycleFlag(observation);
    if (invalidLifecycleFlag) {
      return {
        ok: false,
        required: 'boolean lifecycle flags',
        observed: `invalid-${invalidLifecycleFlag}`,
      };
    }

    const invalidIdentityField = resolveInvalidAuthSessionIdentityField(observation);
    if (invalidIdentityField) {
      return {
        ok: false,
        required: 'string lifecycle fields',
        observed: `invalid-${invalidIdentityField}`,
      };
    }

    if (!summaryObservationCarriesExpectedFlag(field, observation)) {
      return {
        ok: false,
        required: 'boolean lifecycle flags',
        observed: `invalid-${field}`,
      };
    }

    if (
      !summaryObservationStepMatchesMarker(field, observation.step)
      && !summaryMarkerMatchesDirectReadLifecycleOutcome(summary, field, observation)
    ) {
      return {
        ok: false,
        required: 'preserved read',
        observed: normalizeAuthSessionObservationStep(observation.step),
      };
    }

    if (field === 'preserved') {
      const invalidPreservedLifecycleOutcome = resolveInvalidReadLifecycleOutcome(
        observation,
        'preserved read',
      );
      if (invalidPreservedLifecycleOutcome) {
        return invalidPreservedLifecycleOutcome;
      }
    }
  }

  return null;
}

function resolveMismatchedSummaryObservationSession(summary, issuedSessionId) {
  if (!summary || typeof summary !== 'object' || !issuedSessionId) {
    return null;
  }

  for (const [field, observation] of getSummaryObservationEntries(summary)) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      continue;
    }

    const observationSessionId = normalizeAuthSessionObservationId(observation.id);
    if (observationSessionId && observationSessionId !== issuedSessionId) {
      return {
        ok: false,
        field: field === 'rotated' && observation.status === 'rotated'
          ? 'auth.session.status'
          : 'auth.session.rotated',
        required: 'preserved read',
        observed: 'rotated',
      };
    }
  }

  return null;
}

function resolveMismatchedSummaryReadObservation(readObservation, observations) {
  if (!readObservation || !Array.isArray(observations) || observations.length === 0) {
    return null;
  }

  const lastObservedRead = [...observations]
    .reverse()
    .find((observation) => observation && typeof observation === 'object' && isAuthSessionReadStep(observation.step));
  if (!lastObservedRead) {
    return null;
  }

  const readSessionId = normalizeAuthSessionObservationId(readObservation.id);
  const lastObservedReadSessionId = normalizeAuthSessionObservationId(lastObservedRead.id);
  if (readSessionId && lastObservedReadSessionId && readSessionId !== lastObservedReadSessionId) {
    return {
      ok: false,
      field: 'auth.session.rotated',
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (readObservation.step !== lastObservedRead.step) {
    return {
      ok: false,
      required: 'preserved read',
      observed: normalizeAuthSessionObservationStep(lastObservedRead.step),
    };
  }

  if (!authSessionObservationEquals(readObservation, lastObservedRead)) {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'stale-read-summary',
    };
  }

  return null;
}

function resolveMismatchedSummaryIssuedObservation(issuedObservation, observations) {
  if (!issuedObservation || !Array.isArray(observations) || observations.length === 0) {
    return null;
  }

  const observedIssued = observations.find((observation) =>
    observation && typeof observation === 'object' && observation.step === 'preflight');
  if (!observedIssued) {
    return null;
  }

  if (!authSessionObservationEquals(issuedObservation, observedIssued)) {
    return {
      ok: false,
      required: 'issued preflight',
      observed: 'stale-issued-summary',
    };
  }

  return null;
}

function resolveMismatchedSummaryPreservedObservation(preservedObservation, observations) {
  if (!preservedObservation || !Array.isArray(observations) || observations.length === 0) {
    return null;
  }

  const observedPreserved = observations.find((observation) =>
    observation
    && typeof observation === 'object'
    && isAuthSessionReadStep(observation.step)
    && observation.preserved === true);
  if (!observedPreserved) {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'stale-preserved-summary',
    };
  }

  if (!authSessionObservationEquals(preservedObservation, observedPreserved)) {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'stale-preserved-summary',
    };
  }

  return null;
}

function resolveMismatchedSummaryLifecycleMarkerObservation(field, markerObservation, observations) {
  if (
    !markerObservation
    || typeof markerObservation !== 'object'
    || Array.isArray(markerObservation)
    || !Array.isArray(observations)
    || observations.length === 0
  ) {
    return null;
  }

  const observedMarker = observations.find((observation) =>
    observation
    && typeof observation === 'object'
    && observationMatchesLifecycleMarker(field, observation),
  );
  if (!observedMarker) {
    return {
      ok: false,
      required: summaryLifecycleMarkerRequirement(field),
      observed: `stale-${summaryLifecycleMarkerLabel(field)}-summary`,
    };
  }

  if (!authSessionObservationEquals(markerObservation, observedMarker)) {
    return {
      ok: false,
      required: summaryLifecycleMarkerRequirement(field),
      observed: `stale-${summaryLifecycleMarkerLabel(field)}-summary`,
    };
  }

  return null;
}

function resolveInvalidIssuedAuthSessionObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  if (observation.preserved === true) {
    return {
      ok: false,
      required: 'issued preflight',
      observed: 'preserved',
    };
  }

  return resolveInvalidReadLifecycleOutcome(observation, 'issued preflight');
}

function resolveInvalidReadAuthSessionObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  return resolveInvalidReadLifecycleOutcome(observation, 'preserved read');
}

function resolveInvalidReadLifecycleOutcome(observation, required) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  if (observation.status === 'revoked') {
    return {
      ok: false,
      field: 'auth.session.status',
      required: 'unrevoked',
      observed: 'revoked',
    };
  }

  if (observation.status === 'cleaned-up') {
    return {
      ok: false,
      field: 'auth.session.status',
      required: 'unrevoked',
      observed: 'cleaned-up',
    };
  }

  if (observation.status === 'expired') {
    return {
      ok: false,
      field: 'auth.session.status',
      required: 'unexpired',
      observed: 'expired',
    };
  }

  if (observation.expired === true) {
    return {
      ok: false,
      field: 'auth.session.expired',
      required: 'unexpired',
      observed: 'expired',
    };
  }

  if (observation.revoked === true) {
    return {
      ok: false,
      field: 'auth.session.revoked',
      required: 'unrevoked',
      observed: 'revoked',
    };
  }

  if (observation.cleanedUp === true || observation.cleanup === true) {
    return {
      ok: false,
      field: observation.cleanup === true ? 'auth.session.cleanup' : 'auth.session.cleanedUp',
      required: 'unrevoked',
      observed: 'cleaned-up',
    };
  }

  if (observation.rotated === true || observation.status === 'rotated') {
    return {
      ok: false,
      field: observation.status === 'rotated' ? 'auth.session.status' : 'auth.session.rotated',
      required,
      observed: 'rotated',
    };
  }

  return null;
}

function authSessionObservationEquals(left, right) {
  return normalizeAuthSessionObservationId(left?.id) === normalizeAuthSessionObservationId(right?.id)
    && normalizeAuthSessionObservationField(left?.type) === normalizeAuthSessionObservationField(right?.type)
    && normalizeAuthSessionObservationField(left?.status) === normalizeAuthSessionObservationField(right?.status)
    && normalizeAuthSessionObservationField(left?.expiresAt) === normalizeAuthSessionObservationField(right?.expiresAt)
    && normalizeAuthSessionObservationField(left?.warning) === normalizeAuthSessionObservationField(right?.warning)
    && normalizeAuthSessionObservationStep(left?.step) === normalizeAuthSessionObservationStep(right?.step)
    && normalizeLifecycleBoolean(left?.expired) === normalizeLifecycleBoolean(right?.expired)
    && normalizeLifecycleBoolean(left?.revoked) === normalizeLifecycleBoolean(right?.revoked)
    && normalizeLifecycleBoolean(left?.rotated) === normalizeLifecycleBoolean(right?.rotated)
    && normalizeLifecycleBoolean(left?.preserved) === normalizeLifecycleBoolean(right?.preserved)
    && normalizeLifecycleBoolean(left?.playgroundFallback) === normalizeLifecycleBoolean(right?.playgroundFallback)
    && normalizeLifecycleBoolean(left?.cleanedUp ?? left?.cleanup) === normalizeLifecycleBoolean(right?.cleanedUp ?? right?.cleanup);
}

function normalizeLifecycleBoolean(value) {
  return value === true;
}

function summaryObservationCarriesExpectedFlag(field, observation) {
  switch (field) {
    case 'expired':
      return observation.expired === true;
    case 'revoked':
      return observation.revoked === true;
    case 'cleanedUp':
      return observation.cleanedUp === true || observation.cleanup === true;
    case 'rotated':
      return observation.rotated === true || observation.status === 'rotated';
    case 'preserved':
      return observation.preserved === true;
    default:
      return true;
  }
}

function getSummaryObservationEntries(summary) {
  return [
    ['expired', summary?.expired],
    ['revoked', summary?.revoked],
    ['cleanedUp', resolveSummaryCleanedUpObservation(summary)],
    ['rotated', summary?.rotated],
    ['preserved', summary?.preserved],
  ];
}

function resolveSummaryCleanedUpObservation(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  if (summary.cleanedUp && typeof summary.cleanedUp === 'object' && !Array.isArray(summary.cleanedUp)) {
    return summary.cleanedUp;
  }

  if (summary.cleanup && typeof summary.cleanup === 'object' && !Array.isArray(summary.cleanup)) {
    return summary.cleanup;
  }

  return null;
}

function summaryObservationStepMatchesMarker(field, step) {
  switch (field) {
    case 'expired':
    case 'revoked':
    case 'rotated':
    case 'preserved':
      return isAuthSessionReadStep(step);
    case 'cleanedUp':
      return step === 'cleanup';
    default:
      return true;
  }
}

function summaryMarkerMatchesDirectReadLifecycleOutcome(summary, field, observation) {
  if (field !== 'cleanedUp') {
    return false;
  }

  const directRead = summary?.read;
  if (!directRead || typeof directRead !== 'object' || Array.isArray(directRead)) {
    return false;
  }

  if (directRead.cleanedUp !== true && directRead.cleanup !== true) {
    return false;
  }

  const directReadSessionId = normalizeAuthSessionObservationId(directRead.id);
  const observationSessionId = normalizeAuthSessionObservationId(observation?.id);
  return !directReadSessionId || !observationSessionId || directReadSessionId === observationSessionId;
}

function observationMatchesLifecycleMarker(field, observation) {
  switch (field) {
    case 'expired':
      return observation.expired === true;
    case 'revoked':
      return observation.revoked === true;
    case 'cleanedUp':
      return observation.cleanedUp === true || observation.cleanup === true;
    case 'rotated':
      return observation.rotated === true || observation.status === 'rotated';
    default:
      return false;
  }
}

function summaryLifecycleMarkerRequirement(field) {
  switch (field) {
    case 'expired':
      return 'unexpired';
    case 'revoked':
    case 'cleanedUp':
      return 'unrevoked';
    case 'rotated':
      return 'preserved read';
    default:
      return 'preserved read';
  }
}

function summaryLifecycleMarkerLabel(field) {
  switch (field) {
    case 'cleanedUp':
      return 'cleaned-up';
    default:
      return field;
  }
}
