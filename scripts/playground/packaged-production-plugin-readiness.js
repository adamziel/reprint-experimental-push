import { evaluateProductionAuthSessionLifecycle } from './production-auth-session-lifecycle.js';

export const packagedProductionPluginMaxConsecutiveNotReadyProbes = 4;
const packagedProductionPluginWordPressNotReadyPattern = /WordPress is not ready yet/i;
const packagedProductionPluginRouteNotReadyPattern = /No route was found matching the URL and request method\.?/i;
const packagedProductionPluginProductionNamespace = 'reprint/v1';
const packagedProductionPluginLabNamespace = 'reprint-push-lab/v1';

function packagedProductionPluginRouteNotReady(response) {
  return response?.status === 404 && response?.body?.code === 'rest_no_route';
}

export function packagedProductionPluginRestIndexReady(index) {
  if (index?.status !== 200 || !index?.body || typeof index.body !== 'object') {
    return false;
  }

  const namespaces = Array.isArray(index.body.namespaces) ? index.body.namespaces : [];
  const routeKeys = index.body.routes && typeof index.body.routes === 'object'
    ? Object.keys(index.body.routes)
    : [];
  const hasProductionNamespace = namespaces.includes(packagedProductionPluginProductionNamespace)
    || routeKeys.some((route) => route.startsWith(`/${packagedProductionPluginProductionNamespace}/push/`));
  const hasLabNamespace = namespaces.includes(packagedProductionPluginLabNamespace)
    || routeKeys.some((route) => route.startsWith(`/${packagedProductionPluginLabNamespace}/`));

  return hasProductionNamespace && !hasLabNamespace;
}

export function packagedProductionPluginRestIndexRetryable(index) {
  if (index?.status === 502 && index?.body?.code === 'wordpress_not_ready') {
    return true;
  }

  if (packagedProductionPluginRouteNotReady(index)) {
    return true;
  }

  if (index?.status !== 200) {
    return false;
  }

  return !packagedProductionPluginRestIndexReady(index);
}

export function packagedProductionPluginSnapshotReady(snapshot) {
  return snapshot?.status === 200 && snapshot?.body?.ok === true;
}

export function packagedProductionPluginSnapshotRetryable(snapshot) {
  return (
    (snapshot?.status === 502 && snapshot?.body?.code === 'wordpress_not_ready')
    || packagedProductionPluginRouteNotReady(snapshot)
  );
}

export function packagedProductionPluginPreflightReady(preflight) {
  if (preflight?.status !== 200 || preflight?.body?.ok !== true) {
    return false;
  }

  return preflight.body?.routeProfile?.labBacked === false
    && evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session).ok;
}

export function packagedProductionPluginPreflightRetryable(preflight) {
  if (preflight?.status === 502 && preflight?.body?.code === 'wordpress_not_ready') {
    return true;
  }

  if (packagedProductionPluginRouteNotReady(preflight)) {
    return true;
  }

  if (preflight?.status !== 200 || preflight?.body?.ok !== true) {
    return false;
  }

  if (preflight.body?.routeProfile?.labBacked !== false) {
    return true;
  }

  const lifecycle = evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session);
  if (lifecycle.ok) {
    return false;
  }

  // Once the packaged route profile is production-shaped, invalid auth/session
  // evidence is a real checked-boundary failure, not a transient readiness
  // state that should be masked behind more probes.
  return false;
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

export function packagedProductionPluginReadinessBodyRetryable(status, bodyText = '') {
  return status === 502 && packagedProductionPluginWordPressNotReadyPattern.test(bodyText)
    || status === 404 && packagedProductionPluginRouteNotReadyPattern.test(bodyText)
    || /wordpress_not_ready/i.test(bodyText)
    || /rest_no_route/i.test(bodyText);
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
  const nextCounts = {
    snapshot: currentCounts?.snapshot ?? 0,
    preflight: currentCounts?.preflight ?? 0,
  };
  if (routeKey === 'snapshot' || routeKey === 'preflight') {
    nextCounts[routeKey] = packagedProductionPluginReadinessBodyRetryable(status, bodyText)
      ? nextCounts[routeKey] + 1
      : 0;
  }
  return nextCounts;
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

export function packagedProductionPluginNotReadyProbeLimitReached(currentCount) {
  return currentCount >= packagedProductionPluginMaxConsecutiveNotReadyProbes;
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
