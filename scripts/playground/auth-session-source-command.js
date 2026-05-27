import { pathToFileURL } from 'node:url';

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

export function resolveAuthSessionSourceCommandPayload(argv = process.argv.slice(2), env = process.env) {
  const options = parseAuthSessionSourceCommandArgs(argv);
  const sourceUrl = options.sourceUrl || env.REPRINT_PUSH_SOURCE_URL || env.REPRINT_PUSH_REMOTE_URL || '';
  const username = options.username || env.REPRINT_PUSH_USERNAME || env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER || '';
  const applicationPassword = options.applicationPassword
    || env.REPRINT_PUSH_APPLICATION_PASSWORD
    || env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD
    || '';

  return {
    sourceUrl,
    username,
    applicationPassword,
  };
}

export function runAuthSessionSourceCommandCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const payload = resolveAuthSessionSourceCommandPayload(argv, env);
    assertRequiredCliField(payload.sourceUrl, 'sourceUrl');
    assertRequiredCliField(payload.username, 'username');
    assertRequiredCliField(payload.applicationPassword, 'applicationPassword');
    stdout.write(`${JSON.stringify(payload)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseAuthSessionSourceCommandArgs(argv) {
  const options = {
    sourceUrl: '',
    username: '',
    applicationPassword: '',
  };

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const separatorIndex = arg.indexOf('=');
    const flag = separatorIndex === -1 ? arg.slice(2) : arg.slice(2, separatorIndex);
    const value = separatorIndex === -1 ? '' : arg.slice(separatorIndex + 1);
    if (flag === 'source-url') {
      options.sourceUrl = value;
    } else if (flag === 'username') {
      options.username = value;
    } else if (flag === 'application-password') {
      options.applicationPassword = value;
    }
  }

  return options;
}

function assertRequiredCliField(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Auth session source command must return ${field}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runAuthSessionSourceCommandCli();
}
