#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_RELEASE_CHECKS,
  REQUIRED_RELEASE_CHECKS_CONTRACT,
  summarizeRequiredReleaseChecks,
} from '../../src/required-release-checks.js';
import { stableStringify } from '../../src/stable-json.js';

const commandName = 'required-release-checks-report';
const defaultMode = 'current-repo';

if (isMainModule()) {
  const result = runRequiredReleaseChecksReport(process.argv.slice(2), {
    cwd: process.cwd(),
    now: new Date(),
  });
  process.stdout.write(`${stableStringify(result.report)}\n`);
  process.exitCode = result.exitCode;
}

export function runRequiredReleaseChecksReport(argv = [], options = {}) {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      return {
        exitCode: 0,
        report: helpReport(),
      };
    }

    const cwd = options.cwd || process.cwd();
    const input = loadInputs(parsed, cwd, options);
    const summary = summarizeRequiredReleaseChecks({
      checks: input.checks,
      observations: input.observations,
      now: input.now,
    });
    const report = buildReport({
      cwd,
      source: input.source,
      mode: input.mode,
      contract: input.contract,
      checks: input.checks,
      observations: input.observations,
      summary,
      now: input.now,
    });

    return {
      exitCode: summary.releaseReady ? 0 : 1,
      report,
    };
  } catch (error) {
    return cliErrorReport(error);
  }
}

function loadInputs(parsed, cwd, options) {
  let source = 'module:src/required-release-checks.js';
  let mode = defaultMode;
  let contract = REQUIRED_RELEASE_CHECKS_CONTRACT;
  let checks = REQUIRED_RELEASE_CHECKS;
  let observations = {};
  let now = parsed.now || options.now || new Date();

  if (parsed.fixtureFile) {
    const fixturePath = resolveCliPath(parsed.fixtureFile, cwd, 'Fixture file path');
    const fixture = readJsonFile(fixturePath, 'required release checks fixture');
    source = path.relative(cwd, fixturePath) || fixturePath;
    mode = 'fixture';
    contract = fixture;
    checks = Array.isArray(fixture.checks) ? fixture.checks : checks;
    observations = normalizeObservationPayload(fixture);
    now = parsed.now || fixture.evaluation?.now || fixture.now || now;
  }

  if (parsed.contractFile) {
    const contractPath = resolveCliPath(parsed.contractFile, cwd, 'Contract file path');
    const contractPayload = readJsonFile(contractPath, 'required release checks contract');
    source = path.relative(cwd, contractPath) || contractPath;
    contract = contractPayload;
    checks = Array.isArray(contractPayload.checks) ? contractPayload.checks : checks;
  }

  if (parsed.observationsFile) {
    const observationsPath = resolveCliPath(parsed.observationsFile, cwd, 'Observations file path');
    const observationsPayload = readJsonFile(observationsPath, 'required release checks observations');
    observations = normalizeObservationPayload(observationsPayload);
    now = parsed.now || observationsPayload.evaluation?.now || observationsPayload.now || now;
    mode = parsed.fixtureFile ? 'fixture-with-observations' : 'observations-file';
  }

  return {
    source,
    mode,
    contract,
    checks,
    observations,
    now,
  };
}

function buildReport({ cwd, source, mode, contract, checks, observations, summary, now }) {
  const observationsById = normalizeObservations(observations);
  return {
    schemaVersion: 1,
    command: commandName,
    mode,
    source,
    evaluatedAt: isoTimestamp(now),
    ok: summary.ok,
    releaseReady: summary.releaseReady,
    releaseStatus: releaseStatus(summary),
    requiredCount: summary.requiredCount,
    passedCount: summary.passedCount,
    missingCount: summary.missingChecks.length,
    staleCount: summary.staleChecks.length,
    nonBlockingCount: summary.nonBlockingChecks.length,
    contract: {
      contractId: contract.contract_id || 'required-release-checks-inline-contract',
      schemaVersion: contract.schema_version || contract.schemaVersion || 1,
      branchProtection: contract.release_movement_policy?.branch_protection || 'not consulted',
      externalServices: contract.release_movement_policy?.external_services || 'not required',
    },
    summary,
    checks: checks.map((check) => checkReport(check, observationsById.get(check.id), cwd)),
  };
}

function checkReport(check, observation, cwd) {
  return {
    id: check.id,
    title: check.title || '',
    area: check.area || '',
    ownerScope: check.ownerScope || '',
    severity: check.severity || '',
    productionRequired: check.productionRequired !== false,
    command: check.command || '',
    staleAfterMs: check.staleAfterMs,
    artifacts: (Array.isArray(check.artifacts) ? check.artifacts : []).map((artifact) => ({
      path: artifact,
      exists: isNonEmptyString(artifact) ? fs.existsSync(path.resolve(cwd, artifact)) : false,
    })),
    observation: observationReport(check, observation),
  };
}

