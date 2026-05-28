#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  releaseGateProvenanceRequirements,
  validateReleaseEvidenceProvenance,
} from '../../src/release-evidence-provenance.js';
import {
  evaluateReleaseGates,
  formatReleaseGateStatusMarker,
  releaseGateSummary,
} from '../../src/release-gates.js';

const DEFAULT_SCOPE = 'final-release';

if (isMainModule()) {
  const result = runReleaseGateCli(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    now: new Date(),
  });

  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

export function runReleaseGateCli(argv = [], options = {}) {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      return {
        exitCode: 0,
        report: helpReport(),
      };
    }

    const cwd = options.cwd || process.cwd();
    const evidencePayload = parsed.evidenceFile
      ? readJsonFile(resolveCliPath(parsed.evidenceFile, cwd))
      : {};
    const evidence = resolveEvidence(evidencePayload);
    const fileEnv = isPlainObject(evidencePayload.env) ? evidencePayload.env : {};
    const env = {
      ...fileEnv,
      ...(options.env || {}),
    };
    const scope = parsed.scope
      || evidencePayload.scope
      || evidencePayload.evidenceScope
      || evidence.scope
      || DEFAULT_SCOPE;
    const packagedFallback = parsed.packagedFallback === true
      ? true
      : firstDefined(evidencePayload.packagedFallback, evidence.packagedFallback);

    const evaluation = evaluateReleaseGates({
      env,
      evidence,
      scope,
      packagedFallback,
      now: parsed.now || options.now || new Date(),
    });
    const provenance = evaluateReleaseEvidenceProvenanceForCli(evidencePayload, evaluation, {
      now: parsed.now || options.now || new Date(),
    });
    const releaseGateBuckets = releaseEvidenceBuckets(evaluation);
    const provenanceBuckets = provenanceEvidenceBuckets(provenance);
    const missingProductionEvidenceBuckets = [
      ...releaseGateBuckets,
      ...provenanceBuckets,
    ];
    const primaryFailure = missingProductionEvidenceBuckets[0]?.gates[0] || null;
    const exitCode = evaluation.releaseMovement?.allowed === true && provenance.ready === true ? 0 : 1;
    const releaseStatus = exitCode === 0 ? 'GO' : 'NO-GO';

    return {
      exitCode,
      report: {
        schemaVersion: 1,
        command: 'check-release-gates',
        ok: exitCode === 0,
        exitCode,
        releaseStatus,
        primaryFailureCode: primaryFailure?.code || null,
        primaryFailureBucket: primaryFailure?.bucket || null,
        status: evaluation.status,
        gateState: evaluation.gateState,
        scope: evaluation.scope,
        generatedAt: evaluation.generatedAt,
        releaseMovement: evaluation.releaseMovement,
        candidateMovement: evaluation.candidateMovement,
        totals: evaluation.totals,
        statusMarker: formatReleaseGateStatusMarker(evaluation, { label: 'release-gates-ci' }),
        missingProductionEvidenceBuckets,
        releaseEvidenceProvenance: provenance,
        summary: releaseGateSummary(evaluation),
        evaluation,
      },
    };
  } catch (error) {
    return cliErrorReport(error);
  }
}

function parseArgs(argv) {
  const parsed = {
    evidenceFile: '',
    scope: '',
    now: '',
    packagedFallback: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--evidence-file' || arg === '--evidence') {
      parsed.evidenceFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--evidence-file=')) {
      parsed.evidenceFile = arg.slice('--evidence-file='.length);
      continue;
    }
    if (arg.startsWith('--evidence=')) {
      parsed.evidenceFile = arg.slice('--evidence='.length);
      continue;
    }
    if (arg === '--scope') {
      parsed.scope = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      parsed.scope = arg.slice('--scope='.length);
      continue;
    }
    if (arg === '--now') {
      parsed.now = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--now=')) {
      parsed.now = arg.slice('--now='.length);
      continue;
    }
    if (arg === '--packaged-fallback') {
      parsed.packagedFallback = true;
      continue;
    }
    throw new Error(`Unknown check-release-gates argument: ${arg}`);
  }

  return parsed;
}

