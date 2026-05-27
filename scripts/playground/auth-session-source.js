import { spawnSync } from 'node:child_process';

export const defaultAuthSessionSourceTimeoutMs = 5_000;

export function loadAuthSessionSource(
  command,
  baseEnv = process.env,
  cwd = process.cwd(),
  options = {},
) {
  const timeout = normalizeAuthSessionSourceTimeout(options.timeout);
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 2,
    timeout,
    killSignal: options.killSignal ?? 'SIGTERM',
    env: {
      ...baseEnv,
      NODE_NO_WARNINGS: '1',
    },
  });

  if (result.error || result.status !== 0 || result.signal) {
    const errorMessage = describeAuthSessionSourceCommandFailure(result, timeout);
    return {
      ok: false,
      error: errorMessage,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      error: `Auth session source command must return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: 'Auth session source command must return a JSON object',
    };
  }

  const sourceUrl = normalizeAuthSessionSourceField(parsed.sourceUrl);
  if (!sourceUrl) {
    return {
      ok: false,
      error: 'Auth session source command must return sourceUrl',
    };
  }
  if (!isPermittedAuthSessionSourceUrl(
    sourceUrl,
    options.allowedSourceUrl,
    options.allowedSourceUrls,
  )) {
    return {
      ok: false,
      error: describeUnsupportedAuthSessionSourceUrl(
        options.allowedSourceUrl,
        options.allowedSourceUrls,
      ),
    };
  }

  const username = normalizeAuthSessionSourceField(parsed.username);
  if (!username) {
    return {
      ok: false,
      error: 'Auth session source command must return username',
    };
  }

  const applicationPassword = normalizeAuthSessionSourceField(parsed.applicationPassword);
  if (!applicationPassword) {
    return {
      ok: false,
      error: 'Auth session source command must return applicationPassword',
    };
  }

  return {
    ok: true,
    sourceUrl,
    username,
    applicationPassword,
    ...(Object.prototype.hasOwnProperty.call(parsed, 'warning')
      ? { warning: parsed.warning }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(parsed, 'playgroundFallback')
      ? { playgroundFallback: parsed.playgroundFallback }
      : {}),
  };
}

export function describeAuthSessionSourceMetadataDrift(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  if (
    source.playgroundFallback !== undefined
    && source.playgroundFallback !== null
    && typeof source.playgroundFallback !== 'boolean'
  ) {
    return {
      field: 'auth.session.playgroundFallback',
      required: 'boolean lifecycle flags',
      observed: 'invalid-playgroundFallback',
    };
  }

  if (source.playgroundFallback === true) {
    return {
      field: 'auth.session.playgroundFallback',
      required: 'production-backed auth',
      observed: 'playground-fallback',
    };
  }

  if (source.warning === undefined || source.warning === null) {
    return null;
  }

  const normalizedWarning = normalizeAuthSessionSourceField(source.warning);
  if (!normalizedWarning) {
    return {
      field: 'auth.session.warning',
      required: 'string lifecycle fields',
      observed: 'invalid-warning',
    };
  }

  return {
    field: 'auth.session.warning',
    required: 'production-backed auth',
    observed: normalizedWarning,
  };
}

function describeAuthSessionSourceCommandFailure(result, timeout) {
  if (result.error?.code === 'ETIMEDOUT') {
    return `Auth session source command timed out after ${timeout}ms`;
  }

  if (result.signal) {
    return `Auth session source command terminated by ${result.signal}`;
  }

  if (result.status !== 0 && result.status !== null) {
    const detail = normalizeAuthSessionSourceCommandFailureDetail(result.stderr || result.stdout);
    return detail
      ? `Auth session source command exited with status ${result.status}: ${detail}`
      : `Auth session source command exited with status ${result.status}`;
  }

  if (result.error instanceof Error) {
    return result.error.message.trim();
  }

  const detail = normalizeAuthSessionSourceCommandFailureDetail(result.stderr || result.stdout);
  return detail || `Auth session source command failed after ${timeout}ms`;
}

function normalizeAuthSessionSourceCommandFailureDetail(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export function resolveAuthSessionSourceCredentials({
  liveSourceUrl = '',
  remoteUrl = '',
  localUrl = '',
  username = '',
  applicationPassword = '',
}, source, { preferSource = false } = {}) {
  const normalizedAllowedSourceUrls = resolveExplicitAllowedAuthSessionSourceUrls(
    liveSourceUrl,
    remoteUrl,
    localUrl,
  );
  const normalizedAllowedSourceUrl = normalizedAllowedSourceUrls[0] || '';
  const normalizedLiveSourceUrl = normalizePermittedAuthSessionSourceUrl(
    liveSourceUrl,
    normalizedAllowedSourceUrl,
    normalizedAllowedSourceUrls,
  );
  const preserveEmptyExplicitSourceBoundary = shouldPreserveEmptyExplicitSourceBoundary(
    liveSourceUrl,
    normalizedAllowedSourceUrls,
  );
  if (!source?.ok) {
    return {
      liveSourceUrl: normalizedLiveSourceUrl,
      username,
      applicationPassword,
    };
  }

  const normalizedSourceUrl = normalizePermittedAuthSessionSourceUrl(
    source.sourceUrl,
    normalizedAllowedSourceUrl,
    normalizedAllowedSourceUrls,
  );
  const normalizedUsername = normalizeAuthSessionSourceField(source.username);
  const normalizedApplicationPassword = normalizeAuthSessionSourceField(source.applicationPassword);
  if (!normalizedSourceUrl || !normalizedUsername || !normalizedApplicationPassword) {
    return {
      liveSourceUrl: normalizedLiveSourceUrl,
      username,
      applicationPassword,
    };
  }

  return {
    liveSourceUrl: preferSource
      ? normalizedSourceUrl
      : preserveEmptyExplicitSourceBoundary
        ? normalizedLiveSourceUrl
        : normalizedLiveSourceUrl || normalizedSourceUrl,
    username: normalizedUsername,
    applicationPassword: preferSource
      ? normalizedApplicationPassword
      : normalizedApplicationPassword,
  };
}

export function resolveAuthSessionRequestCredentials({
  liveSourceUrl = '',
  remoteUrl = '',
  localUrl = '',
  username = '',
  applicationPassword = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
}, source, { preferSource = false } = {}) {
  const normalizedAllowedSourceUrls = resolveExplicitAllowedAuthSessionSourceUrls(
    liveSourceUrl,
    remoteUrl,
    localUrl,
  );
  const normalizedAllowedSourceUrl = normalizedAllowedSourceUrls[0] || '';
  const normalizedLiveSourceUrl = normalizePermittedAuthSessionSourceUrl(
    liveSourceUrl,
    normalizedAllowedSourceUrl,
    normalizedAllowedSourceUrls,
  );
  const preserveEmptyExplicitSourceBoundary = shouldPreserveEmptyExplicitSourceBoundary(
    liveSourceUrl,
    normalizedAllowedSourceUrls,
  );
  const normalizedUsername = normalizeAuthSessionSourceField(username);
  const normalizedApplicationPassword = normalizeAuthSessionSourceField(applicationPassword);
  const normalizedFallbackUsername = normalizeAuthSessionSourceField(fallbackUsername);
  const normalizedFallbackApplicationPassword = normalizeAuthSessionSourceField(fallbackApplicationPassword);
  const hasExplicitCredentialField = hasExplicitAuthSessionCredentialField(username)
    || hasExplicitAuthSessionCredentialField(applicationPassword);
  const normalizedSourceUrl = normalizePermittedAuthSessionSourceUrl(
    source?.sourceUrl,
    normalizedAllowedSourceUrl,
    normalizedAllowedSourceUrls,
  );
  const resolvedUsername = hasExplicitCredentialField
    ? normalizedUsername
    : normalizedFallbackUsername;
  const resolvedApplicationPassword = hasExplicitCredentialField
    ? normalizedApplicationPassword
    : normalizedFallbackApplicationPassword;
  if (hasExplicitCredentialField && !preferSource) {
    return {
      liveSourceUrl: preserveEmptyExplicitSourceBoundary
        ? normalizedLiveSourceUrl
        : normalizedLiveSourceUrl || normalizedSourceUrl,
      username: resolvedUsername,
      applicationPassword: resolvedApplicationPassword,
    };
  }

  return resolveAuthSessionSourceCredentials(
    {
      liveSourceUrl,
      remoteUrl,
      localUrl,
      username: resolvedUsername,
      applicationPassword: resolvedApplicationPassword,
    },
    source,
    { preferSource },
  );
}

export function resolveAuthSessionRequestState({
  liveSourceUrl = '',
  remoteUrl = '',
  localUrl = '',
  username = '',
  applicationPassword = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
}, source, { preferSource = false } = {}) {
  const resolved = resolveAuthSessionRequestCredentials({
    liveSourceUrl,
    remoteUrl,
    localUrl,
    username,
    applicationPassword,
    fallbackUsername,
    fallbackApplicationPassword,
  }, source, { preferSource });

  return {
    liveSourceUrl: resolved.liveSourceUrl,
    username: resolved.username,
    applicationPassword: resolved.applicationPassword,
    credentials: {
      username: resolved.username,
      password: resolved.applicationPassword,
    },
  };
}

export function normalizeSupportedAuthSessionSourceUrl(value) {
  return normalizePermittedAuthSessionSourceUrl(value);
}

function normalizePermittedAuthSessionSourceUrl(value, allowedSourceUrl = '', allowedSourceUrls = []) {
  const sourceUrl = normalizeAuthSessionSourceField(value);
  if (!sourceUrl) {
    return '';
  }

  if (!isPermittedAuthSessionSourceUrl(sourceUrl, allowedSourceUrl, allowedSourceUrls)) {
    return '';
  }

  return sourceUrl;
}

export function resolveExplicitAllowedAuthSessionSourceUrl(...values) {
  for (const value of values) {
    const normalizedValue = normalizeExplicitAllowedAuthSessionSourceUrl(value);
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return '';
}

export function loadAuthSessionSourceFromRuntimeEnvironment(
  command,
  baseEnv = process.env,
  cwd = process.cwd(),
  options = {},
) {
  if (typeof command !== 'string' || command.trim() === '') {
    return null;
  }

  const allowedSourceUrls = resolveExplicitAllowedAuthSessionSourceUrls(
    options.sourceUrl,
    baseEnv.REPRINT_PUSH_SOURCE_URL,
    options.remoteUrl,
    baseEnv.REPRINT_PUSH_REMOTE_URL,
    options.localUrl,
    baseEnv.REPRINT_PUSH_LOCAL_URL,
  );

  return loadAuthSessionSource(command, baseEnv, cwd, {
    ...options,
    allowedSourceUrl: allowedSourceUrls[0] || '',
    allowedSourceUrls,
  });
}

function normalizeAuthSessionSourceField(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return '';
  }

  return normalized;
}

function normalizeAuthSessionSourceTimeout(timeout) {
  if (!Number.isFinite(timeout)) {
    return defaultAuthSessionSourceTimeoutMs;
  }

  return Math.max(1, Math.trunc(timeout));
}

function describeUnsupportedAuthSessionSourceUrl(allowedSourceUrl) {
  return resolveExplicitAllowedAuthSessionSourceUrls(allowedSourceUrl).length > 0
    ? 'Auth session source command must return a supported local sourceUrl or match the explicit live sourceUrl'
    : 'Auth session source command must return a supported local sourceUrl';
}

function isPermittedAuthSessionSourceUrl(sourceUrl, allowedSourceUrl, allowedSourceUrls = []) {
  if (isSupportedAuthSessionSourceUrl(sourceUrl)) {
    return true;
  }

  const normalizedSourceUrl = normalizeExplicitAllowedAuthSessionSourceUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    return false;
  }

  const normalizedAllowedSourceUrls = resolveExplicitAllowedAuthSessionSourceUrls(
    allowedSourceUrl,
    ...(Array.isArray(allowedSourceUrls) ? allowedSourceUrls : []),
  );
  return normalizedAllowedSourceUrls.includes(normalizedSourceUrl);
}

export function normalizeExplicitAllowedAuthSessionSourceUrl(value) {
  const normalizedValue = normalizeAuthSessionSourceField(value);
  if (!normalizedValue) {
    return '';
  }

  let parsed;
  try {
    parsed = new URL(normalizedValue);
  } catch {
    return '';
  }

  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname += '/';
  }

  return parsed.toString();
}

export function resolveExplicitAllowedAuthSessionSourceUrls(...values) {
  const normalizedValues = [];

  for (const value of values) {
    const normalizedValue = normalizeExplicitAllowedAuthSessionSourceUrl(value);
    if (!normalizedValue || normalizedValues.includes(normalizedValue)) {
      continue;
    }

    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function isSupportedAuthSessionSourceUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && isLoopbackHost(parsed.hostname)
  ) {
    return true;
  }

  return false;
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname.startsWith('127.');
}

function hasExplicitAuthSessionCredentialField(value) {
  return value !== undefined
    && value !== null
    && !(typeof value === 'string' && value === '');
}

function shouldPreserveEmptyExplicitSourceBoundary(liveSourceUrl, normalizedAllowedSourceUrls) {
  return hasExplicitAuthSessionCredentialField(liveSourceUrl)
    && Array.isArray(normalizedAllowedSourceUrls)
    && normalizedAllowedSourceUrls.length === 0;
}
