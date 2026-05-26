import { evaluateProductionAuthSessionLifecycle } from './production-auth-session-lifecycle.js';

export const packagedProductionPluginMaxConsecutiveNotReadyProbes = 4;
const packagedProductionPluginWordPressNotReadyPattern = /WordPress is not ready yet/i;
const packagedProductionPluginRouteNotReadyPattern = /No route was found matching the URL and request method\.?/i;
const packagedProductionPluginWordPressNotReadyCodePattern = /wordpress_not_ready/i;
const packagedProductionPluginRouteNotReadyCodePattern = /rest_no_route/i;

function packagedProductionPluginFindMessage(value, visited = new Set()) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = packagedProductionPluginFindMessage(item, visited);
      if (message) {
        return message;
      }
    }
    return '';
  }

  if (typeof value !== 'object') {
    return '';
  }

  if (visited.has(value)) {
    return '';
  }
  visited.add(value);

  for (const key of ['message', 'error', 'error_description', 'reason']) {
    const message = packagedProductionPluginFindMessage(value[key], visited);
    if (message) {
      return message;
    }
  }

  for (const key of ['data', 'details']) {
    const message = packagedProductionPluginFindMessage(value[key], visited);
    if (message) {
      return message;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (['message', 'error', 'error_description', 'reason', 'data', 'details'].includes(key)) {
      continue;
    }
    const message = packagedProductionPluginFindMessage(nestedValue, visited);
    if (message) {
      return message;
    }
  }

  return '';
}

function packagedProductionPluginResponseMessage(response) {
  return packagedProductionPluginFindMessage(response?.body);
}

function packagedProductionPluginFindCode(value, visited = new Set()) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const code = packagedProductionPluginFindCode(item, visited);
      if (code) {
        return code;
      }
    }
    return '';
  }

  if (typeof value !== 'object') {
    return '';
  }

  if (visited.has(value)) {
    return '';
  }
  visited.add(value);

  for (const key of ['code', 'error_code', 'errorCode']) {
    const code = packagedProductionPluginFindCode(value[key], visited);
    if (code) {
      return code;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (['code', 'error_code', 'errorCode'].includes(key)) {
      continue;
    }
    const code = packagedProductionPluginFindCode(nestedValue, visited);
    if (code) {
      return code;
    }
  }

  return '';
}

function packagedProductionPluginResponseCode(response) {
  return packagedProductionPluginFindCode(response?.body);
}

function packagedProductionPluginWordPressNotReadyResponse(response) {
  return packagedProductionPluginWordPressNotReadyCodePattern.test(
    packagedProductionPluginResponseCode(response),
  )
    || packagedProductionPluginReadinessWordPressNotReady(
      response?.status,
      packagedProductionPluginResponseMessage(response),
    );
}

function packagedProductionPluginRouteNotReadyBody(response) {
  return packagedProductionPluginRouteNotReadyCodePattern.test(
    packagedProductionPluginResponseCode(response),
  )
    || packagedProductionPluginRouteNotReadyPattern.test(
      packagedProductionPluginResponseMessage(response),
    );
}

function packagedProductionPluginRouteProfileReady(routeProfile) {
  return routeProfile?.profile === 'production-shaped'
    && routeProfile?.restNamespace === 'reprint/v1'
    && routeProfile?.routePrefix === '/push'
    && routeProfile?.labBacked === false;
}

function packagedProductionPluginRouteNotReady(response) {
  return packagedProductionPluginRouteNotReadyBody(response);
}

export function packagedProductionPluginSnapshotReady(snapshot) {
  return snapshot?.status === 200
    && snapshot?.body?.ok === true
    && typeof snapshot?.body?.snapshot === 'object'
    && snapshot.body.snapshot !== null
    && !Array.isArray(snapshot.body.snapshot);
}

export function packagedProductionPluginSnapshotRetryable(snapshot) {
  return (
    packagedProductionPluginWordPressNotReadyResponse(snapshot)
    || packagedProductionPluginRouteNotReady(snapshot)
  );
}

export function packagedProductionPluginSnapshotTerminal(snapshot) {
  return !packagedProductionPluginSnapshotReady(snapshot)
    && !packagedProductionPluginSnapshotRetryable(snapshot);
}

export function packagedProductionPluginPreflightReady(preflight) {
  if (preflight?.status !== 200 || preflight?.body?.ok !== true) {
    return false;
  }

  return packagedProductionPluginRouteProfileReady(preflight.body?.routeProfile)
    && evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session).ok;
}

export function packagedProductionPluginPreflightRetryable(preflight) {
  if (packagedProductionPluginWordPressNotReadyResponse(preflight)) {
    return true;
  }

  if (packagedProductionPluginRouteNotReady(preflight)) {
    return true;
  }

  // Once the packaged preflight responds normally, a wrong route profile or
  // invalid production session is a ready-but-broken boundary, not startup lag.
  return false;
}