function releaseEvidenceBuckets(evaluation) {
  const gatesById = new Map((evaluation.gates || []).map((gate) => [gate.id, gate]));
  const buckets = [];
  const byName = new Map();

  for (const blocker of evaluation.releaseMovement?.missingEvidence || []) {
    const gate = gatesById.get(blocker.id) || blocker;
    const bucketName = gate.category || 'uncategorized';
    if (!byName.has(bucketName)) {
      const bucket = {
        bucket: bucketName,
        gateCount: 0,
        gates: [],
      };
      byName.set(bucketName, bucket);
      buckets.push(bucket);
    }
    const bucket = byName.get(bucketName);
    bucket.gates.push({
      bucket: bucketName,
      id: gate.id,
      rpp: gate.rpp,
      title: gate.title,
      status: blocker.status || gate.status,
      code: blocker.code || gate.code,
      reason: blocker.reason || gate.reason,
      required: blocker.evidence?.required,
      observed: blocker.evidence?.observed,
      envKey: blocker.evidence?.envKey,
      evidenceKey: blocker.evidence?.evidenceKey || gate.evidence?.evidenceKey,
      scope: blocker.evidence?.scope || gate.evidence?.scope,
      requiredScope: gate.evidence?.requiredScope,
    });
    bucket.gateCount = bucket.gates.length;
  }

  return buckets;
}

function evaluateReleaseEvidenceProvenanceForCli(evidencePayload, evaluation, options = {}) {
  const payload = resolveProvenancePayload(evidencePayload);
  const releaseGateReady = evaluation.releaseMovement?.allowed === true;
  const requiredProductionEvidence = releaseGateReady
    ? releaseGateProvenanceRequirements(evaluation)
    : [];
  const provenanceInput = {
    ...payload,
    requiredProductionEvidence: [
      ...arrayValue(payload.requiredProductionEvidence),
      ...requiredProductionEvidence,
    ],
  };
  const summary = validateReleaseEvidenceProvenance(provenanceInput, {
    now: firstDefined(payload.referenceNow, payload.now, options.now),
  });
  const required = releaseGateReady || hasProvenancePayload(evidencePayload);
  const ready = required ? summary.releaseReady === true : true;

  return {
    required,
    ready,
    requiredEvidenceIds: summary.requiredProductionEvidenceIds,
    summary,
  };
}

function provenanceEvidenceBuckets(provenance) {
  if (!provenance.required || provenance.ready === true) {
    return [];
  }

  const rejectedEvidence = provenance.summary?.rejectedEvidence || [];
  const gates = rejectedEvidence.length > 0
    ? rejectedEvidence.map((entry) => provenanceRejectedEvidenceGate(entry))
    : [
      {
        bucket: 'provenance',
        id: 'release-evidence-provenance',
        rpp: '',
        title: 'Release evidence provenance',
        status: 'missing',
        code: 'PRODUCTION_EVIDENCE_REQUIRED',
        reason: 'Production-scoped release evidence provenance is required before release movement.',
        required: provenance.requiredEvidenceIds,
        observed: 'missing-production-evidence-provenance',
        scope: 'missing',
      },
    ];

  return [
    {
      bucket: 'provenance',
      gateCount: gates.length,
      gates,
    },
  ];
}

function provenanceRejectedEvidenceGate(entry) {
  const code = entry.reasonCodes?.[0] || 'PRODUCTION_EVIDENCE_REQUIRED';
  return {
    bucket: 'provenance',
    id: entry.evidenceId,
    rpp: entry.rppId,
    title: 'Release evidence provenance',
    status: 'failed',
    code,
    reason: provenanceReason(code),
    required: 'fresh operator production evidence provenance',
    observed: entry.reasonCodes,
    evidenceKey: entry.evidenceId,
    scope: entry.productionRequired ? 'final-release' : 'local-candidate',
  };
}

