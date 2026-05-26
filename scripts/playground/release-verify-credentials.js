import { resolveAuthSessionSourceCredentials } from './auth-session-source.js';

export const releaseVerifyFixtureCredentials = Object.freeze({
  username: 'reprint_push_admin',
  applicationPassword: 'reprint-push-admin-app-password',
});

export function resolveReleaseVerifyCredentials({
  liveSourceUrl = '',
  username = '',
  applicationPassword = '',
}, authSessionSource, { preferSource = false } = {}) {
  const live = resolveAuthSessionSourceCredentials(
    {
      liveSourceUrl,
      username,
      applicationPassword,
    },
    authSessionSource,
    { preferSource },
  );

  return {
    fixture: { ...releaseVerifyFixtureCredentials },
    live,
  };
}
