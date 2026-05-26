import { spawnSync } from 'node:child_process';

export function loadAuthSessionSource(command, baseEnv = process.env, cwd = process.cwd()) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 2,
    env: {
      ...baseEnv,
      NODE_NO_WARNINGS: '1',
    },
  });

  if (result.error || result.status !== 0 || result.signal) {
    const errorMessage = result.error?.message || result.stderr || result.stdout || `exit ${result.status ?? 'null'}`;
    return {
      ok: false,
      error: String(errorMessage).trim(),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
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
  };
}

export function resolveAuthSessionSourceCredentials({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
}, source, { preferSource = false } = {}) {
  if (!source?.ok) {
    return {
      liveSourceUrl,
      username,
      applicationPassword,
    };
  }

  return {
    liveSourceUrl: preferSource && source.sourceUrl ? source.sourceUrl : source.sourceUrl || liveSourceUrl,
    username: preferSource && source.username ? source.username : source.username || username,
    applicationPassword: preferSource && source.applicationPassword
      ? source.applicationPassword
      : source.applicationPassword || applicationPassword,
  };
}

export function resolveAuthSessionRequestCredentials({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
}, source, { preferSource = false } = {}) {
  return resolveAuthSessionSourceCredentials(
    {
      liveSourceUrl,
      username: normalizeAuthSessionSourceField(username) || normalizeAuthSessionSourceField(fallbackUsername),
      applicationPassword:
        normalizeAuthSessionSourceField(applicationPassword)
        || normalizeAuthSessionSourceField(fallbackApplicationPassword),
    },
    source,
    { preferSource },
  );
}

export function resolveAuthSessionRequestState({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
}, source, { preferSource = false } = {}) {
  const resolved = resolveAuthSessionRequestCredentials(
    {
      liveSourceUrl,
      username,
      applicationPassword,
      fallbackUsername,
      fallbackApplicationPassword,
    },
    source,
    { preferSource },
  );

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

function normalizeAuthSessionSourceField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}
