import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

for (const scriptName of [
  'production-shaped-live-topology-proof.mjs',
  'production-shaped-live-protocol-proof.mjs',
]) {
  test(`${scriptName} tolerates startup-shaped index readiness while probing snapshots`, () => {
    const source = readFileSync(
      path.join(repoRoot, 'scripts/playground', scriptName),
      'utf8',
    );

    assert.match(source, /labMaxConsecutiveNotReadyProbes/);
    assert.match(source, /labNotReadyProbeLimitReached/);
    assert.match(
      source,
      /const maxReadinessProbes = Math\.max\(10, Math\.ceil\(serverStartupTimeoutMs \/ readinessProbeIntervalMs\)\);/,
    );
    assert.match(
      source,
      /const maxNotReadyReadinessProbes = Math\.max\(labMaxConsecutiveNotReadyProbes, maxReadinessProbes\);/,
    );
    assert.match(source, /let notReadyProbeCount = 0;/);
    assert.match(source, /let readinessProbeCount = 0;/);
    assert.match(source, /readinessProbeCount \+= 1;/);
    assert.match(source, /const readinessRetryable = labReadinessBodyRetryable\(response\.status, responseBody\);/);
    assert.match(source, /if \(response\.status === 200 && !readinessRetryable\) \{/);
    assert.match(
      source,
      /if \(readinessRetryable\) \{[\s\S]*?fetchTextWithTimeout\(`\$\{baseUrl\}\/wp-json\/reprint-push-lab\/v1\/snapshot`/s,
    );
    assert.match(
      source,
      /if \(labSnapshotReady\(\{[\s\S]*?\}\)\) \{\s*return;\s*\}/s,
    );
    assert.match(
      source,
      /if \(labNotReadyProbeLimitReached\(notReadyProbeCount, maxNotReadyReadinessProbes\)\)/,
    );
  });
}
