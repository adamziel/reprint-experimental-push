import { resolveAuthSessionSourceCommand } from './auth-session-source-command.js';

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
