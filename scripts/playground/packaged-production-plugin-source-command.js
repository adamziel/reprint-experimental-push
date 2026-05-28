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

export function shouldRequestPackagedProductionPluginAuthSession({
  requireProductionAuthSession = false,
  authSessionSourceCommand = '',
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  fixtureUsername = '',
  fixtureApplicationPassword = '',
}) {
  if (!requireProductionAuthSession) {
    return false;
  }
  if (!fixtureUsername || !fixtureApplicationPassword) {
    return false;
  }
  if (authSessionSourceCommand) {
    return false;
  }
  return !liveSourceUrl && !username && !applicationPassword;
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

export function bindPackagedProductionPluginRuntimeSource({
  sourceUrl,
  authSessionSourceCommand = '',
  authSessionSource,
  username = '',
  applicationPassword = '',
  runtimeSourceUrl = '',
}) {
  if (!runtimeSourceUrl) {
    return {
      sourceUrl,
      authSessionSourceCommand,
      authSessionSource,
    };
  }

  const runtimeUsername = authSessionSource?.ok
    ? authSessionSource.username
    : username;
  const runtimeApplicationPassword = authSessionSource?.ok
    ? authSessionSource.applicationPassword
    : applicationPassword;

  const runtimeAuthSessionSourceCommand = runtimeUsername && runtimeApplicationPassword
    ? `REPRINT_PUSH_PACKAGED_PRODUCTION_PLUGIN=1 ${buildAuthSessionSourceCommand({
        sourceUrl: runtimeSourceUrl,
        username: runtimeUsername,
        applicationPassword: runtimeApplicationPassword,
      })}`
    : authSessionSourceCommand;

  return {
    sourceUrl: runtimeSourceUrl,
    authSessionSourceCommand: runtimeAuthSessionSourceCommand,
    authSessionSource: authSessionSource?.ok
      ? {
          ...authSessionSource,
          sourceUrl: runtimeSourceUrl,
        }
      : authSessionSource,
  };
}
