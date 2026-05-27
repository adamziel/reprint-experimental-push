#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const releaseSuiteManifestPath = path.join(
  repoRoot,
  'fixtures/protocol/push-production-release-suite-manifest.json',
);

export function loadReleaseSuiteManifest(manifestPath = releaseSuiteManifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function buildReleaseSuiteSummary({
  manifest = loadReleaseSuiteManifest(),
  env = process.env,
  runRelease = true,
  runSupport = false,
  now = new Date(),
} = {}) {
  assert.equal(manifest.releaseGateTotal, manifest.gates.length, 'release gate total must match manifest gates');

  const supportChecks = [];
  const gates = manifest.gates.map((gate) => {
    const supportEvidence = evaluateSupportEvidence({
      supportEvidence: gate.supportEvidence || [],
      env,
      manifest,
      runSupport,
      supportChecks,
    });
    const missingRequirement = firstMissingRequirement(gate.requiredEnv || [], env);

    if (missingRequirement) {
      return blockedGate(gate, {
        status: 'blocked',
        code: missingRequirement.code,
        reason: `missing required ${missingRequirement.id}`,
        firstMissing: missingRequirement.firstMissing,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
      });
    }

    if (gate.knownUnavailableProof) {
      return blockedGate(gate, {
        status: 'blocked',
        code: gate.knownUnavailableProof.code,
        reason: 'production proof is not implemented in this repository',
        firstMissing: gate.knownUnavailableProof.firstMissing,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
      });
    }

    if (!gate.releaseCommand) {
      return blockedGate(gate, {
        status: 'blocked',
        code: 'RELEASE_GATE_COMMAND_REQUIRED',
        reason: 'manifest gate has no release command',
        firstMissing: `command:${gate.id}`,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
      });
    }

    if (!runRelease) {
      return blockedGate(gate, {
        status: 'not-run',
        code: 'RELEASE_GATE_COMMAND_NOT_RUN',
        reason: 'release gate command was not run',
        firstMissing: `command:${gate.releaseCommand.label}`,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
      });
    }

    const commandResult = runCommand(gate.releaseCommand, env, manifest.defaultInjectedEnv || {});
    if (commandResult.status !== 0) {
      return blockedGate(gate, {
        status: 'failed',
        code: inferProofCode(commandResult.stdout, commandResult.stderr) || 'RELEASE_GATE_COMMAND_FAILED',
        reason: 'release gate command exited nonzero',
        firstMissing: `command:${gate.releaseCommand.label}`,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
        command: summarizeCommandResult(commandResult),
      });
    }

    let proof = null;
    try {
      proof = parseJsonOutput(commandResult.stdout);
    } catch (error) {
      return blockedGate(gate, {
        status: 'failed',
        code: 'RELEASE_GATE_PROOF_JSON_REQUIRED',
        reason: error.message,
        firstMissing: `command:${gate.releaseCommand.label}`,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
        command: summarizeCommandResult(commandResult),
      });
    }

    const acceptance = evaluateProofAcceptance(gate.proofAcceptance || [], proof);
    if (!acceptance.ok) {
      return blockedGate(gate, {
        status: 'blocked',
        code: 'RELEASE_GATE_PROOF_NOT_ACCEPTED',
        reason: `proof acceptance failed at ${acceptance.failed?.path || 'unknown path'}`,
        firstMissing: `api:${gate.id} accepted production proof`,
        requirements: requirementStatuses(gate.requiredEnv || [], env),
        supportEvidence,
        command: summarizeCommandResult(commandResult),
        proofAcceptance: acceptance,
      });
    }

    return {
      id: gate.id,
      name: gate.name,
      status: 'open',
      code: 'RELEASE_GATE_OK',
      claim: gate.claim,
      command: summarizeCommandResult(commandResult),
      proofAcceptance: acceptance,
      requirements: requirementStatuses(gate.requiredEnv || [], env),
      supportEvidence,
    };
  });

  const open = gates.filter((gate) => gate.status === 'open').length;
  const supportFailures = supportChecks.filter((check) => check.status === 'failed');
  const firstBlocker = gates.find((gate) => gate.status !== 'open') || null;

  return {
    ok: open === manifest.releaseGateTotal && supportFailures.length === 0,
    generatedAt: now.toISOString(),
    checkedCommand: manifest.checkedCommand,
    contractId: manifest.contractId,
    networkPolicy: manifest.networkPolicy,
    evidencePolicy: manifest.evidencePolicy,
    releaseGates: {
      open,
      total: manifest.releaseGateTotal,
      status: open === manifest.releaseGateTotal ? 'open' : 'blocked',
      firstBlocker: firstBlocker
        ? {
            gate: firstBlocker.id,
            code: firstBlocker.code,
            firstMissing: firstBlocker.firstMissing,
          }
        : null,
    },
    gates,
    supportChecks,
  };
}

function evaluateSupportEvidence({
  supportEvidence,
  env,
  manifest,
  runSupport,
  supportChecks,
}) {
  return supportEvidence.map((evidence) => {
    if (!runSupport) {
      const summary = {
        id: evidence.id,
        classification: evidence.classification || 'support-only',
        status: 'not-run',
        command: evidence.command?.label || null,
      };
      supportChecks.push(summary);
      return summary;
    }

    const result = runCommand(evidence.command, env, manifest.defaultInjectedEnv || {});
    const summary = {
      id: evidence.id,
      classification: evidence.classification || 'support-only',
      status: result.status === 0 ? 'passed' : 'failed',
      command: evidence.command?.label || null,
      result: summarizeCommandResult(result),
    };
    supportChecks.push(summary);
    return summary;
  });
}

function blockedGate(gate, details) {
  return {
    id: gate.id,
    name: gate.name,
    claim: gate.claim,
    status: details.status,
    code: details.code,
    reason: details.reason,
    firstMissing: details.firstMissing,
    requirements: details.requirements,
    supportEvidence: details.supportEvidence,
    ...(details.command ? { command: details.command } : {}),
    ...(details.proofAcceptance ? { proofAcceptance: details.proofAcceptance } : {}),
  };
}

function firstMissingRequirement(requirements, env) {
  return requirements.map((requirement) => evaluateRequirement(requirement, env)).find((result) => !result.ok) || null;
}

function requirementStatuses(requirements, env) {
  return requirements.map((requirement) => {
    const result = evaluateRequirement(requirement, env);
    return {
      id: requirement.id,
      ok: result.ok,
      code: requirement.code,
      required: describeRequirement(requirement),
      ...(result.ok ? {} : { firstMissing: result.firstMissing }),
    };
  });
}

function evaluateRequirement(requirement, env) {
  if (Array.isArray(requirement.anyOf)) {
    const ok = requirement.anyOf.some((name) => hasEnvValue(env, name));
    return {
      id: requirement.id,
      ok,
      code: requirement.code,
      firstMissing: requirement.firstMissing || `env:${requirement.anyOf.join(' or ')}`,
    };
  }

  if (requirement.equals && typeof requirement.equals === 'object') {
    const entries = Object.entries(requirement.equals);
    const ok = entries.every(([name, expected]) => String(env[name] || '') === String(expected));
    return {
      id: requirement.id,
      ok,
      code: requirement.code,
      firstMissing: requirement.firstMissing || `env:${entries.map(([name]) => name).join(',')}`,
    };
  }

  if (Array.isArray(requirement.urlFromAnyOf)) {
    const rawUrl = firstEnvValue(env, requirement.urlFromAnyOf);
    const ok = sourceUrlAllowed(rawUrl, requirement, env);
    return {
      id: requirement.id,
      ok,
      code: requirement.code,
      firstMissing: requirement.firstMissing || `api:${requirement.urlFromAnyOf.join(' or ')}`,
    };
  }

  return {
    id: requirement.id,
    ok: true,
    code: requirement.code,
    firstMissing: requirement.firstMissing || `requirement:${requirement.id}`,
  };
}

function describeRequirement(requirement) {
  if (Array.isArray(requirement.anyOf)) {
    return `one of ${requirement.anyOf.join(', ')}`;
  }
  if (requirement.equals && typeof requirement.equals === 'object') {
    return Object.entries(requirement.equals).map(([name, value]) => `${name}=${value}`).join(', ');
  }
  if (Array.isArray(requirement.urlFromAnyOf)) {
    const protocols = (requirement.allowedProtocols || []).join(', ');
    return `${requirement.urlFromAnyOf.join(' or ')} with protocol ${protocols}`;
  }
  return requirement.id;
}

function hasEnvValue(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

function firstEnvValue(env, names) {
  for (const name of names) {
    if (hasEnvValue(env, name)) {
      return env[name].trim();
    }
  }
  return '';
}

function sourceUrlAllowed(rawUrl, requirement, env) {
  if (!rawUrl) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if ((requirement.allowedProtocols || []).includes(parsed.protocol)) {
    return true;
  }

  if (requirement.allowLoopbackWhen && env[requirement.allowLoopbackWhen] === '1') {
    return isLoopbackHost(parsed.hostname);
  }

  return false;
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || /^127\./.test(hostname);
}

function runCommand(commandSpec, env, defaultEnv) {
  assert.ok(commandSpec?.command, 'command spec must include command');
  const startedAt = Date.now();
  const result = spawnSync(commandSpec.command, commandSpec.args || [], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: commandSpec.timeoutMs || 120000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      ...env,
      ...defaultEnv,
      ...(commandSpec.env || {}),
    },
  });
  return {
    label: commandSpec.label || [commandSpec.command, ...(commandSpec.args || [])].join(' '),
    status: result.status,
    signal: result.signal,
    error: result.error
      ? {
          name: result.error.name,
          code: result.error.code || null,
          message: result.error.message,
        }
      : null,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function summarizeCommandResult(result) {
  return {
    label: result.label,
    status: result.status,
    signal: result.signal || null,
    error: result.error,
    durationMs: result.durationMs,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

function tail(text, limit = 2000) {
  const value = String(text || '');
  return value.length > limit ? value.slice(-limit) : value;
}

function inferProofCode(stdout, stderr) {
  const text = `${stdout || ''}\n${stderr || ''}`;
  const match = text.match(/"code":\s*"([^"]+)"/) || text.match(/\b(REPRINT_PUSH_[A-Z_]+|PRODUCTION_[A-Z_]+)\b/);
  return match ? match[1] : null;
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('release gate command did not emit a JSON proof object');
  }
  return JSON.parse(extractFirstJsonObject(text.slice(firstBrace)));
}

function extractFirstJsonObject(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(0, index + 1);
      }
    }
  }

  throw new Error('release gate command emitted an unterminated JSON proof object');
}

