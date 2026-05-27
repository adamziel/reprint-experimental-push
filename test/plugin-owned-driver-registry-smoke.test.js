import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeScript = path.join(repoRoot, 'scripts/playground/plugin-owned-driver-registry-smoke.mjs');
const smokeSource = fs.readFileSync(smokeScript, 'utf8');

test('plugin-owned driver registry smoke includes whitespace-only registry guard fixtures', () => {
  assert.match(smokeSource, /whitespaceDriverNameBlueprintPath/);
  assert.match(smokeSource, /whitespacePluginOwnerBlueprintPath/);
  assert.match(smokeSource, /whitespaceTableBlueprintPath/);
  assert.match(smokeSource, /whitespaceDriverName: true/);
  assert.match(smokeSource, /whitespacePluginOwner: true/);
  assert.match(smokeSource, /whitespaceTable: true/);
  assert.match(smokeSource, /whitespaceDriverNameGuard: whitespaceDriverNameExport\.error\?\.class/);
  assert.match(smokeSource, /whitespacePluginOwnerGuard: whitespacePluginOwnerExport\.error\?\.class/);
  assert.match(smokeSource, /whitespaceTableGuard: whitespaceTableExport\.error\?\.class/);
});

test('plugin-owned driver registry smoke bounds registry-only scope separately from full apply coverage', () => {
  assert.match(smokeSource, /const smokeScope = process\.env\.REPRINT_PUSH_PLUGIN_DRIVER_REGISTRY_SMOKE_SCOPE\?\.trim\(\) \|\| 'full';/);
  assert.match(smokeSource, /if \(!\['full', 'registry-guards'\]\.includes\(smokeScope\)\)/);
  assert.match(smokeSource, /Unknown plugin-owned driver registry smoke scope: \$\{smokeScope\}/);
  assert.match(smokeSource, /if \(smokeScope === 'full'\) \{/);
  assert.match(smokeSource, /let planStatus = 'skipped';/);
  assert.match(smokeSource, /let updateVerified = \[];/);
  assert.match(smokeSource, /let deleteVerified = \[];/);
  assert.match(smokeSource, /let appliedMutations = 0;/);
});

test('plugin-owned driver registry smoke summary reports scope and bounded apply state', () => {
  assert.match(smokeSource, /console\.log\(JSON\.stringify\(\{/);
  assert.match(smokeSource, /scope: smokeScope,/);
  assert.match(smokeSource, /status: planStatus,/);
  assert.match(smokeSource, /applied: appliedMutations,/);
  assert.match(smokeSource, /updateVerified,/);
  assert.match(smokeSource, /deleteVerified,/);
  assert.match(smokeSource, /missingExportRowsGuard: missingExportRowsExport\.error\?\.class,/);
  assert.match(smokeSource, /duplicateTableGuard: duplicateTableExport\.error\?\.class,/);
});
