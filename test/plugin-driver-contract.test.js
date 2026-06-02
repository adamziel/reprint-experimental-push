import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  normalizePluginOwnedRowDriverMergePolicy,
  normalizePluginOwnedRowDriverReferenceFields,
  normalizePluginOwnedRowDriverRowSchema,
  pluginOwnedRowDriverContractValidationEvidenceHash,
  pluginOwnedRowDriverContractHash,
} from '../src/plugin-driver-contracts.js';
import { validatePluginOwnedDriverPayload } from '../src/plugin-driver-validators.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms base plugin file */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'remote-preserved-contract' },
          __pluginOwner: 'forms',
        },
      },
    },
  };
}

function addStablePost(site, id, title = `plugin reference target ${id}`) {
  site.db ||= {};
  site.db.wp_posts ||= {};
  site.db.wp_posts[`ID:${id}`] = {
    ID: id,
    post_type: 'post',
    post_title: title,
    post_name: `plugin-reference-target-${id}`,
    post_parent: 0,
    post_author: 0,
    guid: `urn:reprint-plugin-reference-target:${id}`,
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function explicitContract(extra = {}) {
  return {
    contractVersion: 1,
    contractKind: 'plugin-owned-row-driver',
    resourceKey: formsOptionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    table: 'wp_options',
    supportsDelete: false,
    ...extra,
  };
}

function explicitCustomTableContract(extra = {}) {
  return {
    contractVersion: 1,
    contractKind: 'plugin-owned-row-driver',
    resourceKey: 'row:["wp_forms_contract_rows","entry_id:7"]',
    pluginOwner: 'forms',
    driver: 'forms-contract-row',
    table: 'wp_forms_contract_rows',
    supportsDelete: false,
    ...extra,
  };
}

function explicitPostmetaContract(extra = {}) {
  return {
    contractVersion: 1,
    contractKind: 'plugin-owned-row-driver',
    resourceKey: 'row:["wp_postmeta","post_id:1001:meta_key:_forms:schema"]',
    pluginOwner: 'forms',
    driver: 'wp-postmeta',
    table: 'wp_postmeta',
    supportsDelete: false,
    ...extra,
  };
}

function schemaBoundCustomTableContract(extra = {}) {
  return explicitCustomTableContract({
    rowSchema: {
      required: ['entry_id', 'payload', 'updated_marker', '__pluginOwner'],
      fields: {
        entry_id: 'integer',
        payload: 'object',
        updated_marker: 'string',
        __pluginOwner: 'string',
      },
    },
    ...extra,
  });
}

function nestedSchemaBoundCustomTableContract(extra = {}) {
  return explicitCustomTableContract({
    rowSchema: {
      required: ['entry_id', 'payload', 'updated_marker', '__pluginOwner'],
      fields: {
        entry_id: 'integer',
        payload: {
          type: 'object',
          required: ['mode', 'version'],
          additionalProperties: false,
          properties: {
            mode: 'string',
            version: 'integer',
          },
        },
        updated_marker: 'string',
        __pluginOwner: 'string',
      },
    },
    ...extra,
  });
}

function constrainedSchemaBoundCustomTableContract(extra = {}) {
  return explicitCustomTableContract({
    rowSchema: {
      required: ['entry_id', 'payload', 'updated_marker', '__pluginOwner'],
      fields: {
        entry_id: 'integer',
        payload: {
          type: 'object',
          required: ['mode', 'version'],
          additionalProperties: false,
          properties: {
            mode: {
              type: 'string',
              enum: ['local-constraint', 'local-constraint-alt'],
            },
            version: {
              type: 'integer',
              const: 2,
            },
          },
        },
        updated_marker: {
          type: 'string',
          const: 'local',
        },
        __pluginOwner: 'string',
      },
    },
    ...extra,
  });
}

function referenceBoundCustomTableContract(extra = {}) {
  return explicitCustomTableContract({
    rowSchema: {
      required: ['entry_id', 'payload', 'updated_marker', '__pluginOwner'],
      fields: {
        entry_id: 'integer',
        payload: 'object',
        updated_marker: 'string',
        __pluginOwner: 'string',
      },
    },
    referenceFields: {
      fields: [
        {
          path: 'payload.post_id',
          targetTable: 'wp_posts',
          targetIdField: 'ID',
          required: true,
        },
      ],
    },
    ...extra,
  });
}

function optionalReferenceBoundCustomTableContract(extra = {}) {
  return referenceBoundCustomTableContract({
    referenceFields: {
      fields: [
        {
          path: 'payload.post_id',
          targetTable: 'wp_posts',
          targetIdField: 'ID',
          required: false,
        },
      ],
    },
    ...extra,
  });
}

const normalizedCustomTableRowSchema = Object.freeze({
  schemaVersion: 1,
  fields: [
    { field: '__pluginOwner', type: 'string', required: true },
    { field: 'entry_id', type: 'integer', required: true },
    { field: 'payload', type: 'object', required: true },
    { field: 'updated_marker', type: 'string', required: true },
  ],
});

const normalizedNestedCustomTableRowSchema = Object.freeze({
  schemaVersion: 1,
  fields: [
    { field: '__pluginOwner', type: 'string', required: true },
    { field: 'entry_id', type: 'integer', required: true },
    {
      field: 'payload',
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: [
        { field: 'mode', type: 'string', required: true },
        { field: 'version', type: 'integer', required: true },
      ],
    },
    { field: 'updated_marker', type: 'string', required: true },
  ],
});

const constrainedModeEnumHashes = Object.freeze(
  ['local-constraint', 'local-constraint-alt'].map((value) => digest(value)).sort(),
);
const normalizedConstrainedCustomTableRowSchema = Object.freeze({
  schemaVersion: 1,
  fields: [
    { field: '__pluginOwner', type: 'string', required: true },
    { field: 'entry_id', type: 'integer', required: true },
    {
      field: 'payload',
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: [
        {
          field: 'mode',
          type: 'string',
          required: true,
          enumHashes: constrainedModeEnumHashes,
        },
        {
          field: 'version',
          type: 'integer',
          required: true,
          constHash: digest(2),
        },
      ],
    },
    {
      field: 'updated_marker',
      type: 'string',
      required: true,
      constHash: digest('local'),
    },
  ],
});

const normalizedRefuseOnConflictMergePolicy = Object.freeze({
  schemaVersion: 1,
  strategy: 'refuse-on-conflict',
  conflictResolution: 'preserve-remote-and-stop',
  rawValuesIncluded: false,
});

const normalizedReferenceFields = Object.freeze({
  schemaVersion: 1,
  fields: [
    {
      path: 'payload.post_id',
      targetTable: 'wp_posts',
      targetIdField: 'ID',
      scalarType: 'positive-integer',
      required: true,
    },
  ],
  rawValuesIncluded: false,
});

const normalizedOptionalReferenceFields = Object.freeze({
  schemaVersion: 1,
  fields: [
    {
      path: 'payload.post_id',
      targetTable: 'wp_posts',
      targetIdField: 'ID',
      scalarType: 'positive-integer',
      required: false,
    },
  ],
  rawValuesIncluded: false,
});

test('legacy object row schema normalization and contract hash remain stable', () => {
  const objectSchemaContract = schemaBoundCustomTableContract();
  const normalizedSchemaContract = schemaBoundCustomTableContract({
    rowSchema: normalizedCustomTableRowSchema,
  });

  assert.deepEqual(
    normalizePluginOwnedRowDriverRowSchema(objectSchemaContract.rowSchema).normalized,
    normalizedCustomTableRowSchema,
  );
  assert.deepEqual(
    normalizePluginOwnedRowDriverRowSchema(normalizedCustomTableRowSchema).normalized,
    normalizedCustomTableRowSchema,
  );
  assert.equal(
    pluginOwnedRowDriverContractHash(objectSchemaContract),
    pluginOwnedRowDriverContractHash(normalizedSchemaContract),
  );
  assert.equal(JSON.stringify(normalizedCustomTableRowSchema).includes('properties'), false);
  assert.equal(JSON.stringify(normalizedCustomTableRowSchema).includes('additionalProperties'), false);
});

test('nested row schema normalization is stable across object form, normalized form, and field order', () => {
  const objectSchemaContract = nestedSchemaBoundCustomTableContract();
  const normalizedSchemaContract = nestedSchemaBoundCustomTableContract({
    rowSchema: normalizedNestedCustomTableRowSchema,
  });
  const reorderedSchemaContract = nestedSchemaBoundCustomTableContract({
    rowSchema: {
      required: ['updated_marker', 'payload', '__pluginOwner', 'entry_id', 'payload'],
      fields: {
        updated_marker: 'string',
        payload: {
          type: 'object',
          required: ['version', 'mode', 'mode'],
          additionalProperties: false,
          properties: {
            version: 'integer',
            mode: 'string',
          },
        },
        __pluginOwner: 'string',
        entry_id: 'integer',
      },
    },
  });

  assert.deepEqual(
    normalizePluginOwnedRowDriverRowSchema(objectSchemaContract.rowSchema).normalized,
    normalizedNestedCustomTableRowSchema,
  );
  assert.deepEqual(
    normalizePluginOwnedRowDriverRowSchema(normalizedNestedCustomTableRowSchema).normalized,
    normalizedNestedCustomTableRowSchema,
  );
  assert.equal(
    pluginOwnedRowDriverContractHash(objectSchemaContract),
    pluginOwnedRowDriverContractHash(normalizedSchemaContract),
  );
  assert.equal(
    pluginOwnedRowDriverContractHash(objectSchemaContract),
    pluginOwnedRowDriverContractHash(reorderedSchemaContract),
  );
});

test('nested additionalProperties contracts must be enforceable object schemas', () => {
  assert.equal(
    normalizePluginOwnedRowDriverRowSchema({
      fields: {
        payload: {
          type: 'string',
          additionalProperties: false,
          properties: {
            mode: 'string',
          },
        },
      },
    }).valid,
    false,
  );
  assert.equal(
    normalizePluginOwnedRowDriverRowSchema({
      fields: {
        payload: {
          type: 'object',
          additionalProperties: false,
        },
      },
    }).valid,
    false,
  );
});

test('schema constraint normalization stores hashes and preserves hash-form contract compatibility', () => {
  const rawConstraintContract = constrainedSchemaBoundCustomTableContract();
  const hashConstraintContract = constrainedSchemaBoundCustomTableContract({
    rowSchema: normalizedConstrainedCustomTableRowSchema,
  });
  const normalized = normalizePluginOwnedRowDriverRowSchema(rawConstraintContract.rowSchema).normalized;

  assert.deepEqual(normalized, normalizedConstrainedCustomTableRowSchema);
  assert.equal(
    pluginOwnedRowDriverContractHash(rawConstraintContract),
    pluginOwnedRowDriverContractHash(hashConstraintContract),
  );
  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes('local-constraint'), false);
  assert.equal(serialized.includes('local-constraint-alt'), false);
  assert.equal(serialized.includes('"local"'), false);
});

test('plugin row driver merge policy normalization is hash-bound and conservative', () => {
  const stringPolicyContract = explicitCustomTableContract({
    mergePolicy: 'refuse-on-conflict',
  });
  const objectPolicyContract = explicitCustomTableContract({
    mergePolicy: {
      strategy: 'refuse-on-conflict',
      rawValuesIncluded: false,
    },
  });
  const unsupportedPolicy = normalizePluginOwnedRowDriverMergePolicy({
    strategy: 'last-write-wins',
  });
  const rawPolicy = normalizePluginOwnedRowDriverMergePolicy({
    strategy: 'refuse-on-conflict',
    rawValuesIncluded: true,
  });

  assert.deepEqual(
    normalizePluginOwnedRowDriverMergePolicy('refuse-on-conflict').normalized,
    normalizedRefuseOnConflictMergePolicy,
  );
  assert.equal(
    pluginOwnedRowDriverContractHash(stringPolicyContract),
    pluginOwnedRowDriverContractHash(objectPolicyContract),
  );
  assert.notEqual(
    pluginOwnedRowDriverContractHash(stringPolicyContract),
    pluginOwnedRowDriverContractHash(explicitCustomTableContract()),
  );
  assert.equal(unsupportedPolicy.valid, false);
  assert.equal(unsupportedPolicy.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_MERGE_POLICY');
  assert.equal(unsupportedPolicy.observed, 'unsupported-strategy');
  assert.equal(rawPolicy.valid, false);
  assert.equal(rawPolicy.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MERGE_POLICY_RAW_VALUES_INCLUDED');
});

test('plugin row driver reference fields are hash-bound and conservative', () => {
  const objectReferenceContract = referenceBoundCustomTableContract();
  const normalizedReferenceContract = referenceBoundCustomTableContract({
    referenceFields: normalizedReferenceFields,
  });
  const reorderedReferenceContract = referenceBoundCustomTableContract({
    referenceFields: {
      rawValuesIncluded: false,
      fields: [
        {
          targetIdField: 'ID',
          required: true,
          targetTable: 'wp_posts',
          path: 'payload.post_id',
        },
      ],
    },
  });
  const unsupportedType = normalizePluginOwnedRowDriverReferenceFields({
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
        scalarType: 'uuid',
      },
    ],
  });
  const rawReferences = normalizePluginOwnedRowDriverReferenceFields({
    rawValuesIncluded: true,
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
      },
    ],
  });

  assert.deepEqual(
    normalizePluginOwnedRowDriverReferenceFields(objectReferenceContract.referenceFields).normalized,
    normalizedReferenceFields,
  );
  assert.deepEqual(
    normalizePluginOwnedRowDriverReferenceFields(normalizedReferenceFields).normalized,
    normalizedReferenceFields,
  );
  assert.equal(
    pluginOwnedRowDriverContractHash(objectReferenceContract),
    pluginOwnedRowDriverContractHash(normalizedReferenceContract),
  );
  assert.equal(
    pluginOwnedRowDriverContractHash(objectReferenceContract),
    pluginOwnedRowDriverContractHash(reorderedReferenceContract),
  );
  assert.equal(unsupportedType.valid, false);
  assert.equal(unsupportedType.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_REFERENCE_FIELD_TYPE');
  assert.equal(rawReferences.valid, false);
  assert.equal(rawReferences.reasonCode, 'PLUGIN_DRIVER_CONTRACT_REFERENCE_FIELDS_RAW_VALUES_INCLUDED');
});

