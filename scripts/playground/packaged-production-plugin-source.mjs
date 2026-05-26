import path from 'node:path';

export function packagedProductionPluginSource(repoRoot) {
  const pluginRelativePath = 'plugins/reprint-push/reprint-push.php';
  return {
    plugin: pluginRelativePath,
    pluginPath: path.join(repoRoot, pluginRelativePath),
    packageSource: 'packaged-production-plugin',
    sourceCommand: [
      'plugins/reprint-push/reprint-push.php',
      'REPRINT_PUSH_DISABLE_LAB_ROUTES=1',
      'REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP=1',
    ].join(' '),
  };
}
