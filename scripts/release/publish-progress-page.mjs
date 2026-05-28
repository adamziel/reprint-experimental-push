#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_REMOTE = 'origin';
const DEFAULT_BRANCH = 'main';
const DEFAULT_SOURCE = 'progress.html';

function parseArgs(argv) {
  const options = {
    remote: DEFAULT_REMOTE,
    branch: DEFAULT_BRANCH,
    source: DEFAULT_SOURCE,
    dryRun: false,
    keepWorktree: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--keep-worktree') {
      options.keepWorktree = true;
    } else if (arg === '--remote') {
      options.remote = requiredValue(argv, ++index, arg);
    } else if (arg === '--branch') {
      options.branch = requiredValue(argv, ++index, arg);
    } else if (arg === '--source') {
      options.source = requiredValue(argv, ++index, arg);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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
  console.log(`Usage: node scripts/release/publish-progress-page.mjs [options]

Publishes the current lane's progress.html to the existing GitHub Pages source
branch without creating a PR or a new branch.

Options:
  --dry-run          Verify whether progress.html would change, but do not commit or push.
  --remote <name>    Git remote to use. Default: origin.
  --branch <name>    Existing Pages source branch to update. Default: main.
  --source <path>    Progress HTML file to publish. Default: progress.html.
  --keep-worktree    Keep the temporary detached worktree for debugging.
`);
}

function git(args, options = {}) {
  const output = execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  return typeof output === 'string' ? output.trim() : '';
}

function gitOk(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).status === 0;
}

function assertSafeRefName(value, label) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes('..') || value.startsWith('/') || value.endsWith('/')) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

function copyProgress(sourcePath, worktreePath) {
  const targetPath = path.join(worktreePath, 'progress.html');
  fs.copyFileSync(sourcePath, targetPath);
}

function cleanupWorktree(root, worktreePath, keepWorktree) {
  if (keepWorktree) {
    return;
  }

  try {
    git(['worktree', 'remove', '--force', worktreePath], { cwd: root, stdio: 'ignore' });
  } catch {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSafeRefName(options.remote, 'remote');
  assertSafeRefName(options.branch, 'branch');

  const root = git(['rev-parse', '--show-toplevel']);
  const sourcePath = path.resolve(root, options.source);
  const relativeSourcePath = path.relative(root, sourcePath);
  if (relativeSourcePath.startsWith('..') || path.isAbsolute(relativeSourcePath)) {
    throw new Error(`Source must be inside the repository: ${options.source}`);
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${relativeSourcePath}`);
  }

  const sourceHead = git(['rev-parse', 'HEAD'], { cwd: root });
  const sourceBranch = git(['branch', '--show-current'], { cwd: root }) || '(detached)';
  const remoteRef = `refs/remotes/${options.remote}/${options.branch}`;
  const branchRefspec = `+refs/heads/${options.branch}:${remoteRef}`;

  git(['fetch', options.remote, branchRefspec], { cwd: root, stdio: 'inherit' });
  const baseHead = git(['rev-parse', remoteRef], { cwd: root });
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-progress-main-'));
  let result;

  try {
    git(['worktree', 'add', '--detach', worktreePath, remoteRef], { cwd: root, stdio: 'inherit' });
    copyProgress(sourcePath, worktreePath);
    const status = git(['status', '--porcelain', '--', 'progress.html'], { cwd: worktreePath });
    const changed = status.length > 0;

    result = {
      ok: true,
      dryRun: options.dryRun,
      changed,
      sourceBranch,
      sourceHead,
      pagesBranch: options.branch,
      baseHead,
      worktreePath: options.keepWorktree ? worktreePath : undefined,
    };

    if (!changed) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (options.dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    git(['add', 'progress.html'], { cwd: worktreePath });
    git([
      '-c',
      'user.name=Reprint Progress Publisher',
      '-c',
      'user.email=progress-publisher@users.noreply.github.com',
      'commit',
      '-m',
      'docs: publish progress page',
      '-m',
      `Source: ${sourceBranch} ${sourceHead}`,
    ], { cwd: worktreePath, stdio: 'inherit' });

    git(['fetch', options.remote, branchRefspec], { cwd: worktreePath, stdio: 'inherit' });
    if (!gitOk(['merge-base', '--is-ancestor', remoteRef, 'HEAD'], worktreePath)) {
      throw new Error(`${options.remote}/${options.branch} moved and is no longer an ancestor of the publish commit`);
    }

    const publishedHead = git(['rev-parse', 'HEAD'], { cwd: worktreePath });
    git(['push', options.remote, `HEAD:refs/heads/${options.branch}`], { cwd: worktreePath, stdio: 'inherit' });
    result.publishedHead = publishedHead;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cleanupWorktree(root, worktreePath, options.keepWorktree);
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
