import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSourcePath = path.join(repoRoot, 'scripts/playground/push-remote-rest-plugin.php');
const journalSourcePath = path.join(repoRoot, 'scripts/playground/push-db-journal-lib.php');
const routeSource = readFileSync(routeSourcePath, 'utf8');
const journalSource = readFileSync(journalSourcePath, 'utf8');

function functionBody(source, name) {
  const declaration = `function ${name}(`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing body for ${declaration}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  assert.fail(`unterminated body for ${declaration}`);
}

function routeRegistration(namespace, route) {
  const startNeedle = `register_rest_route(${namespace}, '${route}', [`;
  const start = routeSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing route registration ${namespace} ${route}`);
  const end = routeSource.indexOf('    ]);', start);
  assert.notEqual(end, -1, `missing end for route registration ${namespace} ${route}`);
  return routeSource.slice(start, end + '    ]);'.length);
}

test('RPP-0520 production audit event schema route is authenticated and production-shaped', () => {
  const productionRoute = routeRegistration(
    'REPRINT_PUSH_PRODUCTION_SHAPED_REST_NAMESPACE',
    '/push/db-journal/schema',
  );
  assert.match(productionRoute, /'methods'\s*=>\s*WP_REST_Server::READABLE/);
  assert.match(productionRoute, /'callback'\s*=>\s*'reprint_push_lab_rest_db_journal_schema'/);
  assert.match(productionRoute, /'permission_callback'\s*=>\s*'reprint_push_lab_rest_authenticated_permission'/);

  const schemaCallback = functionBody(routeSource, 'reprint_push_lab_rest_db_journal_schema');
  assert.match(schemaCallback, /\$audit_event_schema\s*=\s*reprint_push_lab_rest_production_audit_event_schema\(\$request\)/);
  assert.match(schemaCallback, /\$db_journal_schema\['auditEventSchema'\]\s*=\s*\$audit_event_schema/);
  assert.match(schemaCallback, /'auditEventSchema'\s*=>\s*\$audit_event_schema/);
});

test('RPP-0520 production DB journal readback carries audit event schema in the verifier summary path', () => {
  const dbJournalCallback = functionBody(routeSource, 'reprint_push_lab_rest_db_journal');
  assert.match(
    dbJournalCallback,
    /\$db_journal\['auditEventSchema'\]\s*=\s*reprint_push_lab_rest_production_audit_event_schema\(\$request\)/,
  );

  const publicRow = functionBody(journalSource, 'reprint_push_lab_db_journal_public_row');
  assert.match(publicRow, /'schemaVersion'\s*=>\s*1/);
});

test('RPP-0520 production audit event schema is hash-only and excludes credential material', () => {
  const auditSchema = functionBody(routeSource, 'reprint_push_lab_rest_production_audit_event_schema');

  assert.match(auditSchema, /'schemaVersion'\s*=>\s*1/);
  assert.match(auditSchema, /'schemaId'\s*=>\s*'reprint-push-production-audit-event\/v1'/);
  assert.match(auditSchema, /'routeEvidence'\s*=>\s*\[/);
  assert.match(auditSchema, /'routeProfile'\s*=>\s*\(string\) \(\$profile\['profile'\]/);
  assert.match(auditSchema, /'restNamespace'\s*=>\s*\(string\) \(\$profile\['restNamespace'\]/);
  assert.match(auditSchema, /'journalRoute'\s*=>\s*reprint_push_lab_rest_profile_route\(\$request, '\/db-journal'\)/);
  assert.match(auditSchema, /'schemaRoute'\s*=>\s*reprint_push_lab_rest_profile_route\(\$request, '\/db-journal\/schema'\)/);
  assert.match(auditSchema, /'eventStore'\s*=>\s*\[/);
  assert.match(auditSchema, /'appendOnlyEvents'\s*=>\s*true/);
  assert.match(auditSchema, /'sequenceField'\s*=>\s*'sequence'/);
  assert.match(auditSchema, /'eventShape'\s*=>\s*\[/);
  assert.match(auditSchema, /'resourceHashEvidence'/);
  assert.match(auditSchema, /'redaction'\s*=>\s*\[/);
  assert.match(auditSchema, /'format'\s*=>\s*'hash-only'/);
  assert.match(auditSchema, /'rawValuesIncluded'\s*=>\s*false/);
  assert.match(auditSchema, /'hashAlgorithm'\s*=>\s*'sha256'/);

  for (const field of ['value', 'content', 'payload', 'post_content', 'option_value', 'meta_value']) {
    assert.match(auditSchema, new RegExp(`'${field}'`), `missing forbidden raw field ${field}`);
  }

  assert.doesNotMatch(auditSchema, /Authorization|Basic|applicationPassword|password|credentialHash|signingKey/i);
});
