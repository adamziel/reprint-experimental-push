import { resolveAuthSessionSourceCommand } from './auth-session-source-command.js';
import { loadAuthSessionSource, normalizeSupportedAuthSessionSourceUrl } from './auth-session-source.js';

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
    source: loadAuthSessionSource(command, process.env, process.cwd(), {
      allowedSourceUrl: sourceUrl,
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
  runtimeSourceUrl = '',
}) {
  const normalizedRuntimeSourceUrl = normalizeRuntimeSourceUrl(runtimeSourceUrl);
  if (!normalizedRuntimeSourceUrl) {
    return {
      sourceUrl,
      authSessionSource,
    };
  }

  return {
    sourceUrl: normalizedRuntimeSourceUrl,
    authSessionSource: authSessionSource?.ok
      ? {
          ...authSessionSource,
          sourceUrl: normalizedRuntimeSourceUrl,
        }
      : authSessionSource,
  };
}

function normalizeRuntimeSourceUrl(value) {
  return normalizeSupportedAuthSessionSourceUrl(value);
}