test('invalid schema constraints fail closed before becoming contracts', () => {
  const invalidSchemas = [
    {
      fields: {
        payload: {
          type: 'object',
          const: {},
        },
      },
    },
    {
      fields: {
        mode: {
          type: 'string',
          enum: ['accepted', 1],
        },
      },
    },
    {
      fields: {
        mode: {
          type: 'string',
          const: 'accepted',
          enum: ['accepted'],
        },
      },
    },
    {
      fields: {
        mode: {
          type: 'string',
          constHash: 'not-a-sha256',
        },
      },
    },
  ];

  for (const rowSchema of invalidSchemas) {
    assert.equal(normalizePluginOwnedRowDriverRowSchema(rowSchema).valid, false);
  }
});

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

test('explicit plugin-owned row driver contract carries accepted proof into the mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-accepted';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify(contractEvidence);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(contractEvidence.schemaVersion, 1);
  assert.equal(contractEvidence.operation, 'plugin-driver-contract-validation');
  assert.equal(contractEvidence.contractKind, 'plugin-owned-row-driver');
  assert.equal(contractEvidence.contractVersion, 1);
  assert.equal(contractEvidence.outcome, 'accepted');
  assert.equal(contractEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_ACCEPTED');
  assert.deepEqual(contractEvidence.issueCodes, []);
  assert.equal(contractEvidence.rawValuesIncluded, false);
  assert.equal(contractEvidence.resourceKey, formsOptionResourceKey);
  assert.equal(contractEvidence.pluginOwner, 'forms');
  assert.equal(contractEvidence.driver, 'wp-option');
  assert.equal(contractEvidence.table, 'wp_options');
  assert.match(contractEvidence.contractHash, /^[a-f0-9]{64}$/);
  assert.match(auditEvidence.contractValidationHash, /^[a-f0-9]{64}$/);
  assert.equal(evidenceJson.includes('local-contract-accepted'), false);
  assert.equal(evidenceJson.includes('remote-preserved-contract'), false);
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-contract-accepted');
});

