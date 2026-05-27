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

  const invalidIdentityField = resolveInvalidAuthSessionIdentityField(session);
  if (invalidIdentityField) {
    return {
      ok: false,
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
      required: 'production-auth-session',
      observed: observedType,
    };
  }

  if (revoked || cleanedUp) {
    return {
      ok: false,
      required: 'unrevoked',
      observed: revoked ? 'revoked' : 'cleaned-up',
    };
  }

  if (rotated) {
    return {
      ok: false,
      required: 'preserved read',
      observed: 'rotated',
    };
  }

  if (expired) {
    return {
      ok: false,
      field: normalizeAuthSessionObservationField(session?.expiredField)
        || (session?.status === 'expired' ? 'auth.session.status' : 'auth.session.expired'),
      required: 'unexpired',
      observed: session?.status === 'expired' ? 'expired' : 'expired',
    };
  }
  if (observedStatus !== 'active') {
    return {
      ok: false,
      required: 'active',
      observed: observedStatus,
    };
  }

  if (!session?.expiresAt) {
    return {
      ok: false,
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

  const invalidSummaryObservation = resolveInvalidAuthSessionSummaryObservationField(summary);
  if (invalidSummaryObservation) {
    return invalidSummaryObservation;
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
  const staleIssuedObservation = resolveMismatchedSummaryIssuedObservation(issuedObservation, observations);
  if (staleIssuedObservation) {
    return staleIssuedObservation;
  }
  const lifecycleBoundaryObservations = observations.slice(
    0,
    resolveLifecycleBoundaryObservationCount(observations, summary.read),
  );
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

  const staleReadObservation = resolveMismatchedSummaryReadObservation(readObservation, observations);
  if (staleReadObservation) {
    return staleReadObservation;
  }

  const readAuthUser = resolveAuthSessionIdentitySummary(readObservation);
  if (!issuedAuthUser.userLoginMissing && readAuthUser.userLoginMissing) {
    return {
      ok: false,
      required: 'authenticated identity continuity',
      observed: 'missing-user-login',
    };
  }
  if (
    !issuedAuthUser.userLoginMissing
    && !readAuthUser.userLoginMissing
    && readAuthUser.userLogin !== issuedAuthUser.userLogin
  ) {
    return {
      ok: false,
      required: 'authenticated identity continuity',
      observed: readAuthUser.userLogin,
    };
  }
  if (!issuedAuthUser.userIdMissing && readAuthUser.userIdMissing) {
    return {
      ok: false,
      field: 'auth.identity.userId',
      required: issuedAuthUser.userId,
      observed: 'missing-user-id',
    };
  }
  if (!issuedAuthUser.userIdMissing && !readAuthUser.userIdMissing && readAuthUser.userId !== issuedAuthUser.userId) {
    return {
      ok: false,
      field: 'auth.identity.userId',
      required: issuedAuthUser.userId,
      observed: readAuthUser.userId,
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

  const mismatchedSummaryObservationSession = resolveMismatchedSummaryObservationSession(summary, issuedSessionId);
  if (mismatchedSummaryObservationSession) {
    return mismatchedSummaryObservationSession;
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
      field: normalizeAuthSessionObservationField(summary.expired.expiredField)
        || (summary.expired.status === 'expired' ? 'auth.session.status' : 'auth.session.expired'),
      required: 'unexpired',
      observed: summary.expired.status === 'expired' ? 'expired' : (summary.expired.expiresAt || 'expired'),
    };
  }

  for (const observation of lifecycleBoundaryObservations) {
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
    if (!issuedAuthUser.userLoginMissing && observationAuthUser.userLoginMissing) {
      return {
        ok: false,
        required: 'authenticated identity continuity',
        observed: 'missing-user-login',
      };
    }
    if (
      !issuedAuthUser.userLoginMissing
      && !observationAuthUser.userLoginMissing
      && observationAuthUser.userLogin !== issuedAuthUser.userLogin
    ) {
      return {
        ok: false,
        required: 'authenticated identity continuity',
        observed: observationAuthUser.userLogin,
      };
    }
    if (!issuedAuthUser.userIdMissing && observationAuthUser.userIdMissing) {
      return {
        ok: false,
        field: 'auth.identity.userId',
        required: issuedAuthUser.userId,
        observed: 'missing-user-id',
      };
    }
    if (
      !issuedAuthUser.userIdMissing
      && !observationAuthUser.userIdMissing
      && observationAuthUser.userId !== issuedAuthUser.userId
    ) {
      return {
        ok: false,
        field: 'auth.identity.userId',
        required: issuedAuthUser.userId,
        observed: observationAuthUser.userId,
      };
    }

    const lifecycle = evaluateProductionAuthSessionLifecycle(observation, now);
    if (!lifecycle.ok) {
      return lifecycle;
    }

    if (isAuthSessionReadStep(observation.step) && observation.preserved !== true) {
      return {
        ok: false,
        required: 'preserved read',
        observed: observation.rotated ? 'rotated' : 'unpreserved',
      };
    }
  }

  const mismatchedPreservedObservation = resolveMismatchedSummaryPreservedObservation(
    summary.preserved,
    observations,
  );
  if (mismatchedPreservedObservation) {
    return mismatchedPreservedObservation;
  }

  if (issuedAuthUser.userLoginMissing) {
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

export function evaluateCheckedReleaseAuthSessionLifecycleSummary(summary, now = Date.now()) {
  const lifecycle = evaluateProductionAuthSessionLifecycleSummary(summary, now);
  if (!lifecycle.ok) {
    return lifecycle;
  }

  const releaseBoundaryRead = summary?.read;
  if (!releaseBoundaryRead || typeof releaseBoundaryRead !== 'object') {
    return {
      ok: false,
      required: 'release-boundary preserved read',
      observed: 'missing',
    };
  }

  if (releaseBoundaryRead.step !== 'replay' && releaseBoundaryRead.step !== 'journal') {
    return {
      ok: false,
      required: 'release-boundary preserved read',
      observed: releaseBoundaryRead.step || 'missing',
    };
  }

  if (releaseBoundaryRead.preserved !== true) {
    return {
      ok: false,
      required: 'release-boundary preserved read',
      observed: releaseBoundaryRead.rotated ? 'rotated' : 'unpreserved',
    };
  }

  return {
    ok: true,
    required: 'checked release production-auth-session lifecycle',
    observed: releaseBoundaryRead.step,
  };
}

export function summarizeProductionAuthSessionLifecycleTrace(trace) {
  if (!Array.isArray(trace) || trace.length === 0) {
    return null;
  }

  const observations = trace
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const invalidLifecycleFlag = resolveInvalidAuthSessionLifecycleFlag(entry);
      return {
        step: entry.step ?? null,
        id: entry.id ?? null,
        type: entry.type ?? null,
        status: entry.status ?? null,
        expiresAt: entry.expiresAt ?? null,
        ...(typeof entry.authUser === 'string' && entry.authUser.trim()
          ? { authUser: entry.authUser.trim() }
          : {}),
        ...(Number.isInteger(entry.authUserId) && entry.authUserId > 0
          ? { authUserId: entry.authUserId }
          : {}),
        ...(invalidLifecycleFlag
          ? { invalidLifecycleFlag }
          : {}),
        ...(typeof entry.expiredField === 'string' ? { expiredField: entry.expiredField } : {}),
        expired: entry.expired === true || entry.status === 'expired' || isExpiredAuthSession(entry),
        revoked: entry.revoked === true || entry.status === 'revoked',
        cleanedUp: entry.cleanedUp === true || entry.cleanup === true || entry.status === 'cleaned-up',
        rotated: entry.rotated === true || entry.status === 'rotated',
        preserved: isAuthSessionReadStep(entry.step) && entry.preserved === true,
      };
    });
  const readObservation = resolvePreferredAuthSessionReadObservation(observations);
  const lifecycleBoundaryObservations = observations.slice(
    0,
    resolveLifecycleBoundaryObservationCount(observations, readObservation),
  );

  return {
    issued: observations.find((entry) => entry.step === 'preflight') ?? null,
    read: readObservation,
    expired: lifecycleBoundaryObservations.find((entry) => entry.expired) ?? null,
    revoked: lifecycleBoundaryObservations.find((entry) => entry.revoked) ?? null,
    cleanedUp: lifecycleBoundaryObservations.find((entry) => entry.cleanedUp) ?? null,
    rotated: lifecycleBoundaryObservations.find((entry) => entry.rotated) ?? null,
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

function resolvePreferredAuthSessionReadObservation(observations) {
  const reversed = [...observations].reverse();
  return reversed.find((entry) => entry.step === 'journal' || entry.step === 'replay')
    || reversed.find((entry) => isAuthSessionReadStep(entry.step))
    || null;
}

function resolveLifecycleBoundaryObservationCount(observations, readObservation) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return 0;
  }

  if (!readObservation || typeof readObservation !== 'object') {
    return observations.length;
  }

  const readIndex = observations.findIndex((entry) => authSessionObservationEquals(entry, readObservation));
  if (readIndex === -1) {
    return observations.length;
  }

  return readIndex + 1;
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

function resolveInvalidAuthSessionIdentityField(observation) {
  if (!observation || typeof observation !== 'object') {
    return null;
  }

  if (observation.id !== undefined && observation.id !== null && !normalizeAuthSessionObservationId(observation.id)) {
    return 'id';
  }

  const identityFields = [
    ['type', 'type'],
    ['status', 'status'],
    ['expiresAt', 'expires-at'],
    ['warning', 'warning'],
  ];

  for (const [field, label] of identityFields) {
    const value = observation[field];
    if (value !== undefined && value !== null && !normalizeAuthSessionObservationField(value)) {
      return label;
    }
  }

  return null;
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
    return {
      userLoginMissing: true,
      userLogin: '',
      userIdMissing: true,
      userId: null,
    };
  }

  const authUser = typeof observation.authUser === 'string'
    ? observation.authUser.trim()
    : '';
  const authUserId = Number.isInteger(observation.authUserId) && observation.authUserId > 0
    ? observation.authUserId
    : null;
  return {
    userLoginMissing: !authUser,
    userLogin: authUser,
    userIdMissing: !authUserId,
    userId: authUserId,
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
    ['playgroundFallback', session.playgroundFallback],
  ];

  for (const [name, value] of lifecycleFlags) {
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return name;
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

function resolveInvalidAuthSessionSummaryObservationField(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const summaryObservationFields = ['expired', 'revoked', 'cleanedUp', 'rotated', 'preserved'];
  for (const field of summaryObservationFields) {
    const observation = summary[field];
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

  const summaryObservationFields = ['expired', 'revoked', 'cleanedUp', 'rotated', 'preserved'];
  for (const field of summaryObservationFields) {
    const observation = summary[field];
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      continue;
    }

    const observationSessionId = normalizeAuthSessionObservationId(observation.id);
    if (observationSessionId && observationSessionId !== issuedSessionId) {
      return {
        ok: false,
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

  if (observation.expired === true) {
    return {
      ok: false,
      required: 'unexpired',
      observed: 'expired',
    };
  }

  if (observation.revoked === true) {
    return {
      ok: false,
      required: 'unrevoked',
      observed: 'revoked',
    };
  }

  if (observation.cleanedUp === true || observation.cleanup === true) {
    return {
      ok: false,
      required: 'unrevoked',
      observed: 'cleaned-up',
    };
  }

  if (observation.rotated === true) {
    return {
      ok: false,
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
    && normalizeAuthSessionObservationStep(left?.step) === normalizeAuthSessionObservationStep(right?.step)
    && normalizeLifecycleBoolean(left?.expired) === normalizeLifecycleBoolean(right?.expired)
    && normalizeLifecycleBoolean(left?.revoked) === normalizeLifecycleBoolean(right?.revoked)
    && normalizeLifecycleBoolean(left?.rotated) === normalizeLifecycleBoolean(right?.rotated)
    && normalizeLifecycleBoolean(left?.preserved) === normalizeLifecycleBoolean(right?.preserved)
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
      return observation.rotated === true;
    case 'preserved':
      return observation.preserved === true;
    default:
      return true;
  }
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
