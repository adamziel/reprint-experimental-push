#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
};

const tmpDir = path.join(repoRoot, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const protocolWrapperPath = path.join(tmpDir, 'push-recovery-protocol-wrapper.php');
fs.writeFileSync(protocolWrapperPath, protocolWrapperSource());

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);

assert.equal(snapshots.base.meta.fixture, 'remote-base');
assert.equal(snapshots.local.meta.fixture, 'local-edited');

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.summary.conflicts, 0);
assert.equal(readyPlan.summary.blockers, 0);
assert.equal(readyPlan.mutations.length, 8, 'ready fixture plan must keep eight target mutations');
assertReadyPlanResources(readyPlan);
assertTargetHashes(readyPlan, snapshots.base, 'expectedHash', 'ready preconditions');

const readyPlanPath = writeJson('push-recovery-ready-plan.json', readyPlan);

const dryRun = runProtocolCommand({
  name: 'recovery dry-run receipt',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'dry-run',
  planPath: readyPlanPath,
});

assert.equal(dryRun.status, 0);
assert.equal(dryRun.result.ok, true);
assert.equal(dryRun.result.mode, 'dry-run');
assert.equal(dryRun.result.applied, 0);
assert.equal(dryRun.result.receipt?.mode, 'dry-run');
assert.ok(dryRun.result.receipt?.receiptHash, 'dry-run receipt hash missing');
assert.equal(dryRun.result.verifiedPreconditions.length, readyPlan.mutations.length);
assertJournalEvent(dryRun.result, 'dry-run-recorded');

const dryRunReceiptPath = writeJson('push-recovery-ready-dry-run-receipt.json', dryRun.result.receipt);

const cliRecovery = runProtocolRecoveryScenario({
  blueprintPath: path.join(repoRoot, fixtures.base),
  planPath: readyPlanPath,
  receiptPath: dryRunReceiptPath,
});

assertSnapshotContentEqual(cliRecovery.beforeSnapshot, snapshots.base, 'CLI recovery before snapshot');
assertFailedLabApply(cliRecovery.failedApply, 'CLI fail-after-2 apply');
assertRecoveryInspection(cliRecovery.inspect.result.recovery, {
  state: 'blocked-recovery',
  old: 6,
  new: 2,
  blockedUnknown: 0,
  label: 'CLI inspect after fail-after-2',
});
assertTargetClassificationsMatchSnapshot(readyPlan, cliRecovery.afterFailureSnapshot, { old: 6, new: 2, blockedUnknown: 0 });
assertRecoveryEvidenceNoRawValues(cliRecovery.inspect.result.recovery, 'CLI inspect');

assert.notEqual(cliRecovery.retryApply.status, 0, 'retry after partial apply must fail');
assert.equal(cliRecovery.retryApply.result.ok, false);
assert.ok(
  ['PRECONDITION_FAILED', 'RECOVERY_REQUIRED', 'RECOVERY_BLOCKED', 'BLOCKED_RECOVERY'].includes(cliRecovery.retryApply.result.code),
  `unexpected retry blocker code: ${cliRecovery.retryApply.result.code}`,
);
assert.notEqual(cliRecovery.retryApply.result.code, 'LAB_INJECTED_APPLY_FAILURE', 'retry failure must come from recovery/precondition guard, not lab failpoint');
assertNoJournalEvent(cliRecovery.retryApply.result, 'apply-committed');
assertTargetClassificationsMatchSnapshot(readyPlan, cliRecovery.afterRetrySnapshot, { old: 6, new: 2, blockedUnknown: 0 });
assertRecoveryInspection(cliRecovery.retryInspect.result.recovery, {
  state: 'blocked-recovery',
  old: 6,
  new: 2,
  blockedUnknown: 0,
  label: 'CLI inspect after retry',
});