test('explicit custom row driver contract carries contract-bound validator evidence through apply', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-custom', secret: 'base-contract-custom-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-custom';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-custom-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify({
    mutation: mutation.pluginOwnedResource,
    journal: result.journal,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.pluginOwnedResource.driver, 'forms-contract-row');
  assert.equal(mutation.pluginOwnedResource.table, 'wp_forms_contract_rows');
  assert.equal(payloadEvidence.operation, 'plugin-driver-payload-validation');
  assert.equal(payloadEvidence.validator, 'contract-bound-row-driver');
  assert.equal(payloadEvidence.outcome, 'accepted');
  assert.equal(payloadEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED');
  assert.equal(payloadEvidence.rawValuesIncluded, false);
  assert.equal(payloadEvidence.resourceKey, resourceKey);
  assert.equal(payloadEvidence.pluginOwner, 'forms');
  assert.equal(payloadEvidence.driver, 'forms-contract-row');
  assert.equal(payloadEvidence.table, 'wp_forms_contract_rows');
  assert.equal(payloadEvidence.contractHash, mutation.pluginOwnedResource.contractValidationEvidence.contractHash);
  assert.deepEqual(payloadEvidence.rowIdentity, {
    resourceId: 'entry_id:7',
    status: 'matched',
    fields: [
      {
        field: 'entry_id',
        expected: '7',
        observedHash: digest('7'),
        matched: true,
      },
    ],
  });
  assert.match(payloadEvidence.value.hash, /^[a-f0-9]{64}$/);
  assert.match(payloadEvidence.contractValidationHash, /^[a-f0-9]{64}$/);
  assert.equal(
    payloadEvidence.contractValidationHash,
    pluginOwnedRowDriverContractValidationEvidenceHash(
      mutation.pluginOwnedResource.contractValidationEvidence,
    ),
  );
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_forms_contract_rows['entry_id:7'].payload.mode, 'local-contract-custom');
  assert.equal(evidenceJson.includes('base-contract-custom-secret'), false);
  assert.equal(evidenceJson.includes('local-contract-custom-secret'), false);
});

test('contract-bound wp_postmeta row driver matches compound post_id and meta_key row ids', () => {
  const resourceKey = 'row:["wp_postmeta","post_id:1001:meta_key:_forms:schema"]';
  const base = baseSite();
  base.db.wp_posts = {
    'ID:1001': {
      ID: 1001,
      post_title: 'Forms postmeta contract fixture',
      post_status: 'publish',
      post_type: 'post',
    },
  };
  base.db.wp_postmeta = {
    'post_id:1001:meta_key:_forms:schema': {
      post_id: 1001,
      meta_key: '_forms:schema',
      meta_value: { mode: 'base-postmeta-contract', secret: 'base-postmeta-contract-secret' },
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_postmeta['post_id:1001:meta_key:_forms:schema'].meta_value.mode = 'local-postmeta-contract';
  local.db.wp_postmeta['post_id:1001:meta_key:_forms:schema'].meta_value.secret =
    'local-postmeta-contract-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitPostmetaContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const evidenceJson = JSON.stringify(payloadEvidence);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(payloadEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED');
  assert.deepEqual(payloadEvidence.rowIdentity, {
    resourceId: 'post_id:1001:meta_key:_forms:schema',
    status: 'matched',
    fields: [
      {
        field: 'post_id',
        expected: '1001',
        observedHash: digest('1001'),
        matched: true,
      },
      {
        field: 'meta_key',
        expected: '_forms:schema',
        observedHash: digest('_forms:schema'),
        matched: true,
      },
    ],
  });
  assert.equal(evidenceJson.includes('base-postmeta-contract-secret'), false);
  assert.equal(evidenceJson.includes('local-postmeta-contract-secret'), false);
});

test('reference-bound custom row driver carries hash-only reference evidence through apply', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-contract', secret: 'base-reference-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  addStablePost(base, 2);
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-contract';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const targetEvidence = mutation.pluginOwnedResource.referenceTargetValidationEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify({
    mutation: mutation.pluginOwnedResource,
    journal: result.journal,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(contractEvidence.referenceFields, normalizedReferenceFields);
  assert.equal(
    contractEvidence.contractHash,
    pluginOwnedRowDriverContractHash(contractEvidence),
  );
  assert.deepEqual(payloadEvidence.referenceValidation, {
    referenceFieldsHash: digest(normalizedReferenceFields),
    status: 'matched',
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
        scalarType: 'positive-integer',
        required: true,
        state: 'present',
        observedType: 'integer',
        observedHash: digest('2'),
        targetResourceKey: 'row:["wp_posts","ID:2"]',
        matched: true,
      },
    ],
  });
  assert.equal(
    payloadEvidence.contractValidationHash,
    pluginOwnedRowDriverContractValidationEvidenceHash(contractEvidence),
  );
  assert.equal(targetEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED');
  assert.equal(targetEvidence.outcome, 'accepted');
  assert.equal(targetEvidence.rawValuesIncluded, false);
  assert.equal(targetEvidence.fields[0].path, 'payload.post_id');
  assert.equal(targetEvidence.fields[0].targetResourceKey, 'row:["wp_posts","ID:2"]');
  assert.equal(targetEvidence.fields[0].targetStable, true);
  assert.equal(targetEvidence.fields[0].targetRemotePresent, true);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_forms_contract_rows['entry_id:7'].payload.mode, 'local-reference-contract');
  assert.equal(evidenceJson.includes('base-reference-secret'), false);
  assert.equal(evidenceJson.includes('local-reference-secret'), false);
});

test('optional reference-bound custom row driver accepts missing reference targets as not required', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-optional-reference', secret: 'base-optional-reference-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-optional-reference';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-optional-reference-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(optionalReferenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const targetEvidence = mutation.pluginOwnedResource.referenceTargetValidationEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify({
    mutation: mutation.pluginOwnedResource,
    journal: result.journal,
  });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(contractEvidence.referenceFields, normalizedOptionalReferenceFields);
  assert.deepEqual(payloadEvidence.referenceValidation, {
    referenceFieldsHash: digest(normalizedOptionalReferenceFields),
    status: 'matched',
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
        scalarType: 'positive-integer',
        required: false,
        state: 'missing',
        observedType: null,
        matched: true,
      },
    ],
  });
  assert.equal(targetEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED');
  assert.equal(targetEvidence.outcome, 'accepted');
  assert.equal(targetEvidence.rawValuesIncluded, false);
  assert.deepEqual(targetEvidence.fields[0], {
    path: 'payload.post_id',
    targetTable: 'wp_posts',
    targetIdField: 'ID',
    scalarType: 'positive-integer',
    required: false,
    state: 'missing',
    observedType: null,
    observedHash: null,
    targetResourceKey: null,
    targetStable: true,
    reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_NOT_REQUIRED',
  });
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_forms_contract_rows['entry_id:7'].payload.mode, 'local-optional-reference');
  assert.equal(evidenceJson.includes('base-optional-reference-secret'), false);
  assert.equal(evidenceJson.includes('local-optional-reference-secret'), false);
});