function observationReport(check, observation) {
  if (!isRecord(observation)) {
    return {
      status: 'missing',
      observedAt: null,
      commandRecorded: false,
      commandMatches: false,
      artifactCount: 0,
      requiredArtifactCount: Array.isArray(check.artifacts) ? check.artifacts.length : 0,
    };
  }

  const observedArtifacts = Array.isArray(observation.artifacts)
    ? observation.artifacts
    : (Array.isArray(observation.artifactPaths) ? observation.artifactPaths : []);
  const observedCommand = typeof observation.command === 'string' ? observation.command.trim() : '';
  return {
    status: observation.status || (observation.passed === true || observation.ok === true ? 'passed' : 'unknown'),
    observedAt: observation.observedAt || null,
    commandRecorded: observedCommand !== '',
    commandMatches: observedCommand === check.command,
    artifactCount: observedArtifacts.filter(isNonEmptyString).length,
    requiredArtifactCount: Array.isArray(check.artifacts) ? check.artifacts.length : 0,
  };
}

function parseArgs(argv) {
  const parsed = {
    fixtureFile: '',
    contractFile: '',
    observationsFile: '',
    now: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--fixture') {
      parsed.fixtureFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--fixture=')) {
      parsed.fixtureFile = arg.slice('--fixture='.length);
      continue;
    }
    if (arg === '--contract-file' || arg === '--contract') {
      parsed.contractFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--contract-file=')) {
      parsed.contractFile = arg.slice('--contract-file='.length);
      continue;
    }
    if (arg.startsWith('--contract=')) {
      parsed.contractFile = arg.slice('--contract='.length);
      continue;
    }
    if (arg === '--observations-file' || arg === '--observations') {
      parsed.observationsFile = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--observations-file=')) {
      parsed.observationsFile = arg.slice('--observations-file='.length);
      continue;
    }
    if (arg.startsWith('--observations=')) {
      parsed.observationsFile = arg.slice('--observations='.length);
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
    throw new Error(`Unknown ${commandName} argument: ${arg}`);
  }

  return parsed;
}

function helpReport() {
  return {
    schemaVersion: 1,
    command: commandName,
    ok: true,
    releaseReady: false,
    releaseStatus: 'help',
    usage: [
      'node ./scripts/release/required-release-checks-report.mjs',
      'node ./scripts/release/required-release-checks-report.mjs --fixture fixtures/protocol/push-required-release-checks-contract.json',
      'node ./scripts/release/required-release-checks-report.mjs --observations-file path/to/observations.json --now 2026-05-28T08:30:00.000Z',
    ],
  };
}

function cliErrorReport(error) {
  return {
    exitCode: 2,
    report: {
      schemaVersion: 1,
      command: commandName,
      mode: 'cli-error',
      ok: false,
      releaseReady: false,
      releaseStatus: 'cli-error',
      requiredCount: 0,
      passedCount: 0,
      missingCount: 1,
      staleCount: 0,
      nonBlockingCount: 0,
      primaryFailureCode: 'REQUIRED_RELEASE_CHECKS_REPORT_CLI_ERROR',
      summary: {
        ok: false,
        releaseReady: false,
        requiredCount: 0,
        passedCount: 0,
        missingChecks: [
          {
            id: commandName,
            code: 'REQUIRED_RELEASE_CHECKS_REPORT_CLI_ERROR',
            reason: error.message,
            ownerScope: 'release-gates',
            severity: 'blocking',
            command: `node ./scripts/release/${commandName}.mjs`,
            artifacts: ['scripts/release/required-release-checks-report.mjs'],
          },
        ],
        staleChecks: [],
        nonBlockingChecks: [],
      },
      checks: [],
    },
  };
}

function releaseStatus(summary) {
  if (summary.releaseReady) {
    return 'release-ready';
  }
  if (summary.staleChecks.length > 0) {
    return 'stale';
  }
  return 'held';
}

function normalizeObservationPayload(payload) {
  if (isRecord(payload?.observations)) {
    return payload.observations;
  }
  if (Array.isArray(payload?.observations)) {
    return payload.observations;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload)) {
    return payload;
  }
  return {};
}

function normalizeObservations(observations) {
  const normalized = new Map();
  if (Array.isArray(observations)) {
    for (const observation of observations) {
      if (isNonEmptyString(observation?.id)) {
        normalized.set(observation.id.trim(), observation);
      }
    }
    return normalized;
  }
  if (isRecord(observations)) {
    for (const [id, observation] of Object.entries(observations)) {
      if (isRecord(observation)) {
        normalized.set(id, { id, ...observation });
      }
    }
  }
  return normalized;
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} not found: ${filePath}`);
    }
    throw new Error(`Unable to read ${label} ${filePath}: ${error.message}`);
  }
}

function resolveCliPath(value, cwd, label) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${label} must be a non-empty string.`);
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

function isoTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
