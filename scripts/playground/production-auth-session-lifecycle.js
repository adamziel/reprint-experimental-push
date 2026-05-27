export function isExpiredAuthSession(session, now = Date.now()) {
  if (!session || typeof session !== 'object') {
    return false;
  }

  if (session.expired === true) {
    return true;
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
  const rotated = session?.rotated === true;

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

  if (revoked || cleanedUp || rotated) {
    return {
      ok: false,
      required: 'unrevoked',
      observed: revoked ? 'revoked' : (cleanedUp ? 'cleaned-up' : 'rotated'),
    };
  }

  return {
    ok: true,
    required: 'production-auth-session lifecycle',
    observed: observedType,
  };
}