test('reference-bound custom row driver blocks missing WordPress target rows before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-missing-target', secret: 'base-reference-missing-target-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-missing-target';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-missing-target-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const targetEvidence = blocker.referenceTargetValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-driver-reference-target');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_ABSENT');
  assert.equal(blocker.driverPayloadValidationEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_ACCEPTED');
  assert.equal(targetEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_ABSENT');
  assert.equal(targetEvidence.outcome, 'refused-before-mutation');
  assert.equal(targetEvidence.rawValuesIncluded, false);
  assert.equal(targetEvidence.fields[0].path, 'payload.post_id');
  assert.equal(targetEvidence.fields[0].targetResourceKey, 'row:["wp_posts","ID:2"]');
  assert.equal(targetEvidence.fields[0].targetRemotePresent, false);
  assert.equal(targetEvidence.fields[0].targetStable, false);
  assert.equal(blockerJson.includes('base-reference-missing-target-secret'), false);
  assert.equal(blockerJson.includes('local-reference-missing-target-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('reference-bound custom row driver revalidates target rows at apply time', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-target-drift', secret: 'base-reference-target-drift-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  addStablePost(base, 2, 'base reference target drift');
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-target-drift';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-target-drift-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  remote.db.wp_posts['ID:2'].post_title = 'remote reference target drift after dry run';
  const remoteBefore = JSON.stringify(remote);

  let error;
  try {
    applyPlan(remote, plan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_REFERENCE_TARGET');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_MISMATCH');
  assert.equal(error.details.applyValidationEvidence.referenceTargetValidationEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_MISMATCH');
  assert.equal(error.details.applyValidationEvidence.referenceTargetValidationEvidence.fields[0].targetResourceKey, 'row:["wp_posts","ID:2"]');
  assert.equal(JSON.stringify(error.details).includes('base-reference-target-drift-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-reference-target-drift-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses surplus reference target evidence before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const rawSentinel = 'reference-target-surplus-raw-secret';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-surplus-target', secret: 'base-reference-surplus-target-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  addStablePost(base, 2, 'base reference surplus target');
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-surplus-target';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-surplus-target-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);

  for (const variant of [
    {
      label: 'top-level',
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_EVIDENCE_INVALID',
      mutate(mutation) {
        mutation.pluginOwnedResource.referenceTargetValidationEvidence.unexpectedRawPayload = rawSentinel;
      },
    },
    {
      label: 'field',
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_FIELD_MISMATCH',
      mutate(mutation) {
        mutation.pluginOwnedResource.referenceTargetValidationEvidence.fields[0].unexpectedRawPayload = rawSentinel;
      },
    },
    {
      label: 'field-count',
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_FIELD_MISMATCH',
      mutate(mutation) {
        mutation.pluginOwnedResource.referenceTargetValidationEvidence.referenceFieldCount = 99;
      },
    },
    {
      label: 'targetChange',
      reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_FIELD_MISMATCH',
      mutate(mutation) {
        mutation.pluginOwnedResource.referenceTargetValidationEvidence.fields[0].targetChange.remote.unexpectedRawPayload = rawSentinel;
      },
    },
  ]) {
    const remoteForVariant = cloneJson(remote);
    const remoteBefore = JSON.stringify(remoteForVariant);
    const forgedPlan = cloneJson(plan);
    const mutation = mutationFor(forgedPlan, resourceKey);
    variant.mutate(mutation);

    let error;
    try {
      applyPlan(remoteForVariant, forgedPlan);
    } catch (caught) {
      error = caught;
    }

    assert.equal(plan.status, 'ready', variant.label);
    assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_REFERENCE_TARGET', variant.label);
    assert.equal(error.details.reasonCode, variant.reasonCode, variant.label);
    assert.equal(error.details.resourceKey, resourceKey, variant.label);
    assert.equal(error.details.pluginOwner, 'forms', variant.label);
    assert.equal(error.details.driver, 'forms-contract-row', variant.label);
    assert.equal(
      error.details.applyValidationEvidence.referenceTargetValidationEvidence.reasonCode,
      variant.reasonCode,
      variant.label,
    );
    assert.equal(
      error.details.applyValidationEvidence.referenceTargetValidationEvidence.outcome,
      'refused-before-mutation',
      variant.label,
    );
    assert.equal(
      error.details.applyValidationEvidence.referenceTargetValidationEvidence.rawValuesIncluded,
      false,
      variant.label,
    );
    assert.equal(JSON.stringify(error.details).includes(rawSentinel), false, variant.label);
    assert.equal(JSON.stringify(error.details).includes('base-reference-surplus-target-secret'), false, variant.label);
    assert.equal(JSON.stringify(error.details).includes('local-reference-surplus-target-secret'), false, variant.label);
    assert.equal(JSON.stringify(remoteForVariant), remoteBefore, variant.label);
  }
});

test('apply refuses unbound reference target evidence before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const rawSentinel = 'reference-target-unbound-raw-secret';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-unbound', secret: 'base-reference-unbound-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-unbound';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-unbound-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  mutation.pluginOwnedResource.referenceTargetValidationEvidence = {
    schemaVersion: 1,
    operation: 'plugin-driver-reference-target-validation',
    validator: 'contract-bound-row-driver-reference-targets',
    reasonCode: 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGETS_ACCEPTED',
    outcome: 'accepted',
    format: 'hash-only',
    rawValuesIncluded: false,
    resourceKey,
    pluginOwner: 'forms',
    driver: 'forms-contract-row',
    table: 'wp_forms_contract_rows',
    contractHash: mutation.pluginOwnedResource.contractValidationEvidence.contractHash,
    contractValidationHash: pluginOwnedRowDriverContractValidationEvidenceHash(
      mutation.pluginOwnedResource.contractValidationEvidence,
    ),
    payloadValidationHash: digest(mutation.pluginOwnedResource.driverPayloadValidationEvidence),
    referenceValidationHash: digest({ forged: rawSentinel }),
    referenceFieldCount: 0,
    fields: [],
    unexpectedRawPayload: rawSentinel,
  };

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_REFERENCE_TARGET');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_EVIDENCE_UNBOUND');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(
    error.details.applyValidationEvidence.referenceTargetValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_EVIDENCE_UNBOUND',
  );
  assert.equal(
    error.details.applyValidationEvidence.referenceTargetValidationEvidence.rawValuesIncluded,
    false,
  );
  assert.equal(JSON.stringify(error.details).includes(rawSentinel), false);
  assert.equal(JSON.stringify(error.details).includes('base-reference-unbound-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-reference-unbound-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('reference-bound custom row driver blocks identity-mapped source targets until rewritten', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const sourcePostKey = 'row:["wp_posts","ID:2"]';
  const targetPostKey = 'row:["wp_posts","ID:22"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-identity-map', secret: 'base-reference-identity-map-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  addStablePost(base, 2, 'base mapped source target');
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-identity-map';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-identity-map-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.db.wp_posts['ID:2'].post_title = 'local mapped source target';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
    wordpressGraphIdentityMap: {
      rows: [
        {
          sourceResourceKey: sourcePostKey,
          targetResourceKey: targetPostKey,
        },
      ],
    },
  };
  const remote = cloneJson(base);
  delete remote.db.wp_posts['ID:2'];
  remote.db.wp_posts['ID:22'] = {
    ...local.db.wp_posts['ID:2'],
    ID: 22,
  };
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const targetEvidence = blocker.referenceTargetValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-driver-reference-target');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_TARGET_REMOTE_ABSENT');
  assert.equal(targetEvidence.fields[0].targetResourceKey, sourcePostKey);
  assert.equal(targetEvidence.fields[0].targetRemotePresent, false);
  assert.equal(targetEvidence.fields[0].targetStable, false);
  assert.equal(plan.decisions.some((entry) =>
    entry.resourceKey === sourcePostKey
    && entry.targetResourceKey === targetPostKey
    && entry.decision === 'map-local-identity-to-remote'), true);
  assert.equal(blockerJson.includes('base-reference-identity-map-secret'), false);
  assert.equal(blockerJson.includes('local-reference-identity-map-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('explicit custom row driver merge policy is carried and bound through apply', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-merge-policy', secret: 'base-merge-policy-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-merge-policy';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-merge-policy-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract({
      mergePolicy: 'refuse-on-conflict',
    })),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify({ contractEvidence, payloadEvidence, mutation: mutation.pluginOwnedResource });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(mutation.pluginOwnedResource.mergePolicy, normalizedRefuseOnConflictMergePolicy);
  assert.deepEqual(contractEvidence.mergePolicy, normalizedRefuseOnConflictMergePolicy);
  assert.equal(
    contractEvidence.contractHash,
    pluginOwnedRowDriverContractHash(contractEvidence),
  );
  assert.equal(
    payloadEvidence.contractValidationHash,
    pluginOwnedRowDriverContractValidationEvidenceHash(contractEvidence),
  );
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_forms_contract_rows['entry_id:7'].payload.mode, 'local-merge-policy');
  assert.equal(evidenceJson.includes('base-merge-policy-secret'), false);
  assert.equal(evidenceJson.includes('local-merge-policy-secret'), false);
});

test('explicit custom row driver merge policy records hash-only refusal evidence on conflicts', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-merge-conflict', secret: 'base-merge-conflict-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-merge-conflict';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-merge-conflict-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract({
      mergePolicy: 'refuse-on-conflict',
    })),
  };
  const remote = cloneJson(base);
  remote.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'remote-merge-conflict';
  remote.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'remote-merge-conflict-secret';
  remote.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'remote';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === resourceKey);
  const evidence = conflict.pluginDriverMergePolicyConflictEvidence;
  let error;
  try {
    applyPlan(remote, plan);
  } catch (caught) {
    error = caught;
  }
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(evidence.operation, 'plugin-driver-merge-policy-validation');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_MERGE_POLICY_REFUSE_ON_CONFLICT');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.deepEqual(evidence.mergePolicy, normalizedRefuseOnConflictMergePolicy);
  assert.match(evidence.contractHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.contractValidationHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.conflictHash, /^[a-f0-9]{64}$/);
  assert.equal(error?.code, 'PLAN_NOT_READY');
  assert.equal(error.details.status, 'conflict');
  assert.equal(conflictJson.includes('base-merge-conflict-secret'), false);
  assert.equal(conflictJson.includes('local-merge-conflict-secret'), false);
  assert.equal(conflictJson.includes('remote-merge-conflict-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('contract-bound custom row driver blocks present payloads without owner markers', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-owner-marker', secret: 'base-contract-owner-marker-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-owner-marker';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-owner-marker-secret';
  delete local.db.wp_forms_contract_rows['entry_id:7'].__pluginOwner;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.driverPayloadValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-payload');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISSING');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISSING');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'forms-contract-row');
  assert.equal(JSON.stringify(blocker).includes('base-contract-owner-marker-secret'), false);
  assert.equal(JSON.stringify(blocker).includes('local-contract-owner-marker-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('contract-bound custom row driver blocks payload row ids that do not match the resource key', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-row-id', secret: 'base-contract-row-id-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].entry_id = 8;
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-row-id';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-row-id-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.driverPayloadValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-payload');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_MISMATCH');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_MISMATCH');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.deepEqual(evidence.rowIdentity, {
    resourceId: 'entry_id:7',
    status: 'mismatch',
    fields: [
      {
        field: 'entry_id',
        expected: '7',
        observedHash: digest('8'),
        matched: false,
      },
    ],
  });
  assert.equal(JSON.stringify(blocker).includes('base-contract-row-id-secret'), false);
  assert.equal(JSON.stringify(blocker).includes('local-contract-row-id-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('reference-bound custom row driver blocks invalid reference fields without raw values', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const privateReference = 'local-reference-field-secret';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-invalid', secret: 'base-reference-invalid-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-invalid';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-invalid-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.post_id = privateReference;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.driverPayloadValidationEvidence;
  const mismatch = evidence.referenceValidation.fields[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-payload');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_INVALID');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_INVALID');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.referenceValidation.status, 'mismatch');
  assert.deepEqual(mismatch, {
    path: 'payload.post_id',
    targetTable: 'wp_posts',
    targetIdField: 'ID',
    scalarType: 'positive-integer',
    required: true,
    state: 'invalid',
    observedType: 'string',
    observedHash: digest(privateReference),
    matched: false,
  });
  assert.equal(blockerJson.includes(privateReference), false);
  assert.equal(blockerJson.includes('base-reference-invalid-secret'), false);
  assert.equal(blockerJson.includes('local-reference-invalid-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('schema-bound custom row driver contract carries hash-only row schema evidence through apply', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-schema-contract', secret: 'base-schema-contract-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-schema-contract';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-schema-contract-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(schemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify({ contractEvidence, payloadEvidence });

  assert.equal(plan.status, 'ready');
  assert.deepEqual(contractEvidence.rowSchema, normalizedCustomTableRowSchema);
  assert.equal(
    contractEvidence.contractHash,
    pluginOwnedRowDriverContractHash(contractEvidence),
  );
  assert.deepEqual(payloadEvidence.schemaValidation, {
    schemaHash: digest(normalizedCustomTableRowSchema),
    status: 'matched',
    fields: [
      {
        field: '__pluginOwner',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
      {
        field: 'entry_id',
        expectedType: 'integer',
        required: true,
        state: 'present',
        observedType: 'integer',
        matched: true,
      },
      {
        field: 'payload',
        expectedType: 'object',
        required: true,
        state: 'present',
        observedType: 'object',
        matched: true,
      },
      {
        field: 'updated_marker',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
    ],
  });
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_forms_contract_rows['entry_id:7'].updated_marker, 'local');
  assert.equal(evidenceJson.includes('base-schema-contract-secret'), false);
  assert.equal(evidenceJson.includes('local-schema-contract-secret'), false);
});

test('schema-bound custom row driver blocks payloads with wrong field types', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-schema-type', secret: 'base-schema-type-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-schema-type';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-schema-type-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = { nested: 'not-a-string' };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(schemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.driverPayloadValidationEvidence;
  const mismatch = evidence.schemaValidation.fields.find((field) => field.field === 'updated_marker');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'invalid-plugin-driver-payload');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_TYPE_MISMATCH');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_TYPE_MISMATCH');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.deepEqual(mismatch, {
    field: 'updated_marker',
    expectedType: 'string',
    required: true,
    state: 'present',
    observedType: 'object',
    matched: false,
  });
  assert.equal(JSON.stringify(blocker).includes('base-schema-type-secret'), false);
  assert.equal(JSON.stringify(blocker).includes('local-schema-type-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('nested schema-bound custom row driver validates plugin payload object shape', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-nested-schema', version: 1 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-nested-schema';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.version = 2;
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(nestedSchemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(contractEvidence.rowSchema, normalizedNestedCustomTableRowSchema);
  assert.deepEqual(
    payloadEvidence.schemaValidation.fields.filter((field) => field.path?.startsWith('payload.')),
    [
      {
        field: 'mode',
        path: 'payload.mode',
        expectedType: 'string',
        required: true,
        state: 'present',
        observedType: 'string',
        matched: true,
      },
      {
        field: 'version',
        path: 'payload.version',
        expectedType: 'integer',
        required: true,
        state: 'present',
        observedType: 'integer',
        matched: true,
      },
    ],
  );
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_forms_contract_rows['entry_id:7'].payload.version, 2);
  assert.equal(JSON.stringify(payloadEvidence).includes('local-nested-schema'), false);
  assert.equal(JSON.stringify(payloadEvidence).includes('base-nested-schema'), false);
});

test('nested schema-bound custom row driver blocks unexpected plugin payload properties', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-nested-extra', version: 1 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-nested-extra';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.version = 2;
  local.db.wp_forms_contract_rows['entry_id:7'].payload.private_note = 'local-nested-extra-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.auth_token = 'local-nested-extra-token';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(nestedSchemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.driverPayloadValidationEvidence;
  const unexpected = evidence.schemaValidation.fields.find(
    (field) => field.path === 'payload' && field.state === 'unexpected',
  );

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'invalid-plugin-driver-payload');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_UNEXPECTED_FIELD');
  assert.deepEqual(unexpected, {
    field: 'payload',
    path: 'payload',
    expectedType: 'object',
    required: true,
    state: 'unexpected',
    observedType: 'object',
    observedExtraPropertyCount: 2,
    matched: false,
  });
  assert.equal(JSON.stringify(blocker).includes('local-nested-extra-secret'), false);
  assert.equal(JSON.stringify(blocker).includes('local-nested-extra-token'), false);
  assert.equal(JSON.stringify(blocker).includes('private_note'), false);
  assert.equal(JSON.stringify(blocker).includes('auth_token'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('schema-bound custom row driver validates hash-only scalar constraints', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'local-constraint', version: 2 },
      updated_marker: 'local',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-constraint-alt';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(constrainedSchemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const payloadEvidence = mutation.pluginOwnedResource.driverPayloadValidationEvidence;
  const result = applyPlan(remote, plan);
  const modeEvidence = payloadEvidence.schemaValidation.fields.find((field) => field.path === 'payload.mode');
  const versionEvidence = payloadEvidence.schemaValidation.fields.find((field) => field.path === 'payload.version');

  assert.equal(plan.status, 'ready');
  assert.deepEqual(
    mutation.pluginOwnedResource.contractValidationEvidence.rowSchema,
    normalizedConstrainedCustomTableRowSchema,
  );
  assert.deepEqual(modeEvidence, {
    field: 'mode',
    path: 'payload.mode',
    expectedType: 'string',
    required: true,
    state: 'present',
    observedType: 'string',
    constraint: 'enum',
    constraintHash: digest(constrainedModeEnumHashes),
    observedHash: digest('local-constraint-alt'),
    matched: true,
  });
  assert.deepEqual(versionEvidence, {
    field: 'version',
    path: 'payload.version',
    expectedType: 'integer',
    required: true,
    state: 'present',
    observedType: 'integer',
    constraint: 'const',
    constraintHash: digest(2),
    observedHash: digest(2),
    matched: true,
  });
  assert.equal(result.appliedMutations, 1);
  assert.equal(JSON.stringify(payloadEvidence).includes('local-constraint-alt'), false);
  assert.equal(JSON.stringify(payloadEvidence).includes('local-constraint'), false);
});

test('schema-bound custom row driver blocks scalar constraint mismatches', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'local-constraint', version: 2 },
      updated_marker: 'local',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'constraint-private-mode';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(constrainedSchemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const mismatch = blocker.driverPayloadValidationEvidence.schemaValidation.fields.find(
    (field) => field.path === 'payload.mode',
  );

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'invalid-plugin-driver-payload');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_CONSTRAINT_MISMATCH');
  assert.deepEqual(mismatch, {
    field: 'mode',
    path: 'payload.mode',
    expectedType: 'string',
    required: true,
    state: 'constraint-mismatch',
    observedType: 'string',
    constraint: 'enum',
    constraintHash: digest(constrainedModeEnumHashes),
    observedHash: digest('constraint-private-mode'),
    matched: false,
  });
  assert.equal(JSON.stringify(blocker).includes('constraint-private-mode'), false);
  assert.equal(JSON.stringify(blocker).includes('local-constraint'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('generic custom row driver allowlist without explicit contract blocks before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-missing-contract', secret: 'base-missing-contract-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-missing-contract';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-missing-contract-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'forms-contract-row',
      table: 'wp_forms_contract_rows',
      supportsDelete: false,
    }),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.pluginDriverContractRequiredEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'missing-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_REQUIRED');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_REQUIRED');
  assert.equal(evidence.requiredContractKind, 'plugin-owned-row-driver');
  assert.equal(evidence.requiredContractVersion, 1);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'forms-contract-row');
  assert.equal(evidence.table, 'wp_forms_contract_rows');
  assert.equal(blockerJson.includes('base-missing-contract-secret'), false);
  assert.equal(blockerJson.includes('local-missing-contract-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('schema-bound custom row driver contract with unsupported field type fails closed before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-schema-invalid', secret: 'base-schema-invalid-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-schema-invalid';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-schema-invalid-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(schemaBoundCustomTableContract({
      rowSchema: {
        fields: {
          entry_id: 'integer',
          payload: 'raw-value',
        },
      },
    })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.contractValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA_TYPE');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA_TYPE');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_INVALID_ROW_SCHEMA_TYPE']);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(JSON.stringify(blocker).includes('base-schema-invalid-secret'), false);
  assert.equal(JSON.stringify(blocker).includes('local-schema-invalid-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('explicit custom row driver contract with unsupported merge policy fails closed before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-merge-policy-invalid', secret: 'base-merge-policy-invalid-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-merge-policy-invalid';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-merge-policy-invalid-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract({
      mergePolicy: {
        strategy: 'last-write-wins',
        rawValuesIncluded: false,
      },
    })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const evidence = blocker.contractValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_MERGE_POLICY');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_MERGE_POLICY');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_MERGE_POLICY']);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(JSON.stringify(blocker).includes('last-write-wins'), false);
  assert.equal(JSON.stringify(blocker).includes('base-merge-policy-invalid-secret'), false);
  assert.equal(JSON.stringify(blocker).includes('local-merge-policy-invalid-secret'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('unsupported explicit plugin-owned row driver contract version fails closed before mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-unsupported';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract({ contractVersion: 2 })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.contractValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION');
  assert.equal(blocker.reason, 'Explicit plugin-owned row driver contract is invalid.');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION']);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(blockerJson.includes('local-contract-unsupported'), false);
  assert.equal(blockerJson.includes('remote-preserved-contract'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('explicit plugin-owned row driver contract without a kind fails closed before mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-missing-kind';
  const malformed = explicitContract();
  delete malformed.contractKind;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(malformed),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.contractValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MISSING_KIND');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MISSING_KIND');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_MISSING_KIND']);
  assert.equal(evidence.contractKind, null);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(blockerJson.includes('local-contract-missing-kind'), false);
  assert.equal(blockerJson.includes('remote-preserved-contract'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('raw-value explicit plugin-owned row driver contract fails closed before mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-raw-values';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract({ rawValuesIncluded: true })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.contractValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_RAW_VALUES_INCLUDED');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_RAW_VALUES_INCLUDED');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_RAW_VALUES_INCLUDED']);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(blockerJson.includes('local-contract-raw-values'), false);
  assert.equal(blockerJson.includes('remote-preserved-contract'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('explicit plugin-owned row driver contract without a driver fails closed as a contract error', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-missing-driver';
  const malformed = explicitContract();
  delete malformed.driver;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(malformed),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.contractValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.driver, null);
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER']);
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, null);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged ready plans that carry refused plugin driver contract evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-forged-apply';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, formsOptionResourceKey);
  mutation.pluginOwnedResource.contractValidationEvidence = {
    ...mutation.pluginOwnedResource.contractValidationEvidence,
    outcome: 'refused-before-mutation',
    reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION',
    issueCodes: ['PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION'],
  };

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION');
  assert.equal(error.details.resourceKey, formsOptionResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'wp-option');
  assert.equal(
    error.details.contractValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION',
  );
  assert.equal(error.details.contractValidationEvidence.rawValuesIncluded, false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-forged-apply'), false);
  assert.equal(JSON.stringify(error.details).includes('remote-preserved-contract'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver contract evidence with unexpected raw fields before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const rawSentinel = 'local-contract-raw-evidence-secret';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-extra-evidence', secret: 'base-contract-extra-evidence-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-extra-evidence';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-extra-evidence-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  mutation.pluginOwnedResource.contractValidationEvidence.rawFixture = rawSentinel;
  mutation.pluginOwnedResource.contractValidationEvidence.rawValuesIncluded = false;

  const payloadValidation = validatePluginOwnedDriverPayload({
    resource: mutation.resource,
    owner: 'forms',
    driver: 'forms-contract-row',
    table: 'wp_forms_contract_rows',
    value: local.db.wp_forms_contract_rows['entry_id:7'],
    action: 'put',
    supportsDelete: false,
    contractValidationEvidence: mutation.pluginOwnedResource.contractValidationEvidence,
  });
  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(payloadValidation.supported, true);
  assert.equal(payloadValidation.evidence, null);
  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_VALIDATION_EVIDENCE_MISMATCH');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(error.details.contractValidationEvidence.contractHash, pluginOwnedRowDriverContractHash(
    mutation.pluginOwnedResource.contractValidationEvidence,
  ));
  assert.equal(JSON.stringify(error.details).includes(rawSentinel), false);
  assert.equal(JSON.stringify(error.details).includes('base-contract-extra-evidence-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-extra-evidence-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver payloads with missing owner markers before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-apply-owner-marker', secret: 'base-contract-apply-owner-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-apply-owner-marker';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-apply-owner-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  const forgedValue = mutation.value.value;
  delete forgedValue.__pluginOwner;
  mutation.localHash = digest(forgedValue);

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_PAYLOAD');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISSING');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(
    error.details.applyValidationEvidence.driverPayloadValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_BOUND_PAYLOAD_OWNER_MISSING',
  );
  assert.equal(error.details.applyValidationEvidence.driverPayloadValidationEvidence.rawValuesIncluded, false);
  assert.equal(JSON.stringify(error.details).includes('base-contract-apply-owner-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-apply-owner-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver payloads with mismatched row ids before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-apply-row-id', secret: 'base-contract-apply-row-id-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-apply-row-id';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-apply-row-id-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  const forgedValue = mutation.value.value;
  forgedValue.entry_id = 8;
  mutation.localHash = digest(forgedValue);

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_PAYLOAD');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_ID_MISMATCH');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.deepEqual(error.details.applyValidationEvidence.driverPayloadValidationEvidence.rowIdentity, {
    resourceId: 'entry_id:7',
    status: 'mismatch',
    fields: [
      {
        field: 'entry_id',
        expected: '7',
        observedHash: digest('8'),
        matched: false,
      },
    ],
  });
  assert.equal(JSON.stringify(error.details).includes('base-contract-apply-row-id-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-apply-row-id-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged reference-bound custom row driver payloads before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-reference-apply', secret: 'base-reference-apply-secret', post_id: 2 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  addStablePost(base, 2);
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-reference-apply';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-reference-apply-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(referenceBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  const forgedValue = mutation.value.value;
  forgedValue.payload.post_id = 0;
  mutation.localHash = digest(forgedValue);
  mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(forgedValue);

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_PAYLOAD');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_REFERENCE_FIELD_INVALID');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.deepEqual(error.details.applyValidationEvidence.driverPayloadValidationEvidence.referenceValidation, {
    referenceFieldsHash: digest(normalizedReferenceFields),
    status: 'mismatch',
    fields: [
      {
        path: 'payload.post_id',
        targetTable: 'wp_posts',
        targetIdField: 'ID',
        scalarType: 'positive-integer',
        required: true,
        state: 'invalid',
        observedType: 'integer',
        observedHash: digest('0'),
        matched: false,
      },
    ],
  });
  assert.equal(JSON.stringify(error.details).includes('base-reference-apply-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-reference-apply-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged schema-bound custom row driver payloads before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-apply-schema', secret: 'base-contract-apply-schema-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-apply-schema';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-apply-schema-secret';
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(schemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  const forgedValue = mutation.value.value;
  forgedValue.updated_marker = { nested: 'not-a-string' };
  mutation.localHash = digest(forgedValue);
  mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(forgedValue);

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_PAYLOAD');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_TYPE_MISMATCH');
  assert.deepEqual(
    error.details.applyValidationEvidence.driverPayloadValidationEvidence.schemaValidation.fields.find(
      (field) => field.field === 'updated_marker',
    ),
    {
      field: 'updated_marker',
      expectedType: 'string',
      required: true,
      state: 'present',
      observedType: 'object',
      matched: false,
    },
  );
  assert.equal(JSON.stringify(error.details).includes('base-contract-apply-schema-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-apply-schema-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged nested schema-bound custom row driver payloads before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-apply-nested-schema', version: 1 },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-apply-nested-schema';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.version = 2;
  local.db.wp_forms_contract_rows['entry_id:7'].updated_marker = 'local';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(nestedSchemaBoundCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  const forgedValue = mutation.value.value;
  forgedValue.payload.private_note = 'forged-nested-schema-secret';
  mutation.localHash = digest(forgedValue);
  mutation.pluginOwnedResource.driverPayloadValidationEvidence.value.hash = digest(forgedValue);

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(error?.code, 'INVALID_PLUGIN_DRIVER_PAYLOAD');
  assert.equal(error.details.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_ROW_SCHEMA_UNEXPECTED_FIELD');
  assert.deepEqual(
    error.details.applyValidationEvidence.driverPayloadValidationEvidence.schemaValidation.fields.find(
      (field) => field.path === 'payload' && field.state === 'unexpected',
    ),
    {
      field: 'payload',
      path: 'payload',
      expectedType: 'object',
      required: true,
      state: 'unexpected',
      observedType: 'object',
      observedExtraPropertyCount: 1,
      matched: false,
    },
  );
  assert.equal(JSON.stringify(error.details).includes('forged-nested-schema-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('private_note'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver contracts when table binding is changed', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-binding', secret: 'base-contract-binding-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-binding';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-binding-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  mutationFor(forgedPlan, resourceKey).pluginOwnedResource.table = 'wp_forms_contract_rows_shadow';

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_INVALID_BINDING');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(error.details.contractValidationEvidence.table, 'wp_forms_contract_rows');
  assert.equal(JSON.stringify(error.details).includes('base-contract-binding-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-binding-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver contracts when merge policy binding is changed', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-merge-binding', secret: 'base-contract-merge-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-merge-binding';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-merge-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract({
      mergePolicy: 'refuse-on-conflict',
    })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  mutationFor(forgedPlan, resourceKey).pluginOwnedResource.mergePolicy = {
    schemaVersion: 1,
    strategy: 'refuse-on-conflict',
    conflictResolution: 'silently-merge',
    rawValuesIncluded: false,
  };

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_BOUND_MERGE_POLICY_MISMATCH');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.deepEqual(error.details.contractValidationEvidence.mergePolicy, normalizedRefuseOnConflictMergePolicy);
  assert.equal(JSON.stringify(error.details).includes('silently-merge'), false);
  assert.equal(JSON.stringify(error.details).includes('base-contract-merge-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-merge-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver contract fingerprints before mutation', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-hash-binding', secret: 'base-contract-hash-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-hash-binding';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-hash-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  mutationFor(forgedPlan, resourceKey).pluginOwnedResource.contractValidationEvidence.contractHash = '0'.repeat(64);

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_HASH_MISMATCH');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(error.details.contractValidationEvidence.contractHash, '0'.repeat(64));
  assert.equal(JSON.stringify(error.details).includes('base-contract-hash-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-hash-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver plans when resourceKey no longer matches the row resource', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const forgedResourceKey = 'row:["wp_forms_contract_rows","entry_id:8"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-resource-key-binding', secret: 'base-resource-key-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-resource-key-binding';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-resource-key-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, resourceKey);
  mutation.resourceKey = forgedResourceKey;
  mutation.pluginOwnedResource.resourceKey = forgedResourceKey;
  mutation.pluginOwnedResource.contractValidationEvidence.resourceKey = forgedResourceKey;
  mutation.pluginOwnedResource.driverPayloadValidationEvidence.resourceKey = forgedResourceKey;

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLAN_INVARIANT_VIOLATION');
  assert.ok(
    error.details.issues.some((issue) =>
      issue.code === 'MUTATION_RESOURCE_KEY_MISMATCH'
      && issue.resourceKey === forgedResourceKey
      && issue.actualResourceKey === resourceKey,
    ),
  );
  assert.equal(JSON.stringify(error.details).includes('base-resource-key-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-resource-key-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver contracts when mutation owner binding is removed', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-owner-binding', secret: 'base-contract-owner-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-owner-binding';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-owner-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  delete mutationFor(forgedPlan, resourceKey).pluginOwnedResource.pluginOwner;

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_BOUND_OWNER_MISSING');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(error.details.contractValidationEvidence.pluginOwner, 'forms');
  assert.equal(error.details.contractValidationEvidence.driver, 'forms-contract-row');
  assert.equal(JSON.stringify(error.details).includes('base-contract-owner-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-owner-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver contracts when mutation driver binding is removed', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-driver-binding', secret: 'base-contract-driver-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-driver-binding';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-driver-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  delete mutationFor(forgedPlan, resourceKey).pluginOwnedResource.driver;

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_BOUND_DRIVER_MISSING');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, null);
  assert.equal(error.details.contractValidationEvidence.pluginOwner, 'forms');
  assert.equal(error.details.contractValidationEvidence.driver, 'forms-contract-row');
  assert.equal(JSON.stringify(error.details).includes('base-contract-driver-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-driver-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged custom row driver delete when contract evidence does not allow delete', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-delete-binding', secret: 'base-contract-delete-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  delete local.db.wp_forms_contract_rows['entry_id:7'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract({ supportsDelete: true })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);
  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const forgedMutation = mutationFor(forgedPlan, resourceKey);
  forgedMutation.pluginOwnedResource.contractValidationEvidence.supportsDelete = false;
  forgedMutation.pluginOwnedResource.contractValidationEvidence.contractHash = pluginOwnedRowDriverContractHash(
    forgedMutation.pluginOwnedResource.contractValidationEvidence,
  );

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(plan.status, 'ready');
  assert.equal(forgedMutation.action, 'delete');
  assert.equal(forgedMutation.pluginOwnedResource.supportsDelete, true);
  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_BOUND_DELETE_UNSUPPORTED');
  assert.equal(error.details.resourceKey, resourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'forms-contract-row');
  assert.equal(error.details.contractValidationEvidence.supportsDelete, false);
  assert.equal(JSON.stringify(error.details).includes('base-contract-delete-secret'), false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-delete-secret'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('contract-bound row driver validator refuses missing observed owner and driver bindings', () => {
  const resourceKey = 'row:["wp_forms_contract_rows","entry_id:7"]';
  const base = baseSite();
  base.db.wp_forms_contract_rows = {
    'entry_id:7': {
      entry_id: 7,
      payload: { mode: 'base-contract-validator', secret: 'base-contract-validator-secret' },
      updated_marker: 'base',
      __pluginOwner: 'forms',
    },
  };
  const local = cloneJson(base);
  local.db.wp_forms_contract_rows['entry_id:7'].payload.mode = 'local-contract-validator';
  local.db.wp_forms_contract_rows['entry_id:7'].payload.secret = 'local-contract-validator-secret';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitCustomTableContract()),
  };
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const value = local.db.wp_forms_contract_rows['entry_id:7'];

  const missingOwner = validatePluginOwnedDriverPayload({
    resource: mutation.resource,
    owner: null,
    driver: 'forms-contract-row',
    table: 'wp_forms_contract_rows',
    value,
    contractValidationEvidence: contractEvidence,
  });
  const missingDriver = validatePluginOwnedDriverPayload({
    resource: mutation.resource,
    owner: 'forms',
    driver: null,
    table: 'wp_forms_contract_rows',
    value,
    contractValidationEvidence: contractEvidence,
  });
  const forgedDeleteSupport = validatePluginOwnedDriverPayload({
    resource: mutation.resource,
    owner: 'forms',
    driver: 'forms-contract-row',
    table: 'wp_forms_contract_rows',
    value,
    action: 'delete',
    supportsDelete: true,
    contractValidationEvidence: contractEvidence,
  });

  assert.equal(missingOwner.supported, false);
  assert.equal(missingOwner.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_OWNER_MISSING');
  assert.equal(missingOwner.evidence.outcome, 'refused-before-mutation');
  assert.equal(missingOwner.evidence.rawValuesIncluded, false);
  assert.equal(missingDriver.supported, false);
  assert.equal(missingDriver.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_DRIVER_MISSING');
  assert.equal(missingDriver.evidence.outcome, 'refused-before-mutation');
  assert.equal(missingDriver.evidence.rawValuesIncluded, false);
  assert.equal(forgedDeleteSupport.supported, false);
  assert.equal(forgedDeleteSupport.reasonCode, 'PLUGIN_DRIVER_CONTRACT_BOUND_DELETE_UNSUPPORTED');
  assert.equal(forgedDeleteSupport.evidence.outcome, 'refused-before-mutation');
  assert.equal(forgedDeleteSupport.evidence.supportsDelete, true);
  assert.equal(forgedDeleteSupport.evidence.contractSupportsDelete, false);
  assert.equal(forgedDeleteSupport.evidence.contractHash, contractEvidence.contractHash);
  assert.equal(forgedDeleteSupport.evidence.rawValuesIncluded, false);
  assert.equal(JSON.stringify({ missingOwner, missingDriver, forgedDeleteSupport }).includes('base-contract-validator-secret'), false);
  assert.equal(JSON.stringify({ missingOwner, missingDriver, forgedDeleteSupport }).includes('local-contract-validator-secret'), false);
});
