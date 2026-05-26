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
      required: 'boolean lifecycle flags',
      observed: `invalid-${invalidLifecycleFlag}`,
    };
  }

  const observedType = session?.type || 'missing';
  const observedStatus = session?.status || 'missing';
  const observedExpiresAt = session?.expiresAt || 'missing';
  const revoked = session?.revoked === true || session?.status === 'revoked';
  const cleanedUp = session?.cleanedUp === true || session?.cleanup === true;

  if (observedType !== 'production-auth-session') {
    return {
      ok: false,
      required: 'production-auth-session',
      observed: observedType,
    };
  }

  if (observedStatus !== 'active') {
    return {
      ok: false,
      required: 'active',
      observed: observedStatus,
    };
  }

  if (!session?.expiresAt || isExpiredAuthSession(session, now)) {
    return {
      ok: false,
      required: 'unexpired',
      observed: observedExpiresAt,
    };
  }

  if (revoked || cleanedUp) {
    return {
      ok: false,
      required: 'unrevoked',
      observed: revoked ? 'revoked' : 'cleaned-up',
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
      observed: issuedObservation.step || 'missing',
    };
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
      observed: readObservation.step || 'missing',
    };
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
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (readObservation.preserved !== true) {
    return {
      ok: false,
      required: 'preserved read',
      observed: readObservation.rotated ? 'rotated' : 'unpreserved',
    };
  }

  if (summary.rotated) {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (summary.revoked || summary.cleanedUp || summary.cleanup) {
    return {
      ok: false,
      required: 'unrevoked',
      observed: summary.revoked ? 'revoked' : 'cleaned-up',
    };
  }

  if (summary.expired) {
    return {
      ok: false,
      required: 'unexpired',
      observed: summary.expired.expiresAt || 'expired',
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

    const observationSessionId = normalizeAuthSessionObservationId(observation.id);
    if (
      observation.step !== 'preflight'
      && isAuthSessionReadStep(observation.step)
      && !observationSessionId
    ) {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'rotated',
      };
    }
    if (observationSessionId && observationSessionId !== issuedSessionId) {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'rotated',
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
        observed: observation.step || 'missing',
      };
    }
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
      expired: entry.expired === true,
      revoked: entry.revoked === true,
      cleanedUp: entry.cleanedUp === true || entry.cleanup === true,
      rotated: entry.rotated === true,
      preserved: entry.preserved === true,
    };
  });
  const readObservation = [...observations]
    .reverse()
    .find((entry) => entry.step === 'journal'
      || entry.step === 'replay'
      || entry.step === 'apply'
      || entry.step === 'dry-run') ?? null;

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

function resolveInvalidAuthSessionLifecycleFlag(observation) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  if (typeof observation.invalidLifecycleFlag === 'string' && observation.invalidLifecycleFlag) {
    return observation.invalidLifecycleFlag;
  }

  const lifecycleFlags = ['expired', 'revoked', 'cleanedUp', 'cleanup', 'rotated', 'preserved'];
  for (const flag of lifecycleFlags) {
    const value = observation[flag];
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return flag;
    }
  }

  return null;
}

function resolveInvalidAuthSessionSummaryFlag(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  if (summary.cleanup !== undefined && summary.cleanup !== null && typeof summary.cleanup !== 'boolean') {
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
