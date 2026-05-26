import { evaluateProductionAuthSessionLifecycle } from './production-auth-session-lifecycle.js';

function packagedProductionPluginRouteNotReady(response) {
  return response?.status === 404 && response?.body?.code === 'rest_no_route';
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

  // Once the packaged preflight responds normally, a wrong route profile or
  // invalid production session is a ready-but-broken boundary, not startup lag.
  return false;
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

export function packagedProductionPluginReadinessBodyRetryable(status, bodyText = '') {
  return status === 502 && /WordPress is not ready yet/i.test(bodyText);
}
