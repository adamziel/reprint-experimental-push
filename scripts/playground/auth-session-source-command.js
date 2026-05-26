export function buildAuthSessionSourceCommand({
  nodePath = process.execPath,
  sourceUrl,
  username,
  applicationPassword,
}) {
  if (!sourceUrl) {
    throw new Error('Missing sourceUrl for auth-session source command');
  }
  if (!username) {
    throw new Error('Missing username for auth-session source command');
  }
  if (!applicationPassword) {
    throw new Error('Missing applicationPassword for auth-session source command');
  }

  return [
    `REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL=${escapeShellEnvValue(sourceUrl)}`,
    `REPRINT_PUSH_SOURCE_COMMAND_USERNAME=${escapeShellEnvValue(username)}`,
    `REPRINT_PUSH_SOURCE_COMMAND_APPLICATION_PASSWORD=${escapeShellEnvValue(applicationPassword)}`,
    `${nodePath} -e ${escapeShellEnvValue('process.stdout.write(JSON.stringify({sourceUrl: process.env.REPRINT_PUSH_SOURCE_COMMAND_SOURCE_URL, username: process.env.REPRINT_PUSH_SOURCE_COMMAND_USERNAME, applicationPassword: process.env.REPRINT_PUSH_SOURCE_COMMAND_APPLICATION_PASSWORD}))')}`,
  ].join(' ');
}

function escapeShellEnvValue(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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
