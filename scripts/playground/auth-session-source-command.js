export function buildAuthSessionSourceCommand({
  nodePath = process.execPath,
  sourceUrl,
  username,
  applicationPassword,
}) {
  const normalizedNodePath = normalizeAuthSessionSourceCommandField(nodePath);
  if (!normalizedNodePath) {
    throw new Error('Missing nodePath for auth-session source command');
  }
  const normalizedSourceUrl = normalizeAuthSessionSourceCommandField(sourceUrl);
  if (!normalizedSourceUrl) {
    throw new Error('Missing sourceUrl for auth-session source command');
  }
  const normalizedUsername = normalizeAuthSessionSourceCommandField(username);
  if (!normalizedUsername) {
    throw new Error('Missing username for auth-session source command');
  }
  const normalizedApplicationPassword = normalizeAuthSessionSourceCommandField(applicationPassword);
  if (!normalizedApplicationPassword) {
    throw new Error('Missing applicationPassword for auth-session source command');
  }

  return [
    `REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL=${escapeShellEnvValue(normalizedSourceUrl)}`,
    `REPRINT_PUSH_SOURCE_COMMAND_USERNAME=${escapeShellEnvValue(normalizedUsername)}`,
    `REPRINT_PUSH_SOURCE_COMMAND_APPLICATION_PASSWORD=${escapeShellEnvValue(normalizedApplicationPassword)}`,
    `${escapeShellEnvValue(normalizedNodePath)} -e ${escapeShellEnvValue('process.stdout.write(JSON.stringify({sourceUrl: process.env.REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL, username: process.env.REPRINT_PUSH_SOURCE_COMMAND_USERNAME, applicationPassword: process.env.REPRINT_PUSH_SOURCE_COMMAND_APPLICATION_PASSWORD}))')}`,
  ].join(' ');
}

function escapeShellEnvValue(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeAuthSessionSourceCommandField(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  if (!normalized || normalized !== value || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return '';
  }

  return normalized;
}

export function resolveAuthSessionSourceCommand({
  sourceUrl,
  username,
  applicationPassword,
  authSessionSourceCommand = '',
}) {
  if (authSessionSourceCommand) {
    return authSessionSourceCommand;
  }

  return buildAuthSessionSourceCommand({
    sourceUrl,
    username,
    applicationPassword,
  });
}
