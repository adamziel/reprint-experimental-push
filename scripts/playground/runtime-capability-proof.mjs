#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const commandNames = Object.freeze([
  'docker',
  'podman',
  'node',
  'npm',
  'npx',
  'php',
  'composer',
  'wp',
  'wp-env',
  'nix',
  'nix-shell',
  'sqlite3',
  'curl',
  'tar',
  'unzip',
  'git',
]);

const brewcommerceAssets = Object.freeze([
  'blueprint.json',
  'content.xml',
  'database.sql',
  'ensure-media.php',
  'theme.zip',
  'uploads.zip',
]);

const localProductionCommand = 'npm run verify:release:local-production';
const capabilityProofCommand = 'node scripts/playground/runtime-capability-proof.mjs';
const dockerOrExternalReleaseCommand = [
  'REPRINT_PUSH_SOURCE_URL=https://source.example',
  'REPRINT_PUSH_REMOTE_CHANGED_URL=https://changed.example',
  'REPRINT_PUSH_LOCAL_URL=https://local-edited.example',
  'REPRINT_PUSH_USERNAME=<admin>',
  'REPRINT_PUSH_APPLICATION_PASSWORD=<application-password>',
  'npm run verify:release',
].join(' ');

export function collectRuntimeCapabilityProof({
  cwd = repoRoot,
  env = process.env,
  now = new Date(),
} = {}) {
  const commands = Object.fromEntries(commandNames.map((name) => [name, commandFact(name, env)]));
  const localBinaries = {
    wpEnv: localBinaryFact(cwd, 'wp-env'),
    wpPlayground: localBinaryFact(cwd, 'wp-playground'),
  };
  const packageJson = readPackageJson(cwd);
  const repoNixFiles = ['flake.nix', 'flake.lock', 'shell.nix', 'default.nix']
    .filter((file) => fs.existsSync(path.join(cwd, file)));
  const brewcommerceDir = env.REPRINT_PUSH_BREWCOMMERCE_BLUEPRINT_DIR
    || '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce';
  const brewcommerce = Object.fromEntries(
    brewcommerceAssets.map((asset) => [asset, fs.existsSync(path.join(brewcommerceDir, asset))]),
  );

  const commandOutput = {
    dockerVersion: runIfPresent(commands.docker, ['--version']),
    dockerInfo: runIfPresent(commands.docker, ['info', '--format', '{{json .}}'], { timeoutMs: 10000 }),
    podmanVersion: runIfPresent(commands.podman, ['--version']),
    podmanInfo: runIfPresent(commands.podman, ['info', '--format', 'json'], { timeoutMs: 10000 }),
    nodeVersion: runIfPresent(commands.node, ['--version']),
    npmVersion: runIfPresent(commands.npm, ['--version']),
    npxVersion: runIfPresent(commands.npx, ['--version']),
    phpVersion: runIfPresent(commands.php, ['-r', 'echo PHP_VERSION;']),
    phpModules: runIfPresent(commands.php, ['-m']),
    composerVersion: runIfPresent(commands.composer, ['--version']),
    wpVersion: runIfPresent(commands.wp, ['--version']),
    wpEnvVersion: runIfPresent(commands['wp-env'], ['--version']),
    nixVersion: runIfPresent(commands.nix, ['--version']),
    nixShellVersion: runIfPresent(commands['nix-shell'], ['--version']),
    sqliteVersion: runIfPresent(commands.sqlite3, ['--version']),
    curlVersion: runIfPresent(commands.curl, ['--version']),
    tarVersion: runIfPresent(commands.tar, ['--version']),
    unzipVersion: runIfPresent(commands.unzip, ['-v']),
    gitVersion: runIfPresent(commands.git, ['--version']),
  };

  return summarizeRuntimeCapability({
    checkedAt: now.toISOString(),
    cwd,
    env,
    commands,
    localBinaries,
    packageJson,
    repoNixFiles,
    brewcommerceDir,
    brewcommerce,
    commandOutput,
  });
}