const summary = {
  plan: {
    status: readyPlan.status,
    mutations: readyPlan.mutations.length,
  },
  dryRun: {
    status: dryRun.status,
    receipt: Boolean(dryRun.result.receipt?.receiptHash),
    verified: dryRun.result.verifiedPreconditions.length,
  },
  cli: {
    failAfter: 2,
    failedStatus: cliRecovery.failedApply.status,
    failedCode: cliRecovery.failedApply.result.code,
    failedJournal: journalEvents(cliRecovery.failedApply.result),
    inspect: recoveryCounts(cliRecovery.inspect.result.recovery),
    retryCode: cliRecovery.retryApply.result.code,
    retryInspect: recoveryCounts(cliRecovery.retryInspect.result.recovery),
  },
  rest: {
    transport: {
      host: '127.0.0.1',
      servers: [],
    },
  },
};

await withPlaygroundServer('recovery-rest-base', path.join(repoRoot, fixtures.base), async (server) => {
  summary.rest.transport.servers.push(server.summary);

  const dryRunResponse = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRunResponse.status, 200);
  assert.equal(dryRunResponse.body.ok, true);
  assert.equal(dryRunResponse.body.mode, 'dry-run');
  assert.ok(dryRunResponse.body.receipt?.receiptHash, 'REST dry-run receipt hash missing');

  const failApply = await postLab(
    server,
    '/apply',
    {
      plan: readyPlan,
      receipt: dryRunResponse.body.receipt,
      labFailAfterMutations: 2,
    },
    { [idempotencyHeader]: 'recovery-rest-fail-after-2' },
  );
  assert.equal(failApply.status, 500);
  assertFailedLabApply({ status: 1, result: failApply.body }, 'REST fail-after-2 apply');
  await assertJournalContains(server, 'apply-failed');
  await assertJournalContains(server, 'recovery-required');

  const inspect = await postLab(server, '/recovery/inspect', {
    plan: readyPlan,
    receipt: dryRunResponse.body.receipt,
  });
  assert.equal(inspect.status, 200);
  assert.equal(inspect.body.ok, true);
  assert.equal(inspect.body.mode, 'inspect');
  assertRecoveryInspection(inspect.body.recovery, {
    state: 'blocked-recovery',
    old: 6,
    new: 2,
    blockedUnknown: 0,
    label: 'REST inspect after fail-after-2',
  });
  assertRecoveryEvidenceNoRawValues(inspect.body.recovery, 'REST inspect');

  const after = await getSnapshot(server);
  assertTargetClassificationsMatchSnapshot(readyPlan, after.body.snapshot, { old: 6, new: 2, blockedUnknown: 0 });

  summary.rest.dryRun = {
    route: 'POST /wp-json/reprint-push-lab/v1/dry-run',
    status: dryRunResponse.status,
    receipt: Boolean(dryRunResponse.body.receipt?.receiptHash),
  };
  summary.rest.failApply = {
    route: 'POST /wp-json/reprint-push-lab/v1/apply',
    status: failApply.status,
    code: failApply.body.code,
    journal: journalEvents(failApply.body),
  };
  summary.rest.inspect = {
    route: 'POST /wp-json/reprint-push-lab/v1/recovery/inspect',
    status: inspect.status,
    recovery: recoveryCounts(inspect.body.recovery),
  };
});

console.log(JSON.stringify(summary, null, 2));

