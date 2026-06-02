#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_INTERVAL_MS = 600000;
const DEFAULT_STATE_PATH = '.tmp/progress-surface-watch.json';
const DEFAULT_LOG_PATH = '.tmp/progress-surface-watch.log';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    intervalMs: DEFAULT_INTERVAL_MS,
    statePath: DEFAULT_STATE_PATH,
    logPath: DEFAULT_LOG_PATH,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--interval-ms') {
      options.intervalMs = Number(requiredValue(rest, ++index, arg));
    } else if (arg === '--state') {
      options.statePath = requiredValue(rest, ++index, arg);
    } else if (arg === '--log') {
      options.logPath = requiredValue(rest, ++index, arg);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['start', 'stop', 'status', 'restart'].includes(options.command)) {
    printHelp();
    process.exit(options.command ? 1 : 0);
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1000) {
    throw new Error('--interval-ms must be at least 1000');
  }

  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/release/manage-progress-surface-watch.mjs <command> [options]

Commands:
  start    Start a managed local progress-surface refresh loop.
  status   Print watcher state and whether the recorded process is alive.
  stop     Stop the recorded watcher process.
  restart  Stop the recorded watcher, then start a fresh one.

Options:
  --interval-ms <n>  Refresh cadence in milliseconds. Default: 600000.
  --state <path>     State file path. Default: .tmp/progress-surface-watch.json.
  --log <path>       Log file path. Default: .tmp/progress-surface-watch.log.
`);
}

function repoRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, '../..');
}

function absolute(root, maybeRelative) {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.join(root, maybeRelative);
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    return {
      invalid: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function appendLogHeader(logPath, state) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, [
    '',
    `# progress-surface-watch start ${state.startedAt}`,
    `pid=${state.pid}`,
    `intervalMs=${state.intervalMs}`,
    `command=${state.command.join(' ')}`,
    '',
  ].join('\n'));
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function statusPayload(statePath, logPath) {
  const state = readState(statePath);
  const alive = state && !state.invalid ? processAlive(state.pid) : false;
  return {
    ok: Boolean(!state || !state.invalid),
    alive,
    statePath,
    logPath,
    state: state || null,
  };
}

async function stopWatcher(statePath, logPath) {
  const state = readState(statePath);
  if (!state) {
    return { ok: true, stopped: false, reason: 'no-state-file', statePath, logPath };
  }

  if (state.invalid) {
    return { ok: false, stopped: false, reason: 'invalid-state-file', statePath, logPath, state };
  }

  if (!processAlive(state.pid)) {
    removeState(statePath);
    return { ok: true, stopped: false, cleanedState: true, reason: 'not-running', statePath, logPath, state };
  }

  sendSignal(state.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(100);
    if (!processAlive(state.pid)) {
      removeState(statePath);
      return { ok: true, stopped: true, cleanedState: true, signal: 'SIGTERM', statePath, logPath, state };
    }
  }

  sendSignal(state.pid, 'SIGKILL');
  removeState(statePath);
  return { ok: true, stopped: true, cleanedState: true, signal: 'SIGKILL', statePath, logPath, state };
}

function removeState(statePath) {
  try {
    fs.unlinkSync(statePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function startWatcher(root, statePath, logPath, intervalMs) {
  const existing = readState(statePath);
  if (existing && !existing.invalid && processAlive(existing.pid)) {
    return {
      ok: true,
      started: false,
      reason: 'already-running',
      statePath,
      logPath,
      state: existing,
    };
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');
  const script = path.join(root, 'scripts/release/refresh-progress-surface.mjs');
  const command = [
    process.execPath,
    script,
    '--watch',
    '--interval-ms',
    String(intervalMs),
  ];
  const child = spawn(command[0], command.slice(1), {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const state = {
    schemaVersion: 1,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    intervalMs,
    command,
    statePath,
    logPath,
  };
  writeState(statePath, state);
  appendLogHeader(logPath, state);
  const initialRefresh = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (initialRefresh.status !== 0) {
    sendSignal(child.pid, 'SIGTERM');
    return {
      ok: false,
      started: true,
      reason: 'initial-refresh-failed',
      refreshExitCode: initialRefresh.status,
      refreshStderr: initialRefresh.stderr,
      statePath,
      logPath,
      state,
    };
  }

  return {
    ok: true,
    started: true,
    initialRefresh: 'ok',
    statePath,
    logPath,
    state,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const statePath = absolute(root, options.statePath);
  const logPath = absolute(root, options.logPath);
  let result;

  if (options.command === 'status') {
    result = statusPayload(statePath, logPath);
  } else if (options.command === 'stop') {
    result = await stopWatcher(statePath, logPath);
  } else if (options.command === 'start') {
    result = startWatcher(root, statePath, logPath, options.intervalMs);
  } else {
    const stopped = await stopWatcher(statePath, logPath);
    const started = startWatcher(root, statePath, logPath, options.intervalMs);
    result = { ok: stopped.ok && started.ok, stopped, started };
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