export function summarizeRuntimeCapability({
  checkedAt = new Date(0).toISOString(),
  cwd = repoRoot,
  env = {},
  commands = {},
  localBinaries = {},
  packageJson = {},
  repoNixFiles = [],
  brewcommerceDir = '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
  brewcommerce = {},
  commandOutput = {},
} = {}) {
  const dockerInfo = commandOutput.dockerInfo || nullCommandResult('docker');
  const podmanInfo = commandOutput.podmanInfo || nullCommandResult('podman');
  const phpModules = parsePhpModules(commandOutput.phpModules?.stdout || '');
  const packageScripts = packageJson.scripts || {};
  const packageDeps = {
    dependencies: packageJson.dependencies || {},
    devDependencies: packageJson.devDependencies || {},
  };
  const dockerUsable = commands.docker?.present === true && dockerInfo.status === 0;
  const podmanUsable = commands.podman?.present === true && podmanInfo.status === 0;
  const externalProduction = externalProductionConfig(env);
  const localProductionScript = packageScripts['verify:release:local-production'] || '';
  const hasLocalProductionScript = localProductionScript === 'node ./scripts/playground/local-production-release-verify.mjs';
  const brewcommerceReady = brewcommerceAssets.every((asset) => brewcommerce[asset] === true);
  const localProductionReady = Boolean(
    hasLocalProductionScript
    && commands.node?.present
    && commands.npm?.present
    && commands.npx?.present
    && brewcommerceReady,
  );
  const wpEnvDeclared = Boolean(
    packageDeps.dependencies?.['@wordpress/env']
    || packageDeps.devDependencies?.['@wordpress/env'],
  );
  const wpEnvPresent = Boolean(localBinaries.wpEnv?.present || commands['wp-env']?.present);
  const wpEnvUsable = wpEnvPresent && dockerUsable;
  const phpSqliteReady = Boolean(
    commands.php?.present
    && phpModules.has('pdo_sqlite')
    && phpModules.has('sqlite3'),
  );
  const localPhpWordPressToolReady = Boolean(
    phpSqliteReady
    && commands.curl?.present
    && commands.tar?.present,
  );
  const ok = dockerUsable || externalProduction.complete;
  const blocker = ok
    ? null
    : {
        code: commands.docker?.present ? 'DOCKER_DAEMON_UNUSABLE' : 'DOCKER_RUNTIME_UNAVAILABLE',
        reason: commands.docker?.present
          ? `Docker is on PATH but docker info did not pass: ${firstOutputLine(dockerInfo.stderr || dockerInfo.stdout || dockerInfo.error || 'unknown failure')}`
          : 'Docker is not on PATH in this sandbox.',
        failClosed: true,
      };

  return {
    event: 'runtime-capability-proof',
    checkedAt,
    cwd,
    ok,
    exitCode: ok ? 0 : 1,
    verdict: ok ? 'docker-or-external-runtime-available' : blocker.code,
    blocker,
    constraints: {
      sandboxIngressPort: 8080,
      allowedAdditionalPorts: '127.0.0.1 loopback only',
      tunnelsProhibited: true,
    },
    runtimeCandidates: {
      docker: {
        present: commands.docker?.present === true,
        path: commands.docker?.path || null,
        usable: dockerUsable,
        version: firstOutputLine(commandOutput.dockerVersion?.stdout || ''),
        infoStatus: dockerInfo.status,
        failure: dockerUsable ? null : missingOrFailed(commands.docker, dockerInfo, 'docker info'),
      },
      podman: {
        present: commands.podman?.present === true,
        path: commands.podman?.path || null,
        usable: podmanUsable,
        acceptedAsDockerProof: false,
        version: firstOutputLine(commandOutput.podmanVersion?.stdout || ''),
        infoStatus: podmanInfo.status,
        failure: podmanUsable ? null : missingOrFailed(commands.podman, podmanInfo, 'podman info'),
      },
      wpEnv: {
        present: wpEnvPresent,
        localBinary: localBinaries.wpEnv?.path || null,
        packageDeclared: wpEnvDeclared,
        usable: wpEnvUsable,
        failure: wpEnvUsable
          ? null
          : wpEnvPresent
            ? 'wp-env depends on a usable Docker daemon, which is not proven here.'
            : '@wordpress/env/wp-env is not installed locally or declared in package.json.',
      },
      nixShell: {
        nixPresent: commands.nix?.present === true,
        nixShellPresent: commands['nix-shell']?.present === true,
        repoFiles: repoNixFiles,
        usableAsDockerProof: false,
        caveat: repoNixFiles.length
          ? 'Repo Nix files exist, but Docker proof still requires a Docker daemon/socket.'
          : 'Nix is available, but this repo has no flake.nix, shell.nix, or default.nix.',
        possibleClientOnlyCommand: 'nix shell nixpkgs#docker-client nixpkgs#docker-compose',
      },
      localPhpSqliteWordPress: {
        phpPresent: commands.php?.present === true,
        phpVersion: firstOutputLine(commandOutput.phpVersion?.stdout || commandOutput.phpVersion?.stderr || ''),
        sqliteExtensions: {
          pdoSqlite: phpModules.has('pdo_sqlite'),
          sqlite3: phpModules.has('sqlite3'),
        },
        toolReady: localPhpWordPressToolReady,
        missing: [
          ...(commands.php?.present ? [] : ['php']),
          ...(phpModules.has('pdo_sqlite') ? [] : ['php pdo_sqlite extension']),
          ...(phpModules.has('sqlite3') ? [] : ['php sqlite3 extension']),
          ...(commands.curl?.present ? [] : ['curl']),
          ...(commands.tar?.present ? [] : ['tar']),
        ],
        caveat: 'This is a plausible non-Playground local WordPress primitive, but no checked PHP/SQLite WordPress proof script exists in this repo yet.',
      },
      localProductionPlayground: {
        available: localProductionReady,
        exactCommand: localProductionCommand,
        script: localProductionScript || null,
        brewcommerceBlueprintDir: brewcommerceDir,
        brewcommerceAssetsPresent: brewcommerceReady,
        missingAssets: brewcommerceAssets.filter((asset) => brewcommerce[asset] !== true),
        caveat: 'This is the closest checked local substitute, but it is Playground loopback WordPress, not Docker or external production WordPress.',
      },
    },
    commandInventory: Object.fromEntries(
      commandNames.map((name) => [
        name,
        {
          present: commands[name]?.present === true,
          path: commands[name]?.path || null,
          version: inventoryVersion(name, commandOutput),
        },
      ]),
    ),
    externalProductionConfig: externalProduction,
    nextCommands: {
      capabilityProof: capabilityProofCommand,
      localSubstitute: localProductionReady ? localProductionCommand : null,
      dockerOrExternalRelease: dockerOrExternalReleaseCommand,
    },
  };
}

