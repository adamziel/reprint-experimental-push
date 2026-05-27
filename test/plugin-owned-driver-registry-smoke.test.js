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
