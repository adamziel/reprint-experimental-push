import { evaluateProductionAuthSessionLifecycle } from './production-auth-session-lifecycle.js';

export const packagedProductionPluginMaxConsecutiveNotReadyProbes = 4;
const packagedProductionPluginWordPressNotReadyPattern = /WordPress is not ready yet/i;
const packagedProductionPluginRouteNotReadyPattern = /No route was found matching the URL and request method\.?/i;
const packagedProductionPluginWordPressNotReadyCodePattern = /wordpress_not_ready/i;
const packagedProductionPluginRouteNotReadyCodePattern = /rest_no_route/i;
const packagedProductionPluginLabAuthRequiredCodePattern = /reprint_push_lab_auth_required/i;

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

function packagedProductionPluginLabAuthRequiredResponse(response) {
  return packagedProductionPluginLabAuthRequiredCodePattern.test(
    packagedProductionPluginResponseCode(response),
  )
    || (
      typeof response?.body === 'string'
      && packagedProductionPluginLabAuthRequiredCodePattern.test(response.body)
    );
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

function packagedProductionPluginSessionEnvelopeReady(session) {
  return typeof session?.id === 'string'
    && session.id.length > 0
    && session?.type === 'production-auth-session';
}

export function packagedProductionPluginRestIndexReady(status, bodyText = '') {
  if (status !== 200) {
    return false;
  }

  try {
    const body = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return false;
    }

    const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
    const routes = body.routes && typeof body.routes === 'object' && !Array.isArray(body.routes)
      ? body.routes
      : null;
    return namespaces.length > 0 || routes !== null;
  } catch {
    return false;
  }
}

function packagedProductionPluginInvalidRestIndexBody(status, bodyText = '') {
  return status === 200 && !packagedProductionPluginRestIndexReady(status, bodyText);
}

function packagedProductionPluginRouteNotReady(response) {
  return packagedProductionPluginRouteNotReadyBody(response);
}

export function packagedProductionPluginRestIndexRetryable(index) {
  return packagedProductionPluginWordPressNotReadyResponse(index)
    || packagedProductionPluginRouteNotReady(index)
    || packagedProductionPluginInvalidRestIndexBody(index?.status, index?.body || '');
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

export function packagedProductionPluginSnapshotProbeContext(snapshotProbe) {
  if (!snapshotProbe || typeof snapshotProbe !== 'object') {
    return null;
  }

  return {
    status: snapshotProbe.status,
    body: snapshotProbe.body || '',
    ...(snapshotProbe.timedOut === true ? { timedOut: true } : {}),
  };
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
    && packagedProductionPluginSessionEnvelopeReady(preflight.body?.session)
    && evaluateProductionAuthSessionLifecycle(preflight.body?.auth?.session).ok;
}

export function packagedProductionPluginPreflightRetryable(preflight, context = {}) {
  if (packagedProductionPluginWordPressNotReadyResponse(preflight)) {
    return true;
  }

  if (packagedProductionPluginRouteNotReady(preflight)) {
    return true;
  }

  if (
    packagedProductionPluginLabAuthRequiredResponse(preflight)
  ) {
    // A fresh /wp-json/ probe is the strongest startup signal. Once it shows
    // startup is over, do not keep retrying on an older packaged-startup hint.
    if (context.indexProbe?.timedOut !== true && context.indexProbe) {
      return packagedProductionPluginReadinessBodyRetryable(
        context.indexProbe?.status,
        context.indexProbe?.body || '',
      );
    }

    if (context.snapshotProbe?.timedOut !== true && context.snapshotProbe) {
      return packagedProductionPluginReadinessBodyRetryable(
        context.snapshotProbe?.status,
        context.snapshotProbe?.body || '',
      );
    }

    if (context.packagedStartup === true) {
      return true;
    }
  }

  // Once the packaged preflight responds normally, a wrong route profile or
  // invalid production session is a ready-but-broken boundary, not startup lag.
  return false;
}

export function packagedProductionPluginPreflightTerminal(preflight, context = {}) {
  return !packagedProductionPluginPreflightReady(preflight)
    && !packagedProductionPluginPreflightRetryable(preflight, context);
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
  const code = packagedProductionPluginFindCode(bodyText);
  const message = packagedProductionPluginFindMessage(bodyText);
  return packagedProductionPluginWordPressNotReadyPattern.test(
    typeof bodyText === 'string' ? bodyText : '',
  )
    || packagedProductionPluginWordPressNotReadyPattern.test(message)
    || packagedProductionPluginWordPressNotReadyCodePattern.test(code);
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

export function packagedProductionPluginPackagedRouteStartupStillWithinBudget(
  currentCount,
  limit = packagedProductionPluginMaxConsecutiveNotReadyProbes,
) {
  return !packagedProductionPluginPackagedRouteStartupLimitReached(currentCount, limit);
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
  if (packagedProductionPluginInvalidRestIndexBody(status, bodyText)) {
    return false;
  }

  const code = packagedProductionPluginFindCode(bodyText);
  const message = packagedProductionPluginFindMessage(bodyText);
  const text = typeof bodyText === 'string' ? bodyText : '';
  return (
    packagedProductionPluginReadinessWordPressNotReady(status, bodyText)
    || packagedProductionPluginWordPressNotReadyCodePattern.test(code)
    || packagedProductionPluginRouteNotReadyPattern.test(text)
    || packagedProductionPluginRouteNotReadyPattern.test(message)
    || packagedProductionPluginRouteNotReadyCodePattern.test(text)
    || packagedProductionPluginRouteNotReadyCodePattern.test(code)
  );
}

export function packagedProductionPluginRouteRetryableWhileWordPressStarting(
  routeStatus,
  routeBodyText = '',
  indexStatus,
  indexBodyText = '',
) {
  const indexProbe = {
    status: indexStatus,
    body: indexBodyText,
  };
  return packagedProductionPluginReadinessBodyRetryable(routeStatus, routeBodyText)
    && packagedProductionPluginRestIndexRetryable(indexProbe)
    && !packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
}

export function packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
  routeStatus,
  routeBodyText = '',
  indexStatus,
  indexBodyText = '',
) {
  const indexProbe = {
    status: indexStatus,
    body: indexBodyText,
  };
  return packagedProductionPluginReadinessBodyRetryable(routeStatus, routeBodyText)
    && packagedProductionPluginRestIndexReady(indexStatus, indexBodyText)
    && !packagedProductionPluginRestIndexRetryable(indexProbe);
}

export function packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
  routeProbe,
  indexStatus,
  indexBodyText = '',
) {
  const indexProbe = {
    status: indexStatus,
    body: indexBodyText,
  };
  return routeProbe?.timedOut === true
    && packagedProductionPluginRestIndexRetryable(indexProbe)
    && !packagedProductionPluginMalformedTerminalIndexProbe(indexProbe);
}