function commandFact(name, env) {
  const resolved = resolveCommand(name, env);
  return {
    present: Boolean(resolved),
    path: resolved || null,
  };
}

function localBinaryFact(cwd, name) {
  const fullPath = path.join(cwd, 'node_modules', '.bin', name);
  return {
    present: fs.existsSync(fullPath),
    path: fs.existsSync(fullPath) ? fullPath : null,
  };
}

function resolveCommand(name, env = process.env) {
  const pathValue = env.PATH || '';
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    const fullPath = path.join(dir, name);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return fullPath;
    } catch {
      // Continue scanning PATH.
    }
  }
  return '';
}

function runIfPresent(command, args, { timeoutMs = 5000 } = {}) {
  if (!command?.present || !command.path) {
    return nullCommandResult(command?.path || '');
  }
  const result = spawnSync(command.path, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message || '',
    stdout: trimOutput(result.stdout || ''),
    stderr: trimOutput(result.stderr || ''),
  };
}

function nullCommandResult(command) {
  return {
    status: null,
    signal: null,
    error: command ? 'not run' : 'command missing',
    stdout: '',
    stderr: '',
  };
}

function readPackageJson(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function parsePhpModules(output) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean)
      .filter((line) => !line.startsWith('[')),
  );
}

function externalProductionConfig(env) {
  const sourceUrl = env.REPRINT_PUSH_SOURCE_URL || '';
  const remoteChangedUrl = env.REPRINT_PUSH_REMOTE_CHANGED_URL || '';
  const localUrl = env.REPRINT_PUSH_LOCAL_URL || '';
  const usernamePresent = Boolean(env.REPRINT_PUSH_USERNAME || env.REPRINT_PUSH_LAB_AUTH_ADMIN_USER);
  const applicationPasswordPresent = Boolean(
    env.REPRINT_PUSH_APPLICATION_PASSWORD || env.REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD,
  );
  const authSessionSourceCommandPresent = Boolean(env.REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND);
  const authPresent = authSessionSourceCommandPresent || (usernamePresent && applicationPasswordPresent);
  const missing = [
    ...(sourceUrl ? [] : ['REPRINT_PUSH_SOURCE_URL']),
    ...(remoteChangedUrl ? [] : ['REPRINT_PUSH_REMOTE_CHANGED_URL']),
    ...(localUrl ? [] : ['REPRINT_PUSH_LOCAL_URL']),
    ...(authPresent ? [] : ['REPRINT_PUSH_USERNAME plus REPRINT_PUSH_APPLICATION_PASSWORD, or REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND']),
  ];

  return {
    complete: missing.length === 0,
    sourceUrlPresent: Boolean(sourceUrl),
    remoteChangedUrlPresent: Boolean(remoteChangedUrl),
    localUrlPresent: Boolean(localUrl),
    usernamePresent,
    applicationPasswordPresent,
    authSessionSourceCommandPresent,
    missing,
  };
}

function missingOrFailed(command, result, label) {
  if (!command?.present) {
    return `${label} not run because the command is missing.`;
  }
  return firstOutputLine(result?.stderr || result?.stdout || result?.error || `${label} failed`);
}

function inventoryVersion(name, commandOutput) {
  const key = {
    docker: 'dockerVersion',
    podman: 'podmanVersion',
    node: 'nodeVersion',
    npm: 'npmVersion',
    npx: 'npxVersion',
    php: 'phpVersion',
    composer: 'composerVersion',
    wp: 'wpVersion',
    'wp-env': 'wpEnvVersion',
    nix: 'nixVersion',
    'nix-shell': 'nixShellVersion',
    sqlite3: 'sqliteVersion',
    curl: 'curlVersion',
    tar: 'tarVersion',
    unzip: 'unzipVersion',
    git: 'gitVersion',
  }[name];
  return firstOutputLine(commandOutput[key]?.stdout || commandOutput[key]?.stderr || '');
}

function firstOutputLine(value) {
  return trimOutput(value).split(/\r?\n/).find(Boolean) || '';
}

function trimOutput(value) {
  return String(value).trim().slice(0, 4000);
}

function main() {
  const proof = collectRuntimeCapabilityProof();
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (!proof.ok) {
    process.stderr.write(`${proof.blocker.code}: ${proof.blocker.reason}\n`);
  }
  process.exitCode = proof.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
