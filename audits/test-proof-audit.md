# Test Proof Audit

This note isolates what the current tests actually prove and what they do not prove for the release objective.

## Test Coverage Verdict

The suite is useful, but it is still not release proof.

| Test surface | What it proves | What it does not prove | Release value |
| --- | --- | --- | --- |
| `test/push-planner.test.js` and `npm test` | Planner refusal, remote-change protection, local deletion blocking, plugin-owned data blocking, and fixture-level conflict handling | No live-source mutation, no production storage boundary, no end-to-end no-loss proof, no real remote/local topology | Blocker evidence only |
| `test/recovery-journal.test.js` | File-backed journal monotonicity, redaction, restart classification, and blocked recovery states | No durable production journal, no lease/fencing regime, no real crash recovery on the source boundary | Blocker evidence only |
| `test/performance-model.test.js` | Benchmark shape, guardrails, refusal discipline, and safe-fast-path modeling | No measured throughput, no memory ceiling, no runtime threshold on a live push path | Blocker evidence only |
| `test/guarded-executor-benchmark.test.js` | Explicit refusal of unsupported throughput claims and tamper detection for benchmark evidence | No positive speed claim, no production-shaped timing result, no live-path benchmark threshold | Blocker evidence only |
| `npm run test:playground:*` | Lab/fixture route shape, auth/session scaffolding, storage guard behavior, stale-claim classification, and journal smoke paths | No real remote/local topology, no production storage path, no enforced release gate | Lab evidence only |

## Why The Suite Is Not Enough

The tests are credible because they reject unsafe shortcuts.
They are not enough because they do not execute the same live-source boundary that the release objective names.

That means the current suite can support these statements:

- unsafe planner actions are blocked in fixtures
- journal redaction and replay shape are preserved in local files
- unsupported speed claims are refused
- lab routes still identify themselves as lab-backed
- plugin-owned data and file/database fixtures remain protected by local-only guards

It cannot yet support these statements:

- a production WordPress source site survives a failed push with no data loss
- the release path is reliable across crash, retry, lease, fencing, and duplicate-request cases
- the push path is fast enough on the live source boundary to support a production speed claim
- one enforced gate prevents a green lab-only run from being mistaken for release approval

## Minimal Release Bar

The current test surface remains necessary, but not sufficient.

Before any release claim can stand, the repository still needs one required command that:

1. Runs the auth/session, journal, lease/fencing, graph-identity, plugin-driver, topology, crash-boundary, and benchmark checks together.
2. Fails closed on any `labBacked: true`, fixture-only, benchmark-only, or missing-live-source proof.
3. Prints the last failing proof bucket before exiting non-zero.
4. Is wired into checked-in automation so it cannot be bypassed by choosing a weaker command.