export function packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
  routeProbe,
  indexStatus,
  indexBodyText = '',
) {
  const indexProbe = {
    status: indexStatus,
    body: indexBodyText,
  };
  return routeProbe?.timedOut === true
    && packagedProductionPluginRestIndexReady(indexStatus, indexBodyText)
    && !packagedProductionPluginRestIndexRetryable(indexProbe);
}

export function packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
  routeProbe,
  indexProbe,
) {
  return routeProbe?.retryable === true
    && indexProbe?.timedOut === true;
}

export function packagedProductionPluginMalformedTerminalIndexProbe(indexProbe) {
  if (
    packagedProductionPluginInvalidRestIndexBody(
      indexProbe?.status,
      indexProbe?.body || '',
    )
  ) {
    return true;
  }

  return indexProbe?.timedOut !== true
    && indexProbe?.parsedBody === null
    && !packagedProductionPluginReadinessBodyRetryable(
      indexProbe?.status,
      indexProbe?.body || '',
    );
}

export function packagedProductionPluginClassifyBoundedStartup(
  routeProbe,
  indexProbe,
) {
  if (
    routeProbe?.retryable === true
    && (
    packagedProductionPluginRouteRetryableWhileWordPressStarting(
      routeProbe?.status,
      routeProbe?.body || '',
      indexProbe?.status,
      indexProbe?.body || '',
    )
    )
  ) {
    return {
      kind: 'retryable-route-wordpress-starting',
      globalWordPressStartup: true,
    };
  }

  if (
    routeProbe?.retryable === true
    && (
    packagedProductionPluginRouteRetryableWhilePackagedRouteStarting(
      routeProbe?.status,
      routeProbe?.body || '',
      indexProbe?.status,
      indexProbe?.body || '',
    )
    )
  ) {
    return {
      kind: 'retryable-route-packaged-route-starting',
      packagedRouteStartup: true,
    };
  }

  if (
    routeProbe?.retryable === true
    && indexProbe
    && indexProbe.timedOut !== true
    && (
      packagedProductionPluginMalformedTerminalIndexProbe(indexProbe)
      || !packagedProductionPluginRestIndexRetryable(indexProbe)
    )
  ) {
    return {
      kind: 'retryable-route-index-terminal',
      indexTerminal: true,
    };
  }

  return null;
}

export function packagedProductionPluginClassifyTimeoutFallbackStartup(
  routeProbe,
  indexProbe,
) {
  if (routeProbe?.timedOut === true && indexProbe?.timedOut === true) {
    return {
      kind: 'timed-out-route-index-timeout',
      indexProbeTimedOut: true,
    };
  }

  if (
    packagedProductionPluginRetryableRouteProbeWhileIndexProbeTimedOut(
      routeProbe,
      indexProbe,
    )
  ) {
    return {
      kind: 'retryable-route-index-timeout',
      indexProbeTimedOut: true,
    };
  }

  const boundedStartup = packagedProductionPluginClassifyBoundedStartup(routeProbe, indexProbe);
  if (boundedStartup) {
    return boundedStartup;
  }

  if (
    packagedProductionPluginTimedOutRouteProbeWhileWordPressStarting(
      routeProbe,
      indexProbe?.status,
      indexProbe?.body || '',
    )
  ) {
    return {
      kind: 'timed-out-route-wordpress-starting',
      globalWordPressStartup: true,
    };
  }

  if (
    packagedProductionPluginTimedOutRouteProbeWhilePackagedRouteStarting(
      routeProbe,
      indexProbe?.status,
      indexProbe?.body || '',
    )
  ) {
    return {
      kind: 'timed-out-route-packaged-route-starting',
      packagedRouteStartup: true,
    };
  }

  if (
    routeProbe?.timedOut === true
    && indexProbe
    && indexProbe.timedOut !== true
    && (
      packagedProductionPluginMalformedTerminalIndexProbe(indexProbe)
      || !packagedProductionPluginRestIndexRetryable(indexProbe)
    )
  ) {
    return {
      kind: 'timed-out-route-index-terminal',
      indexTerminal: true,
    };
  }

  return null;
}

export function packagedProductionPluginPreflightTerminalContext(
  context = {},
  {
    snapshotStartupFallback = false,
    timeoutFallback = false,
  } = {},
) {
  return {
    ...context,
    packagedProductionPlugin: true,
    preflightTerminal: true,
    ...(snapshotStartupFallback ? { snapshotStartupFallback: true } : {}),
    ...(timeoutFallback ? { timeoutFallback: true } : {}),
  };
}
