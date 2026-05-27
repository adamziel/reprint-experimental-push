#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildAuthSessionSourceCommand } from './auth-session-source-command.js';
import { releaseVerifyFixtureCredentials } from './release-verify-credentials.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultBrewcommerceDir = '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce';
const brewcommerceDir = process.env.REPRINT_PUSH_BREWCOMMERCE_BLUEPRINT_DIR || defaultBrewcommerceDir;
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const serverStartupTimeoutMs = Number.parseInt(process.env.REPRINT_PUSH_LOCAL_PROD_STARTUP_TIMEOUT_MS || '180000', 10);
const readinessProbeIntervalMs = 1000;
const credentials = releaseVerifyFixtureCredentials;
const fullBrewcommerceImport = process.env.REPRINT_PUSH_LOCAL_PRODUCTION_FULL_BREWCOMMERCE === '1';
const installWooCommerce = fullBrewcommerceImport || process.env.REPRINT_PUSH_LOCAL_PRODUCTION_INSTALL_WOOCOMMERCE === '1';

const siteVariants = Object.freeze([
  {
    key: 'source',
    title: 'Brewcommerce Source Production',
    fixture: 'local-production-source',
    releaseStateMode: 'base',
    releaseStateVersion: 1,
    releaseStateMarker: 'base',
  },
  {
    key: 'remote-changed',
    title: 'Brewcommerce Remote Changed Production',
    fixture: 'local-production-remote-changed',
    releaseStateMode: 'remote-changed',
    releaseStateVersion: 3,
    releaseStateMarker: 'remote-changed',
  },
  {
    key: 'local-edited',
    title: 'Brewcommerce Local Edited Production',
    fixture: 'local-production-local-edited',
    releaseStateMode: 'local-update',
    releaseStateVersion: 2,
    releaseStateMarker: 'local-update',
  },
  {
    key: 'apply-revalidation-source',
    title: 'Brewcommerce Apply Revalidation Source Production',
    fixture: 'local-production-apply-revalidation-source',
    releaseStateMode: 'base',
    releaseStateVersion: 1,
    releaseStateMarker: 'base',
  },
]);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-local-production-release-'));
const servers = [];

try {
  assertBrewcommerceBlueprint(brewcommerceDir);
  const blueprints = siteVariants.map((variant) => writeDerivedBlueprint(variant));
  process.stdout.write(JSON.stringify({
    event: 'local-production-topology-prepared',
    dockerAvailable: false,
    runtime: 'local-playground-wordpress',
    fullBrewcommerceImport,
    installWooCommerce,
    brewcommerceBlueprintDir: brewcommerceDir,
    tempDir,
    sites: blueprints.map(({ variant, blueprintPath }) => ({
      key: variant.key,
      blueprintPath,
      title: variant.title,
    })),
  }, null, 2));
  process.stdout.write('\n');

  for (const item of blueprints) {
    servers.push(await startLocalWordPressSite(item.variant, item.blueprintPath));
  }

  const urls = Object.fromEntries(servers.map((server) => [server.key, server.baseUrl]));
  const authSessionSourceCommand = buildAuthSessionSourceCommand({
    sourceUrl: urls.source,
    username: credentials.username,
    applicationPassword: credentials.applicationPassword,
  });

  process.stdout.write(JSON.stringify({
    event: 'local-production-topology-running',
    source: urls.source,
    remoteChanged: urls['remote-changed'],
    localEdited: urls['local-edited'],
    credentials: {
      username: credentials.username,
      applicationPasswordPresent: true,
    },
    authSessionSourceCommand,
  }, null, 2));
  process.stdout.write('\n');

  const verify = await runReleaseVerifier({
    sourceUrl: urls.source,
    remoteChangedUrl: urls['remote-changed'],
    localUrl: urls['local-edited'],
    applyRevalidationSourceUrl: urls['apply-revalidation-source'],
    authSessionSourceCommand,
  });

  process.stdout.write(JSON.stringify({
    event: 'local-production-release-result',
    status: verify.status,
    signal: verify.signal,
    ok: verify.status === 0,
    stdoutBytes: verify.stdout.length,
    stderrBytes: verify.stderr.length,
  }, null, 2));
  process.stdout.write('\n');
  process.stdout.write(verify.stdout);
  process.stderr.write(verify.stderr);

  process.exitCode = verify.status === 0 ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(servers.map((server) => stopChild(server.child)));
  if (process.env.REPRINT_PUSH_KEEP_LOCAL_PRODUCTION_TOPOLOGY !== '1') {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } else {
    process.stdout.write(`Kept local production topology temp dir: ${tempDir}\n`);
  }
}

