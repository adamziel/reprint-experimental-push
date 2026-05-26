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

  return `${nodePath} -e "process.stdout.write(JSON.stringify({sourceUrl:'${escapeShellSingleQuotedString(sourceUrl)}', username:'${escapeShellSingleQuotedString(username)}', applicationPassword:'${escapeShellSingleQuotedString(applicationPassword)}'}))"`;
}

function escapeShellSingleQuotedString(value) {
  return String(value).replace(/'/g, `'\\''`);
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
