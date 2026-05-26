function labRouteNotReady(response) {
  return response?.status === 404 && response?.body?.code === 'rest_no_route';
}

export function labSnapshotReady(snapshot) {
  return snapshot?.status === 200
    && snapshot?.body?.ok === true
    && typeof snapshot?.body?.snapshot === 'object'
    && snapshot.body.snapshot !== null
    && !Array.isArray(snapshot.body.snapshot);
}

export function labSnapshotRetryable(snapshot) {
  return (
    (snapshot?.status === 502 && snapshot?.body?.code === 'wordpress_not_ready')
    || labRouteNotReady(snapshot)
  );
}

export function labReadinessErrorRetryable(error) {
  return !(error && typeof error === 'object' && error.isPlaygroundReadinessFailure === true);
}

export function labReadinessBodyRetryable(status, bodyText = '') {
  return (
    (status === 502 && /WordPress is not ready yet/i.test(bodyText))
    || (status === 404 && /No route was found matching the URL and request method\./i.test(bodyText))
  );
}