function evaluateProofAcceptance(criteria, proof) {
  const checks = criteria.map((criterion) => {
    const actual = getPath(proof, criterion.path);
    const ok = Object.is(actual, criterion.equals);
    return {
      path: criterion.path,
      ok,
      expected: criterion.equals,
      actual,
    };
  });
  return {
    ok: checks.every((check) => check.ok),
    checks,
    failed: checks.find((check) => !check.ok) || null,
  };
}

function getPath(value, pathExpression) {
  return String(pathExpression || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => {
      if (current === null || current === undefined) {
        return undefined;
      }
      return current[key];
    }, value);
}

function parseArgs(argv) {
  const options = {
    runRelease: true,
    runSupport: false,
    printManifest: false,
    allowBlocked: false,
  };

  for (const arg of argv) {
    if (arg === '--no-run') {
      options.runRelease = false;
      continue;
    }
    if (arg === '--run-support') {
      options.runSupport = true;
      continue;
    }
    if (arg === '--manifest') {
      options.printManifest = true;
      continue;
    }
    if (arg === '--allow-blocked') {
      options.allowBlocked = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const manifest = loadReleaseSuiteManifest();
    if (options.printManifest) {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      process.exit(0);
    }
    const summary = buildReleaseSuiteSummary({
      manifest,
      env: process.env,
      runRelease: options.runRelease,
      runSupport: options.runSupport,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(summary.ok || options.allowBlocked ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  }
}
