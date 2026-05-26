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
  const invalidLifecycleFlag = resolveInvalidProductionAuthSessionLifecycleFlag(session);
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

  const issuedObservation = summary.issued;
  if (!issuedObservation || typeof issuedObservation !== 'object') {
    return {
      ok: false,
      required: 'issued preflight',
      observed: 'missing',
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(issuedObservation, 'step')
    && issuedObservation.step !== null
    && issuedObservation.step !== 'preflight'
  ) {
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

  const issuedAuthUser = resolveAuthSessionIdentitySummary(issuedObservation);
  const observations = Array.isArray(summary.observations) ? summary.observations : [];
  if (observations.length > 0) {
    const issuedIndex = observations.findIndex((observation) =>
      observation
      && typeof observation === 'object'
      && observation.step === 'preflight'
    );
    if (issuedIndex === -1) {
      return {
        ok: false,
        required: 'issued preflight',
        observed: 'missing',
      };
    }

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

    const hasSubsequentReadObservation = hasTraceBackedPostPreflightReadObservation(observations, issuedIndex);
    if (!hasSubsequentReadObservation) {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'missing',
      };
    }
  }

  const readObservation = summary.read;
  if (!readObservation || typeof readObservation !== 'object') {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'missing',
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(readObservation, 'step')
    && readObservation.step !== null
    && !isAuthSessionReadStep(readObservation.step)
  ) {
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

  const readAuthUser = resolveAuthSessionIdentitySummary(readObservation);
  if (!issuedAuthUser.missing && readAuthUser.missing) {
    return {
      ok: false,
      required: 'authenticated identity continuity',
      observed: 'missing-user-login',
    };
  }
  if (!issuedAuthUser.missing && !readAuthUser.missing && readAuthUser.value !== issuedAuthUser.value) {
    return {
      ok: false,
      required: 'authenticated identity continuity',
      observed: readAuthUser.value,
    };
  }

  const issuedSessionId = typeof summary.issued?.id === 'string' && summary.issued.id.trim()
    ? summary.issued.id
    : null;
  const readSessionId = typeof readObservation.id === 'string' && readObservation.id.trim()
    ? readObservation.id
    : null;
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

  if (summary.revoked || summary.cleanedUp) {
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
      continue;
    }

    if (observation.step !== 'preflight' && !isAuthSessionReadStep(observation.step)) {
      return {
        ok: false,
        required: 'preserved read',
        observed: observation.step || 'missing',
      };
    }

    const observationSessionId = typeof observation.id === 'string' && observation.id.trim()
      ? observation.id
      : null;
    if (!observationSessionId) {
      return {
        ok: false,
        required: 'preserved read',
        observed: 'missing-session-id',
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

    const observationAuthUser = resolveAuthSessionIdentitySummary(observation);
    if (!issuedAuthUser.missing && observationAuthUser.missing) {
      return {
        ok: false,
        required: 'authenticated identity continuity',
        observed: 'missing-user-login',
      };
    }
    if (!issuedAuthUser.missing && !observationAuthUser.missing
      && observationAuthUser.value !== issuedAuthUser.value) {
      return {
        ok: false,
        required: 'authenticated identity continuity',
        observed: observationAuthUser.value,
      };
    }

    const lifecycle = evaluateProductionAuthSessionLifecycle(observation, now);
    if (!lifecycle.ok) {
      return lifecycle;
    }
  }

  if (issuedAuthUser.missing) {
    return {
      ok: false,
      required: 'authenticated identity continuity',
      observed: 'missing-user-login',
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

  const observations = trace
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      step: entry.step ?? null,
      id: entry.id ?? null,
      type: entry.type ?? null,
      status: entry.status ?? null,
      expiresAt: entry.expiresAt ?? null,
      ...(typeof entry.authUser === 'string' && entry.authUser.trim()
        ? { authUser: entry.authUser.trim() }
        : {}),
      expired: Boolean(entry.expired),
      revoked: Boolean(entry.revoked),
      cleanedUp: Boolean(entry.cleanedUp),
      rotated: Boolean(entry.rotated),
      preserved: Boolean(entry.preserved),
    }));
  const readObservation = [...observations]
    .reverse()
    .find((entry) => entry.step === 'journal'
      || entry.step === 'replay'
      || entry.step === 'recovery-inspect'
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
    || step === 'recovery-inspect'
    || step === 'replay'
    || step === 'journal';
}

function hasTraceBackedPostPreflightReadObservation(observations, issuedIndex) {
  for (let index = observations.length - 1; index > issuedIndex; index -= 1) {
    const observation = observations[index];
    if (
      observation
      && typeof observation === 'object'
      && isAuthSessionReadStep(observation.step)
    ) {
      return true;
    }
  }

  return false;
}

function resolveAuthSessionIdentitySummary(observation) {
  if (!observation || typeof observation !== 'object') {
    return { missing: true, value: '' };
  }

  const authUser = typeof observation.authUser === 'string'
    ? observation.authUser.trim()
    : '';
  return {
    missing: !authUser,
    value: authUser,
  };
}

function resolveInvalidProductionAuthSessionLifecycleFlag(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const lifecycleFlags = [
    ['revoked', session.revoked],
    ['cleanedUp', session.cleanedUp],
    ['cleanup', session.cleanup],
    ['expired', session.expired],
    ['rotated', session.rotated],
    ['preserved', session.preserved],
  ];

  for (const [name, value] of lifecycleFlags) {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return name;
    }
  }

  return null;
}