function assertBrewcommerceBlueprint(dir) {
  const required = [
    'blueprint.json',
    'content.xml',
    'database.sql',
    'ensure-media.php',
    'theme.zip',
    'uploads.zip',
  ];
  for (const file of required) {
    const fullPath = path.join(dir, file);
    assert.equal(fs.existsSync(fullPath), true, `Missing Brewcommerce blueprint asset: ${fullPath}`);
  }
}

function writeDerivedBlueprint(variant) {
  const targetDir = path.join(tempDir, variant.key);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(brewcommerceDir)) {
    const source = path.join(brewcommerceDir, file);
    const target = path.join(targetDir, file);
    if (fs.statSync(source).isFile()) {
      fs.copyFileSync(source, target);
    }
  }

  const sourceBlueprint = JSON.parse(fs.readFileSync(path.join(brewcommerceDir, 'blueprint.json'), 'utf8'));
  const blueprint = {
    ...sourceBlueprint,
    meta: {
      ...sourceBlueprint.meta,
      title: variant.title,
      description: `${sourceBlueprint.meta?.description || 'Brewcommerce storefront'} Local production-shaped Reprint release site.`,
    },
    steps: [
      ...brewcommerceBaseSteps(sourceBlueprint),
      {
        step: 'setSiteOptions',
        options: {
          blogname: 'Brewcommerce Production',
          reprint_push_fixture: variant.fixture,
          reprint_push_runtime: 'local-production-playground',
        },
      },
      {
        step: 'runPHP',
        code: buildSiteSeedPhp(variant),
      },
    ],
  };

  const blueprintPath = path.join(targetDir, 'blueprint.local-production.json');
  fs.writeFileSync(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
  return { variant, blueprintPath };
}

function brewcommerceBaseSteps(sourceBlueprint) {
  const steps = Array.isArray(sourceBlueprint.steps)
    ? sourceBlueprint.steps.filter((step) => step?.step !== 'login')
    : [];

  if (fullBrewcommerceImport) {
    return steps;
  }

  const base = [
    {
      step: 'setSiteOptions',
      options: {
        blog_public: '1',
        woocommerce_coming_soon: 'no',
        woocommerce_coming_soon_enabled: 'no',
      },
    },
  ];

  if (installWooCommerce) {
    base.splice(1, 0, steps.find((step) => step?.step === 'installPlugin' && step?.pluginData?.slug === 'woocommerce') || {
      step: 'installPlugin',
      pluginData: {
        resource: 'wordpress.org/plugins',
        slug: 'woocommerce',
      },
      options: {
        activate: true,
      },
    });
  }

  return base;
}

function buildSiteSeedPhp(variant) {
  return [
    '<?php',
    "require_once '/wordpress/wp-load.php';",
    'global $wpdb;',
    `$shared_id = wp_insert_post(array('import_id'=>1001,'post_title'=>'Brewcommerce Shared Production Proof','post_name'=>'brewcommerce-shared-proof','post_content'=>'Stable production copy for Brewcommerce push proof.','post_status'=>'publish','post_author'=>0));`,
    "add_post_meta($shared_id, 'reprint_push_fixture', 'shared', true);",
    "update_post_meta($shared_id, '_reprint_push_forms_schema', array('owner'=>'forms','schemaVersion'=>'brewcommerce-production-001','form'=>'coffee-wholesale','required'=>array('email','message','roast'),'fields'=>array(array('key'=>'email','type'=>'email','label'=>'Wholesale email','enabled'=>true),array('key'=>'message','type'=>'textarea','label'=>'Coffee request','enabled'=>true),array('key'=>'roast','type'=>'select','label'=>'Roast profile','enabled'=>true,'choices'=>array('espresso','filter','decaf'))),'notifications'=>array('admin'=>true,'copyToSender'=>true)));",
    "$product_id = wp_insert_post(array('import_id'=>1002,'post_title'=>'Reprint Proof Coffee','post_name'=>'reprint-proof-coffee','post_content'=>'Complex Brewcommerce product used to keep the local production site realistic.','post_status'=>'publish','post_type'=>'product','post_author'=>0));",
    "add_post_meta($product_id, 'reprint_push_fixture', 'product', true);",
    "update_post_meta($product_id, '_sku', 'REPRINT-PROOF-COFFEE');",
    "update_post_meta($product_id, '_regular_price', '21.00');",
    "update_post_meta($product_id, '_price', '21.00');",
    "update_post_meta($product_id, '_stock_status', 'instock');",
    "update_post_meta($product_id, '_manage_stock', 'yes');",
    "update_post_meta($product_id, '_stock', '24');",
    "$dir = WP_CONTENT_DIR . '/uploads/reprint-push';",
    'wp_mkdir_p($dir);',
    "file_put_contents($dir . '/brewcommerce-production.txt', 'Brewcommerce production upload evidence');",
    "update_option('reprint_push_brewcommerce_fixture', array('owner'=>'brewcommerce','revision'=>'production-001','catalog'=>array('coffee','equipment','subscription'),'fulfillment'=>array('pickup'=>true,'shipping'=>true),'marketing'=>array('segments'=>array('espresso','filter','wholesale'))));",
    "$forms_table = $wpdb->prefix . 'reprint_push_forms_lab';",
    "$wpdb->query('CREATE TABLE IF NOT EXISTS ' . $forms_table . ' (id bigint(20) unsigned NOT NULL, form_slug varchar(191) NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (id)) ' . $wpdb->get_charset_collate());",
    "$wpdb->replace($forms_table, array('id'=>1,'form_slug'=>'coffee-wholesale','payload_json'=>wp_json_encode(array('owner'=>'forms','mode'=>'production','version'=>'1','rules'=>array('requireConsent'=>true,'maxAttachments'=>'3'))),'updated_marker'=>'production'), array('%d','%s','%s','%s'));",
    "$release_table = $wpdb->prefix . 'reprint_push_release_state';",
    "$wpdb->query('CREATE TABLE IF NOT EXISTS ' . $release_table . ' (state_id bigint(20) unsigned NOT NULL, payload_json longtext NOT NULL, updated_marker varchar(32) NOT NULL, PRIMARY KEY (state_id)) ' . $wpdb->get_charset_collate());",
    "$release_payload = wp_json_encode(array('owner'=>'reprint-push','mode'=>" + phpString(variant.releaseStateMode) + ",'version'=>" + String(variant.releaseStateVersion) + ",'releaseBoundaryProof'=>'plugin-driver-boundary'));",
    "$wpdb->replace($release_table, array('state_id'=>1,'payload_json'=>$release_payload,'updated_marker'=>" + phpString(variant.releaseStateMarker) + "), array('%d','%s','%s'));",
  ].join(' ');
}