function provenanceReason(code) {
  switch (code) {
    case 'PRODUCTION_EVIDENCE_REQUIRED':
      return 'Production-scoped release evidence provenance is required before release movement.';
    case 'OBSERVED_AT_REQUIRED':
      return 'Release evidence provenance is missing an observedAt timestamp.';
    case 'OBSERVED_AT_STALE':
      return 'Release evidence provenance is stale for the configured release window.';
    case 'PRODUCTION_SOURCE_REQUIRED':
      return 'Production-required release evidence must come from operator production provenance.';
    case 'SUBJECT_HASH_REQUIRED':
      return 'Release evidence provenance must include a subject hash.';
    case 'ARTIFACT_PATH_RAW_URL':
      return 'Release evidence artifact references must be repository-relative paths, not raw URLs.';
    case 'ARTIFACT_PATH_SECRET_LIKE':
      return 'Release evidence artifact references must not contain secret-looking values.';
    case 'COMMAND_STATUS_UNCHECKED':
      return 'Release evidence provenance must include a checked command status.';
    default:
      return 'Release evidence provenance failed validation.';
  }
}

function resolveProvenancePayload(evidencePayload) {
  if (!isPlainObject(evidencePayload)) {
    return {};
  }
  for (const key of ['releaseEvidenceProvenance', 'evidenceProvenance', 'provenance']) {
    if (isPlainObject(evidencePayload[key])) {
      return evidencePayload[key];
    }
  }
  return {};
}

function hasProvenancePayload(evidencePayload) {
  const payload = resolveProvenancePayload(evidencePayload);
  return Object.keys(payload).length > 0;
}

function readJsonFile(filePath) {
  try {
    const source = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(source);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Evidence file not found: ${filePath}`);
    }
    throw new Error(`Unable to read release gate evidence file ${filePath}: ${error.message}`);
  }
}

function resolveEvidence(payload) {
  if (!isPlainObject(payload)) {
    return {};
  }
  if (isPlainObject(payload.evidence)) {
    return payload.evidence;
  }
  return payload;
}

function resolveCliPath(value, cwd) {
  if (!value || typeof value !== 'string') {
    throw new Error('Evidence file path must be a non-empty string.');
  }
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${arg} requires a value.`);
  }
  return value;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function cliErrorReport(error) {
  return {
    exitCode: 2,
    report: {
      schemaVersion: 1,
      command: 'check-release-gates',
      ok: false,
      exitCode: 2,
      status: 'cli-error',
      gateState: 'held',
      primaryFailureCode: 'CHECK_RELEASE_GATES_CLI_ERROR',
      primaryFailureBucket: 'cli',
      releaseMovement: {
        allowed: false,
        state: 'held',
        reason: error.message,
      },
      missingProductionEvidenceBuckets: [
        {
          bucket: 'cli',
          gateCount: 1,
          gates: [
            {
              bucket: 'cli',
              id: 'check-release-gates-cli',
              status: 'failed',
              code: 'CHECK_RELEASE_GATES_CLI_ERROR',
              reason: error.message,
              required: 'valid check-release-gates invocation',
              observed: 'cli-error',
              scope: 'missing',
            },
          ],
        },
      ],
    },
  };
}

function helpReport() {
  return {
    schemaVersion: 1,
    command: 'check-release-gates',
    ok: true,
    exitCode: 0,
    usage: 'node ./scripts/release/check-release-gates.mjs [--evidence-file evidence.json] [--scope final-release|local-candidate] [--now ISO] [--packaged-fallback]',
    defaultScope: DEFAULT_SCOPE,
    output: 'Machine-readable JSON. Exit code 0 only when releaseMovement.allowed is true; otherwise 1 for held release gates and 2 for CLI errors.',
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
