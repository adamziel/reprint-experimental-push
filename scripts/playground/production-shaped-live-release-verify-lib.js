import { buildAuthSessionSourceCommand } from './auth-session-source-command.js';
import { shouldRequestPackagedProductionPluginAuthSession } from './packaged-production-plugin-source-command.js';
import { resolvePackagedProductionPluginSourceCommand } from './packaged-production-plugin-source-command.js';

export function resolveCheckedReleaseRequirementEnv() {
  return {
    REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
    REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
  };
}

export function shouldRequestCheckedLivePackagedBoundary({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fixtureUsername = '',
  fixtureApplicationPassword = '',
} = {}) {
  return shouldRequestPackagedProductionPluginAuthSession({
    requireProductionAuthSession: true,
    authSessionSourceCommand,
    liveSourceUrl,
    username,
    applicationPassword,
    fixtureUsername,
    fixtureApplicationPassword,
  });
}

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
  allowCredentialFallback = false,
} = {}) {
  const resolvedUsername = username || (allowCredentialFallback ? fallbackUsername : '');
  const resolvedApplicationPassword = applicationPassword || (allowCredentialFallback ? fallbackApplicationPassword : '');
  const resolvedAuthSessionSourceCommand = authSessionSourceCommand
    || (sourceUrl
      && resolvedUsername
      && resolvedApplicationPassword
      ? buildAuthSessionSourceCommand({
          sourceUrl,
          username: resolvedUsername,
          applicationPassword: resolvedApplicationPassword,
        })
      : '');

  return {
    ...resolveCheckedReleaseRequirementEnv(),
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
    ...(resolvedAuthSessionSourceCommand
      ? { REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: resolvedAuthSessionSourceCommand }
      : {}),
  };
}

export function resolveLiveApplyRevalidationEnv({
  sourceUrl = '',
  remoteChangedUrl = '',
  localUrl = '',
  packagedBoundaryRequested = false,
  username = '',
  applicationPassword = '',
  authSessionSourceCommand = '',
  fallbackUsername = '',
  fallbackApplicationPassword = '',
  allowCredentialFallback = false,
} = {}) {
  const resolvedUsername = username || (allowCredentialFallback ? fallbackUsername : '');
  const resolvedApplicationPassword = applicationPassword || (allowCredentialFallback ? fallbackApplicationPassword : '');
  const resolvedAuthSessionSourceCommand = authSessionSourceCommand
    || (sourceUrl
      && resolvedUsername
      && resolvedApplicationPassword
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
    ...resolveCheckedReleaseRequirementEnv(),
    ...(sourceUrl
      ? {
          REPRINT_PUSH_SOURCE_URL: sourceUrl,
          REPRINT_PUSH_REMOTE_URL: sourceUrl,
        }
      : {}),
    ...(remoteChangedUrl ? { REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl } : {}),
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

export function shouldUseProductionSnapshotExport({
  packagedBoundaryRequested = false,
  explicitSourceUrl = '',
} = {}) {
  return Boolean(packagedBoundaryRequested || explicitSourceUrl);
}

export function resolveCheckedReleaseTopology({
  remoteBaseUrl = '',
  explicitSourceUrl = '',
  explicitRemoteChangedUrl = '',
  explicitLocalUrl = '',
  packagedBoundaryRequested = false,
} = {}) {
  const explicitLiveTopologyRequested = Boolean(explicitSourceUrl) && !packagedBoundaryRequested;

  return {
    remoteBase: remoteBaseUrl,
    remoteChanged: explicitLiveTopologyRequested
      ? (explicitRemoteChangedUrl || explicitSourceUrl)
      : 'remote-changed',
    localEdited: explicitLocalUrl || 'local-edited',
  };
}
