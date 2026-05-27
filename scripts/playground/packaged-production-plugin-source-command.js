import {
  buildAuthSessionSourceCommand,
  resolveAuthSessionSourceCommand,
} from './auth-session-source-command.js';
import {
  loadAuthSessionSourceFromRuntimeEnvironment,
  normalizeExplicitAllowedAuthSessionSourceUrl,
  normalizeSupportedAuthSessionSourceUrl,
} from './auth-session-source.js';

export function resolvePackagedProductionPluginSourceCommand({
  sourceUrl,
  remoteUrl = '',
  localUrl = '',
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  const resolvedSourceUrl = resolvePackagedProductionPluginCommandSourceUrl({
    sourceUrl,
    remoteUrl,
    localUrl,
  });
  const command = resolveAuthSessionSourceCommand({
    sourceUrl: resolvedSourceUrl,
    username,
    applicationPassword,
    authSessionSourceCommand,
    allowedSourceUrl: resolvedSourceUrl,
  });

  if (isPackagedProductionPluginSourceCommand(command)) {
    return command;
  }

  return `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ${command}`;
}

export function isPackagedProductionPluginSourceCommand(command = '') {
  return /\bREPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1\b/.test(String(command || ''));
}

export function resolvePackagedProductionPluginAuthSessionSource({
  sourceUrl,
  remoteUrl = '',
  localUrl = '',
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  const command = resolvePackagedProductionPluginSourceCommand({
    sourceUrl,
    remoteUrl,
    localUrl,
    username,
    applicationPassword,
    authSessionSourceCommand,
  });

  return {
    command,
    source: loadAuthSessionSourceFromRuntimeEnvironment(command, process.env, process.cwd(), {
      sourceUrl,
      remoteUrl,
      localUrl,
    }),
  };
}

export function resolvePackagedProductionPluginAuthSessionRequest({
  sourceUrl,
  remoteUrl = '',
  localUrl = '',
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  const request = resolvePackagedProductionPluginAuthSessionSource({
    sourceUrl,
    remoteUrl,
    localUrl,
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

function resolvePackagedProductionPluginCommandSourceUrl({
  sourceUrl,
  remoteUrl,
  localUrl,
}) {
  return normalizeSupportedAuthSessionSourceUrl(sourceUrl)
    || normalizeExplicitAllowedAuthSessionSourceUrl(sourceUrl)
    || normalizeSupportedAuthSessionSourceUrl(remoteUrl)
    || normalizeExplicitAllowedAuthSessionSourceUrl(remoteUrl)
    || normalizeSupportedAuthSessionSourceUrl(localUrl)
    || normalizeExplicitAllowedAuthSessionSourceUrl(localUrl)
    || '';
}

function buildRuntimePackagedProductionPluginSourceCommand({
  runtimeSourceUrl,
  authSessionSource,
  authSessionSourceCommand,
}) {
  const reboundExplicitCommand = rebindPackagedProductionPluginSourceCommandSourceUrl(
    authSessionSourceCommand,
    runtimeSourceUrl,
  );
  if (reboundExplicitCommand) {
    return {
      command: reboundExplicitCommand,
      rebound: true,
    };
  }

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
      command: buildAuthSessionSourceCommand({
        sourceUrl: runtimeSourceUrl,
        username,
        applicationPassword,
        ...(Object.prototype.hasOwnProperty.call(authSessionSource, 'warning')
          ? { warning: authSessionSource.warning }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(authSessionSource, 'playgroundFallback')
          ? { playgroundFallback: authSessionSource.playgroundFallback }
          : {}),
        allowedSourceUrl: runtimeSourceUrl,
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

function rebindPackagedProductionPluginSourceCommandSourceUrl(command, runtimeSourceUrl) {
  const normalizedCommand = normalizePackagedProductionPluginSourceCommand(command);
  if (!normalizedCommand || !runtimeSourceUrl || !isPackagedProductionPluginSourceCommand(normalizedCommand)) {
    return '';
  }

  const reboundCommand = normalizedCommand.replace(
    /\bREPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL=(?:'[^']*'|"[^"]*"|[^\s]+)/,
    (match) => {
      if (match.includes("='")) {
        return `REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL='${runtimeSourceUrl}'`;
      }

      if (match.includes('="')) {
        return `REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL="${runtimeSourceUrl}"`;
      }

      return `REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL=${runtimeSourceUrl}`;
    },
  );
  return reboundCommand === normalizedCommand ? '' : reboundCommand;
}
