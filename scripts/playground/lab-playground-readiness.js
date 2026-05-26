const labWordPressNotReadyPattern = /WordPress is not ready yet/i;
const labRouteNotReadyPattern = /No route was found matching the URL and request method\.?/i;
const labWordPressNotReadyCodePattern = /wordpress_not_ready/i;
const labRouteNotReadyCodePattern = /rest_no_route/i;

function labFindMessage(value, depth = 0) {
  if (depth > 4 || value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = labFindMessage(item, depth + 1);
      if (message) {
        return message;
      }
    }
    return '';
  }

  if (typeof value !== 'object') {
    return '';
  }

  for (const key of ['message', 'error', 'error_description', 'reason']) {
    const message = labFindMessage(value[key], depth + 1);
    if (message) {
      return message;
    }
  }

  for (const key of ['data', 'details']) {
    const message = labFindMessage(value[key], depth + 1);
    if (message) {
      return message;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (['message', 'error', 'error_description', 'reason', 'data', 'details'].includes(key)) {
      continue;
    }
    const message = labFindMessage(nestedValue, depth + 1);
    if (message) {
      return message;
    }
  }

  return '';
}

function labResponseMessage(response) {
  return labFindMessage(response?.body);
}

function labFindCode(value, depth = 0) {
  if (depth > 4 || value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const code = labFindCode(item, depth + 1);
      if (code) {
        return code;
      }
    }
    return '';
  }

  if (typeof value !== 'object') {
    return '';
  }

  for (const key of ['code', 'error_code', 'errorCode']) {
    const code = labFindCode(value[key], depth + 1);
    if (code) {
      return code;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (['code', 'error_code', 'errorCode'].includes(key)) {
      continue;
    }
    const code = labFindCode(nestedValue, depth + 1);
    if (code) {
      return code;
    }
  }

  return '';
}

function labResponseCode(response) {
  return labFindCode(response?.body);
}

function labWordPressNotReady(response) {
  return labWordPressNotReadyCodePattern.test(labResponseCode(response))
    || labWordPressNotReadyPattern.test(labResponseMessage(response));
}

function labRouteNotReady(response) {
  return labRouteNotReadyCodePattern.test(labResponseCode(response))
    || labRouteNotReadyPattern.test(labResponseMessage(response));
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
    labWordPressNotReady(snapshot)
    || labRouteNotReady(snapshot)
  );
}

export function labReadinessErrorRetryable(error) {
  return !(error && typeof error === 'object' && error.isPlaygroundReadinessFailure === true);
}

export function labReadinessBodyRetryable(status, bodyText = '') {
  return (
    labWordPressNotReadyPattern.test(bodyText)
    || labRouteNotReadyPattern.test(bodyText)
  );
}
