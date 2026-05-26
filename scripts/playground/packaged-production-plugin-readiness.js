import { evaluateProductionAuthSessionLifecycle } from './production-auth-session-lifecycle.js';

function packagedProductionPluginRouteNotReady(response) {
  return response?.status === 404 && response?.body?.code === 'rest_no_route';
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

export function packagedProductionPluginServerReady({ snapshot, preflight = null } = {}) {
  if (!packagedProductionPluginSnapshotReady(snapshot)) {
    return false;
  }

  if (!preflight) {
    return true;
  }

  return packagedProductionPluginPreflightReady(preflight);
}
