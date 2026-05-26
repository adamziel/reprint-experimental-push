import assert from 'node:assert/strict';
import test from 'node:test';
import { productionPluginPackageSource } from '../src/authenticated-http-push-client.js';

test('production plugin package source exposes the packaged production boundary', () => {
  const source = productionPluginPackageSource({
    copiedFiles: [
      'snapshot-lib.php',
      'push-db-journal-lib.php',
      'push-remote-lib.php',
      'push-remote-rest-plugin.php',
    ],
  });

  assert.deepEqual(source, {
    plugin: 'reprint-push/reprint-push.php',
    mountedAs: '/wordpress/wp-content/plugins/reprint-push',
    sourceCommand: 'npm run test:playground:production-plugin-package',
    copiedFiles: [
      'push-db-journal-lib.php',
      'push-remote-lib.php',
      'push-remote-rest-plugin.php',
      'snapshot-lib.php',
    ],
    labRoutesDisabled: true,
    authBootstrapDisabled: true,
  });
});