async function startLocalWordPressSite(variant, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--blueprint-may-read-adjacent-files',
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

  process.stdout.write(`Starting ${variant.key} at ${baseUrl}\n`);
  const child = spawn('npx', args, {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      REPRINT_PUSH_LAB_AUTH_BOOTSTRAP: '1',
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.applicationPassword,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(`[${variant.key}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
    process.stderr.write(`[${variant.key}] ${chunk}`);
  });

  await waitForServer(child, baseUrl, () => output, variant.key);
  return { ...variant, baseUrl, child };
}

async function runReleaseVerifier({
  sourceUrl,
  remoteChangedUrl,
  localUrl,
  applyRevalidationSourceUrl,
  authSessionSourceCommand,
}) {
  const child = spawn('npm', ['run', 'verify:release'], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      REPRINT_PUSH_SOURCE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_URL: sourceUrl,
      REPRINT_PUSH_REMOTE_CHANGED_URL: remoteChangedUrl,
      REPRINT_PUSH_LOCAL_URL: localUrl,
      REPRINT_PUSH_APPLY_REVALIDATION_SOURCE_URL: applyRevalidationSourceUrl,
      REPRINT_PUSH_USERNAME: credentials.username,
      REPRINT_PUSH_APPLICATION_PASSWORD: credentials.applicationPassword,
      REPRINT_PUSH_LAB_AUTH_ADMIN_USER: credentials.username,
      REPRINT_PUSH_LAB_AUTH_ADMIN_APP_PASSWORD: credentials.applicationPassword,
      REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND: authSessionSourceCommand,
      REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1',
      REPRINT_PUSH_REQUIRE_PRODUCTION_DURABLE_JOURNAL: '1',
      REPRINT_PUSH_SIMULATE_PRESERVED_REMOTE_RETRY_PATH: '/snapshot',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    process.stdout.write(`[verify] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    process.stderr.write(`[verify] ${chunk}`);
  });

  return new Promise((resolve) => {
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function waitForServer(child, baseUrl, getOutput, label) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < serverStartupTimeoutMs) {
    assert.equal(child.exitCode, null, `${label} exited before readiness\n${getOutput()}`);
    try {
      const response = await fetchWithTimeout(`${baseUrl}/wp-json/reprint/v1`, 10000);
      const body = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = null;
      }
      if (response.status === 200 && payload?.routes?.['/reprint/v1/push/preflight']) {
        process.stdout.write(`${label} ready at ${baseUrl}\n`);
        return;
      }
      lastError = new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, readinessProbeIntervalMs));
  }
  throw new Error(`${label} did not become ready at ${baseUrl}: ${lastError?.message || 'unknown'}\n${getOutput()}`);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function findLocalPort() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 39000 + Math.floor(Math.random() * 20000);
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error('Unable to find a free local port');
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.once('listening', () => socket.close(() => resolve(true)));
    socket.listen(port, '127.0.0.1');
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
      resolve();
    }, 5000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
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

function phpString(value) {
  return `'${phpEscaped(value)}'`;
}

function phpEscaped(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
