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
