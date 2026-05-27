import { buildAuthSessionSourceCommand } from './auth-session-source-command.js';
import { resolvePackagedProductionPluginSourceCommand } from './packaged-production-plugin-source-command.js';

export function applyRevalidationRetryable(proof) {
  const combinedOutput = `${proof.stdout ?? ''}\n${proof.stderr ?? ''}`;
  return proof.status !== 0
    && /apply-revalidation:/.test(combinedOutput)
    && (
      /Timed out waiting for Playground server/.test(combinedOutput)
      || /readiness probe error fetch failed/.test(combinedOutput)
      || /WordPress is not ready yet/.test(combinedOutput)
      || (
        /apply-revalidation:\s+apply\s+\/apply/.test(combinedOutput)
        && /TimeoutError: The operation was aborted due to timeout/.test(combinedOutput)
      )
    );
}

export function hasExplicitCheckedBoundaryRequest({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
} = {}) {
  return Boolean(
    liveSourceUrl
    || username
    || applicationPassword
    || authSessionSourceCommand,
  );
}

export function resolveCheckedLiveBoundaryEnv({
  sourceUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
} = {}) {
  const resolvedUsername = username || fallbackUsername;
  const resolvedApplicationPassword = applicationPassword || fallbackApplicationPassword;

  return {
    ...(sourceUrl
      ? {
          REPRINT_PUSH_SOURCE_URL: sourceUrl,
          REPRINT_PUSH_REMOTE_URL: sourceUrl,
        }
      : {}),
    REPRINT_PUSH_USERNAME: resolvedUsername,
    REPRINT_PUSH_APPLICATION_PASSWORD: resolvedApplicationPassword,
    REPRINT_PUSH_LAB_AUTH_ADMIN_USER: resolvedUsername,
    REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: resolvedApplicationPassword,
    ...(authSessionSourceCommand
      ? { REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: authSessionSourceCommand }
      : {}),
  };
}

export function resolveLiveApplyRevalidationEnv({
  sourceUrl = '',
  localUrl = '',
  packagedBoundaryRequested = false,
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
} = {}) {
  const resolvedUsername = username || fallbackUsername;
  const resolvedApplicationPassword = applicationPassword || fallbackApplicationPassword;
  const resolvedAuthSessionSourceCommand = authSessionSourceCommand
    || (sourceUrl
      ? packagedBoundaryRequested
        ? resolvePackagedProductionPluginSourceCommand({
            sourceUrl,
            username: resolvedUsername,
            applicationPassword: resolvedApplicationPassword,
          })
        : buildAuthSessionSourceCommand({
            sourceUrl,
            username: resolvedUsername,
            applicationPassword: resolvedApplicationPassword,
          })
      : '');

  return {
    ...(sourceUrl
      ? {
          REPRINT_PUSH_SOURCE_URL: sourceUrl,
          REPRINT_PUSH_REMOTE_URL: sourceUrl,
        }
      : {}),
    ...(localUrl ? { REPRINT_PUSH_LOCAL_URL: localUrl } : {}),
    REPRINT_PUSH_USERNAME: resolvedUsername,
    REPRINT_PUSH_APPLICATION_PASSWORD: resolvedApplicationPassword,
    REPRINT_PUSH_LAB_AUTH_ADMIN_USER: resolvedUsername,
    REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: resolvedApplicationPassword,
    ...(resolvedAuthSessionSourceCommand
      ? { REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: resolvedAuthSessionSourceCommand }
      : {}),
  };
}
