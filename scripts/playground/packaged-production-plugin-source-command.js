import { resolveAuthSessionSourceCommand } from './auth-session-source-command.js';
import {
  loadAuthSessionSourceFromRuntimeEnvironment,
  normalizeSupportedAuthSessionSourceUrl,
} from './auth-session-source.js';

export function resolvePackagedProductionPluginSourceCommand({
  sourceUrl,
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  const command = resolveAuthSessionSourceCommand({
    sourceUrl,
    username,
    applicationPassword,
    authSessionSourceCommand,
    allowedSourceUrl: sourceUrl,
  });

  return `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ${command}`;
}

export function isPackagedProductionPluginSourceCommand(command = '') {
  return /\bREPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1\b/.test(String(command || ''));
}

export function resolvePackagedProductionPluginAuthSessionSource({
  sourceUrl,
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  const command = resolvePackagedProductionPluginSourceCommand({
    sourceUrl,
    username,
    applicationPassword,
    authSessionSourceCommand,
  });

  return {
    command,
    source: loadAuthSessionSourceFromRuntimeEnvironment(command, process.env, process.cwd(), {
      sourceUrl,
    }),
  };
}

export function resolvePackagedProductionPluginAuthSessionRequest({
  sourceUrl,
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  const request = resolvePackagedProductionPluginAuthSessionSource({
    sourceUrl,
    username,
    applicationPassword,
    authSessionSourceCommand,
  });

  return {
    ...request,
    requested: isPackagedProductionPluginSourceCommand(request.command),
  };
}

export function bindPackagedProductionPluginRuntimeSource({
  sourceUrl,
  authSessionSource,
  authSessionSourceCommand = '',
  runtimeSourceUrl = '',
}) {
  const normalizedAuthSessionSourceCommand = normalizePackagedProductionPluginSourceCommand(
    authSessionSourceCommand,
  );
  const normalizedRuntimeSourceUrl = normalizeRuntimeSourceUrl(runtimeSourceUrl);
  if (!normalizedRuntimeSourceUrl) {
    return {
      sourceUrl,
      authSessionSource,
      ...(normalizedAuthSessionSourceCommand
        ? { authSessionSourceCommand: normalizedAuthSessionSourceCommand }
        : {}),
    };
  }

  const runtimeAuthSessionSourceCommand = buildRuntimePackagedProductionPluginSourceCommand({
    runtimeSourceUrl: normalizedRuntimeSourceUrl,
    authSessionSource,
    authSessionSourceCommand: normalizedAuthSessionSourceCommand,
  });
  const runtimeAuthSessionSource = runtimeAuthSessionSourceCommand.rebound
    ? authSessionSource?.ok
      ? {
          ...authSessionSource,
          sourceUrl: normalizedRuntimeSourceUrl,
        }
      : authSessionSource
    : authSessionSource;

  return {
    sourceUrl: normalizedRuntimeSourceUrl,
    authSessionSource: runtimeAuthSessionSource,
    ...(runtimeAuthSessionSourceCommand.command
      ? { authSessionSourceCommand: runtimeAuthSessionSourceCommand.command }
      : normalizedAuthSessionSourceCommand
        ? { authSessionSourceCommand: normalizedAuthSessionSourceCommand }
        : {}),
  };
}

function normalizeRuntimeSourceUrl(value) {
  return normalizeSupportedAuthSessionSourceUrl(value);
}

function buildRuntimePackagedProductionPluginSourceCommand({
  runtimeSourceUrl,
  authSessionSource,
  authSessionSourceCommand,
}) {
  const sourceUrl = normalizeSupportedAuthSessionSourceUrl(authSessionSource?.sourceUrl);
  const username = typeof authSessionSource?.username === 'string'
    ? authSessionSource.username
    : '';
  const applicationPassword = typeof authSessionSource?.applicationPassword === 'string'
    ? authSessionSource.applicationPassword
    : '';
  if (!runtimeSourceUrl || !sourceUrl || !username || !applicationPassword) {
    return {
      command: authSessionSourceCommand || '',
      rebound: false,
    };
  }

  try {
    return {
      command: resolvePackagedProductionPluginSourceCommand({
        sourceUrl: runtimeSourceUrl,
        username,
        applicationPassword,
      }),
      rebound: true,
    };
  } catch {
    return {
      command: authSessionSourceCommand || '',
      rebound: false,
    };
  }
}

function normalizePackagedProductionPluginSourceCommand(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return '';
  }

  return normalized;
}
