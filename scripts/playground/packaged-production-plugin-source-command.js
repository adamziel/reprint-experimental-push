import { resolveAuthSessionSourceCommand } from './auth-session-source-command.js';
import { loadAuthSessionSource } from './auth-session-source.js';

export function resolvePackagedProductionPluginSourceCommand({
  sourceUrl,
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  return resolveAuthSessionSourceCommand({
    sourceUrl,
    username,
    applicationPassword,
    authSessionSourceCommand,
  });
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
