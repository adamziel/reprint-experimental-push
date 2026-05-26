import { resolveAuthSessionSourceCommand } from './auth-session-source-command.js';
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

export function bindPackagedProductionPluginRuntimeSource({
  sourceUrl,
  authSessionSource,
  runtimeSourceUrl = '',
}) {
  if (!runtimeSourceUrl) {
    return {
      sourceUrl,
      authSessionSource,
    };
  }

  return {
    sourceUrl: runtimeSourceUrl,
    authSessionSource: authSessionSource?.ok
      ? {
          ...authSessionSource,
          sourceUrl: runtimeSourceUrl,
        }
      : authSessionSource,
  };
}