export function packagedProductionPluginPreflightTerminal(preflight) {
  return !packagedProductionPluginPreflightReady(preflight)
    && !packagedProductionPluginPreflightRetryable(preflight);
}

export function packagedProductionPluginServerReady({ snapshot, preflight = null } = {}) {
  if (!packagedProductionPluginSnapshotReady(snapshot)) {
    return false;
  }

  if (!preflight) {
    return true;
  }

  return packagedProductionPluginPreflightReady(preflight);
}

export function packagedProductionPluginReadinessErrorRetryable(error) {
  return !(error && typeof error === 'object' && error.isPlaygroundReadinessFailure === true);
}

export function packagedProductionPluginReadinessProbeTimedOut(error) {
  return Boolean(
    error
    && typeof error === 'object'
    && typeof error.message === 'string'
    && error.message.includes('Timed out fetching '),
  );
}

export function packagedProductionPluginReadinessWordPressNotReady(status, bodyText = '') {
  return packagedProductionPluginWordPressNotReadyPattern.test(bodyText);
}

export function packagedProductionPluginNextNotReadyProbeCount(currentCount, status, bodyText = '') {
  return packagedProductionPluginReadinessBodyRetryable(status, bodyText)
    ? currentCount + 1
    : 0;
}

export function packagedProductionPluginNotReadyProbeLimitReached(
  currentCount,
  limit = packagedProductionPluginMaxConsecutiveNotReadyProbes,
) {
  return currentCount >= limit;
}

export function packagedProductionPluginPackagedRouteStartupLimitReached(
  currentCount,
  limit = packagedProductionPluginMaxConsecutiveNotReadyProbes,
) {
  return packagedProductionPluginNotReadyProbeLimitReached(currentCount, limit);
}

export function packagedProductionPluginNextTimeoutProbeCount(currentCount, error) {
  return packagedProductionPluginReadinessProbeTimedOut(error)
    ? currentCount + 1
    : 0;
}

export function packagedProductionPluginNextRouteNotReadyProbeCounts(
  currentCounts,
  routeKey,
  status,
  bodyText = '',
) {
  return {
    snapshot: routeKey === 'snapshot'
      ? packagedProductionPluginNextNotReadyProbeCount(currentCounts?.snapshot ?? 0, status, bodyText)
      : (currentCounts?.snapshot ?? 0),
    preflight: routeKey === 'preflight'
      ? packagedProductionPluginNextNotReadyProbeCount(currentCounts?.preflight ?? 0, status, bodyText)
      : (currentCounts?.preflight ?? 0),
  };
}

export function packagedProductionPluginResetRouteNotReadyProbeCounts(currentCounts, ...routeKeys) {
  const nextCounts = {
    snapshot: currentCounts?.snapshot ?? 0,
    preflight: currentCounts?.preflight ?? 0,
  };

  for (const routeKey of routeKeys) {
    if (routeKey === 'snapshot' || routeKey === 'preflight') {
      nextCounts[routeKey] = 0;
    }
  }

  return nextCounts;
}

export function packagedProductionPluginReadinessBodyRetryable(status, bodyText = '') {
  return (
    packagedProductionPluginReadinessWordPressNotReady(status, bodyText)
    || packagedProductionPluginWordPressNotReadyCodePattern.test(bodyText)
    || packagedProductionPluginRouteNotReadyPattern.test(bodyText)
    || packagedProductionPluginRouteNotReadyCodePattern.test(bodyText)
  );
}

export function packagedProductionPluginRouteRetryableWhileWordPressStarting(
  routeStatus,
  routeBodyText = '',
  indexStatus,
  indexBodyText = '',
) {
  return packagedProductionPluginReadinessBodyRetryable(routeStatus, routeBodyText)
    && packagedProductionPluginReadinessBodyRetryable(indexStatus, indexBodyText);
}

export function packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
  routeStatus,
  routeBodyText = '',
  indexStatus,
  indexBodyText = '',
) {
  return packagedProductionPluginReadinessBodyRetryable(routeStatus, routeBodyText)
    && indexStatus === 200
    && !packagedProductionPluginReadinessBodyRetryable(indexStatus, indexBodyText);
}

export function packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
  routeProbe,
  indexStatus,
  indexBodyText = '',
) {
  return routeProbe?.timedOut === true
    && packagedProductionPluginReadinessBodyRetryable(indexStatus, indexBodyText);
}

export function packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
  routeProbe,
  indexStatus,
  indexBodyText = '',
) {
  return routeProbe?.timedOut === true
    && indexStatus === 200
    && !packagedProductionPluginReadinessBodyRetryable(indexStatus, indexBodyText);
}

export function packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
  routeProbe,
  indexProbe,
) {
  return routeProbe?.retryable === true
    && indexProbe?.timedOut === true;
}
