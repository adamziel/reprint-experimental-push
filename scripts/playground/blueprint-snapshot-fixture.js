import fs from 'node:fs';
import path from 'node:path';

export function resolveBlueprintSnapshotFixturePath(blueprintPath) {
  return path.resolve(
    path.dirname(blueprintPath),
    path.basename(blueprintPath).replace(/\.blueprint\.json$/u, '.snapshot.json'),
  );
}

export function loadBlueprintSnapshotFixture(expectedFixture, blueprintPath) {
  const fixturePath = resolveBlueprintSnapshotFixturePath(blueprintPath);
  if (!fs.existsSync(fixturePath)) {
    return null;
  }

  const snapshot = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (expectedFixture && snapshot?.meta?.fixture !== expectedFixture) {
    throw new Error(
      `Snapshot fixture ${path.basename(fixturePath)} expected meta.fixture=${expectedFixture} but found ${snapshot?.meta?.fixture || 'missing'}`,
    );
  }
  return snapshot;
}
