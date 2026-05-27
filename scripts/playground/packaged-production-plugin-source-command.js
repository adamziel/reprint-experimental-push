import {
  buildAuthSessionSourceCommand,
  resolveAuthSessionSourceCommand,
} from './auth-session-source-command.js';
import { loadAuthSessionSource } from './auth-session-source.js';

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
    source: loadAuthSessionSource(command),
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