function exportSnapshot(name, blueprintPath) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function runProtocolCommand({ name, blueprintPath, mode, planPath, receiptPath = null }) {
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/push-remote-endpoint.php',
    mode,
    `/workspace/${path.relative(repoRoot, planPath)}`,
  ];

  if (receiptPath) {
    args.push(`/workspace/${path.relative(repoRoot, receiptPath)}`);
  }

  const result = spawnSync('npx', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    result: parseMarkedJson(
      result.stdout,
      'REPRINT_PUSH_PROTOCOL_JSON_BEGIN',
      'REPRINT_PUSH_PROTOCOL_JSON_END',
      `Protocol markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    ),
  };
}

function runProtocolRecoveryScenario({ blueprintPath, planPath, receiptPath }) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    `/workspace/${path.relative(repoRoot, protocolWrapperPath)}`,
    `/workspace/${path.relative(repoRoot, planPath)}`,
    `/workspace/${path.relative(repoRoot, receiptPath)}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 30,
  });

  if (result.status !== 0) {
    throw new Error(`Recovery protocol wrapper failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_RECOVERY_PROTOCOL_JSON_BEGIN',
    'REPRINT_PUSH_RECOVERY_PROTOCOL_JSON_END',
    `Recovery protocol markers missing\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function protocolWrapperSource() {
  return `<?php
if (!defined('ABSPATH')) {
    require_once '/wordpress/wp-load.php';
}
require_once '/workspace/scripts/playground/snapshot-lib.php';
require_once '/workspace/scripts/playground/push-remote-lib.php';

$plan_path = $argv[1] ?? null;
$receipt_path = $argv[2] ?? null;
if (!is_string($plan_path) || !is_string($receipt_path)) {
    fwrite(STDERR, "Usage: php push-recovery-protocol-wrapper.php <plan.json> <receipt.json>\\n");
    exit(1);
}

function reprint_push_recovery_smoke_call(string $label, string $mode, string $plan_path, ?string $receipt_path = null, ?int $fail_after = null): array
{
    if ($fail_after === null) {
        putenv('REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS');
    } else {
        putenv('REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=' . $fail_after);
    }

    try {
        $result = reprint_push_protocol_run($mode, $plan_path, $receipt_path);
        $status = 0;
    } catch (Reprint_Push_Protocol_Error $error) {
        $result = $error->result;
        $status = max(1, $error->getCode());
    } catch (Throwable $error) {
        $result = [
            'ok' => false,
            'code' => 'PUSH_PROTOCOL_ERROR',
            'message' => $error->getMessage(),
            'error' => [
                'class' => get_class($error),
                'message' => $error->getMessage(),
            ],
        ];
        $status = 1;
    } finally {
        putenv('REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS');
    }

    return [
        'label' => $label,
        'status' => $status,
        'result' => $result,
    ];
}

$before = reprint_push_export_snapshot();
$failed_apply = reprint_push_recovery_smoke_call('apply fail-after-2', 'apply', $plan_path, $receipt_path, 2);
$after_failure = reprint_push_export_snapshot();
$inspect = reprint_push_recovery_smoke_call('inspect after failure', 'inspect', $plan_path, $receipt_path);
$retry_apply = reprint_push_recovery_smoke_call('retry apply after failure', 'apply', $plan_path, $receipt_path);
$after_retry = reprint_push_export_snapshot();
$retry_inspect = reprint_push_recovery_smoke_call('inspect after retry', 'inspect', $plan_path, $receipt_path);

echo "REPRINT_PUSH_RECOVERY_PROTOCOL_JSON_BEGIN\\n";
echo json_encode([
    'beforeSnapshot' => $before,
    'failedApply' => $failed_apply,
    'afterFailureSnapshot' => $after_failure,
    'inspect' => $inspect,
    'retryApply' => $retry_apply,
    'afterRetrySnapshot' => $after_retry,
    'retryInspect' => $retry_inspect,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\\n";
echo "REPRINT_PUSH_RECOVERY_PROTOCOL_JSON_END\\n";
`;
}

function writeJson(name, value) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServer(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ];

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  let listenerCheck;
  try {
    await waitForServer(child, baseUrl, logs);
    listenerCheck = assertLocalhostListener(port);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return {
    name,
    port,
    baseUrl,
    child,
    logs,
    summary: {
      name,
      baseUrl,
      port,
      listenerCheck,
      stopped: false,
    },
  };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);

  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
  server.summary.stopped = true;
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await fetch(`${baseUrl}/wp-json/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${logs.join('')}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);

    function onExit() {
      clearTimeout(timer);
      resolve();
    }

    child.once('exit', onExit);
  });
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function assertLocalhostListener(port) {
  const result = spawnSync('ss', ['-H', '-ltn', 'sport', '=', `:${port}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return {
      tool: 'ss',
      status: 'skipped',
      reason: (result.stderr || result.stdout || 'ss command unavailable').trim(),
    };
  }

  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length > 0, `No listener found for Playground port ${port}`);

  for (const line of lines) {
    const fields = line.split(/\s+/);
    const localAddress = fields[3] || '';
    assert.ok(
      localAddress === `127.0.0.1:${port}` || localAddress === `[127.0.0.1]:${port}`,
      `Playground listener must be 127.0.0.1 only, got: ${line}`,
    );
  }

  return {
    tool: 'ss',
    status: 'checked',
    listeners: lines,
  };
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

async function isPortAccepting(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function getLab(server, pathSuffix) {
  return requestJson(server, 'GET', `/wp-json/reprint-push-lab/v1${pathSuffix}`);
}

async function postLab(server, pathSuffix, body, headers = {}) {
  return requestJson(server, 'POST', `/wp-json/reprint-push-lab/v1${pathSuffix}`, body, headers);
}

async function requestJson(server, method, pathname, body = undefined, headers = {}) {
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? headers : {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

async function assertJournalContains(server, event) {
  const response = await getLab(server, '/journal?limit=80');
  assert.equal(response.status, 200);
  const entries = response.body.journal?.entries || [];
  assert.ok(entries.some((entry) => entry.event === event), `journal route missing ${event}`);
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function assertSnapshotContentEqual(actual, expected, label) {
  assert.deepEqual(snapshotContent(actual), snapshotContent(expected), `${label} content mismatch`);
  assert.equal(digest(snapshotContent(actual)), digest(snapshotContent(expected)), `${label} content digest mismatch`);
}

function snapshotContent(snapshot) {
  return {
    meta: {
      source: snapshot.meta.source,
      fixture: snapshot.meta.fixture,
      table_prefix: snapshot.meta.table_prefix,
    },
    ...visibleSurface(snapshot),
  };
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}

function assertReadyPlanResources(plan) {
  const expectedReadyKeys = [
    'file:wp-content/uploads/reprint-push/local-only.txt',
    'file:wp-content/uploads/reprint-push/shared.txt',
    'row:["wp_options","option_name:reprint_push_forms_fixture"]',
    'row:["wp_options","option_name:reprint_push_plugin_payload"]',
    'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_posts","ID:1001"]',
    'row:["wp_posts","ID:2001"]',
  ];
  const readyKeys = plan.mutations.map((mutation) => mutation.resourceKey).sort();
  assert.deepEqual(readyKeys, [...expectedReadyKeys].sort(), 'ready mutations should match fixture-scoped resources');
  assertNoReadyMutation(plan, 'plugin:reprint-push-forms-fixture');
  assertNoReadyMutation(plan, 'row:["wp_reprint_push_forms_lab","id:1"]');
}

function assertNoReadyMutation(plan, resourceKey) {
  assert.ok(
    !plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    `${resourceKey} must remain detection-only in ready plans`,
  );
}

function assertTargetHashes(plan, snapshot, preconditionHashField, label) {
  for (const precondition of plan.preconditions) {
    assert.equal(
      resourceHash(snapshot, precondition.resource),
      precondition[preconditionHashField],
      `${label}: ${precondition.resourceKey}`,
    );
  }
}

function assertFailedLabApply(run, label) {
  assert.notEqual(run.status, 0, `expected ${label} to fail`);
  assert.equal(run.result.ok, false);
  assert.equal(run.result.code, 'LAB_INJECTED_APPLY_FAILURE');
  assert.equal(run.result.applied, 2);
  assert.equal(run.result.labFailAfterMutations, 2);
  assertJournalEvent(run.result, 'recovery-required');
  assertJournalRecentIncludes(run.result, 'apply-failed');
  assertJournalRecentIncludes(run.result, 'recovery-required');
  assertNoJournalEvent(run.result, 'apply-committed');
}

function assertRecoveryInspection(recovery, { state, old, new: newCount, blockedUnknown, label }) {
  assert.equal(recovery?.state, state, `${label} state`);
  assert.equal(recovery.counts.old, old, `${label} old count`);
  assert.equal(recovery.counts.new, newCount, `${label} new count`);
  assert.equal(recovery.counts.blockedUnknown, blockedUnknown, `${label} blocked unknown count`);
  assert.equal(recovery.counts.total, readyPlan.mutations.length, `${label} total count`);
  assert.equal(recovery.targets.length, readyPlan.mutations.length, `${label} target count`);
  assert.deepEqual(
    recovery.targets.map((target) => target.resourceKey).sort(),
    readyPlan.mutations.map((mutation) => mutation.resourceKey).sort(),
    `${label} target resource keys`,
  );

  for (const target of recovery.targets) {
    assert.equal(typeof target.resourceKey, 'string', `${label} target resource key`);
    assert.match(target.expectedOldHash, /^[a-f0-9]{64}$/, `${label} expected old hash`);
    assert.match(target.expectedNewHash, /^[a-f0-9]{64}$/, `${label} expected new hash`);
    assert.match(target.currentHash, /^[a-f0-9]{64}$/, `${label} current hash`);
    assert.ok(['old', 'new', 'blocked-unknown'].includes(target.classification), `${label} classification`);
  }
}

function assertTargetClassificationsMatchSnapshot(plan, snapshot, expectedCounts) {
  const counts = {
    old: 0,
    new: 0,
    blockedUnknown: 0,
  };

  for (const mutation of plan.mutations) {
    const currentHash = resourceHash(snapshot, mutation.resource);
    if (currentHash === mutation.remoteBeforeHash) {
      counts.old += 1;
    } else if (currentHash === mutation.localHash) {
      counts.new += 1;
    } else {
      counts.blockedUnknown += 1;
    }
  }

  assert.deepEqual(counts, expectedCounts, 'target write classification counts');
}

function assertRecoveryEvidenceNoRawValues(recovery, label) {
  const forbiddenKeys = new Set([
    'value',
    'option_value',
    'meta_value',
    'post_content',
    'post_excerpt',
    'post_title',
    'payload',
  ]);

  const forbiddenStrings = [
    'Local edited content',
    'Created locally after pull',
    'local upload content',
    'local-only upload content',
    'local-admin@example.test',
    'ops@example.test',
    'Contact the studio',
    '002-local',
    '2-local',
    '1-local-only',
  ];

  walkRecoveryEvidence(recovery, (key, value) => {
    assert.ok(!forbiddenKeys.has(key), `${label} leaked raw value key ${key}`);
    if (typeof value === 'string') {
      for (const forbidden of forbiddenStrings) {
        assert.ok(!value.includes(forbidden), `${label} leaked raw fixture value ${forbidden}`);
      }
    }
  });
}

function walkRecoveryEvidence(value, visit, key = '') {
  visit(key, value);
  if (Array.isArray(value)) {
    value.forEach((entry) => walkRecoveryEvidence(entry, visit, key));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    walkRecoveryEvidence(childValue, visit, childKey);
  }
}

function assertJournalEvent(result, event) {
  assert.equal(result.journal?.event, event, `expected current journal event ${event}`);
  assert.equal(result.journal?.option, 'reprint_push_protocol_journal');
  assert.ok(Array.isArray(result.journal?.recent), 'missing bounded journal evidence');
  assert.ok(result.journal.recent.length <= 5, 'journal evidence must stay bounded');
  assertJournalRecentIncludes(result, event);
}

function assertJournalRecentIncludes(result, event) {
  assert.ok(
    result.journal?.recent?.some((entry) => entry.event === event),
    `journal recent entries missing ${event}`,
  );
}

function assertNoJournalEvent(result, event) {
  assert.ok(
    !(result.journal?.recent || []).some((entry) => entry.event === event),
    `journal recent entries should not include ${event}`,
  );
}

function journalEvents(result) {
  return (result.journal?.recent || []).map((entry) => entry.event);
}

function recoveryCounts(recovery) {
  return {
    state: recovery.state,
    old: recovery.counts.old,
    new: recovery.counts.new,
    blockedUnknown: recovery.counts.blockedUnknown,
    total: recovery.counts.total,
  };
}

function pushLog(logs, chunk) {
  logs.push(chunk);
  while (logs.join('').length > 20_000) {
    logs.shift();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
