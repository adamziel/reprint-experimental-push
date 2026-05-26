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

  const issuedLifecycle = evaluateProductionAuthSessionLifecycle(summary.issued, now);
  if (!issuedLifecycle.ok) {
    return issuedLifecycle;
  }

  const readObservation = summary.read;
  if (!readObservation || typeof readObservation !== 'object') {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'missing',
    };
  }

  const readLifecycle = evaluateProductionAuthSessionLifecycle(readObservation, now);
  if (!readLifecycle.ok) {
    return readLifecycle;
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

  for (const observation of Array.isArray(summary.observations) ? summary.observations : []) {
    if (!observation || typeof observation !== 'object') {
      continue;
    }

    const observationSessionId = typeof observation.id === 'string' && observation.id.trim()
      ? observation.id
      : null;
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

    const lifecycle = evaluateProductionAuthSessionLifecycle(observation, now);
    if (!lifecycle.ok && (
      lifecycle.required === 'active' ||
      lifecycle.required === 'unexpired' ||
      lifecycle.required === 'unrevoked'
    )) {
      return lifecycle;
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

  const observations = trace
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      step: entry.step ?? null,
      id: entry.id ?? null,
      type: entry.type ?? null,
      status: entry.status ?? null,
      expiresAt: entry.expiresAt ?? null,
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
      || entry.step === 'apply'
      || entry.step === 'dry-run') ?? null;

  return {
    issued: observations[0] ?? null,
    read: readObservation,
    expired: observations.find((entry) => entry.expired) ?? null,
    revoked: observations.find((entry) => entry.revoked) ?? null,
    cleanedUp: observations.find((entry) => entry.cleanedUp) ?? null,
    rotated: observations.find((entry) => entry.rotated) ?? null,
    preserved: observations.find((entry) => entry.preserved) ?? null,
    observations,
  };
}
