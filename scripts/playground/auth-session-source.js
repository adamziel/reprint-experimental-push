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

  const normalizedSourceUrl = normalizeAuthSessionSourceField(source.sourceUrl);
  const normalizedUsername = normalizeAuthSessionSourceField(source.username);
  const normalizedApplicationPassword = normalizeAuthSessionSourceField(source.applicationPassword);
  if (!normalizedSourceUrl || !normalizedUsername || !normalizedApplicationPassword) {
    return {
      liveSourceUrl,
      username,
      applicationPassword,
    };
  }

  return {
    liveSourceUrl: preferSource ? normalizedSourceUrl : normalizedSourceUrl || liveSourceUrl,
    username: preferSource ? normalizedUsername : normalizedUsername || username,
    applicationPassword: preferSource
      ? normalizedApplicationPassword
      : normalizedApplicationPassword || applicationPassword,
  };
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
