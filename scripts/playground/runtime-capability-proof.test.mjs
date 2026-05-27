import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeRuntimeCapability } from './runtime-capability-proof.mjs';

const present = (name) => ({ present: true, path: `/bin/${name}` });
const missing = () => ({ present: false, path: null });

const baseCommands = {
  docker: missing(),
  podman: missing(),
  node: present('node'),
  npm: present('npm'),
  npx: present('npx'),
  php: present('php'),
  composer: present('composer'),
  wp: missing(),
  'wp-env': missing(),
  nix: present('nix'),
  'nix-shell': present('nix-shell'),
  sqlite3: missing(),
  curl: present('curl'),
  tar: present('tar'),
  unzip: missing(),
  git: present('git'),
};

const packageJson = {
  scripts: {
    'verify:release:local-production': 'node ./scripts/playground/local-production-release-verify.mjs',
  },
};

const brewcommerce = {
  'blueprint.json': true,
  'content.xml': true,
  'database.sql': true,
  'ensure-media.php': true,
  'theme.zip': true,
  'uploads.zip': true,
};

test('runtime capability proof fails closed when Docker and external production config are missing', () => {
  const proof = summarizeRuntimeCapability({
    checkedAt: '2026-05-27T00:00:00.000Z',
    commands: baseCommands,
    packageJson,
    brewcommerce,
    commandOutput: {
      phpModules: {
        stdout: 'pdo_sqlite\nsqlite3\n',
      },
    },
  });

  assert.equal(proof.ok, false);
  assert.equal(proof.exitCode, 1);
  assert.equal(proof.verdict, 'DOCKER_RUNTIME_UNAVAILABLE');
  assert.equal(proof.blocker.failClosed, true);
  assert.equal(proof.runtimeCandidates.docker.present, false);
  assert.equal(proof.runtimeCandidates.localProductionPlayground.available, true);
  assert.equal(proof.nextCommands.localSubstitute, 'npm run verify:release:local-production');
  assert.match(
    proof.nextCommands.dockerOrExternalRelease,
    /REPRINT_PUSH_SOURCE_URL=https:\/\/source\.example/,
  );
});

test('runtime capability proof accepts complete external production config without exposing secrets', () => {
  const proof = summarizeRuntimeCapability({
    commands: baseCommands,
    packageJson,
    brewcommerce,
    env: {
      REPRINT_PUSH_SOURCE_URL: 'https://source.example',
      REPRINT_PUSH_REMOTE_CHANGED_URL: 'https://changed.example',
      REPRINT_PUSH_LOCAL_URL: 'https://local.example',
      REPRINT_PUSH_USERNAME: 'admin',
      REPRINT_PUSH_APPLICATION_PASSWORD: 'secret',
    },
    commandOutput: {
      phpModules: {
        stdout: 'pdo_sqlite\nsqlite3\n',
      },
    },
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.exitCode, 0);
  assert.equal(proof.externalProductionConfig.complete, true);
  assert.equal(proof.externalProductionConfig.applicationPasswordPresent, true);
  assert.doesNotMatch(JSON.stringify(proof), /secret/);
});

test('runtime capability proof marks wp-env unusable unless Docker is proven usable', () => {
  const proof = summarizeRuntimeCapability({
    commands: baseCommands,
    localBinaries: {
      wpEnv: {
        present: true,
        path: '/repo/node_modules/.bin/wp-env',
      },
    },
    packageJson: {
      ...packageJson,
      devDependencies: {
        '@wordpress/env': 'latest',
      },
    },
    brewcommerce,
  });

  assert.equal(proof.runtimeCandidates.wpEnv.present, true);
  assert.equal(proof.runtimeCandidates.wpEnv.packageDeclared, true);
  assert.equal(proof.runtimeCandidates.wpEnv.usable, false);
  assert.match(proof.runtimeCandidates.wpEnv.failure, /Docker daemon/);
});
