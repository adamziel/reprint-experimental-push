import { spawnSync } from 'node:child_process';

export function loadAuthSessionSource(command, baseEnv = process.env, cwd = process.cwd()) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 2,
    env: {
      ...baseEnv,
      NODE_NO_WARNINGS: '1',
    },
  });

  if (result.error || result.status !== 0 || result.signal) {
    const errorMessage = result.error?.message || result.stderr || result.stdout || `exit ${result.status ?? 'null'}`;
    return {
      ok: false,
      error: String(errorMessage).trim(),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    sourceUrl: parsed.sourceUrl || '',
    username: parsed.username || '',
    applicationPassword: parsed.applicationPassword || '',
  };
}
